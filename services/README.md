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
| `collector` | collecte OTLP : traces, logs, replay ; source maps de CI (`POST /v1/sourcemaps`, jeton dédié) | oui (`PORT`) | `node services/collector/server.mjs` | non — image d'auto-hébergement, démarrée par la CI ; en production la collecte passe par la route de la console |
| `scheduler` | déclenche les travaux planifiés sous bail, et **seul** applique les migrations (pré-déploiement) — détail : [`scheduler/README.md`](scheduler/README.md) | oui (`PORT`) : `/health` (sonde Railway), `/ready` et `/metrics` (jeton) | `node services/scheduler/worker.mjs` · pré-déploiement `node services/scheduler/migrate.mjs` | Railway |
| `mcp` | expose l'API v1 à un agent IA, sans accès à la base | oui (`PORT`) | `node services/mcp/http.mjs` | Railway |

`services/collector/` porte aussi les deux serveurs de **développement** que
lancent l'E2E et les scripts de validation (`dev-server.mjs` :4318,
`replay-dev-server.mjs` :4319).

`collector`, `scheduler` et les migrations partagent **une seule image**
(`infra/docker/Dockerfile.backend`) : mêmes paquets, mêmes dépendances, seule la
commande change.

`mcp` a **la sienne** (`infra/docker/Dockerfile.mcp`), et ce n'est pas une
entorse à la règle précédente mais son application : ni le même noyau, ni les
mêmes dépendances — et surtout, **il ne doit pas pouvoir atteindre la base**.
C'est le seul service pilotable par un modèle de langage, donc par le texte que
ce modèle a lu ; la seule protection qui tienne contre une injection de prompt
réussie, c'est qu'il n'y ait rien à atteindre. Pas de `pg`, pas de
`DATABASE_URL` : tout passe par l'API v1, qui applique déjà le cloisonnement par
jeton. Cf. `docs/MCP.md`.

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
| `DATABASE_URL` | `collector`, `scheduler` | **oui** | Postgres. TLS vérifié dès que l'hôte n'est pas local — jamais de `rejectUnauthorized: false`. |
| `MIGRATION_DATABASE_URL` | `scheduler` (pré-déploiement) | non | la **même** base par une connexion **directe**, hors pooler : les `predeploy-vNN-*.sql` (index `CONCURRENTLY`) y passent sous verrou de session, juste avant leur migration. Absente, ou pointée sur un pooler, ils sont sautés avec un avertissement et chaque migration garde son garde-fou de taille. Une autre base que `DATABASE_URL` est refusée. |
| `PORT` | `collector` | fourni par l'hébergeur | port d'écoute (défaut local : 4318) |
| `PORT` | `scheduler` | fourni par l'hébergeur (défaut 8080) | `/health` (sonde Railway : processus + base ; « jamais exécuté » et « bail tenu ailleurs » y sont sains), `/ready` et `/metrics` (fraîcheur, arriéré ; jeton) |
| `METRICS_TOKEN` | `scheduler` | non (secret, ≥ 32 caractères) | jeton de `/ready` et `/metrics` ; absent, les deux répondent 404 |
| `DEADMAN_URL` | `scheduler` | non (secret, `https:`) | dead-man's switch externe, signalé après chaque tick abouti ; absent, aucun signal |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `scheduler` | **à poser** (15 à 30) | délai SIGTERM → SIGKILL ; défaut Railway 0, soit aucun arrêt propre |
| `REQUIRE_API_KEY` | `collector` | non | `true` = rejeter toute app inconnue ou sans clé |
| `RATE_LIMIT_PER_MIN` | `collector` | non | défaut 600, par app |
| `PGPOOL_MAX` | `collector`, `scheduler` | non | taille du pool (défauts : 8 et 4) |
| `LOG_LEVEL` | `collector`, `scheduler` | non | défaut `info` |
| `MIP_CONSOLE_URL` | `mcp` | **oui** | origine de la console dont il consomme l'API v1 |
| `MCP_PATH` | `mcp` | non | chemin du point MCP (défaut `/mcp`) |

`mcp` ne prend **pas** `DATABASE_URL` ni de jeton d'API : il relaie celui de
l'appelant, et n'a donc aucun secret à stocker.

## Vérifier en local

```bash
# la base de dev
cd infra/docker && docker compose up -d db

# le schéma, puis ce qui manque
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum \
  node services/scheduler/migrate.mjs

# les services
DATABASE_URL=... PORT=4318 node services/collector/server.mjs
DATABASE_URL=... PORT=4320 node services/scheduler/worker.mjs

# le serveur MCP : pas de base, mais l'origine de la console
MIP_CONSOLE_URL=http://localhost:3000 PORT=4322 node services/mcp/http.mjs
```

`GET /health` répond dès que le process vit ; `GET /ready` seulement quand la
base répond. Les deux sont distincts à dessein : redémarrer un service dont
seule la base est absente n'arrange rien. `mcp` n'expose que `/health` — n'ayant
aucune dépendance à chaud, vivant et prêt y sont la même chose.
