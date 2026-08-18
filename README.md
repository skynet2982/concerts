# Concerts Métal

Site statique listant les prochains concerts metal, hardcore et punk à
Toulouse, Rennes et Lorient.

**En ligne :** https://skynet2982.github.io/concerts/

## Fonctionnement

Le site se reconstruit tout seul toutes les heures via GitHub Actions (voir
`.github/workflows/build.yml`) et se déploie sur la branche `gh-pages`.

- **Plusieurs villes** : un sélecteur au-dessus des onglets À venir/Historique
  bascule entre Toulouse (racine du site, ville par défaut), Rennes
  (`/rennes/`) et Lorient (`/lorient/`). Chaque ville a son propre jeu de
  sources dans `index.js` (tableau `CITIES`) — rien n'est mutualisé entre
  elles au-delà du *type* de source (JDS.fr, ConcertAndCo.com,
  concerts-metal.com archivé), les salles/programmateurs locaux sont par
  nature propres à chaque ville. Le dédoublonnage (voir plus bas) est
  scopé par ville : même groupe + même date sur deux villes différentes
  n'est jamais considéré comme un doublon.

  Rennes et Lorient partagent leurs deux sources régionales (ConcertAndCo
  Bretagne, concerts-metal.com archivé sous `bretagne.`) avec toute la
  Bretagne, pas seulement leur ville — et le classement par région de
  ConcertAndCo s'est révélé peu fiable (sa page "Bretagne" a un temps
  affiché des concerts à Nîmes et à Toulouse). Ces deux villes filtrent
  donc chaque source, JDS.fr compris, strictement sur la commune exacte
  (`communeFilter` dans `CITIES`) plutôt que de faire confiance au
  découpage géographique du site source. Toulouse n'a pas ce filtre : ses
  sources sont soit spécifiques à une seule salle, soit correctement
  bornées à Midi-Pyrénées / Languedoc-Roussillon.

- **Sources de données pour Toulouse** (huit, fusionnées et dédupliquées —
  voir plus bas ; en cas de doublon, la source la plus précisément taguée
  gagne, dans l'ordre de son entrée dans `CITIES` dans `index.js`) :
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

- **Sources de données pour Rennes** (trois — c'est le même point de départ
  que Toulouse à son lancement, avant les ajouts progressifs de salles
  locales) :
  1. La catégorie ["Rock" de JDS.fr pour Rennes](https://www.jds.fr/rennes/agenda/rock-111_B) —
     même mécanisme que pour Toulouse (JSON-LD, filtré par `METAL_RE`).
     Couvre déjà indirectement Le Liberté et L'Étage, les deux salles
     rennaises de référence pour le metal/hardcore.
  2. La catégorie ["Metal-Hardcore-Hard Rock" de ConcertAndCo.com pour la
     Bretagne](https://www.concertandco.com/region-style/bretagne/metal-hardcore-hard-rock/billet-concert-2-MID.htm) —
     même source que pour Toulouse, région changée.
  3. `bretagne.concerts-metal.com`, via la Wayback Machine — même mécanisme
     que pour Toulouse (voir plus haut) ; concerts-metal.com n'a pas de
     sous-domaine dédié à Rennes, `bretagne` est son découpage régional
     (le sous-domaine `toulouse`, lui aussi, couvre en réalité tout
     Midi-Pyrénées, pas seulement la ville). Rafraîchie par le même
     workflow hebdomadaire que Toulouse.

  Salle évaluée et écartée pour Rennes :
  - **L'Ubu** (`ubu-rennes.com`) : programmation chargée entièrement côté
    client (routeur JS en hashbang, aucune donnée dans le HTML statique,
    aucune API `wp-json` exploitable trouvée) — même problème que Le Rex
    pour Toulouse. Pas grave : ses concerts remontent en grande partie via
    JDS.fr de toute façon.

- **Sources de données pour Lorient** (trois, mêmes sources que Rennes,
  juste re-filtrées sur la commune de Lorient) :
  1. La catégorie ["Rock" de JDS.fr pour Lorient](https://www.jds.fr/lorient/agenda/rock-111_B).
  2. ConcertAndCo.com Bretagne (même requête que pour Rennes).
  3. `bretagne.concerts-metal.com` via la Wayback Machine (même instantané
     que pour Rennes).

- **Nettoyage des liens billetterie** : plusieurs sources (JDS.fr,
  ConcertAndCo.com, l'archive concerts-metal.com) pointent parfois vers un
  lien d'affiliation Awin (`awin1.com/pclick.php?p=...`) plutôt que
  directement vers le billettier — le paramètre `p` est un identifiant
  opaque, pas une URL encodée, donc impossible à décoder sans requête.
  `resolveAwinTicketUrl` dans `index.js` suit la redirection (juste les
  en-têtes, sans télécharger la page) et ne garde que la vraie destination,
  débarrassée des paramètres de tracking (`awc`, `utm_*`…) — ex. le lien
  Awin de 1000mods à Rennes devient directement
  `fnacspectacles.com/artist/1000-mods/`. Les liens SeeTickets
  (`pfd.seetickets.com/?...&redir=<url>`) sont eux résolus sans requête,
  l'URL réelle étant déjà encodée dans le paramètre `redir`. Un échec de
  résolution (timeout, etc.) laisse simplement le lien Awin d'origine —
  toujours cliquable, juste moins propre — et sera retenté au prochain
  build tant que la source republie l'évènement.

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
- Deux boutons utilitaires au-dessus du sélecteur de ville : 🔄 recharge la
  page, 📱 affiche un QR code de la page courante (pas juste l'accueil —
  utile pour partager directement une page paginée ou une ville) via
  `dist/qrcode.min.js`, une lib vendorisée (MIT, kazuhikoarase/qrcode-generator)
  générée entièrement côté client, sans requête réseau ni service tiers.

## Structure

- `index.js` — script de build : récupère les données de chaque ville
  (tableau `CITIES`), filtre, déduplique, persiste l'historique, génère
  les pages HTML de chaque ville.
- `templates.js` — gabarits HTML (page de liste, carte concert, fiche
  concert).
- `dist/styles.css`, `dist/manifest.json`, `dist/icons/`, `dist/qrcode.min.js`
  — les seules parties de `dist/` versionnées (le reste est généré à
  chaque build). Le site est une PWA installable : `manifest.json`
  référence les icônes dans `dist/icons/` (générées une fois depuis
  `assets/icon.svg` et `assets/icon-maskable.svg` — logo à base de
  l'emoji 🤘 — pas régénérées au build, comme `styles.css`).

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
7. + concerts-metal.com via la Wayback Machine — pas d'accès direct
   possible (voir plus haut), mais web.archive.org n'a pas la même
   protection que le site lui-même.
8. + ville de Rennes — même principe que Toulouse, avec son propre jeu de
   sources (JDS.fr, ConcertAndCo.com, concerts-metal.com archivé) puisque
   les salles/programmateurs locaux ne se recoupent pas d'une ville à
   l'autre. Voir la liste complète des sources ci-dessus, par ville, y
   compris celles évaluées et écartées.
9. + ville de Lorient, filtrage strict par commune pour Rennes/Lorient
   (leurs sources régionales listaient des concerts ailleurs en Bretagne,
   voire hors Bretagne), nettoyage des liens billetterie Awin, et boutons
   rafraîchir/QR code (actuel).
