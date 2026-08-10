# Concerts Metal Toulouse

Site statique listant les prochains concerts metal, hardcore et punk à Toulouse.

**En ligne :** https://skynet2982.github.io/concerts/

## Fonctionnement

Le site se reconstruit tout seul toutes les heures via GitHub Actions (voir
`.github/workflows/build.yml`) et se déploie sur la branche `gh-pages`.

- **Source de données** : la catégorie ["Rock" de JDS.fr pour Toulouse](https://www.jds.fr/toulouse/agenda/rock-111_B),
  qui embarque chaque concert en JSON-LD (`schema.org/MusicEvent` : lieu,
  adresse, coordonnées GPS, tarif, lien billetterie). Cette catégorie n'est
  pas exclusivement metal (blues, rock FM, tribute bands…), donc chaque
  concert passe par un filtre de mots-clés (`METAL_RE` dans `index.js`)
  avant d'être retenu.
- **concerts-metal.com** (la source habituelle) est protégé par un captcha
  Cloudflare Turnstile sur son domaine principal. Son sous-domaine
  `toulouse.concerts-metal.com` n'a pas ce captcha mais reste bloqué
  spécifiquement pour les IP des runners GitHub Actions (Cloudflare les
  reconnaît comme IP de datacenter) — inutilisable en pratique pour un
  build automatisé.
- **Historique** : chaque run fusionne les concerts récupérés avec
  `dist/history.json` (restauré depuis `gh-pages` avant le build), donc un
  concert reste visible dans l'onglet "Historique" même après sa
  disparition du site source.
- Deux onglets : **À venir** (tri par date croissante) et **Historique**
  (concerts passés, tri par date décroissante), tous deux paginés.

## Structure

- `index.js` — script de build : récupère les données JDS.fr, filtre,
  déduplique, persiste l'historique, génère les pages HTML.
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

Ce repo a changé de source de données deux fois avant de se stabiliser sur
JDS.fr :

1. Open data Toulouse Métropole + Région Occitanie (généraliste, quasi
   aucun concert metal réel).
2. `toulouse.concerts-metal.com` (bon contenu, mais bloqué depuis les
   runners GitHub Actions).
3. JDS.fr (actuel) — fiable depuis GitHub Actions, filtré par mots-clés.
