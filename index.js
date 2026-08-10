const fs = require('fs');
const crypto = require('crypto');
const templates = require('./templates.js');

const EVENTS_DIR = './dist/concerts';
const HISTORY_FILE = './dist/history.json';
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// How many events stay in the paginated listing (per category: upcoming /
// past), and how many total we keep in persisted history across runs.
const MAX_PER_CATEGORY = 200;
const PAGE_SIZE = 20;

const CATEGORIES = [
  { slug: 'a-venir', label: 'À venir' },
  { slug: 'historique', label: 'Historique' },
];
const PRIMARY_CATEGORY = CATEGORIES[0].slug;

fs.mkdirSync('./dist', { recursive: true });
fs.mkdirSync(EVENTS_DIR, { recursive: true });

function createFile(fileName, data) {
  fs.mkdirSync(fileName.substring(0, fileName.lastIndexOf('/')), { recursive: true });
  fs.writeFileSync(fileName, data);
}

// dist/history.json is seeded by the GitHub Actions workflow from the
// previously deployed gh-pages before this script runs, so events survive
// in the "Historique" listing even after they fall out of the live source
// (concerts-metal.com only ever lists what's ahead — there's no "past
// events" page there, so our own persisted history *is* the archive).
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    return { events: raw.events && typeof raw.events === 'object' ? raw.events : {} };
  } catch {
    return { events: {} };
  }
}

function slugFor(id) {
  return crypto.createHash('md5').update(id).digest('hex').slice(0, 12);
}

function todayISO() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // sv-SE => YYYY-MM-DD
}

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITY_MAP[name])
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// Source: toulouse.concerts-metal.com — the city-subdomain of
// concerts-metal.com (same publisher as the FR-N__Midi_Pyrenees page, whose
// path-based URL sits behind a Cloudflare Turnstile captcha and can't be
// scraped). The subdomain isn't behind that same challenge and embeds each
// show as schema.org MusicEvent microdata: venue, date, band lineup with
// genre tags, and ticket/Facebook links — no headless browser needed.
const EVENT_BLOCK_SPLIT = '<div itemscope itemtype="https://schema.org/MusicEvent">';

function extractTicketUrl(hrefs, exclude) {
  const raw = hrefs.find((h) => !exclude.includes(h));
  if (!raw) return null;
  try {
    const redir = new URL(raw).searchParams.get('redir');
    return redir ? decodeURIComponent(redir) : raw;
  } catch {
    return raw;
  }
}

function parseConcertsMetalBlock(block) {
  const names = [...block.matchAll(/<meta itemprop="name" content="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
  const commune = block.match(/<meta itemprop="addressLocality" content="([^"]*)"/);
  const dateStart = block.match(/<meta itemprop="startDate" content="([^"]*)"/);
  const dateEnd = block.match(/<meta itemprop="endDate" content="([^"]*)"/);
  if (!names.length || !dateStart) return null;

  const bands = [...block.matchAll(/<b>([^<]*)<\/b>\s*<i>([^<]*)<\/i>/g)]
    .map((m) => ({ name: decodeEntities(m[1]), genre: decodeEntities(m[2]) }));
  const genres = [...new Set(bands.map((b) => b.genre).filter(Boolean))];

  const hrefs = [...block.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
  const facebookUrl = hrefs.find((h) => h.includes('facebook.com')) || null;
  const detailUrl = hrefs.find((h) => h.includes('concerts-metal.com/concert')) || null;
  const ticketUrl = extractTicketUrl(hrefs, [facebookUrl, detailUrl].filter(Boolean));

  const venue = names[0];
  const title = bands.length ? bands.map((b) => b.name).join(' + ') : (names[1] || names[0]);

  return {
    id: `cm:${[dateStart[1], venue, bands.map((b) => b.name).join(',') || title].join('|').toLowerCase()}`,
    title,
    bands,
    genres,
    venue,
    commune: commune ? commune[1] : '',
    dateStart: dateStart[1],
    dateEnd: dateEnd ? dateEnd[1] : dateStart[1],
    url: detailUrl,
    ticketUrl,
    facebookUrl,
    source: 'Concerts-Metal.com',
  };
}

async function fetchConcertsMetalToulouse() {
  const html = await fetchText('https://toulouse.concerts-metal.com/');
  const blocks = html.split(EVENT_BLOCK_SPLIT).slice(1);
  const events = [];
  const seenIds = new Set();
  for (const block of blocks) {
    const ev = parseConcertsMetalBlock(block);
    // The source itself sometimes double-lists a show (once from its own
    // agenda, once cross-posted from Facebook) — same venue/date/lineup,
    // different blurb. Our id is built from exactly those fields.
    if (!ev || seenIds.has(ev.id)) continue;
    seenIds.add(ev.id);
    events.push(ev);
  }
  return events;
}

function paginate(items) {
  const pages = [];
  for (let i = 0; i < items.length || i === 0; i += PAGE_SIZE) {
    pages.push(items.slice(i, i + PAGE_SIZE));
    if (items.length === 0) break;
  }
  return pages;
}

function categoryDir(slug) {
  return slug === PRIMARY_CATEGORY ? '' : `${slug}/`;
}

function pagePath(slug, pageNum) {
  const dir = categoryDir(slug);
  return pageNum === 1 ? `${dir}index.html` : `${dir}page/${pageNum}.html`;
}

function rootPrefixFor(slug, pageNum) {
  const depth = (slug === PRIMARY_CATEGORY ? 0 : 1) + (pageNum === 1 ? 0 : 1);
  return '../'.repeat(depth);
}

function pageHref(targetPage, currentSlug, currentPage) {
  return rootPrefixFor(currentSlug, currentPage) + pagePath(currentSlug, targetPage);
}

function paginationNav(pageNum, totalPages, slug) {
  if (totalPages <= 1) return '';
  const prev = pageNum > 1
    ? `<a class="page-link" href="${pageHref(pageNum - 1, slug, pageNum)}">&larr; Plus tôt</a>`
    : `<span class="page-link is-disabled">&larr; Plus tôt</span>`;
  const next = pageNum < totalPages
    ? `<a class="page-link" href="${pageHref(pageNum + 1, slug, pageNum)}">Plus tard &rarr;</a>`
    : `<span class="page-link is-disabled">Plus tard &rarr;</span>`;
  return `<nav class="pagination" aria-label="Pagination">
    ${prev}
    <span class="page-status">Page ${pageNum} / ${totalPages}</span>
    ${next}
  </nav>`;
}

(async () => {
  const state = loadState();

  const fresh = await fetchConcertsMetalToulouse().catch((err) => {
    console.warn(`concerts-metal.com fetch failed: ${err.message}`);
    return [];
  });
  console.log(`Fetched ${fresh.length} concerts from toulouse.concerts-metal.com.`);

  // Merge into persisted history: upsert by id so events survive even after
  // concerts-metal.com's own rolling agenda stops listing them. Drop any
  // history from a previous source generation (ids not prefixed "cm:") —
  // this repo briefly ran on generic open-data listings before switching
  // to concerts-metal.com, and those weren't metal shows.
  const events = Object.fromEntries(Object.entries(state.events).filter(([id]) => id.startsWith('cm:')));
  for (const ev of fresh) {
    events[ev.id] = { ...ev, slug: slugFor(ev.id) };
  }
  for (const id of Object.keys(events)) {
    if (!events[id].slug) events[id].slug = slugFor(id);
  }

  const today = todayISO();
  const all = Object.values(events);
  // Multi-day events already in progress (dateStart in the past, dateEnd
  // still ahead) should sort by how much of their run is left, not by
  // their original start date — otherwise an ongoing week-long festival
  // permanently pins itself above one-off concerts starting tomorrow.
  const upcomingSortKey = (e) => (e.dateStart < today ? today : e.dateStart);
  const upcoming = all
    .filter((e) => (e.dateEnd || e.dateStart) >= today)
    .sort((a, b) => upcomingSortKey(a).localeCompare(upcomingSortKey(b)))
    .slice(0, MAX_PER_CATEGORY)
    .map((e) => ({ ...e, cardDate: upcomingSortKey(e) }));
  const past = all
    .filter((e) => (e.dateEnd || e.dateStart) < today)
    .sort((a, b) => b.dateStart.localeCompare(a.dateStart))
    .slice(0, MAX_PER_CATEGORY);

  // Only persist events still reachable from a listing page, so
  // dist/history.json (and the repo it lives in) doesn't grow forever.
  const keepIds = new Set([...upcoming, ...past].map((e) => e.id));
  const trimmedEvents = Object.fromEntries(Object.entries(events).filter(([id]) => keepIds.has(id)));
  createFile(HISTORY_FILE, JSON.stringify({ events: trimmedEvents }));

  for (const ev of Object.values(trimmedEvents)) {
    createFile(`${EVENTS_DIR}/${ev.slug}.html`, templates.eventPage(ev));
  }

  const byCategory = { 'a-venir': upcoming, historique: past };

  for (const category of CATEGORIES) {
    const pages = paginate(byCategory[category.slug]);
    pages.forEach((pageItems, i) => {
      const pageNum = i + 1;
      const rootPrefix = rootPrefixFor(category.slug, pageNum);
      const switchLinks = CATEGORIES.map((c) => ({
        slug: c.slug,
        label: c.label,
        href: rootPrefix + pagePath(c.slug, 1),
      }));
      let body = `<section class="news-section">`;
      if (pageItems.length === 0) {
        body += `<p class="empty-state">Aucun concert ${category.slug === 'a-venir' ? 'à venir' : 'passé'} pour le moment.</p>`;
      } else {
        body += '<div class="news-grid">';
        body += pageItems.map((entry) => templates.eventCardTemplate(entry, rootPrefix)).join('');
        body += '</div>';
      }
      body += `</section>`;
      body += paginationNav(pageNum, pages.length, category.slug);

      const html = templates.document(body, { basePrefix: rootPrefix, switchLinks, activeCategory: category.slug });
      createFile(`./dist/${pagePath(category.slug, pageNum)}`, html);
    });
  }
})();
