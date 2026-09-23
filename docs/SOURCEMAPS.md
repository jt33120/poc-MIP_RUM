# Dé-minification des erreurs — source maps (P0 #3, P5.4)

> En prod, le JS est minifié : une stack vaut `at e (main-DVBHRQO7.js:1:40)` — illisible.
> Avec la **source map** de la release, MIP RUM réécrit la stack en positions **source**
> (`at e (src/panier.ts:3:11)`). Depuis P5.4, les maps s'envoient **depuis la CI** avec un
> jeton dédié, la symbolication a lieu **à l'ingestion** (et à la lecture si la map arrive
> après l'erreur), et un seul moteur sert partout : ingestion, upload, CLI et console
> (`packages/backend/shared/sourcemap.mjs`, réexporté par `apps/console/lib/sourcemap.ts`).

## En 4 étapes

### 1. Taguer la version dans le SDK
```js
MIPRum.init({
  endpoint, appId,
  release: "1.4.2",   // ou le git SHA — envoyé en attribut resource mip.release
});
```
La `release` est stockée sur chaque `rum_error` : c'est la clé d'association avec les maps.
Une erreur dont la release ne correspond à aucune map reste **explicitement non symbolisée**.

**Règle de release (P6.1, commune à l'ingestion et à l'upload)** : espaces de bord retirés,
**1 à 120 caractères**, sans caractère de contrôle ni de format Unicode ; **jamais scrubbée**
(`4.8.0.1` ou `build-17654321098` restent intacts, comparés à l'octet près). Hors de ces bornes,
l'ingestion la tient pour **inconnue** (NULL, jamais tronquée) et l'upload répond `400` : une map
envoyée pour une release que l'ingestion ne stocke pas ne serait jamais utilisée.

### 2. Créer un jeton de CI
Console › **Administration › Source maps** › *Jetons de CI* (admin uniquement) :
- un seul privilège, `sourcemaps:write`, sur **une** application ;
- expiration de **1 à 90 jours** (30 par défaut) ;
- le secret (`msu_<id>_<secret>`) n'est affiché **qu'une fois** ; la base n'en garde que le
  hash SHA-256, comparé en temps constant ;
- rotation : créer un nouveau jeton, basculer la CI, **révoquer** l'ancien — un jeton n'est
  jamais prolongé.

Les jetons de lecture (`CONSOLE_API_TOKENS`, `read_tokens`) n'ont **aucun** droit d'upload.

### 3. Envoyer les maps depuis la CI
```yaml
# GitHub Actions : le secret passe par l'environnement du pas, jamais par la ligne de commande.
- name: Source maps MIP RUM
  env:
    MIP_SOURCEMAP_TOKEN: ${{ secrets.MIP_SOURCEMAP_TOKEN }}
  run: >
    node scripts/upload-sourcemaps.mjs --app gip-plateforme --release "$GITHUB_SHA"
    --dir dist --url https://<ingest>/v1/sourcemaps
```
`--url` est l'URL **complète** d'upload, sans endpoint deviné :

| Port | URL | Corps | Map | Lots du CLI |
|---|---|---|---|---|
| Backend direct (Railway) | `https://<ingest>/v1/sourcemaps` | ≤ 20 Mio | ≤ 15 Mio | ≤ 20 Mio |
| Console (Vercel) | `https://<console>/api/sourcemaps` | ≤ 4 Mio (plafond Vercel publié : 4,5 Mo) | ≤ 4 Mio en pratique | ≤ 3 Mio par défaut |

Ce que fait le CLI, **avant** le premier envoi :
- relie chaque bundle `.js/.mjs/.cjs` à sa map (commentaire `sourceMappingURL` relatif, sinon
  `<bundle>.map` voisin) ; le nom envoyé est celui du **bundle** tel qu'il apparaît dans les stacks ;
- valide **toutes** les maps (v3 stricte) : une seule invalide et rien n'est envoyé ;
- refuse : une map déclarée mais absente, une map distante (aucune lecture réseau), un chemin ou
  un lien symbolique qui sort du dossier du build, deux bundles homonymes, une map trop lourde,
  un bundle ou une map qui **contient le jeton** ; ignore (avec avertissement) les maps inline et
  les maps orphelines ;
- calcule le **manifeste** (bundle → map, taille, SHA-256) et son **empreinte**, identique à celle
  que la console affiche pour la release ; `--manifest <fichier.json>` l'écrit (sans contenu).

Puis il découpe en lots sous le plafond du port (une map indivisible trop lourde pour la console
est refusée avec l'indication du backend direct), envoie, **vérifie l'empreinte rendue pour chaque
map**, et réessaie au plus `--retries` fois (0 à 5, défaut 3 ; recul exponentiel, `Retry-After`
respecté) sur erreur réseau, 408, 429 et 5xx — le serveur étant idempotent, rejouer ne duplique rien.

Le jeton ne se lit **que** dans `MIP_SOURCEMAP_TOKEN` : `--token` est refusé, et le jeton n'est
jamais écrit dans la sortie. `--dry-run` valide et affiche le plan sans jeton ni réseau.

Codes de sortie : `0` upload complet · `1` incomplet (map invalide ou absente, lot refusé, 409,
empreinte serveur différente, serveur injoignable) · `2` usage (argument, URL, jeton absent ou
au format d'un jeton de lecture).

Ne **jamais** publier les `.map` avec le site : elles restent côté MIP.

### 4. Lire la stack
- **Écrans de détail** `/errors/{fingerprint}` et `/errors/issues/{id}` : stack source avec le badge « dé-minifié · release »,
  stack brute repliable. Si la map est arrivée après l'erreur, la stack est symbolisée à
  l'affichage (mention explicite). Sinon, le statut est dit : *Stack non symbolisée* (aucune map
  pour la release, positions absentes), *Source map inutilisable*, *Symbolication différée*.
- **Admin seulement** : ±3 lignes de code source autour de la première frame résolue, tirées de
  `sourcesContent`. Jamais pour un viewer ou une session démo, jamais dans l'API.
- **API v1** `GET /api/v1/errors/{fingerprint}` : `last.stack_symbolicated` et
  `last.symbolication_status` (additifs, `stack` reste brute) ; `GET /api/v1/issues/{id}` : les mêmes
  champs sur `last_sample`. Mêmes droits que la stack RUM.
- **MCP** `mip_rum_get_error_group` et `mip_rum_get_issue` : mêmes champs, rendus tels quels.

La symbolication **ne change jamais** `fingerprint` : l'identité d'un groupe ne dépend pas du
moment où la map a été mise en ligne. Aucune reclassification historique (P8).

Le regroupement v2 des issues, lui, retient la première frame applicative **symbolisée à
l'ingestion** : une map mise en ligne avant le déploiement donne, dès la première occurrence, une
clé stable d'un build à l'autre et d'un navigateur à l'autre. Mise en ligne après, les occurrences
suivantes peuvent ouvrir une autre issue que les précédentes — une scission, jamais une fusion ; la
symbolication à la lecture ne reclasse rien.

## Contrat d'upload (les deux ports)

`POST` JSON `{ appId, release, maps: [{ filename, content }], replace? }` — la forme historique
`{ appId, release, filename, content }` reste acceptée. `content` : texte JSON de la map (le CLI
envoie le fichier tel quel) ou objet.

Authentification :
- **backend direct** : `Authorization: Bearer msu_…` **uniquement**, vérifié **avant** la lecture
  du corps ; le jeton fixe l'app (`appId` différent → 403) ;
- **console** : le même jeton, **ou** la session admin avec l'`Origin` de la console (CSRF) ;
  jamais viewer, démo ni jeton de lecture.

Ordre des contrôles : jeton → débit (par instance : 60 uploads/min et 2 simultanés par émetteur,
6 simultanés au total) → taille annoncée → corps lu borné en octets **et** en durée (60 s au total,
10 s sans données) → contrat complet (≤ 200 maps, ≤ 15 Mio par map mesurés **avant** son parsing)
→ une transaction.

Validation d'une map (refus explicites, `400`) : `version` 3 ; `sources`, `names`,
`sourcesContent`, `sourceRoot`, `file` typés et sans caractère de contrôle ; `mappings` décodé en
entier (base64 VLQ, 1/4/5 champs, aucun segment vide, index de source et de nom dans les bornes,
colonnes ordonnées, valeurs dans Int32) ; **map indexée** (`sections`) et **map externe** (URL, `data:`,
`sourceMappingURL`) refusées ; `filename` = bundle minifié (pas de `.map`, pas de `..`, pas de `\`).
Les chemins des sources ne sont que des **étiquettes** : schéma retiré, `..` résolu sans remonter
au-dessus de la racine. Rien n'est jamais lu sur disque ni sur le réseau (`sourceRoot` compris).

Écriture :
- contenu **identique** déjà présent → `unchanged`, rien n'est réécrit ;
- contenu **différent** sous le même (app, release, fichier) → **`409` pour toute la requête**,
  rien n'est écrit, conflits listés (`existing_checksum`, `received_checksum`) ;
- `replace: true` → remplacement, **admin (session console) seulement**, tracé dans `audit_log`
  (`sourcemap_replace`, empreintes avant/après) ; `403` avec un jeton ;
- empreinte SHA-256, taille et date de mise en ligne sont calculées **par la base** (déclencheur),
  quel que soit l'écrivain.

Réponse `200` : `{ uploaded, created, unchanged, replaced, maps: [{ filename, status, checksum,
size_bytes }], release: { app_id, release, files, fingerprint } }`.
Autres statuts : `401` jeton/session · `403` droit ou Origin · `404` app inconnue · `408` corps trop
lent · `409` conflit · `413` taille (la console indique le backend direct) · `429` débit
(`Retry-After`) · `503` schéma non migré (v71).

## Administration

Page **`/admin/sourcemaps`** (admin) : choix de l'app, releases (fichiers, taille, dernière mise en
ligne), manifeste d'une release (fichier, taille, checksum, date et auteur, statut *validée*,
*remplacée (auditée)*, *antérieure à v71*) et son empreinte, upload manuel (même contrat, 4 Mio),
jetons de CI (création, secret affiché une fois, révocation). Ni contenu de map, ni hash, ni
secret hors création.

Routes de session admin (hors API publique v1, auth dans le handler, 401/403 en JSON) :

| Route | Rôle |
|---|---|
| `GET /api/sourcemaps?appId=[&release=]` | releases de l'app, ou fichiers et empreinte d'une release — sans contenu |
| `GET /api/admin/sourcemap-tokens[?appId=]` | `{ tokens: [{ id, name, appId, createdAt, expiresAt, lastUsedAt, revokedAt }] }` |
| `POST /api/admin/sourcemap-tokens` | `{ appId, name, expiresInDays? }` (1..90, défaut 30) → `201 { token, secret }`, audité ; Origin requis |
| `DELETE /api/admin/sourcemap-tokens/{id}` | révocation idempotente, auditée ; Origin requis |

## Symbolication à l'ingestion : bornes

`writeRows` symbolise les erreurs **avant** sa transaction (lecture des maps hors verrou), sur les
trois chemins d'écriture (receveur Railway, route Vercel, file différée). Bornes par défaut
(`LIMITES_SYMBOLICATION`, `packages/backend/lib/error-symbolication.mjs`), à ajuster sur mesure :

| Borne | Défaut | Au-delà |
|---|---|---|
| Consommateurs en cache (LRU) | 32 | éviction |
| Mémoire retenue par le cache | 64 Mio | éviction |
| Index d'une map (calculé **avant** décodage) | 32 Mio | `failed` |
| JSON de maps parsé par lot | 8 Mio (la 1re map passe toujours) | `pending` |
| Frames par erreur / par lot | 50 / 2 000 | frames brutes / `pending` |
| Fichiers vérifiés en base par lot (une entrée fraîche du cache ne compte pas) | 64 | `pending` |
| Durée par lot, lecture des frames comprise | 1 s | `pending` |
| Revalidation présence, absence, échec | 60 s | — |

Le moteur garde la chaîne `mappings` et un point de reprise tous les 32 segments (≈ 1 octet d'index
par segment, contre ~80 pour un objet par segment). Mesuré sur une map synthétique de 15 Mio
(3 millions de segments) : validation 0,24 s, indexation 0,27 s, recherche ≈ 1 µs par frame. Une
recherche ne quitte jamais sa ligne générée et ne décode qu'entre deux points de reprise ; un segment
vide est refusé ; le consommateur ne retient ni le JSON ni `sourcesContent` ; les noms sont nettoyés
et bornés. Les frames sont lues par un analyseur linéaire (même résultat que les expressions
historiques, sans retour arrière) : une stack hostile ne coûte pas de CPU. Une map
illisible ou démesurée donne `failed`, un journal `symbolication: source map inutilisable` une fois
par version, et l'erreur est écrite **brute scrubbed** : un fichier hostile ne bloque pas un lot.
La stack symbolisée est rescrubbée et bornée à 8 000 caractères.

Statuts (`rum_error.symbolication_status`) : `resolved` · `unavailable` (aucune map pour la release,
ou positions absentes) · `failed` · `pending` · `NULL` sans frame JavaScript. Une map mise en ligne
après l'erreur est prise par l'ingestion sous 60 s, et par l'affichage immédiatement.

## Données, sécurité, déploiement

- **migration-v71** (additive, rejouable) : `sourcemap.checksum/uploaded_at/uploaded_by` (taille :
  `size_bytes` existante), déclencheur d'empreinte, table `sourcemap_upload_token` (RLS
  `tenant_scope`, `console_ro` : lecture, création, révocation — ni suppression ni réécriture du
  hash ; aucun droit pour les rôles d'API publique), purge des jetons morts avant la date de
  rétention, effacement de tous les jetons et maps avec `erase_app_data`, colonnes
  `rum_error.symbolication_status/stack_symbolicated` (contrainte `NOT VALID`, `lock_timeout` 5 s).
- **Fenêtre de déploiement** : le code P5.4 sur un schéma sans v71 écrit les erreurs comme avant,
  symbolise à l'affichage et répond `503` aux uploads ; le code antérieur à P5.4 qui écrit encore
  une map après v71 garde une empreinte juste (déclencheur).
- Les maps ne contiennent pas de données d'utilisateur final : hors périmètre DSAR ; elles suivent
  l'effacement d'une app. Le service Railway `ingest` expose `POST /v1/sourcemaps`.

## Limites et suivis

- **Maps indexées** (`sections`) et **Debug IDs** non pris en charge ; association par
  (app, release, nom de bundle).
- Nom de fonction affiché = nom mappé **à la position** de la frame (sinon le nom minifié), pas la
  portée englobante.
- **Rétention des maps** de releases obsolètes : manuelle (seuls les jetons morts sont purgés).
- Plafond réel de Vercel à revérifier à la publication ; intégration dans la CI du client : P8.4.
