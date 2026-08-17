# Concerts Metal Toulouse

Site statique listant les prochains concerts metal, hardcore et punk à Toulouse.

**En ligne :** https://skynet2982.github.io/concerts/

## Fonctionnement

Le site se reconstruit tout seul toutes les heures via GitHub Actions (voir
`.github/workflows/build.yml`) et se déploie sur la branche `gh-pages`.

- **Sources de données** (huit, fusionnées et dédupliquées — voir plus bas ;
  en cas de doublon, la source la plus précisément taguée gagne, dans l'ordre
  du tableau `SOURCES` dans `index.js`) :
  1. La catégorie ["Rock" de JDS.fr pour Toulouse](https://www.jds.fr/toulouse/agenda/rock-111_B) —
     JSON-LD `schema.org/MusicEvent` (lieu, adresse, GPS, tarif, billetterie).
     Pas exclusivement metal (blues, rock FM, tribute bands…), filtrée par
     mots-clés (`METAL_RE` dans `index.js`).
  2. [Le Metronum](https://lemetronum.fr/evenements/) — API REST WordPress
     "Tribe Events" (`/wp-json/tribe/events/v1/events`). Scène généraliste
     (hip-hop, world, chanson…), filtrée par les mêmes mots-clés.
  3. [Interférence (Balma)](https://www.interference-toulouse.fr/programmation) —
     site Next.js dont les données sont embarquées en JSON dans la page
     (`__NEXT_DATA__`) ; le site tague lui-même chaque concert par genre, donc
     la requête utilise directement `?tags=metal`. Son tag "hardcore" désigne
     en réalité la techno hardcore (gabber), pas le hardcore punk — il n'est
     donc volontairement pas utilisé.
  4. La catégorie ["Metal-Hardcore-Hard Rock" de ConcertAndCo.com pour
     Midi-Pyrénées / Languedoc-Roussillon](https://www.concertandco.com/region-style/midi-pyrenees-languedoc-roussillon/metal-hardcore-hard-rock/billet-concert-2-MID.htm) —
     déjà éditorialement filtrée metal, HTML brut à parser (pas de JSON-LD).
     Volume faible mais couvre des salles hors Toulouse.
  5. [Noiser](https://www.noiser.fr/programmation) — petit programmateur
     rock/metal/stoner (essentiellement au Rex). ~5 concerts à la fois : le
     filtre mots-clés est appliqué à la fiche détaillée de chaque concert
     (qui précise le genre de chaque groupe), pas au simple titre de la liste.
  6. [La Cabane](https://lacabane.bleucitron.net/) — table HTML classique.
     Sa programmation actuelle est 100% électro/comédie (zéro concert metal
     en ce moment), mais la source reste branchée pour le jour où elle en
     programmera un.
  7. [Zénith Toulouse Métropole](https://zenith-toulousemetropole.com/program) —
     son filtre de genre regroupe "Pop / Rock / Métal" en une seule catégorie
     (Placebo y est classé alors que ce n'est pas du metal), donc cette
     étiquette de catégorie est explicitement retirée du texte avant le
     filtre mots-clés : seul le texte descriptif libre de chaque concert
     peut déclencher une correspondance. Les concerts annulés sont ignorés.
  8. `toulouse.concerts-metal.com`, via [la Wayback Machine](https://web.archive.org/) —
     le site est inatteignable depuis GitHub Actions (voir plus bas), et
     archive.ph a lui-même un captcha anti-bot. web.archive.org n'a ni l'un
     ni l'autre problème, donc cette source lit le dernier instantané déjà
     présent dans leur index (API CDX) — elle ne déclenche pas elle-même de
     nouvelle capture, c'est le rôle du workflow séparé décrit ci-dessous.
     Seuls les concerts encore `dateStart >= aujourd'hui` sont gardés.

     Un second workflow, [`archive-refresh.yml`](.github/workflows/archive-refresh.yml),
     tourne une fois par semaine (lundi 3h UTC, séparé du build horaire
     pour ne pas spammer Internet Archive de demandes) et envoie une
     requête *Save Page Now* pour rafraîchir cet instantané. Le job ne
     vérifie pas le résultat : la capture est asynchrone et peut échouer
     silencieusement (Cloudflare bloque parfois aussi le robot d'Internet
     Archive), donc c'est volontairement fire-and-forget — le prochain
     build horaire lira simplement le plus récent instantané disponible,
     quel qu'il soit, sans dépendre du succès de ce job. Ça a déjà
     fonctionné une fois : une tentative de capture manuelle avait semblé
     échouer sur le moment (rien de nouveau dans l'index CDX juste après),
     mais s'est avérée avoir abouti quelques heures plus tard — la source
     est passée de 5-6 concerts (vieux instantané de novembre 2025) à 36.

- **Déduplication inter-sources** : deux sites reformulent rarement un même
  concert à l'identique (line-up complet vs. tête d'affiche seule, ordre des
  mots différent…), donc la clé de dédoublonnage n'est pas le titre exact
  mais *n'importe quel nom de groupe partagé à la même date* (voir
  `bandTokensOf` dans `index.js`). Ça a d'ailleurs révélé un vrai bug lors de
  la mise en place : Gloryhammer et Eluveitie étaient comptés deux fois
  (une fois via JDS.fr, une fois via Interférence) avant ce correctif.

  Sites évalués et écartés (ou contournés) :
  - **concerts-metal.com** (la source habituelle de l'utilisateur) : domaine
    principal protégé par un captcha Cloudflare Turnstile. Son sous-domaine
    `toulouse.concerts-metal.com` n'a pas ce captcha mais reste bloqué
    spécifiquement pour les IP des runners GitHub Actions (Cloudflare les
    reconnaît comme IP de datacenter). Pas de flux RSS/API non plus (tous
    les chemins testés renvoient la même page catch-all). Contourné via la
    Wayback Machine (source 8 ci-dessus), avec la limite d'un instantané
    figé plutôt que le site en direct.
  - **archive.ph** : lui-même protégé par un captcha anti-bot pour les
    requêtes automatisées — même catégorie de problème que Cloudflare,
    juste sur un autre service. web.archive.org n'a pas ce souci.
  - **Shotgun.live** : protégé par le bot-mitigation de Vercel (429 +
    challenge token), même famille de problème que Cloudflare/Turnstile —
    pas contourné, pour les mêmes raisons.
  - **Billetterie Festik du Noiser** (`billetterie.festik.net/noiser`) :
    SPA Vue.js pur, aucune donnée dans le HTML statique et aucun endpoint
    API public trouvé dans les bundles JS. De toute façon inutile : ce sont
    les mêmes concerts que ceux déjà récupérés sur noiser.fr.
  - **Actu-Metal Toulouse** : blog, plus mis à jour depuis mars 2025.
  - **Le Rex de Toulouse** (site propre) : programmation chargée en JS,
    aucune donnée exploitable en HTML statique ni API trouvée — mais ses
    concerts remontent déjà via JDS.fr/Noiser/Interférence.
- **Historique** : chaque run fusionne les concerts récupérés avec
  `dist/history.json` (restauré depuis `gh-pages` avant le build), donc un
  concert reste visible dans l'onglet "Historique" même après sa
  disparition du site source.
- Deux onglets : **À venir** (tri par date croissante) et **Historique**
  (concerts passés, tri par date décroissante), tous deux paginés.

## Structure

- `index.js` — script de build : récupère les données des huit sources,
  filtre, déduplique, persiste l'historique, génère les pages HTML.
- `templates.js` — gabarits HTML (page de liste, carte concert, fiche
  concert).
- `dist/styles.css`, `dist/manifest.json`, `dist/icons/` — les seules
  parties de `dist/` versionnées (le reste est généré à chaque build). Le
  site est une PWA installable : `manifest.json` référence les icônes dans
  `dist/icons/` (générées une fois depuis `assets/icon.svg` et
  `assets/icon-maskable.svg` — logo à base de l'emoji 🤘 — pas régénérées
  au build, comme `styles.css`).

## Développement local

```bash
npm install
npm run build   # génère dist/
```

## Historique des sources

Ce repo a changé de source de données plusieurs fois avant de se
stabiliser sur la combinaison actuelle :

1. Open data Toulouse Métropole + Région Occitanie (généraliste, quasi
   aucun concert metal réel).
2. `toulouse.concerts-metal.com` (bon contenu, mais bloqué depuis les
   runners GitHub Actions).
3. JDS.fr (fiable depuis GitHub Actions, filtré par mots-clés).
4. + ConcertAndCo.com en complément — deuxième source metal-curated,
   pour élargir la couverture au-delà de Toulouse ville.
5. + Le Metronum, Interférence et Noiser — trois sources supplémentaires
   trouvées en cherchant des alternatives proches de concerts-metal.com.
6. + La Cabane et Zénith Toulouse Métropole — branchées en prévision de
   concerts metal futurs, même si elles n'en ont aucun là tout de suite.
7. + concerts-metal.com via la Wayback Machine (actuel) — pas d'accès
   direct possible (voir plus bas), mais web.archive.org n'a pas la même
   protection que le site lui-même. Voir la liste complète des sources
   ci-dessus, y compris celles évaluées et écartées.
