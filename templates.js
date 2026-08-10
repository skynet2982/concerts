const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MAX_CARD_GENRES = 3;

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
module.exports.escapeHtml = escapeHtml;

function dateBadge(dateStart) {
  const d = new Date(dateStart + 'T00:00:00');
  return `<span class="card-date-badge"><span class="dd">${d.getDate()}</span><span class="mon">${MONTHS_SHORT[d.getMonth()]}</span></span>`;
}

function displayDateRange(dateStart, dateEnd) {
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  const start = new Date(dateStart + 'T00:00:00').toLocaleDateString('fr-FR', opts);
  if (!dateEnd || dateEnd === dateStart) return start;
  const end = new Date(dateEnd + 'T00:00:00').toLocaleDateString('fr-FR', opts);
  return `Du ${start} au ${end}`;
}

module.exports.document = function (body, { basePrefix = './', switchLinks = [], activeCategory } = {}) {
  const switchHtml = switchLinks.length > 1 ? `<div class="category-switch">
    ${switchLinks.map((l) => `<a class="category-btn${l.slug === activeCategory ? ' is-active' : ''}" href="${l.href}">${l.label}</a>`).join('')}
  </div>` : '';
  return `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Concerts metal, hardcore et punk à Toulouse et en Midi-Pyrénées">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A4%98%3C/text%3E%3C/svg%3E">
    <title>Concerts Metal Toulouse &amp; Midi-Pyrénées</title>
    <link type="text/css" rel="stylesheet" href="${basePrefix}styles.css" media="all">
  </head>
  <body>
    <main>
      <header class="bg-dark mb-4">
        <nav class="container navbar navbar-dark">
        <div class="container-fluid">
          <a href="${basePrefix}index.html"><h1 class="text-light h2 mb-0">🤘 Concerts Metal Toulouse &amp; Midi-Pyrénées</h1></a>
        </div>
        </nav>
      </header>
      <div class="container mb-3">
        <div class="row mb-3">
          <div class="col">
            <strong>Dernière mise à jour</strong>: ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}
          </div>
        </div>
        ${switchHtml}
        ${body}
      </div>
    </main>
  </body>
  </html>`;
}

function genreBadges(genres) {
  if (!genres || !genres.length) return '';
  const shown = genres.slice(0, MAX_CARD_GENRES).map((g) => `<span class="card-genre">${escapeHtml(g)}</span>`);
  if (genres.length > MAX_CARD_GENRES) shown.push(`<span class="card-genre">+${genres.length - MAX_CARD_GENRES}</span>`);
  return `<div class="card-genres">${shown.join('')}</div>`;
}

module.exports.eventCardTemplate = function (entry, rootPrefix) {
  const href = `${rootPrefix}concerts/${entry.slug}.html`;
  return `<a class="card" href="${href}" title="${escapeHtml(entry.title)}">
    <div class="card-top">
      ${dateBadge(entry.cardDate || entry.dateStart)}
      <span class="card-source">${escapeHtml(entry.source)}</span>
    </div>
    <h3 class="card-title">${escapeHtml(entry.title)}</h3>
    <p class="card-venue">${escapeHtml(entry.venue)}${entry.commune ? ` · ${escapeHtml(entry.commune)}` : ''}</p>
    ${genreBadges(entry.genres)}
  </a>`;
}

module.exports.eventPage = function (entry) {
  const mapsHref = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${entry.venue}, ${entry.commune}`)}`;
  const bands = entry.bands || [];
  return `<!DOCTYPE html>
  <html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Ctext y='.9em' font-size='90'%3E%F0%9F%A4%98%3C/text%3E%3C/svg%3E">
    <title>${escapeHtml(entry.title)} — Concerts Metal Toulouse &amp; Midi-Pyrénées</title>
    <link type="text/css" rel="stylesheet" href="../styles.css" media="all">
  </head>
  <body>
    <main class="container mb-3" style="max-width: 700px;">
      <p style="margin-top: 1rem;"><a href="../index.html">&larr; Retour aux concerts</a></p>
      <article>
        ${dateBadge(entry.dateStart)}
        <h1 style="margin-top: .75rem;">${escapeHtml(entry.title)}</h1>
        <p class="event-meta"><strong>${displayDateRange(entry.dateStart, entry.dateEnd)}</strong></p>
        <p class="event-meta">${escapeHtml(entry.venue)}${entry.commune ? `, ${escapeHtml(entry.commune)}` : ''}</p>
        <p class="small"><a href="${mapsHref}" target="_blank" rel="noopener">Voir sur la carte</a></p>
        <hr>
        ${bands.length ? `<ul class="band-list">${bands.map((b) => `<li><strong>${escapeHtml(b.name)}</strong>${b.genre ? ` <span class="small band-genre">— ${escapeHtml(b.genre)}</span>` : ''}</li>`).join('')}</ul>` : ''}
        <div class="mb-3">
          ${entry.ticketUrl ? `<a class="page-link" rel="noopener" target="_blank" href="${escapeHtml(entry.ticketUrl)}">Billetterie &rarr;</a>` : ''}
          ${entry.facebookUrl ? `<a class="page-link" rel="noopener" target="_blank" href="${escapeHtml(entry.facebookUrl)}">Événement Facebook &rarr;</a>` : ''}
        </div>
        ${entry.url ? `<p class="small"><a rel="noopener" target="_blank" href="${escapeHtml(entry.url)}">Voir sur Concerts-Metal.com</a></p>` : ''}
        <p class="small" style="color: var(--card-muted);">Source : ${escapeHtml(entry.source)}</p>
      </article>
    </main>
  </body>
  </html>`;
}
