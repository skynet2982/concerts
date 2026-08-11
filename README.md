# Concerts Metal Toulouse

Site statique listant les prochains concerts metal, hardcore et punk à Toulouse.

**En ligne :** https://skynet2982.github.io/concerts/

## Fonctionnement

Le site se reconstruit tout seul toutes les heures via GitHub Actions (voir
`.github/workflows/build.yml`) et se déploie sur la branche `gh-pages`.

- **Sources de données** (cinq, fusionnées et dédupliquées par date+lieu+titre ;
  en cas de doublon, la source la plus précisément taguée gagne — voir l'ordre
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

  Sites évalués et écartés :
  - **concerts-metal.com** (la source habituelle de l'utilisateur) : domaine
    principal protégé par un captcha Cloudflare Turnstile. Son sous-domaine
    `toulouse.concerts-metal.com` n'a pas ce captcha mais reste bloqué
    spécifiquement pour les IP des runners GitHub Actions (Cloudflare les
    reconnaît comme IP de datacenter). Pas de flux RSS/API non plus (tous
    les chemins testés renvoient la même page catch-all).
  - **Actu-Metal Toulouse** : blog, plus mis à jour depuis mars 2025.
  - **Le Rex de Toulouse** (site propre) : programmation chargée en JS,
    aucune donnée exploitable en HTML statique ni API trouvée — mais ses
    concerts remontent déjà via JDS.fr/Noiser/Interférence.
  - **La Cabane** (bleucitron.net) : techniquement scrapable (table HTML
    classique), mais zéro concert metal actuellement (programmation
    électro/comédie) — pas rajoutée tant que ça reste le cas.
- **concerts-metal.com** (la source habituelle de l'utilisateur) est
  protégé par un captcha Cloudflare Turnstile sur son domaine principal.
  Son sous-domaine `toulouse.concerts-metal.com` n'a pas ce captcha mais
  reste bloqué spécifiquement pour les IP des runners GitHub Actions
  (Cloudflare les reconnaît comme IP de datacenter) — inutilisable en
  pratique pour un build automatisé. Pas de flux RSS/API disponible non
  plus (tous les chemins testés renvoient la même page catch-all).
- **Historique** : chaque run fusionne les concerts récupérés avec
  `dist/history.json` (restauré depuis `gh-pages` avant le build), donc un
  concert reste visible dans l'onglet "Historique" même après sa
  disparition du site source.
- Deux onglets : **À venir** (tri par date croissante) et **Historique**
  (concerts passés, tri par date décroissante), tous deux paginés.

## Structure

- `index.js` — script de build : récupère les données des cinq sources,
  filtre, déduplique, persiste l'historique, génère les pages HTML.
- `templates.js` — gabarits HTML (page de liste, carte concert, fiche
  concert).
- `dist/styles.css` — la seule partie de `dist/` versionnée (le reste est
  généré à chaque build).

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
5. + Le Metronum, Interférence et Noiser (actuel) — trois sources
   supplémentaires trouvées en cherchant des alternatives proches de
   concerts-metal.com ; voir la liste complète des sources ci-dessus,
   y compris celles évaluées et écartées.
