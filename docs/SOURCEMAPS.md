# Dé-minification des erreurs — source maps (P0 #3)

> En prod, le JS est minifié : une stack vaut `at a (main.abc123.js:1:4567)` — illisible.
> En **associant une source map** à la version de l'app, la console réécrit la stack en
> positions **source** (`at validateForm (forms/login.ts:42:7)`). Moteur **zéro-dépendance**
> (`apps/console/lib/sourcemap.ts`), dé-minification **à l'affichage** (lazy, seulement
> pour l'erreur consultée), jamais à l'ingestion.

## 3 étapes

### 1. Taguer la version dans le SDK
```js
MIPRum.init({
  endpoint, appId,
  release: "1.4.2",   // ou le git SHA — envoyé en attribut resource mip.release
});
```
La `release` est stockée sur chaque `rum_error` (`migration-v13`) et sert de clé d'association.

### 2. Uploader les source maps du build
À chaque déploiement (idéalement en **CI**), poster les `.map` produits par le bundler.
**Admin requis** (cookie de session) ; une map par fichier minifié :

```bash
curl -X POST https://<console>/api/sourcemaps \
  -H "content-type: application/json" \
  --cookie "mip_session=<jwt-admin>" \
  -d '{
    "appId": "gip-plateforme",
    "release": "1.4.2",
    "maps": [
      { "filename": "main.abc123.js", "content": <contenu JSON de main.abc123.js.map> }
    ]
  }'
```
- `filename` = nom du **fichier minifié** (pas du `.map`) tel qu'il apparaît dans les stacks.
- `content` = la source map v3 (objet JSON ou string). Validé (champ `mappings`). Upsert
  par `(appId, release, filename)` ; ≤ 15 Mo/map.
- Ne **jamais** servir les `.map` publiquement : on les garde côté MIP.

### 3. Lire la stack dé-minifiée
Sur la page d'un groupe d'erreurs (`/errors/{fingerprint}`), si une map existe pour la
release de l'erreur, la stack est affichée **dé-minifiée** (badge « dé-minifié · `<release>` »).
Sinon, la stack brute reste affichée (repli) avec la release indiquée.

## Détails techniques

- **Moteur** `lib/sourcemap.ts` : décodage VLQ base64, parsing `mappings` (cumul des
  deltas), recherche dichotomique de segment, parsing de stack (formats Chrome & Firefox).
  Testé par round-trip avec un encodeur VLQ indépendant (`tests/unit/sourcemap.test.ts`).
- **Stockage** : table `sourcemap (app_id, release, filename, content, …)`.
- **Sécurité/RGPD** : les source maps ne contiennent pas de PII ; elles restent privées
  (accessibles à la seule console). L'upload est réservé aux admins.

## Suivi (hors périmètre)

- **Upload par jeton CI** (plutôt que cookie admin) : à brancher sur une clé d'app —
  aujourd'hui l'upload passe par un compte admin authentifié.
- **Rétention** : purger les maps des releases obsolètes (au-delà de la rétention des
  erreurs) — manuel pour l'instant.
- **Stacks backend** (sourcemaps Node) : même mécanisme applicable si besoin.
