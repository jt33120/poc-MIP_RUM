# Les services backend

Une règle : **ces fichiers câblent, ils n'implémentent pas.**

Toute la logique vit dans les paquets `packages/*` — parser OTLP, écritures
Postgres, authentification, travaux planifiés, schéma et migrations, catalogue
d'outils MCP. Aucun framework, donc rien à réécrire pour déplacer l'ensemble
chez un autre hébergeur.

```
apps/        ce que les gens utilisent      console (Next.js, Vercel), extension MV3
services/    ce que Railway lance           un dossier par service, minces par construction
packages/    ce que les deux importent      @mip/backend (le noyau), @mip/db (schéma +
                                            migrateur), @mip/mcp-tools (noyau MCP, sans base),
                                            @mip/service-kit, @mip/console-api et son contrat
```

Un service, une ligne. `.railway/railway.ts` les déclare tous les six, et les six tournent sur Railway depuis l'apply du 27/09/2026 (PR #332 ; relevé de l'API Railway du 28/09/2026, [TOPOLOGIE_BACKEND.md](../docs/TOPOLOGIE_BACKEND.md)). Ce qui reste éteint l'est par un drapeau ([runbook](../docs/operations/runbook.md)) :

| Service | Rôle | Écoute | Commande | Déployé |
|---|---|---|---|---|
| `collector` | point d'entrée unique des capteurs : OTLP traces et logs, replay, source maps de CI (jeton dédié) ; chemins historiques de la console acceptés ; bord de confiance du relais, identité hachée ici — détail : [`collector/README.md`](collector/README.md) | oui (`PORT`, défaut 4318) : `/health` (sonde Railway : processus + base, décrit service, protocole de bord et empreinte d'identité), `/ready`, `/metrics` et `/diagnostic/ip` (jeton) | `node services/collector/server.mjs` | **Railway**, deux répliques, domaine généré — reçoit la part de la collecte que la console lui relaie (`ingest_relay_pct` : 50 % le 27/09 au soir, 100 % prévu le 28/09) ; GeoIP pour le seul trafic direct, le capteur de la console (28/09) |
| `scheduler` | déclenche les travaux planifiés sous bail, et **seul** applique les migrations (pré-déploiement) — détail : [`scheduler/README.md`](scheduler/README.md) | oui (`PORT`) : `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/scheduler/worker.mjs` · pré-déploiement `node services/scheduler/migrate.mjs` | **Railway** ; redéployé le 27/09/2026, son pré-déploiement a appliqué v87 → v96 ; tick à 15 minutes, ne livre plus (`SCHEDULER_DELIVERY` = `off`) |
| `notifier` | livre ce que la plateforme a décidé de dire — webhooks signés, e-mails Resend — et seul détient les secrets sortants ; alerte quand les travaux planifiés se taisent — détail : [`notifier/README.md`](notifier/README.md) | oui (`PORT`) : `/health` (sonde Railway), `/live`, `/ready` et `/metrics` (jeton) | `node services/notifier/worker.mjs` | **Railway** depuis le 27/09/2026 — livre à la place du scheduler, passes toutes les 15 minutes |
| `api` | l'API de lecture v1 pour les machines, **en lecture seule** : les routes de la console compilées en un bundle, sans Next ni session — détail : [`api/README.md`](api/README.md) | oui (`PORT`) : `/api/v1/*`, `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/api/dist/server.mjs` (construit par `build.mjs`) | **Railway**, deux répliques, domaine généré — sert le `mcp` ; les autres porteurs de jeton passent encore par la console (`api_relay_pct` = 0) |
| `mcp` | expose l'API v1 à un agent IA, sans accès à la base ; n'utilise pas le kit (pas de README propre : ce fichier et [docs/MCP.md](../docs/MCP.md)) | oui (`PORT`, défaut 8080) : `/mcp` (jeton porteur de l'appelant), `/health` | `node services/mcp/http.mjs` | **Railway** (domaine `mcp-production-201c.up.railway.app`) ; appelle `api` sur le réseau privé (`MIP_API_HOST`, posée par l'apply du 27/09) |
| `console-api` | le backend de la console (piste C) : seul client, le serveur Vercel, gardé par un secret client ; poignée de main signée ES256 — détail : [`console-api/README.md`](console-api/README.md) | oui (`PORT`) : `/v1/*` sous secret client, `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/console-api/dist/server.mjs` (construit par `build.mjs`) | **Railway**, deux répliques, domaine généré — la console l'appelle pour la connexion depuis le 27/09/2026 ; écrans et écritures pas encore basculés (`console_api_*_pct` = 0) |

`services/collector/` porte aussi les deux serveurs de **développement** que
lancent l'E2E et les scripts de validation (`dev-server.mjs` :4318,
`replay-dev-server.mjs` :4319).

## Les images

**Une image par service**, à côté de son point d'entrée : `services/<x>/Dockerfile`
(contrat de service § 9, dans le plan backend, hors dépôt). Même recette pour toutes — `pnpm fetch` →
`pnpm install --offline` → build → `pnpm deploy --prod`, Node épinglé par
digest, utilisateur non-root, `HEALTHCHECK` pour l'auto-hébergement — et un
`CMD` **explicite** : une image ne sait démarrer que son service. L'ancienne
image commune (`infra/docker/Dockerfile.backend`) démarrait par défaut le
collecteur : une commande de démarrage perdue dans le tableau de bord aurait
fait booter au `scheduler` un receveur OTLP, sans une ligne d'erreur.
L'en-tête de `collector/Dockerfile` explique la recette ; les autres la
suivent (`api` et `console-api` y ajoutent la construction de leur bundle).

Les deux anciennes images (`infra/docker/Dockerfile.{backend,mcp}`) restent
dans le dépôt, marquées OBSOLÈTE en première ligne. Le tableau de bord Railway
désigne désormais `services/scheduler/Dockerfile` et `services/mcp/Dockerfile`
(relevé de l'API Railway du 26/09/2026), mais les chemins surveillés des deux
services portent encore les anciens chemins. Plus rien du dépôt ne les
construit (IaC, compose, fumée — un test le vérifie) ; elles partent, avec leurs
chemins surveillés, une fois les deux services déployés en vert sur leur
nouvelle image : c'est fait pour `mcp` (25/09/2026), pas encore pour
`scheduler`, dont les déploiements échouent tant que Neon est suspendu.

| Image | Embarque | `CMD` |
|---|---|---|
| `collector/Dockerfile` | `@mip/backend`, `pg`, **la base GeoIP** (seule image à la porter, vérifiée contre `packages/backend/data/*.manifest.json`) | `node services/collector/server.mjs` |
| `scheduler/Dockerfile` | `@mip/backend`, `@mip/db` et son `sql/`, `pg` | `node services/scheduler/worker.mjs` ; le migrateur (`migrate.mjs`) part au pré-déploiement, jamais par défaut |
| `notifier/Dockerfile` | `@mip/backend`, `pg` — ni `@mip/db` (seul le scheduler migre), ni base GeoIP | `node services/notifier/worker.mjs` |
| `api/Dockerfile` | `dist/server.mjs` (les routes v1 de la console, compilées à la construction) et `pg` — ni Next, ni la vérification des sessions | `node services/api/dist/server.mjs` |
| `mcp/Dockerfile` | `@mip/mcp-tools`, le SDK MCP, zod — **ni `pg` ni `DATABASE_URL`** | `node services/mcp/http.mjs` |
| `console-api/Dockerfile` | un bundle (`@mip/console-api`, `@mip/console-contract`, le kit, et la couche de données de la console, `apps/console/lib`) et `pg` — **ni écran, ni composant, ni session de la console** (garde du build) | `node services/console-api/dist/server.mjs` |

Chaque arbre déployé est posé sous `/app/services/<x>` : les commandes écrites
ailleurs (`.railway/railway.ts`, le compose) sont celles du développement.
Après `pnpm deploy`, `scripts/ci/deploy-fidele.mjs` exige que chaque paquet posé
ait la version ET l'empreinte du lockfile.

`mcp` n'atteint pas la base, et c'est **structurel**. C'est le seul service
pilotable par un modèle de langage, donc par le texte que ce modèle a lu ; la
seule protection qui tienne contre une injection de prompt réussie, c'est qu'il
n'y ait rien à atteindre. Son image ne contient que la fermeture des
dépendances de `@mip/service-mcp` : tout passe par l'API v1, qui applique déjà
le cloisonnement par jeton. Cf. `docs/MCP.md`.

## Pourquoi le scheduler existe

La cadence des travaux n'était pas un choix technique mais la conséquence de
trois plans tarifaires empilés :

| Déclencheur | Pourquoi il ne convenait pas |
|---|---|
| `pg_cron` | l'extension ne s'installe que dans la base `postgres` du projet Neon, jamais dans `neondb` — les blocs `cron.schedule` des migrations sont silencieusement sautés |
| `pg_net` | refusé sur Neon : la livraison des webhooks devait sortir de la base |
| Vercel Cron | plan Hobby = crons **quotidiens uniquement** ; déclarer `*/5 * * * *` fait échouer le déploiement |
| GitHub Actions | facturé à la minute entamée sur un dépôt privé : à `*/5`, le quota mensuel partait en une semaine et emportait la CI |

D'où, avant le scheduler, une cadence rabaissée à une heure, et une ligne
« Latence d'alerte : 5 min visées, 60 réelles » sur la page de présentation
(`apps/console/lib/etat-latence.ts`). Un processus qui tourne en continu n'a
aucune de ces limites. La base en impose une autre : le tick tourne à 15 minutes
par défaut, pour la laisser en veille entre deux passages — sur l'offre gratuite de Neon
d'abord, puis sur l'offre payante à l'usage depuis le 27/09/2026, en attendant la base
que choisira la DSI de MIP ([README du scheduler](scheduler/README.md#base-gratuite--la-cadence-ralentie),
[ADR-0014](../docs/architecture/adr/0014-base-gratuite.md), remplacée).

## Configuration

Ce tableau dit ce que le code **lit**, pas ce qui est posé. Ce que l'apply du
27/09/2026 a posé est déclaré dans `.railway/railway.ts` (liste des variables
partagées en tête du fichier) ; les variables effectivement posées n'ont pas été
relevées depuis. Au relevé du 26/09/2026, avant l'apply, `scheduler` n'avait que
`DATABASE_URL`, `PGPOOL_MAX`, `PORT`, `NODE_ENV` et `LOG_LEVEL`, et `mcp` que
`MIP_CONSOLE_URL`, `NODE_ENV` et `PORT`.

| Variable | Service | Obligatoire | Rôle |
|---|---|---|---|
| `DATABASE_URL` | `collector`, `scheduler`, `notifier`, `api`, `console-api` | **oui** (`console-api` : ou le couple de C13 ci-dessous) | Postgres. TLS vérifié dès que l'hôte n'est pas local — jamais de `rejectUnauthorized: false`. `api` vise le rôle `mip_api` (variable partagée `API_DATABASE_URL`). |
| `CONSOLE_DATABASE_URL` + `IDENTITY_DATABASE_URL` | `console-api` | non, ensemble | C13 : rôles `mip_console` et `mip_identity` (v93) au lieu du propriétaire |
| `MIGRATION_DATABASE_URL` | `scheduler` (pré-déploiement) | non | la **même** base par une connexion **directe**, hors pooler : les `predeploy-vNN-*.sql` (index `CONCURRENTLY`) y passent sous verrou de session, juste avant leur migration. Absente, ou pointée sur un pooler, ils sont sautés avec un avertissement et chaque migration garde son garde-fou de taille. Une autre base que `DATABASE_URL` est refusée. **Non posée en production**, ni déclarée dans l'IaC. |
| `PORT` | `collector` | fourni par l'hébergeur (défaut 4318) | `/health` (sonde Railway), `/ready` et `/metrics` (jeton), routes OTLP |
| `PORT` | `scheduler`, `notifier`, `api`, `console-api`, `mcp` | fourni par l'hébergeur (défaut 8080 ; `api` fixé à 8080 dans l'IaC, `mcp` le joint par le réseau privé) | `/health` (sonde Railway : processus + base ; pour le scheduler, « jamais exécuté » et « bail tenu ailleurs » y sont sains), `/ready` et `/metrics` (jeton) |
| `METRICS_TOKEN` | `collector`, `scheduler`, `notifier`, `api`, `console-api` | non (secret, ≥ 32 caractères) | jeton de `/ready` et `/metrics` ; absent, les deux répondent 404. **Non posé sur le scheduler en production**, et l'IaC ne le lui déclare pas (elle le partage aux quatre autres) |
| `DEADMAN_URL` | `scheduler` | non (secret, `https:`) | dead-man's switch externe, signalé après chaque tick abouti ; absent, aucun signal. **Non posée en production**, ni déclarée dans l'IaC |
| `SCHEDULER_TICK_MIN` | `scheduler` | non (5, 10, 15, 20 ou 30 ; défaut 15) | cadence du tick ; 15 tant que la base est provisoire (posé par l'IaC), 5 pour un vrai produit |
| `SCHEDULER_DELIVERY` | `scheduler` | non (`on`/`off`, défaut `on`) | `off` : le tick ne livre plus, le notifier s'en charge — à poser au plus tard quand il démarre |
| `NOTIFIER_INTERVAL_MS` | `notifier` | non (défaut 15000) | délai entre deux passes de livraison ; 300000 laisse le compute Neon dormir |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TEST_RECIPIENTS` | `notifier` | non (la clé est un secret) | e-mail des alertes ; `@resend.dev` exige la liste de test ; sans clé, e-mails soldés `skipped` avec la raison |
| `WEBHOOK_SIGNING_SECRET` | `notifier` | non (secret, ≥ 32 caractères, deux valeurs pendant une rotation) | signe les webhooks (`x-mip-signature`) |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `collector`, `scheduler`, `notifier`, `api`, `console-api` | **à poser** (15 à 30) | délai SIGTERM → SIGKILL ; défaut Railway 0, soit aucun arrêt propre. Le scheduler de production ne l'a pas en variable (son drainage Railway est réglé à 20 s ; le kit, sans la variable, compte 10 s et avertit au démarrage) |
| `REQUIRE_API_KEY` | `collector` | non | `true` = rejeter toute app inconnue ou sans clé — provisionner d'abord : `scripts/ops/provisionner-cles.mjs`. Une app inactive est refusée quel que soit ce réglage. Exception (30/09/2026) : un lot de l'extension sans clé passe depuis un domaine actif de l'app (`createPgAuth`, `docs/INTEGRATION.md` § 2) |
| `IDENTITY_HASH_SECRET` + `IDENTITY_HASH_FINGERPRINT` | `collector` | non ; l'empreinte **oui** dès que le secret est posé | HMAC des identités ; empreinte par `scripts/ops/empreinte-identite.mjs` (écart : identité retirée, `/ready` refusé) |
| `IDENTITY_HASH_SECRET` | `console-api` | pour le RGPD par identité | la **même** valeur que le collector : sans elle, la recherche, l'export et l'effacement par identité métier (C10) ne peuvent pas hacher la saisie. Déclarée dans l'IaC depuis #327 (26/09/2026) |
| `EDGE_PROXY_SECRET` | `collector` | non (secret, 1 ou 2 valeurs) | secret du relais de la console (bord de confiance `mip-edge/1`) |
| `RATE_LIMIT_PER_MIN` | `collector` | non | défaut 600, par app |
| `PGPOOL_MAX` | `collector`, `scheduler`, `notifier`, `api`, `console-api` | non | taille du pool (défauts : 8, 4, 2, 6 et 8 ; l'IaC pose 6 pour `console-api`) |
| `LOG_LEVEL` | `collector`, `scheduler`, `notifier`, `api`, `console-api` | non | défaut `info` |
| `CONSOLE_API_TOKENS`, `CONSOLE_API_ALLOWED_ORIGINS`, `CONSOLE_API_RATE_LIMIT`, `XSOM_AI_*` | `api` | non | jetons machine et CORS, les mêmes valeurs que la console — [api/README.md](api/README.md) |
| `CONSOLE_API_CLIENT_SECRETS`, `SESSION_SIGNING_KEYS` | `console-api` | **oui** (secrets) | secret client et trousseau privé ES256 ; `DEMO_USER_*`, `OIDC_*`, `CONSOLE_API_RATE_LIMIT` en option — [console-api/README.md](console-api/README.md) |
| `MIP_API_HOST`, `MIP_API_PORT` | `mcp` | non | le service `api` par le réseau privé (`api.railway.internal`, port 8080 par défaut) ; **l'emporte** sur `MIP_CONSOLE_URL`. Hôte privé exigé : HTTP clair, le jeton de l'appelant y passe |
| `MIP_CONSOLE_URL` | `mcp` | oui, sans `MIP_API_HOST` | origine de la console dont il consomme l'API v1 (repli, et le chemin d'avant P4) |
| `MCP_PATH` | `mcp` | non | chemin du point MCP (défaut `/mcp`) |

`mcp` ne prend **pas** `DATABASE_URL` ni de jeton d'API : il relaie celui de
l'appelant, et n'a donc aucun secret à stocker.

## Vérifier en local

```bash
# la base de dev, migrée par le migrateur de production (service one-shot `migrate`)
docker compose -f infra/docker/docker-compose.yml run --rm migrate

# les services
DATABASE_URL=... PORT=4318 node services/collector/server.mjs
DATABASE_URL=... PORT=4320 node services/scheduler/worker.mjs
DATABASE_URL=... PORT=4321 node services/notifier/worker.mjs

# le serveur MCP : pas de base, mais l'origine de la console
MIP_CONSOLE_URL=http://localhost:3000 PORT=4322 node services/mcp/http.mjs

# api et console-api : construits d'abord (bundle), puis lancés — voir leur README
node services/api/build.mjs && DATABASE_URL=... PORT=4323 node services/api/dist/server.mjs
node services/console-api/build.mjs   # puis CONSOLE_API_CLIENT_SECRETS, SESSION_SIGNING_KEYS, PORT=4324
```

Ou les images de production, un profil compose par service (`infra/docker/README.md`) :

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build --wait collector   # db → migrate → collector
docker compose -f infra/docker/docker-compose.yml --profile tout up -d --build --wait
```

`GET /health` (collector, scheduler, notifier, api, console-api) dit processus
vivant **et** base joignable : c'est la sonde Railway. `GET /live` dit processus
vivant, sans toucher la base : c'est la sonde de toute supervision externe (une
sonde externe sur `/health` empêche Neon de s'endormir). `GET /ready`, sous
jeton, dit fraîcheur ou disponibilité métier (registre d'apps chargé pour le
collector, cadences pour le scheduler, dernière passe et arriéré pour le
notifier) : supervision seulement. `mcp` n'expose que `/health` (et `/`) —
n'ayant aucune dépendance à chaud, vivant et prêt y sont la même chose.
