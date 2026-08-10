const fs = require('fs');
const crypto = require('crypto');
const he = require('he');
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
// in the "Historique" listing even after the source stops listing them.
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

function normalizeForKey(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    const snippet = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`HTTP ${res.status} for ${url} — body: ${snippet}`);
  }
  return res.text();
}

function extractTicketUrl(rawUrl) {
  if (!rawUrl) return null;
  try {
    const redir = new URL(rawUrl).searchParams.get('redir');
    return redir ? decodeURIComponent(redir) : rawUrl;
  } catch {
    return rawUrl;
  }
}

function formatPrice(offers, isFree) {
  if (isFree) return 'Gratuit';
  const o = Array.isArray(offers) ? offers[0] : offers;
  if (!o) return null;
  if (o.lowPrice && o.highPrice && o.lowPrice !== o.highPrice) return `${o.lowPrice} – ${o.highPrice} €`;
  if (o.lowPrice) return `${o.lowPrice} €`;
  if (o.price) return `${o.price} €`;
  return null;
}

// Source: JDS.fr's "Rock" listing for Toulouse. Chosen over
// concerts-metal.com (which is exactly on-genre but sits behind Cloudflare
// on its main domain, and its city-subdomain — clean, unprotected, and
// scrapable from a normal machine — turned out to still be blocked from
// GitHub Actions runners specifically: Cloudflare's bot scoring flags the
// well-known GitHub-hosted-runner IP ranges regardless of headers). JDS.fr
// is plain nginx/PHP, robots.txt allows it, and each listing embeds a full
// schema.org MusicEvent as JSON-LD — venue, address, geo, lineup, price,
// ticket link. "Rock" isn't metal-exclusive (it also carries blues, tribute
// bands, arena pop-rock), so results are filtered through a metal/hardcore/
// punk keyword match afterwards.
const JDS_ROCK_URL = 'https://www.jds.fr/toulouse/agenda/rock-111_B';
const MAX_PAGES = 6;

const METAL_RE = /\bmetal\b|hardcore|punk|thrash|deathcore|metalcore|grindcore|\bdoom\b|\bgrind\b|\bstoner\b|\bsludge\b|black.?metal|death.?metal|power.?metal|folk.?metal|gothic.?metal|nu.?metal|hard.?rock/i;

function looksLikeMetal(text) {
  return METAL_RE.test(text);
}

function parseJdsEvent(it) {
  if (!it || it['@type'] !== 'MusicEvent' || !it.startDate) return null;
  const title = he.decode(it.name || '');
  const performer = Array.isArray(it.performer) ? it.performer : (it.performer ? [it.performer] : []);
  const bands = performer.filter((p) => p && p.name).map((p) => ({ name: he.decode(p.name) }));
  const description = he.decode(it.description || '').trim();

  const matchText = `${title} ${description} ${bands.map((b) => b.name).join(' ')}`;
  if (!looksLikeMetal(matchText)) return null;

  const location = it.location || {};
  const addr = location.address || {};
  const geo = location.geo || {};
  const venue = he.decode(location.name || '');
  const commune = he.decode(addr.addressLocality || '');
  const streetAddress = he.decode(addr.streetAddress || '');
  const address = [streetAddress, [addr.postalCode, commune].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const dateStart = (it.startDate || '').slice(0, 10);
  const dateEnd = (it.endDate || it.startDate || '').slice(0, 10) || dateStart;

  const offer = Array.isArray(it.offers) ? it.offers[0] : it.offers;

  return {
    id: `jds:${normalizeForKey([dateStart, venue, title].join('|'))}`,
    title,
    bands,
    description,
    venue,
    commune,
    address,
    lat: typeof geo.latitude === 'number' ? geo.latitude : null,
    lon: typeof geo.longitude === 'number' ? geo.longitude : null,
    dateStart,
    dateEnd,
    price: formatPrice(it.offers, it.isAccessibleForFree),
    ticketUrl: offer ? extractTicketUrl(offer.url) : null,
    url: it.url || null,
    source: 'JDS.fr',
  };
}

async function fetchJdsRock() {
  const events = [];
  const seenIds = new Set();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? JDS_ROCK_URL : `${JDS_ROCK_URL}?page=${page}`;
    const html = await fetchText(url);
    const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => m[1]);
    let pageEventCount = 0;
    for (const raw of scripts) {
      let data;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        if (!it || it['@type'] !== 'MusicEvent') continue;
        pageEventCount++;
        const ev = parseJdsEvent(it);
        if (!ev || seenIds.has(ev.id)) continue;
        seenIds.add(ev.id);
        events.push(ev);
      }
    }
    if (pageEventCount === 0) break;
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

  const fresh = await fetchJdsRock().catch((err) => {
    console.warn(`JDS.fr fetch failed: ${err.message}`);
    createFile('./dist/debug.txt', `${new Date().toISOString()}\n${err.stack || err.message}\n`);
    return [];
  });
  console.log(`Fetched ${fresh.length} metal/hardcore/punk concerts from JDS.fr.`);

  // Merge into persisted history: upsert by id so events survive even after
  // JDS.fr's own listing stops carrying them. Drop history from a previous
  // source generation (ids not prefixed "jds:") — this repo has already
  // been through two source swaps (generic open data, then concerts-metal.com,
  // both abandoned) and neither's leftovers belong in this one's archive.
  const events = Object.fromEntries(Object.entries(state.events).filter(([id]) => id.startsWith('jds:')));
  for (const ev of fresh) {
    events[ev.id] = { ...ev, slug: slugFor(ev.id) };
  }

  const today = todayISO();
  const all = Object.values(events);
  // Multi-day events already in progress (dateStart in the past, dateEnd
  // still ahead) should sort by how much of their run is left, not by
  // their original start date — otherwise an ongoing festival permanently
  // pins itself above one-off concerts starting tomorrow.
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
