# `collector`

**Rôle.** Point d'entrée unique de tout ce que poussent les capteurs — OTLP traces et logs, replay rrweb, source maps de CI — vers Postgres, avec clés, débit, bord de confiance du relais et hachage des identités.

| | |
|---|---|
| Groupe du canevas | 1 · Collecte |
| Point d'entrée | `node services/collector/server.mjs` (câblage seul, sur `@mip/service-kit`) |
| Logique | `@mip/backend/lib/receiver.mjs` (`creerReceveur`), partagée avec les serveurs de développement |
| Exposition | **publique**, domaine généré `*.up.railway.app` (P2 : lancement à blanc, aucun trafic tant que le relais de P3 n'est pas branché) |
| Rôle BDD | propriétaire (`DATABASE_URL`, moindre privilège après M4) ; pool de 8 par réplique (`PGPOOL_MAX`), `application_name = mip-collector`, attente de connexion 2 s |
| Réplicas | 2 (voir « Sûreté multi-réplique ») |
| Image | `services/collector/Dockerfile` — seule image à embarquer la base GeoIP |

État au 24/09/2026 : le service n'est **pas encore déployé**. En production, la collecte passe par les routes de la console (`/api/ingest/v1/*`) ; P3 les fera relayer vers ce service.

## Routes

Les chemins historiques de la console sont **normalisés avant tout routage** (`normaliserChemin`) : `/api/ingest/v1/*` → `/v1/*`, `/api/sourcemaps` → `/v1/sourcemaps`. Le SDK, l'extension et la CI des clients visent aujourd'hui la console ; le jour où un domaine pointe ici, leurs requêtes arrivent telles quelles — préflight replay compris, qui doit annoncer les en-têtes `x-mip-*`.

| Route | Rôle | Réponses |
|---|---|---|
| `POST /v1/traces` | métriques, erreurs, sessions, spans (OTLP/HTTP JSON, 1 Mio) | 200 `partialSuccess`, 400, 403 clé, 409 portée, 413, 429 débit, 503 + `retry-after` |
| `POST /v1/logs` | signal logs d'OpenTelemetry | idem |
| `POST /v1/replay` | chunk rrweb gzippé (2 Mio), métadonnées `x-mip-session/app/seq/key` | 200, 400, 403, 409, 410 session effacée, 413, 425 ancre pas encore reçue (`retry`), 429, 503 + `retry-after` |
| `POST /v1/sourcemaps` | source maps de CI, **jeton d'upload dédié seul** (20 Mio) ; la lecture admin reste dans la console | statut d'`enregistrerMaps`, 401, 403, 413, 429 (+ `retry-after`) |
| `GET /v1/traces`, `GET /v1/logs` | diagnostic d'intégration (parité avec les routes Vercel) | 200 |
| `OPTIONS *` | préflight CORS (origines du registre d'apps) | 204 |
| `GET /health`, `/ready`, `/metrics` | sondes du kit, ci-dessous | |

## Sondes

| Route | Exposition | Sens |
|---|---|---|
| `GET /health` | publique | processus vivant **et** base joignable (`select 1`, 2 s). **C'est la sonde Railway.** Le corps décrit le déploiement, jamais la panne : `service: "collector"`, `edge_protocol: "mip-edge/1"` (lu par le relais en P3), `edge_trust` (secret de relais posé ?), `identity` (`absente` \| `active` \| `discordante`), `id_fp` (empreinte du secret d'identité, **jamais le secret**), `identity_hash.configured`, `ingest_deferred`, `geoip`. |
| `GET /ready` | jeton `METRICS_TOKEN` (sinon 404) | 503 dès SIGTERM ; sinon prêt si le **registre d'apps a été chargé au moins une fois** (`registryLoaded()` : avant cela, la vérification de clé est en *fail-open*) **et** si l'identité n'est pas `discordante`. Supervision seulement. |
| `GET /metrics` | jeton `METRICS_TOKEN` (sinon 404) | Prometheus : `http_requests_total{method,code}`, durée, requêtes en vol, pool, mémoire ; la boucle `drain` si l'ingestion différée est allumée. |

## Configuration

`node services/collector/server.mjs --print-env-example` écrit le gabarit tiré du schéma. Une variable obligatoire absente, ou une valeur invalide, fait refuser le démarrage (code 2) avec **toutes** les erreurs sur une ligne ; un secret n'y est jamais cité.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | **oui** (secret) | — | Postgres. Pas de repli sur un Postgres local : c'était un receveur qui répondait 200 et perdait tout. |
| `PGPOOL_MAX` | non | 8 | taille du pool, par réplique (2 à 20). Neon : `max_connections = 112` pour tous les services. |
| `PORT` | non | 4318 | imposé par Railway |
| `LOG_LEVEL` | non | `info` | |
| `METRICS_TOKEN` | non (secret, ≥ 32 car.) | — | jeton de `/ready` et `/metrics` ; absent : 404 |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | non, **à poser** | 10 hors Railway, 0 sur Railway | délai SIGTERM → SIGKILL ; 15 visé |
| `REQUIRE_API_KEY` | non | `false` | `true` : toute app inconnue, inactive ou **sans clé** prend 403. **Provisionner d'abord** (ci-dessous). Booléen strict : `ture` refuse le démarrage. |
| `RATE_LIMIT_PER_MIN` | non | 600 | plafond par app et par minute (compteur durable en base) |
| `IDENTITY_HASH_SECRET` | non (secret, ≥ 32 car.) | — | clé HMAC de `mip.identity.*`. Absente : l'identité est **retirée**, jamais stockée brute (`identity: "absente"`). |
| `IDENTITY_HASH_FINGERPRINT` | **oui dès que le secret est posé** | — | empreinte du secret (12 hex). Absente avec le secret : refus de démarrer. Discordante : l'identité est retirée, `/ready` refusé, erreur au journal. |
| `EDGE_PROXY_SECRET` | non (secret, ≥ 32 car.) | — | secret du relais de la console (`x-mip-edge-auth`). **Deux valeurs** séparées par une virgule pendant une rotation. |
| `GEOIP_IP_SOURCE` | non | `none` | d'où lire l'adresse du trafic **direct** : `none`, `socket`, `railway`, `xff:<n>` |
| `INGEST_DEFERRED` | non | `false` | acquitte **avant** d'écrire (table UNLOGGED, vidée par un arrêt brutal de Postgres) |
| `INGEST_DRAIN_MS` | non | 250 | intervalle du drain de la file différée |

**L'empreinte d'identité.** Changer le secret casse la continuité de `user_id_hash` *en silence* : rien n'échoue, les HMAC sont simplement autres. L'empreinte rend ce changement bruyant. Elle se calcule sans que le secret passe par l'historique du shell ni par `ps` :

```bash
pbpaste | node scripts/ops/empreinte-identite.mjs          # 12 hex, rien d'autre
```

C'est `sha256("mip-identity-fp/v1\0" + secret)` tronqué : séparé de tout autre usage, publiable sur `/health`. Rien de l'identité ne vit sur Vercel (décision du 23/09 : le relais transmet le corps, **le collector hache**).

## Le bord de confiance (`mip-edge/1`)

En P3, la console relaie les beacons : vu d'ici, l'adresse est celle d'une fonction Vercel, jamais celle du visiteur. Le relais signe sa requête et ne transmet **que le pays** :

| Requête | Reconnue par | Pays retenu | GeoIP |
|---|---|---|---|
| relayée | `x-mip-edge-auth` = une des valeurs d'`EDGE_PROXY_SECRET` (comparaison à temps constant, sur empreintes) | `x-mip-edge-country`, sinon `x-vercel-ip-country` / `cf-ipcountry` — **seulement** s'il vaut `^[A-Z]{2}$` | **sauté** : aucune adresse n'a traversé |
| directe | aucun `x-mip-edge-auth` | aucun en-tête pays (CDN ignorés) | oui, selon `GEOIP_IP_SOURCE` |
| signature fausse (ou vide) | `x-mip-edge-auth` présent mais inconnu | aucun | **non** : l'adresse serait celle d'un relais |

Tout `x-mip-edge-*` est retiré de la requête **à l'entrée**, pour toutes les routes, avant toute autre lecture ; un en-tête de bord non authentifié est signalé au journal (une ligne par minute au plus). Le fuseau horaire, posé par le parseur, reste prioritaire sur le pays d'un relais — même ordre qu'aujourd'hui. C'est ce qui garde vraie la phrase publique « aucune adresse IP n'est transmise ni stockée » (`apps/console/lib/legal.ts`).

**Rotation.** Poser `ancienne,nouvelle` ici → basculer le relais sur la nouvelle → retirer l'ancienne. Aucune fenêtre de refus.

## Clés d'ingestion (R8a)

Le relevé du 23/09 a compté **6 apps sur 7 sans clé**, dont celle du client : `REQUIRE_API_KEY=true` les couperait toutes en 403, et le repli du relais ne se déclenche pas sur un 403. D'où l'ordre, sans rien changer à la sémantique du drapeau :

1. **Lister** (n'écrit rien) : `DATABASE_URL=… node scripts/ops/provisionner-cles.mjs` — apps actives sans `api_key_hash`, les inactives à part.
2. **Provisionner** : `… --appliquer [--app <id>]…` — une clé `mip_` + 32 hex par app, son sha256 en base (l'algorithme exact de `createPgAuth.checkApiKey` et de la rotation de `/admin/customers` : une clé posée ici se tourne depuis la console), une ligne `audit_log` (`app_provision_key`) par app. Les clés sortent **une fois**, sur la sortie standard (`app<TAB>clé`) ; le journal va sur la sortie d'erreur. Écriture conditionnelle (`where api_key_hash is null`) dans une transaction : une app provisionnée entre-temps n'est jamais écrasée, rejouer ne fait rien.
3. Poser chaque clé dans le snippet ou l'intégration de l'app (`mip.api_key` sur la resource OTLP, `x-mip-key` pour le replay) et vérifier les 200.
4. Alors seulement : `REQUIRE_API_KEY=true`.

Prouvé sur Postgres 17 migré (24/09) : dry-run → 3 apps listées, l'inactive à part, rien d'écrit ; `--appliquer --app gip-plateforme` puis `--appliquer` → 3 clés, 3 audits, l'app déjà dotée intacte ; rejeu → 0 ; puis le collector sous `REQUIRE_API_KEY=true` accepte la clé imprimée (200) et refuse une autre (403).

## Budget de requête

En P3, la console attend le collector 8 s au plus ; au-delà, elle ne sait pas s'il a écrit. Le collector répond donc **toujours avant** :

- verrou d'application : `lock_timeout` 1,5 s × **2 essais** (+ 120 ms de recul) ≈ 3,1 s, au lieu des 5 s × 3 que la console garde pour elle ;
- erreurs transitoires (`withRetry`) : 2 reprises au plus, recul plafonné à 400 ms, **aucune reprise qui partirait après l'échéance** de 4 s ;
- au-delà : **503 + `retry-after: 2`** — « rien n'est écrit, rejoue » (la transaction est annulée). Jamais un 500, jamais une réponse pendant l'écriture.

Prouvé sur Docker : verrou de `gip-plateforme` tenu par une autre session → `503` en 3,16 s avec `retry-after: 2` ; verrou rendu → 200 en 48 ms.

Limite connue : une instruction bloquée *au milieu* d'une écriture n'est bornée que par le `query_timeout` du kit (30 s), au-delà des 8 s du relais. Le cas relevé est l'attente du verrou, qui est bornée ; le banc de P2 dira s'il faut resserrer.

## Sûreté multi-réplique

Deux réplicas écrivent en même temps sans se coordonner, et c'est sûr :

- **verrou consultatif par app** (`withAppIngestTransaction`) : deux lots d'une même app s'écrivent l'un après l'autre, dans un ordre de clés déterministe entre apps ;
- **idempotence** : `on conflict` sur les identifiants de span, de session et de chunk ; un lot rejoué après un 503 ne se double pas (sauf les logs, qui ne sont pas idempotents — d'où le 503 *avant* écriture, jamais pendant) ;
- **débit** : compteur durable en base (`rate_check`), commun aux réplicas ; repli local à un quart du plafond si la base ne répond pas ;
- **registre d'apps et origines CORS** : cache par processus, rechargé à 60 s ; la base GeoIP est chargée une fois, au démarrage ;
- **ingestion différée** : chaque réplica draine la file avec `skip locked`.

## Modes de panne

| Situation | Ce qui se passe | Ce qu'on voit |
|---|---|---|
| base injoignable au démarrage | le service démarre ; `/health` 503 ; `/ready` refusé (registre jamais chargé : sans lui, les clés seraient en *fail-open*) | `santé dégradée`, `app_registry load failed` |
| base coupée pendant une écriture | reprises plafonnées, puis 503 + `retry-after` | `db retry (…)`, `busy: database unavailable within budget` |
| verrou d'app tenu (effacement RGPD long) | 503 + `retry-after` en ≈ 3,1 s | `busy: app ingest lock` |
| secret d'identité changé sans l'empreinte | identité **retirée** (donnée manquante, jamais incohérente) ; `/ready` refusé | `empreinte du secret d'identité DISCORDANTE` (empreinte trouvée, attendue, remède) |
| secret de relais désaccordé | trafic relayé sans pays ni GeoIP ; aucun rejet | `en-têtes de bord non authentifiés retirés` (`mode: "refuse"`) |
| client qui forge `x-mip-edge-*` ou un pays de CDN | ignoré et retiré | même ligne, `mode: "direct"` |
| `REQUIRE_API_KEY=true` sur une app sans clé | 403 | `rejected: api key` |
| SIGTERM | `/ready` 503, `Connection: close` ; requêtes en vol finies ; boucle de drain finie ; `pool.end()` ; sortie 0 | `arrêt demandé`, `ressource fermée`, `arrêt terminé` |
| `tampon: true` recopié dans un point d'entrée déployé | **refus de démarrer** si `NODE_ENV=production` ou `RAILWAY_ENVIRONMENT` est défini (`/__recent` rend des payloads en clair) | exception au démarrage |

## Lancement local

```bash
docker run -d --rm --name mip-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
docker exec mip-pg psql -U postgres -c "create database mip_rum"
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum
node services/scheduler/migrate.mjs                       # le seul migrateur

export METRICS_TOKEN=$(openssl rand -hex 24)
export IDENTITY_HASH_SECRET=$(openssl rand -hex 24)
export IDENTITY_HASH_FINGERPRINT=$(printf %s "$IDENTITY_HASH_SECRET" | node scripts/ops/empreinte-identite.mjs)
PORT=4318 node services/collector/server.mjs &

curl -s localhost:4318/health                             # service, edge_protocol, identity, id_fp
curl -s -H "authorization: Bearer $METRICS_TOKEN" localhost:4318/ready
kill -TERM %1                                             # sortie 0, en quelques ms à vide
```

Ou l'image, par son profil compose : `docker compose -f infra/docker/docker-compose.yml up -d --build --wait collector` (db → migrate → collector). Les serveurs de **développement** (`dev-server.mjs` :4318, `replay-dev-server.mjs` :4319) partagent le receveur, avec le tampon `/__recent` allumé pour l'E2E ; ils ne sont pas ce service.
