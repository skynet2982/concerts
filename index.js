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

async function fetchJson(url) {
  return JSON.parse(await fetchText(url));
}

function stripTags(html) {
  const withoutScripts = String(html || '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return he.decode(withoutScripts).replace(/\s+/g, ' ').trim();
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

// Source 2: concertandco.com's own "Metal-Hardcore-Hard Rock" category for
// Midi-Pyrénées / Languedoc-Roussillon — genuinely metal-curated (no
// keyword filter needed, unlike JDS's generic "Rock"), covers venues
// outside Toulouse city, and isn't behind Cloudflare either. Volume is
// modest (a handful of listings at a time) so it supplements JDS.fr rather
// than replacing it. No JSON-LD here — events are parsed out of plain HTML.
const CONCERTANDCO_URL = 'https://www.concertandco.com/region-style/midi-pyrenees-languedoc-roussillon/metal-hardcore-hard-rock/billet-concert-2-MID.htm';
const CONCERTANDCO_EVENT_RE = /<a name=(\d{4}-\d{2}-\d{2})>.*?<h3 class="libelle bbox">(.*?)<span class=genre>(.*?)<\/span>\s*<\/h3>(.*?)<\/div>\s*<\/div>\s*<\/div>/gs;

function splitVenueCommune(rawVenue) {
  // "Le Bikini - Ramonville / Toulouse (31)" -> { venue: "Le Bikini", commune: "Ramonville / Toulouse" }
  const m = rawVenue.match(/^(.*?)\s*-\s*([^(]+?)(?:\s*\(\d+\))?$/);
  return m ? { venue: m[1].trim(), commune: m[2].trim() } : { venue: rawVenue.trim(), commune: '' };
}

function parseConcertAndCoBlock(dateStart, titleRaw, genreBlock, rest) {
  const title = he.decode(titleRaw).trim();
  const genres = [...new Set([...genreBlock.matchAll(/icon-music-([a-z]+)/g)].map((m) => m[1]))]
    .map((g) => g.charAt(0).toUpperCase() + g.slice(1));
  const venueMatch = rest.match(/class="salle icon-marqueurmap">(?:<a[^>]*>)?([^<]*)/);
  const { venue, commune } = venueMatch ? splitVenueCommune(he.decode(venueMatch[1]).trim()) : { venue: '', commune: '' };
  const priceMatch = rest.match(/class="prix icon-tickets">([^<]*)</);
  const ticketMatch = rest.match(/class="reserver bbox"[^>]*href="([^"]*)"/) || rest.match(/href="([^"]*)" class="reserver bbox"/);
  const descMatch = rest.match(/class=txt>(.*?)<\/span>/s);

  return {
    id: `cac:${normalizeForKey([dateStart, venue, title].join('|'))}`,
    title,
    bands: [],
    description: [genres.length ? `Genres : ${genres.join(', ')}` : '', descMatch ? he.decode(descMatch[1].replace(/<br\s*\/?>/g, '\n')) : '']
      .filter(Boolean).join('\n\n'),
    venue,
    commune,
    address: '',
    lat: null,
    lon: null,
    dateStart,
    dateEnd: dateStart,
    price: priceMatch ? he.decode(priceMatch[1]).trim() : null,
    ticketUrl: ticketMatch ? ticketMatch[1] : null,
    url: `${CONCERTANDCO_URL}#${dateStart}`,
    source: 'ConcertAndCo.com',
  };
}

async function fetchConcertAndCo() {
  const html = await fetchText(CONCERTANDCO_URL);
  const events = [];
  const seenIds = new Set();
  for (const m of html.matchAll(CONCERTANDCO_EVENT_RE)) {
    const [, dateStart, titleRaw, genreBlock, rest] = m;
    const ev = parseConcertAndCoBlock(dateStart, titleRaw, genreBlock, rest);
    if (seenIds.has(ev.id)) continue;
    seenIds.add(ev.id);
    events.push(ev);
  }
  return events;
}

// Source 3: Le Metronum's own WordPress "Tribe Events" REST API. Metronum
// is a general "scène de musiques actuelles" (hip-hop, world, chanson,
// metal all mixed under one "Concert" category), so — like JDS — results
// go through the metal/hardcore/punk keyword filter.
const METRONUM_API = 'https://lemetronum.fr/wp-json/tribe/events/v1/events';

async function fetchMetronum() {
  const url = `${METRONUM_API}?start_date=${todayISO()}&categories=concert&per_page=50`;
  const data = await fetchJson(url);
  const events = [];
  for (const e of data.events || []) {
    const title = he.decode(e.title || '');
    const description = stripTags(e.description || '');
    if (!looksLikeMetal(`${title} ${description}`)) continue;

    const dateStart = (e.start_date || '').slice(0, 10);
    const dateEnd = (e.end_date || e.start_date || '').slice(0, 10) || dateStart;
    const venue = he.decode(e.venue?.venue || '');
    const commune = he.decode(e.venue?.city || '');
    const address = [e.venue?.address, [e.venue?.zip, commune].filter(Boolean).join(' ')].filter(Boolean).join(', ');

    events.push({
      id: `metronum:${normalizeForKey([dateStart, venue, title].join('|'))}`,
      title,
      bands: [],
      description,
      venue,
      commune,
      address,
      lat: e.venue?.geo_lat ? Number(e.venue.geo_lat) : null,
      lon: e.venue?.geo_lng ? Number(e.venue.geo_lng) : null,
      dateStart,
      dateEnd,
      price: e.cost || null,
      ticketUrl: e.website || null,
      url: e.url || null,
      source: 'Le Metronum',
    });
  }
  return events;
}

// Source 4: Interférence (Balma) — a Next.js site that ships its event data
// as JSON in a __NEXT_DATA__ script tag, and supports server-side genre-tag
// filtering via ?tags=. Only the "metal" tag is used: this site's "hardcore"
// tag turned out to mean hardcore *techno* (a electronic/gabber genre), not
// hardcore punk — filtering on it would pull in techno nights by mistake,
// so unlike JDS/Metronum this source trusts the site's own tagging rather
// than a keyword match, but only for the one unambiguous tag.
const INTERFERENCE_URL = 'https://www.interference-toulouse.fr/programmation?tags=metal';

async function fetchInterference() {
  const html = await fetchText(INTERFERENCE_URL);
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!m) return [];
  const data = JSON.parse(m[1]);
  const rawEvents = data?.props?.pageProps?.events || [];
  return rawEvents.map((e) => {
    const dateStart = (e.event_starting || '').slice(0, 10);
    const dateEnd = (e.event_ending || e.event_starting || '').slice(0, 10) || dateStart;
    // venue_name/venue_address carry stray tabs/newlines in this site's own
    // CMS data — collapse whitespace rather than passing it straight through.
    const venueName = he.decode(e.venue_name || '').replace(/\s+/g, ' ').trim();
    const venue = venueName + (e.venue_room ? ` (${he.decode(e.venue_room)})` : '');
    const address = he.decode(e.venue_address || '').replace(/\s+/g, ' ').trim();
    const communeMatch = address.match(/\d{5}\s+(.*)$/);
    return {
      id: `interference:${normalizeForKey([dateStart, venue, e.event_name].join('|'))}`,
      title: he.decode(e.event_name || ''),
      bands: [],
      description: '',
      venue,
      commune: communeMatch ? communeMatch[1].trim() : '',
      address,
      lat: null,
      lon: null,
      dateStart,
      dateEnd,
      price: e.start_price ? `À partir de ${e.start_price} €` : null,
      ticketUrl: e.event_external_ticketing_url || null,
      url: INTERFERENCE_URL,
      source: 'Interférence',
    };
  });
}

// Source 5: Noiser — a small Toulouse rock/metal/stoner promoter, mostly
// booking Le Rex. Only ~5 shows live at a time, so each is checked against
// its own detail page (which spells out each act's genre in parentheses,
// e.g. "MOURIR (Black Metal - France)") rather than relying on the sparse
// listing-page title alone.
const NOISER_URL = 'https://www.noiser.fr/programmation';
const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function parseFrenchDate(str) {
  const m = str.match(/(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i);
  if (!m) return null;
  const monthIdx = FR_MONTHS.findIndex((mo) => mo === m[2].toLowerCase());
  if (monthIdx === -1) return null;
  const day = m[1].padStart(2, '0');
  const month = String(monthIdx + 1).padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

async function fetchNoiser() {
  const html = await fetchText(NOISER_URL);
  const blocks = html.split('<div class="event row">').slice(1);
  const candidates = [];
  for (const b of blocks) {
    const h2 = b.match(/<h2>(.*?)<\/h2>/s);
    const h3 = b.match(/<h3>(.*?)<\/h3>/s);
    const moreLink = b.match(/href="([^"]*)">\s*Plus d'informations/);
    if (!h2 || !h3 || !moreLink) continue;
    const parts = stripTags(h3[1]).split('|').map((s) => s.trim());
    const dateStart = parseFrenchDate(parts[0] || '');
    if (!dateStart) continue;
    candidates.push({
      title: he.decode(stripTags(h2[1])),
      venue: parts[2] || '',
      dateStart,
      detailUrl: new URL(moreLink[1], NOISER_URL).href,
    });
  }

  const events = [];
  for (const c of candidates) {
    const detailText = stripTags(await fetchText(c.detailUrl).catch(() => ''));
    if (!looksLikeMetal(detailText)) continue;
    const addrMatch = detailText.match(/Adresse\s+(.*?)\s+Transports/);
    // Real copy starts after the nav breadcrumbs ("Presentation Programmation
    // Galerie... Noiser présente : ✘ BAND (Genre - Country)...") — drop
    // everything before that so the description doesn't open with site chrome.
    const contentStart = detailText.indexOf('Noiser présente');
    const description = contentStart >= 0 ? detailText.slice(contentStart) : detailText;
    events.push({
      id: `noiser:${normalizeForKey([c.dateStart, c.venue, c.title].join('|'))}`,
      title: c.title,
      bands: [],
      description: description.slice(0, 800),
      venue: c.venue,
      commune: '',
      address: addrMatch ? addrMatch[1] : '',
      lat: null,
      lon: null,
      dateStart: c.dateStart,
      dateEnd: c.dateStart,
      price: null,
      ticketUrl: c.detailUrl,
      url: c.detailUrl,
      source: 'Noiser',
    });
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

  // Listed in dedup priority order: when the same concert legitimately
  // appears on two sites, whichever is fetched first here wins.
  const SOURCES = [
    { prefix: 'jds', name: 'JDS.fr', fetcher: fetchJdsRock },
    { prefix: 'metronum', name: 'Le Metronum', fetcher: fetchMetronum },
    { prefix: 'interference', name: 'Interférence', fetcher: fetchInterference },
    { prefix: 'cac', name: 'ConcertAndCo.com', fetcher: fetchConcertAndCo },
    { prefix: 'noiser', name: 'Noiser', fetcher: fetchNoiser },
  ];

  const debugLines = [];
  const results = await Promise.all(SOURCES.map(({ name, fetcher }) => fetcher().catch((err) => {
    console.warn(`${name} fetch failed: ${err.message}`);
    debugLines.push(`${name}: ${err.stack || err.message}`);
    return [];
  })));
  if (debugLines.length) createFile('./dist/debug.txt', `${new Date().toISOString()}\n${debugLines.join('\n\n')}\n`);
  console.log(SOURCES.map((s, i) => `${results[i].length} from ${s.name}`).join(', '));

  // Dedup across sources: whichever source's event we see first (source
  // priority order above) wins when the same concert is listed on two sites.
  const seenKeys = new Set();
  const fresh = [];
  for (const ev of results.flat()) {
    const key = normalizeForKey([ev.dateStart, ev.venue, ev.title].join('|'));
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    fresh.push(ev);
  }

  // Merge into persisted history: upsert by id so events survive even after
  // a source stops listing them. Drop history from a source generation this
  // repo has since moved off of (this repo has already been through two
  // full source swaps — generic open data, then concerts-metal.com, both
  // abandoned — and neither's leftovers belong in the current archive).
  const activePrefixes = SOURCES.map((s) => `${s.prefix}:`);
  const events = Object.fromEntries(Object.entries(state.events).filter(([id]) => activePrefixes.some((p) => id.startsWith(p))));
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
