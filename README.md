# MIP RUM — POC

POC **RUM (Real User Monitoring) OpenTelemetry-native** pour MIP : SDK Web léger → OTLP/HTTP JSON → ingestion serverless → Postgres → console RUM Live, avec **corrélation synthétique↔RUM** (différenciateur MIP).

Source de vérité : [PLAN.md](PLAN.md). Journal de build : [BUILD_LOG.md](BUILD_LOG.md).

## Architecture (hybride assumée)

```
[App web] -> [MIP RUM SDK] --OTLP/HTTP JSON--> [Ingestion /v1/traces] --> [Postgres]
                                                                             ^    |
[Synthétique DEM (mippoc ou seed)] --> [sync-synthetic] -------------------/     v
                                                                  [Console RUM Live (Next.js)]
```

- **Fidèle OTel sur le fil** : le SDK émet de l'OTLP/HTTP JSON standard (`POST /v1/traces`) — portable vers un Collector + ClickHouse sans toucher au SDK.
- **Backend simplifié** : Postgres (Supabase en cloud, docker-compose en local). ClickHouse = cible prod, hors POC (cf. `infra/clickhouse.notes.md`).

## Démarrage local (100 % local, aucun secret)

```bash
pnpm install
docker compose -f apps/ingest/docker-compose.yml up -d   # Postgres + schéma
pnpm --filter @mip/rum-sdk build                         # SDK -> dist/mip-rum.js
node apps/ingest/dev-server.mjs                          # ingestion locale :4318
pnpm --filter console dev                                # console :3000
# ouvrir demo/index.html servi par: node demo/serve.mjs  (:8080)
```

## Workspaces

| Workspace | Rôle |
|---|---|
| `packages/rum-sdk` | SDK Web (OTel lean + web-vitals 5.2) |
| `apps/ingest` | Receiver OTLP `/v1/traces` (Deno edge function + dev server Node) + schéma SQL |
| `apps/sync-synthetic` | Job de synchro synthétique (mippoc ou seed) → `syn_snapshot` |
| `apps/console` | Console RUM Live (Next.js 15) |

Déploiement cloud : voir [DEPLOY.md](DEPLOY.md).
