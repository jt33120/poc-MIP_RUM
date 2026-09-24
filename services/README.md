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
                                            migrateur), @mip/mcp-tools (noyau MCP, sans base)
```

Un service, une ligne :

| Service | Rôle | Écoute | Commande | Déployé |
|---|---|---|---|---|
| `collector` | point d'entrée unique des capteurs : OTLP traces et logs, replay, source maps de CI (jeton dédié) ; chemins historiques de la console acceptés ; bord de confiance du relais, identité hachée ici — détail : [`collector/README.md`](collector/README.md) | oui (`PORT`, défaut 4318) : `/health` (sonde Railway : processus + base, décrit service, protocole de bord et empreinte d'identité), `/ready` et `/metrics` (jeton) | `node services/collector/server.mjs` | pas encore (P2 : lancement à blanc) — en production, la collecte passe par la route de la console jusqu'au relais de P3 |
| `scheduler` | déclenche les travaux planifiés sous bail, et **seul** applique les migrations (pré-déploiement) — détail : [`scheduler/README.md`](scheduler/README.md) | oui (`PORT`) : `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/scheduler/worker.mjs` · pré-déploiement `node services/scheduler/migrate.mjs` | Railway |
| `notifier` | livre ce que la plateforme a décidé de dire — webhooks signés, e-mails Resend, tickets — et seul détient les secrets sortants — détail : [`notifier/README.md`](notifier/README.md) | oui (`PORT`) : `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/notifier/worker.mjs` | pas encore (P5) — en production, le scheduler livre à chaque tick |
| `mcp` | expose l'API v1 à un agent IA, sans accès à la base | oui (`PORT`) | `node services/mcp/http.mjs` | Railway |
| `console-api` | le backend de la console (piste C) : seul client, le serveur Vercel, gardé par un secret client ; poignée de main signée ES256 — détail : [`console-api/README.md`](console-api/README.md) | oui (`PORT`) : `/v1/*` sous secret client, `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/console-api/dist/server.mjs` (construit par `build.mjs`) | pas encore (C0) |

`services/collector/` porte aussi les deux serveurs de **développement** que
lancent l'E2E et les scripts de validation (`dev-server.mjs` :4318,
`replay-dev-server.mjs` :4319).

## Les images

**Une image par service**, à côté de son point d'entrée : `services/<x>/Dockerfile`
(contrat de service § 9). Même recette pour toutes — `pnpm fetch` →
`pnpm install --offline` → build → `pnpm deploy --prod`, Node épinglé par
digest, utilisateur non-root, `HEALTHCHECK` pour l'auto-hébergement — et un
`CMD` **explicite** : une image ne sait démarrer que son service. L'ancienne
image commune (`infra/docker/Dockerfile.backend`) démarrait par défaut le
collecteur : une commande de démarrage perdue dans le tableau de bord aurait
fait booter au `scheduler` un receveur OTLP, sans une ligne d'erreur.
L'en-tête de `collector/Dockerfile` explique la recette ; les deux autres la
suivent à l'identique.

Les deux anciennes images (`infra/docker/Dockerfile.{backend,mcp}`) restent
dans le dépôt, marquées OBSOLÈTE en première ligne, le temps que le workflow
« Railway IaC » applique les nouveaux `dockerfilePath` : jusque-là, le tableau
de bord Railway les désigne encore, et Railway construit à chaque push sur
`master` sans attendre l'apply. Les supprimer dans la même fusion ferait
échouer la construction de `scheduler` et de `mcp` dans cet intervalle. Plus
rien du dépôt ne les construit (IaC, compose, fumée — un test le vérifie) ;
elles partent, avec leurs chemins surveillés, une fois les deux services
déployés en vert sur leur nouvelle image.

| Image | Embarque | `CMD` |
|---|---|---|
| `collector/Dockerfile` | `@mip/backend`, `pg`, **la base GeoIP** (seule image à la porter, vérifiée contre `packages/backend/data/*.manifest.json`) | `node services/collector/server.mjs` |
| `scheduler/Dockerfile` | `@mip/backend`, `@mip/db` et son `sql/`, `pg` | `node services/scheduler/worker.mjs` ; le migrateur (`migrate.mjs`) part au pré-déploiement, jamais par défaut |
| `notifier/Dockerfile` | `@mip/backend`, `pg` — ni `@mip/db` (seul le scheduler migre), ni base GeoIP | `node services/notifier/worker.mjs` |
| `mcp/Dockerfile` | `@mip/mcp-tools`, le SDK MCP, zod — **ni `pg` ni `DATABASE_URL`** | `node services/mcp/http.mjs` |
| `console-api/Dockerfile` | un bundle (`@mip/console-api`, `@mip/console-contract`, le kit) et `pg` — **aucune source de la console** (garde du build) | `node services/console-api/dist/server.mjs` |

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

D'où la cadence rabaissée à une heure, et la ligne « Latence d'alerte : 5 min
visées, 60 réelles » de la page de présentation. Un processus qui tourne en
continu n'a aucune de ces limites.

## Configuration

| Variable | Service | Obligatoire | Rôle |
|---|---|---|---|
| `DATABASE_URL` | `collector`, `scheduler`, `notifier` | **oui** | Postgres. TLS vérifié dès que l'hôte n'est pas local — jamais de `rejectUnauthorized: false`. |
| `MIGRATION_DATABASE_URL` | `scheduler` (pré-déploiement) | non | la **même** base par une connexion **directe**, hors pooler : les `predeploy-vNN-*.sql` (index `CONCURRENTLY`) y passent sous verrou de session, juste avant leur migration. Absente, ou pointée sur un pooler, ils sont sautés avec un avertissement et chaque migration garde son garde-fou de taille. Une autre base que `DATABASE_URL` est refusée. |
| `PORT` | `collector` | fourni par l'hébergeur (défaut 4318) | `/health` (sonde Railway), `/ready` et `/metrics` (jeton), routes OTLP |
| `PORT` | `scheduler` | fourni par l'hébergeur (défaut 8080) | `/health` (sonde Railway : processus + base ; « jamais exécuté » et « bail tenu ailleurs » y sont sains), `/ready` et `/metrics` (fraîcheur, arriéré ; jeton) |
| `METRICS_TOKEN` | `collector`, `scheduler`, `notifier` | non (secret, ≥ 32 caractères) | jeton de `/ready` et `/metrics` ; absent, les deux répondent 404 |
| `DEADMAN_URL` | `scheduler` | non (secret, `https:`) | dead-man's switch externe, signalé après chaque tick abouti ; absent, aucun signal |
| `SCHEDULER_DELIVERY` | `scheduler` | non (`on`/`off`, défaut `on`) | `off` : le tick ne livre plus, le notifier s'en charge — à poser au plus tard quand il démarre |
| `NOTIFIER_INTERVAL_MS` | `notifier` | non (défaut 15000) | délai entre deux passes de livraison ; 300000 laisse le compute Neon dormir |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TEST_RECIPIENTS` | `notifier` | non (la clé est un secret) | e-mail des alertes ; `@resend.dev` exige la liste de test ; sans clé, e-mails soldés `skipped` avec la raison |
| `WEBHOOK_SIGNING_SECRET` | `notifier` | non (secret, ≥ 32 caractères, deux valeurs pendant une rotation) | signe les webhooks (`x-mip-signature`) |
| `TICKET_SECRET_KEY`, `TICKET_*` | `notifier` (et `scheduler` tant que `SCHEDULER_DELIVERY=on`) | selon les intégrations | clé des références `enc:v1:`, jetons `env:TICKET_…` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `collector`, `scheduler`, `notifier` | **à poser** (15 à 30) | délai SIGTERM → SIGKILL ; défaut Railway 0, soit aucun arrêt propre |
| `REQUIRE_API_KEY` | `collector` | non | `true` = rejeter toute app inconnue ou sans clé — provisionner d'abord : `scripts/ops/provisionner-cles.mjs` |
| `IDENTITY_HASH_SECRET` + `IDENTITY_HASH_FINGERPRINT` | `collector` | non ; l'empreinte **oui** dès que le secret est posé | HMAC des identités ; empreinte par `scripts/ops/empreinte-identite.mjs` (écart : identité retirée, `/ready` refusé) |
| `EDGE_PROXY_SECRET` | `collector` | non (secret, 1 ou 2 valeurs) | secret du relais de la console (bord de confiance `mip-edge/1`) |
| `RATE_LIMIT_PER_MIN` | `collector` | non | défaut 600, par app |
| `PGPOOL_MAX` | `collector`, `scheduler`, `notifier` | non | taille du pool (défauts : 8, 4 et 2) |
| `LOG_LEVEL` | `collector`, `scheduler`, `notifier` | non | défaut `info` |
| `MIP_CONSOLE_URL` | `mcp` | **oui** | origine de la console dont il consomme l'API v1 |
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
```

Ou les images de production, un profil compose par service (`infra/docker/README.md`) :

```bash
docker compose -f infra/docker/docker-compose.yml up -d --build --wait collector   # db → migrate → collector
docker compose -f infra/docker/docker-compose.yml --profile tout up -d --build --wait
```

`GET /health` (collector, scheduler, notifier) dit processus vivant **et** base
joignable : c'est la sonde Railway. `GET /ready`, sous jeton, dit fraîcheur ou
disponibilité métier (registre d'apps chargé pour le collector, cadences pour
le scheduler, dernière passe et arriéré pour le notifier) : supervision seulement. `mcp` n'expose que `/health` — n'ayant
aucune dépendance à chaud, vivant et prêt y sont la même chose.
