# MIP RUM

[![CI](https://github.com/jt33120/poc-MIP_RUM/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/jt33120/poc-MIP_RUM/actions/workflows/ci.yml)

**POC** de Real User Monitoring : mesure de l'expérience vécue par les visiteurs réels d'un site ou d'une application — vitesse d'affichage, réactivité, erreurs, parcours. Collecte au format OpenTelemetry (OTLP/HTTP), données hébergées en Union européenne chez des hébergeurs de droit américain.

- **Capteurs** : SDK web (`packages/rum-sdk`), SDK React Native (`packages/rum-mobile`), extension navigateur MV3 (`apps/extension`) ; côté serveur, l'agent OpenTelemetry officiel du langage du client.
- **Console** (`apps/console`, Next.js sur Vercel) : écrans, routes de collecte `/api/ingest/v1/*`, API de lecture `/api/v1` (Swagger sur `/api/v1/docs`), vitrine publique `/presentation`.
- **Services** (`services/*`, Railway) : `collector`, `api`, `console-api`, `mcp`, `scheduler` (travaux planifiés, seul migrateur), `notifier` — voir [services/README.md](services/README.md).
- **Base** : PostgreSQL (Neon) ; schéma et migrations dans `packages/db/sql`.

Ce dépôt ne porte que ce qui sert à construire, tester, déployer et faire tourner le produit. Les consignes pour les agents de code sont dans [AGENTS.md](AGENTS.md).

## Installer

Node 24 (`.nvmrc`), pnpm 9.15.9, Docker pour la base locale.

```bash
pnpm install --frozen-lockfile
pnpm build:sdk                                                  # SDK web et React Native
```

## Lancer en local

Base, ingestion et console sur le poste, sans secret : les programmes se rabattent sur `postgres://postgres:postgres@localhost:5433/mip_rum`. Le schéma se monte par le migrateur de production.

```bash
docker compose -f infra/docker/docker-compose.yml run --rm migrate  # Postgres 17 sur :5433, base mip_rum migrée
node scripts/seed-admin.mjs                                     # compte admin local : mot de passe affiché une fois
node services/collector/dev-server.mjs                          # ingestion locale :4318
node tests/e2e/site-cobaye/serve.mjs                            # site cobaye des E2E :8080
pnpm --filter console dev                                       # console :3000
node tools/sync-synthetic/src/sync.mjs seed                     # passages robot pour /correlation
```

## Tester

```bash
pnpm --filter console typecheck   # tsc --noEmit sur la console
pnpm test:unit                    # vitest, tests/unit (pnpm build:sdk d'abord sur un clone neuf)
pnpm test:sql                     # vitest, tests/integration, sur un PostgreSQL réel (bases dédiées, voir ci.yml)
pnpm test:contract                # vitest, tests/contract : parité console ↔ collector et console ↔ api
pnpm test:e2e                     # Playwright ; lance lui-même ingestion, démo, console-api et console — Postgres migré requis
```

La CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) rejoue ces suites sur un Postgres 17 de service. [`docker-smoke.yml`](.github/workflows/docker-smoke.yml) construit et démarre l'image de chacun des six services.

## Déployer

- **Console** : Vercel, à chaque fusion sur `master` (`apps/console/vercel.json`).
- **Services** : Railway, déclarés dans [`.railway/railway.ts`](.railway/railway.ts) ; chaque service se redéploie quand ses chemins surveillés changent. L'infrastructure ne s'applique que par le workflow [`railway-config.yml`](.github/workflows/railway-config.yml), après approbation.
- **Migrations** : appliquées par le `scheduler` à son pré-déploiement (`services/scheduler/migrate.mjs`), jamais à la main.
- **Auto-hébergement** : les mêmes images, par profil compose ([infra/docker/](infra/docker/)).
