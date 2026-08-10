const fs = require('fs');
const crypto = require('crypto');
const templates = require('./templates.js');

const EVENTS_DIR = './dist/concerts';
const HISTORY_FILE = './dist/history.json';
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// "Not too far from Toulouse" — roughly the old Midi-Pyrénées footprint.
const TOULOUSE_LAT = 43.6047;
const TOULOUSE_LON = 1.4442;
const RADIUS_KM = 160;

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
// (or the source goes down entirely for a run).
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

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dPhi = ((lat2 - lat1) * Math.PI) / 180;
  const dLambda = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeEntities(str) {
  if (!str) return '';
  return String(str)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name) => ENTITY_MAP[name])
    .replace(/<[^>]+>/g, '');
}

// Municipal/state open-data fields come in as ALL CAPS venue/city names —
// title-case them for display, keeping short French connectors lowercase.
const LOWERCASE_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'et', 'à', 'au', 'aux', "d'", "l'"]);
function titleCase(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .split(/(\s+|-|'|’)/)
    .map((part, i) => {
      if (/^\s+$/.test(part) || part === '-' || part === "'" || part === '’') return part;
      if (i > 0 && LOWERCASE_WORDS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join('');
}

function normalizeKey(title, dateStart) {
  const norm = String(title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${norm}|${dateStart}`;
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchAllRecords(baseUrl, maxRows = 600) {
  const rows = 100;
  let start = 0;
  const records = [];
  while (start < maxRows) {
    const page = await fetchJson(`${baseUrl}&rows=${rows}&start=${start}`);
    records.push(...page.records);
    if (records.length >= page.nhits || page.records.length === 0) break;
    start += rows;
  }
  return records;
}

// Source 1: Toulouse Métropole open data — official municipal agenda,
// filtered to the "Concert" category. Covers Toulouse and nearby communes.
async function fetchToulouseMetropole() {
  const url = 'https://data.toulouse-metropole.fr/api/records/1.0/search/?dataset=agenda-des-manifestations-culturelles-so-toulouse&format=json';
  const records = await fetchAllRecords(url);
  const events = [];
  for (const rec of records) {
    const f = rec.fields;
    if (!f.categorie_de_la_manifestation || !f.categorie_de_la_manifestation.includes('Concert')) continue;
    if (!f.date_debut) continue;
    const venueRaw = f.lieu_nom ? titleCase(f.lieu_nom) : '';
    const communeRaw = f.commune ? titleCase(f.commune) : '';
    let url2 = f.reservation_site_internet || null;
    if (url2 && !/^https?:\/\//i.test(url2)) url2 = `https://${url2}`;
    events.push({
      id: `tlse:${rec.recordid}`,
      title: f.nom_de_la_manifestation || 'Concert',
      venue: venueRaw,
      commune: communeRaw,
      address: [f.lieu_adresse_2, f.code_postal ? `${f.code_postal} ${communeRaw}` : null].filter(Boolean).join(', '),
      dateStart: f.date_debut,
      dateEnd: f.date_fin || f.date_debut,
      price: f.tarif_normal || null,
      description: f.descriptif_long || f.descriptif_court || '',
      url: url2,
      lat: f.googlemap_latitude || null,
      lon: f.googlemap_longitude || null,
      source: 'Toulouse Métropole',
    });
  }
  return events;
}

// Source 2: Région Occitanie open data — participatory regional agenda,
// kept live/current. No fine-grained "concert" category, so we filter by
// keyword on title/description plus geographic distance to Toulouse.
// "de concert" ("to act in concert") and "en chœur" ("in unison") are common
// French idioms unrelated to music — strip them before matching so they
// don't false-positive an exhibition or a meeting into looking like a show.
const IDIOM_RE = /\bde\s+concert\b|\ben\s+ch[oœ]ur\b/gi;
const STRONG_MUSIC_RE = /concert|orchestr|symphoni|philharmoni|r[ée]cital|op[ée]ra\b|chorale/i;
const GENRE_MUSIC_RE = /musi(c|que)|\blive\b|\bdj\b|acoustique|chanson|\bjazz\b|\brock\b|m[ée]tal|\bfolk\b|\brap\b|hip-?hop|electro|classique/i;
const EXCLUDE_RE = /cin[ée]ma|th[ée][aâ]tre|exposition|vernissage|conf[ée]rence|\bsalon\b|brocante|vide-grenier|marionnette/i;

function looksLikeMusicEvent(rawText) {
  const text = rawText.replace(IDIOM_RE, '');
  if (STRONG_MUSIC_RE.test(text)) return true;
  return GENRE_MUSIC_RE.test(text) && !EXCLUDE_RE.test(text);
}

async function fetchOccitanieRegion() {
  const url = 'https://data.laregion.fr/api/records/1.0/search/?dataset=agendas-participatif-des-sorties-en-occitanie&format=json';
  const records = await fetchAllRecords(url);
  const events = [];
  for (const rec of records) {
    const f = rec.fields;
    if (!f.date_debut) continue;
    const title = decodeEntities(f.titre);
    const description = decodeEntities(f.description);
    if (!looksLikeMusicEvent(`${title} ${description}`)) continue;
    const geo = f.geo_point_2d;
    if (geo && haversineKm(TOULOUSE_LAT, TOULOUSE_LON, geo[0], geo[1]) > RADIUS_KM) continue;
    const address = decodeEntities(f.adresse || '');
    const withoutCity = address.replace(/,?\s*\d{5}\s+[^,-]+(-\s*[^,]+)?$/, '').trim();
    // "12 rue Foo, Le Venue Name" -> drop the leading street-address segment
    // and keep just the venue name, when there's enough of the address left
    // to spare it (a bare "12 rue Foo" with no venue name keeps the street).
    const withoutCityParts = withoutCity.split(/,\s*/);
    const venue = withoutCityParts.length > 1 ? withoutCityParts.slice(1).join(', ') : withoutCity;
    events.push({
      id: `occ:${rec.recordid}`,
      title: title || 'Concert',
      venue: venue || address,
      commune: f.commune || '',
      address,
      dateStart: f.date_debut,
      dateEnd: f.date_fin || f.date_debut,
      price: null,
      description,
      url: f.url ? (/^https?:\/\//i.test(f.url) ? f.url : `https://${f.url}`) : null,
      lat: geo ? geo[0] : null,
      lon: geo ? geo[1] : null,
      source: 'Région Occitanie',
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

  const [toulouse, occitanie] = await Promise.all([
    fetchToulouseMetropole().catch((err) => { console.warn(`Toulouse Métropole fetch failed: ${err.message}`); return []; }),
    fetchOccitanieRegion().catch((err) => { console.warn(`Région Occitanie fetch failed: ${err.message}`); return []; }),
  ]);
  console.log(`Fetched ${toulouse.length} Toulouse Métropole concerts, ${occitanie.length} Région Occitanie concerts.`);

  // Toulouse Métropole is more precisely tagged, so it wins on duplicates
  // (the same concert can legitimately appear in both open-data sets).
  const seenKeys = new Set();
  const fresh = [];
  for (const ev of [...toulouse, ...occitanie]) {
    const key = normalizeKey(ev.title, ev.dateStart);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    fresh.push(ev);
  }

  // Merge into persisted history: upsert by id so events survive even if a
  // source stops listing them (e.g. after the date has passed).
  const events = { ...state.events };
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
