# Backend MIP RUM auto-hébergé (souverain, conteneurisé)

Les **trois services Railway**, sur un poste ou un serveur, avec leurs **images de
production** (`services/<x>/Dockerfile`). Objectif : maîtriser l'infra, tourner
**hors Cloud Act** (sur ton hébergement / OVH), et disposer de **logs de
conteneur** pour le dogfooding.

```
navigateur / SDK ──(OTLP)──▶ collector ──▶ db (Postgres 17) ◀── migrate (one-shot)
                                               ▲
                              scheduler ───────┘   (travaux planifiés)
agent IA ──(MCP)──▶ mcp ──▶ API v1 de la console   (jamais la base)
```

C'est **le même code et la même image** qu'en production : ce que ce compose
démarre est, octet pour octet, ce que Railway construit depuis le même
Dockerfile. `services/collector/server.mjs` câble le receveur de `@mip/backend`
(`lib/receiver.mjs`) en vrai serveur HTTP (OTLP → Postgres) avec `/health`,
`/ready`, rate-limit, vérif de clé d'API et arrêt propre.

## Un profil par service

| Service | Profil | Image | Port hôte (défaut) | Dépend de |
|---|---|---|---|---|
| `db` | — (toujours) | `postgres:17` | `DB_PORT` (5433) | — |
| `migrate` | — (toujours) | `services/scheduler/Dockerfile` | — | `db` sain |
| `collector` | `collector`, `tout` | `services/collector/Dockerfile` | `COLLECTOR_PORT` (4318) | `migrate` **sorti en 0** |
| `scheduler` | `scheduler`, `tout` | `services/scheduler/Dockerfile` | `SCHEDULER_PORT` (4320) | `migrate` **sorti en 0** |
| `notifier` | `notifier`, `tout` | `services/notifier/Dockerfile` | `NOTIFIER_PORT` (4321) | `migrate` **sorti en 0** |
| `mcp` | `mcp`, `tout` | `services/mcp/Dockerfile` | `MCP_PORT` (4322) | rien : **aucune base** |
| `api` | `api`, `tout` | `services/api/Dockerfile` | `API_PORT` (4323) | `migrate` **sorti en 0** |
| `console-api` | `console-api`, `tout` | `services/console-api/Dockerfile` | `CONSOLE_API_PORT` (4324) | `migrate` **sorti en 0** |

`console-api` exige deux secrets, **sans valeur par défaut** (un secret n'a pas de
valeur « de développement » dans un fichier versionné) ; vides, il refuse de
démarrer et dit lequel manque. À poser dans `infra/docker/.env` :

```bash
echo "CONSOLE_API_CLIENT_SECRETS=$(openssl rand -hex 32)" >> .env
echo "SESSION_SIGNING_KEYS=$(node ../../scripts/ops/generer-cles-session.mjs --nouvelle 2>/dev/null)" >> .env
```

`migrate` lance la commande exacte du pré-déploiement Railway,
`node services/scheduler/migrate.mjs`, avec l'image du scheduler. Un migrateur
en échec bloque le démarrage des services, comme un pré-déploiement en échec
garde l'ancien déploiement en service sur Railway.

## Démarrer

```bash
cd infra/docker
cp .env.example .env                              # adapter les mots de passe hors local

docker compose up -d --build --wait collector     # db → migrate → collector
docker compose --profile tout up -d --build --wait   # les trois services
docker compose ps -a                              # migrate « Exited (0) », les autres « healthy »
```

- **Endpoint OTLP** : `http://localhost:4318/v1/traces`
- **Postgres** : `localhost:5433` (user `postgres`, db `mip_rum`)
- **MCP** : `http://localhost:4322/mcp` (jeton porteur exigé ; il relaie l'API v1
  de `MIP_CONSOLE_URL`, par défaut la console du poste sur `:3000`)

### La base de développement seule

```bash
docker compose -f infra/docker/docker-compose.yml run --rm migrate
```

`run` démarre `db`, attend qu'elle soit saine, migre, et rend le code du
migrateur : quand la commande rend la main, la base est migrée. (`up --wait db
migrate` n'attendrait pas la FIN de `migrate`, seulement son démarrage.) La
rejouer ne coûte rien : le second passage dit « migrations à jour », 0 appliquée.

### Vérifier

```bash
curl -s http://localhost:4318/health   # {"status":"ok","service":"ingest",…,"geoip":{…}}
curl -s http://localhost:4318/ready    # {"status":"ready"} (la base répond)
curl -s http://localhost:4320/health   # scheduler : processus + base
# fraîcheur de chaque cadence et arriéré de livraisons (METRICS_TOKEN posé dans .env)
curl -s -H "authorization: Bearer $METRICS_TOKEN" http://localhost:4320/ready

# envoyer un payload OTLP d'exemple -> attendu {"partialSuccess":{}}
curl -s http://localhost:4318/v1/traces -H 'content-type: application/json' \
  -d @../../tests/fixtures/otlp-sample.json

# le voir en base
docker compose exec db psql -U postgres -d mip_rum \
  -c "select app_id, name, value from rum_metric order by id desc limit 5;"
```

### Fumée en local

La même preuve que la CI (`.github/workflows/docker-smoke.yml`, une ligne de
matrice par service) : démarrer le service, `/health` à 200, une requête de
référence, puis `docker compose stop -t 10 <service>` — le code de sortie doit
être 0 (sorti de lui-même sur SIGTERM, avant le SIGKILL), et
`docker compose exec <service> id -u` ne doit pas rendre 0.

## Les logs (le but de la conteneurisation)

Les services émettent **une ligne JSON par événement** sur stdout
(`{ts,level,service,msg,…}`, secrets expurgés). Le driver `json-file` (rotation
10 Mo × 5) les capture :

```bash
docker compose logs -f collector            # flux structuré (ingested, rate limited, db retry…)
docker compose logs -f collector | jq .     # filtrable : jq 'select(.level=="error")'
docker compose logs migrate                 # ce que le migrateur a appliqué
LOG_LEVEL=debug docker compose up -d collector
```

## Brancher la console / le SDK dessus

```bash
# SDK / console : endpoint d'ingestion
NEXT_PUBLIC_RUM_ENDPOINT=http://localhost:4318/v1/traces
# console : la base du compose
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum
```

## Sécurité

- **Non-root** : chaque image tourne sous l'utilisateur `node` (uid 1000), et
  son code appartient à root — le processus ne peut pas le réécrire.
- **Images épinglées par digest** (Node 24, `.nvmrc`), identiques pour les trois
  services ; chaque paquet posé est vérifié contre le lockfile à la construction
  (`scripts/ci/deploy-fidele.mjs`).
- **`mcp` n'a ni `pg` ni `DATABASE_URL`**, et ne dépend ni de `db` ni de
  `migrate` : il ne parle qu'à l'API v1.
- **`REQUIRE_API_KEY=true`** : rejette (403) tout `app_id` inconnu/sans clé. Défaut
  `false` (fail-open POC) — passer `true` une fois toutes les apps porteuses d'une clé.
- **Mots de passe** : changer `POSTGRES_PASSWORD` hors local.
- **Rôle restreint `console_ro`** (parité avec la production, RLS + policies
  `cro_*`) : il n'est plus créé d'office — c'était le travail de l'ancien
  `initdb.sh`, disparu avec lui. Les blocs de `migration-v16` qui le concernent
  sont gardés par son existence : il doit donc exister AVANT la première
  migration, sur un volume vierge.

  ```bash
  docker compose up -d --wait db
  docker compose exec -T db psql -U postgres -d mip_rum -v ON_ERROR_STOP=1 -v pw="$CONSOLE_RO_PASSWORD" <<'SQL'
  create role console_ro login;
  alter role console_ro password :'pw';
  grant connect on database mip_rum to console_ro;
  grant usage on schema public to console_ro;
  SQL
  docker compose run --rm migrate
  ```

  Sans lui, les blocs sont sautés, exactement comme en CI.

## Rétention (TTL)

`pg_cron` n'est pas présent sur `postgres:17` → la purge automatique passe par
le travail quotidien du `scheduler` (profil `scheduler`). Pour une passe
ponctuelle, sous bail :

```bash
docker compose exec scheduler node services/scheduler/run-once.mjs daily
```

## Ce que ce compose ne couvre pas (encore)

- **La console** (Next.js) : elle reste sur Vercel. La conteneuriser demande
  `output: 'standalone'` et sa propre image — lot C12b du plan.
- **Page supervision logs** : voir ci-dessous.

## Feuille de route « supervision logs »

Aujourd'hui les logs sont accessibles en **CLI** (`docker compose logs`). Pour les
afficher **dans la console** :
1. **Collecte** : un OTel Collector (filelog receiver sur les logs json-file, ou
   réception directe) — la brique est prototypée dans `labs/network-logs/`.
2. **Stockage** : table `otel_logs` en Postgres (comme les traces), ou ClickHouse
   au-delà d'un certain volume (l'arbitrage coût est justement l'objet du POC).
3. **Ingestion** : le signal *logs* OTel (`resourceLogs`) est déjà reçu sur `/v1/logs`.
4. **UI** : page « Logs » (filtres sévérité/source/app, timeline, corrélation
   trace↔log) sur les primitives dataviz existantes.

## Nettoyer

```bash
docker compose --profile tout down       # arrêt (garde les données)
docker compose --profile tout down -v    # + supprime le volume db-data
```

`--profile tout` : sans lui, `down` ignore les services des profils inactifs et
laisse leurs conteneurs derrière lui.
