# MIP RUM

[![CI](https://github.com/jt33120/poc-MIP_RUM/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/jt33120/poc-MIP_RUM/actions/workflows/ci.yml)

**POC** de Real User Monitoring : mesure de l'expérience vécue par les visiteurs réels d'un site ou d'une application — vitesse d'affichage, réactivité, erreurs, parcours. Collecte au format OpenTelemetry, données hébergées en Union européenne.

La vitrine de la console (`/presentation`) dit ce que le POC contient, ce qu'il sait faire et ce qui reste pour un vrai outil de RUM. Ce README en reprend l'hébergement et l'état relevé (sections [Architecture](#architecture) et [Statut](#statut), générées depuis les mêmes sources) ; l'historique des versions est dans [CHANGELOG.md](CHANGELOG.md).

## Pourquoi celui-là

- **Format OpenTelemetry** : le SDK web émet de l'OTLP/HTTP JSON vers la route `/api/ingest/v1/traces` de la console (`apps/console/lib/ingest-endpoint.ts`). La structure des spans est vérifiée, mais ils partent avec une durée nulle et une partie du vocabulaire reste propre à MIP : un collecteur tiers en dessinerait un waterfall plat (vitrine, onglet Specs, ligne « Format sur le fil » : `apps/console/components/presentation/Specs.tsx`). Pour les gros volumes, un chemin ClickHouse a été mesuré en local le 11/06/2026 — mêmes p75, stockage 15 fois plus compact (`labs/clickhouse/NOTES.md`) ; ce banc n'a pas été rejoué depuis la migration vers Neon.
- **Hébergement** : Données hébergées en UE ; hébergeurs de droit américain ; ce POC n'est pas une offre souveraine. Aucune adresse IP n'est stockée, sous aucune forme (`docs/RUM_PARITY_STATUS.md`, § 6.4). Détail dans la section [Architecture](#architecture), lu dans `apps/console/lib/legal.ts`.
- **Robot et réel** : l'écran `/correlation` confronte, route par route et heure par heure, l'état d'un robot de monitoring synthétique au LCP p75 des visiteurs réels, et compte les heures où l'un voit ce que l'autre ne voit pas (angle mort) — sans jamais soustraire une mesure de robot à un LCP de visiteur (`apps/console/app/correlation/page.tsx`). Cet écran est hors du document de couverture : il n'y a pas de verdict.

## Architecture

<!-- genere:readme-architecture -->
<!-- Zone écrite par `node scripts/readme-sections.mjs` depuis apps/console/lib/presentation-topologie.ts, qui lit les hébergeurs dans apps/console/lib/legal.ts. Ne pas la modifier à la main : tests/unit/readme.test.ts la régénère et compare. -->

Le chemin de la mesure, tel que le dessine la vitrine de la console (`/presentation`) :

```mermaid
flowchart TB
  navigateur["Navigateur du visiteur<br/>SDK web ou extension"]
  console["Console — Vercel<br/>fra1 · Francfort<br/>collecteur /api/ingest/v1<br/>API de lecture /api/v1"]
  base["PostgreSQL — Neon<br/>aws-eu-central-1 · Francfort"]
  travaux["Travaux planifiés — Railway<br/>europe-west4 · Amsterdam<br/>migrations, alertes, SLO,<br/>sondes, purge"]
  mcp["Serveur MCP — Railway<br/>europe-west4 · Amsterdam<br/>lecture seule, par /api/v1"]
  navigateur -->|"OTLP/HTTP JSON"| console
  console -->|"écrit et lit"| base
  travaux --> base
  mcp --> console
```

| Pièce | Hébergeur | Région | Rôle |
|---|---|---|---|
| Navigateur du visiteur | poste du visiteur | — | mesure et envoie en OTLP/HTTP JSON |
| Console — Vercel | Vercel Inc. | fra1 — Francfort, Allemagne | reçoit les mesures, sert la console et l'API |
| PostgreSQL — Neon | Neon (sur AWS) | aws-eu-central-1 — Francfort, Allemagne | stocke les mesures |
| Travaux planifiés — Railway | Railway Corp. | europe-west4 — Amsterdam, Pays-Bas | migrations au pré-déploiement, alertes, SLO, sondes, purge |
| Serveur MCP — Railway | Railway Corp. | europe-west4 — Amsterdam, Pays-Bas | lit par l'API /api/v1, sans accès à la base |

- Régions : Francfort, Allemagne ; Amsterdam, Pays-Bas. Droit des trois hébergeurs (Neon, Vercel Inc. et Railway Corp.) : américain.
- Le collecteur est une route de la console : c'est l'adresse que visent les SDK. Le même parseur existe en service Node autonome (`services/collector/server.mjs`), construit et démarré par la CI (`docker-smoke`), pour un hébergement chez le client ; en production, il ne tourne nulle part : le service Railway `ingest`, qui l'exécutait sans domaine public, a été supprimé le 21/09/2026.
- Le `scheduler` applique les migrations au pré-déploiement : constaté le 18/09/2026 dans les journaux du déploiement `03850b30`.
- Topologie relevée par les API Railway et Vercel le 18/09/2026, puis par l'API Railway le 23/09/2026 : [docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md).
<!-- /genere -->

## Démarrage local

Base, ingestion, démo et console sur le poste, sans secret : les programmes se rabattent sur `postgres://postgres:postgres@localhost:5433/mip_rum` (`apps/console/lib/db.ts`, `packages/backend/lib/serveur.mjs`). Le schéma se monte comme dans la CI : par le migrateur de production, `DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum node services/scheduler/migrate.mjs` (`.github/workflows/ci.yml`, étape « Schéma par le migrateur »). La base du compose passe par ce même programme : son service one-shot `migrate` lance `node services/scheduler/migrate.mjs` dans l'image du scheduler.

```bash
pnpm install --frozen-lockfile
docker compose -f infra/docker/docker-compose.yml run --rm migrate  # Postgres 17 sur :5433, base mip_rum migrée par le migrateur de production
pnpm build:sdk                                                  # SDK web, React Native, agent Node
node scripts/seed-admin.mjs                                     # compte admin local : mot de passe affiché une fois, régénéré à chaque appel
node services/collector/dev-server.mjs                          # ingestion locale :4318 (MIP_E2E_TAMPON=1 : tampon /__recent de l'E2E)
node demo/serve.mjs                                             # mini-site de démo :8080
pnpm --filter console dev                                       # console :3000
node tools/sync-synthetic/src/sync.mjs seed                      # passages robot pour /correlation
```

## Outillage IA — local, non versionné

Une partie de ce produit a été écrite avec des agents. Leurs réglages et leurs
artefacts (`.claude/`, `.agents/`, `.codex/`, `_bmad/`, `_bmad-output/`, `.mcp.json`)
**ne sont pas dans le dépôt** : ils ne décrivent pas le produit, et ils pesaient un tiers
des fichiers suivis. Un clone neuf n'en a pas besoin et ne les verra pas.

Ce qui devait survivre à ce retrait a été déplacé dans `docs/` : le plan de la refonte
frontend ([docs/product/plan-frontend-dashboard.md](docs/product/plan-frontend-dashboard.md)),
les quatre journaux de livraison ([docs/archive/delivery/](docs/archive/delivery/)) et les
notes de lecture qui servent de source à la vitrine
([docs/product/notes-lecture-ekara.md](docs/product/notes-lecture-ekara.md)).

Le seul outil que le dépôt suppose installé est **graft**, et seulement pour qui travaille
avec un agent :

```bash
npm install -g @nanonets/graft   # le binaire `graft`, appelé par l'outillage local
graft build                      # (re)génère le graphe de code dans graft/ — local, gitignoré
```

Le graphe vit dans `graft/`, **jamais commité** : chaque poste régénère le sien. `.ignore` le
garde greppable malgré le gitignore.

## Tests

```bash
pnpm --filter console typecheck   # tsc --noEmit sur la console
pnpm test:unit                    # vitest, tests/unit (pnpm build:sdk d'abord sur un clone neuf)
pnpm test:sql                     # vitest, tests/integration, sur un PostgreSQL réel (bases dédiées, voir ci.yml)
pnpm test:e2e                     # Playwright ; lance lui-même ingestion, replay, démo et console (build de production) — Postgres requis
```

La CI GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) rejoue ces suites sur un Postgres de service : build des SDK, typage des paquets et de la console, unitaires et middleware Python ; puis schéma et toutes les migrations, suites SQL sur bases dédiées, seed synthétique et E2E Chromium. [`docker-smoke.yml`](.github/workflows/docker-smoke.yml) construit et démarre les images du receveur autonome et du serveur MCP.

Les zones générées de ce README se régénèrent par `node scripts/readme-sections.mjs` ; `tests/unit/readme.test.ts` échoue si elles ne sont plus à jour.

## Workspaces

| Workspace | Rôle |
|---|---|
| `packages/rum-core` | Primitives pures partagées par les runtimes (contexte, snapshots d'événement, `beforeSend`, encodeur OTLP) |
| `packages/rum-sdk` | SDK Web (émetteur OTLP + web-vitals), build esbuild IIFE `mip-rum.js` ; poids gzip remesuré par `tests/unit/specs.test.ts` (`apps/console/lib/sdk-poids.ts`) |
| `packages/agent-node` | Agent backend Node.js (`node -r @mip/agent-node/register`) : span `http.server` sans changement de code, plus une API publique (`track`, `captureException`, `withContext`, `flush`) ; aucun service Node n'émet vers la production (document de couverture, `C5`) |
| `packages/rum-mobile` | SDK **React Native** : crashes, écrans, réseau (traceparent), événements → mêmes tables (`device_type=mobile`) ; livré, jamais lancé dans une application React Native (document de couverture, `C1` et `C10`) |
| `packages/backend` | `@mip/backend` — noyau backend sans framework : parseur OTLP, receveur (`/v1/traces`, `/v1/logs`, `/v1/replay`, `/v1/sourcemaps`), écritures Postgres, travaux planifiés, livraison des alertes, connecteur de tickets. Importé par la console comme par les services. **En production, le collecteur actif est la route de la console** ([docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md)) |
| `packages/db` | `@mip/db` — le schéma (`sql/` : `schema.sql`, migrations numérotées, index de pré-déploiement) et son migrateur, que seul le `scheduler` lance |
| `packages/mcp-tools` | `@mip/mcp-tools` — noyau MCP : catalogue d'outils, client HTTP de l'API v1 ; sans base de données |
| `services/*` | Points d'entrée minces au-dessus des paquets, un par service Railway : `scheduler` et `mcp` (déployés), `collector` (receveur autonome pour l'auto-hébergement, voir [infra/docker/](infra/docker/)) — [services/README.md](services/README.md) |
| `tools/sync-synthetic` | Synchro synthétique → `syn_snapshot` (interface `SyntheticSource` : seed ou export mippoc) |
| _(hors workspaces)_ | `examples/integrations/fastapi` (middleware FastAPI, testé en CI) · `labs/clickhouse` et `labs/network-logs` (bancs et prototypes, non déployés) · `demo/` et `scripts/` restent à la racine : l'E2E et la CI les lancent par leur chemin |
| `apps/extension` | Extension navigateur MV3 (injection du SDK par domaine enregistré) |
| `apps/console` | Console (Next.js 15) et collecteur `/api/ingest/v1` ; les écrans sont listés dans `apps/console/components/nav-items.tsx`, la vitrine publique est `/presentation` |

## Documentation

En cas de désaccord entre ces documents, [docs/RUM_PARITY_STATUS.md](docs/RUM_PARITY_STATUS.md) et [docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md) font foi : la vitrine et les zones générées de ce README en tirent leurs verdicts et leurs faits d'exploitation.

| Document | Contenu |
|---|---|
| [docs/RUM_PARITY_STATUS.md](docs/RUM_PARITY_STATUS.md) | **Document de couverture** : capacité par capacité, son verdict, sa preuve et sa limite (lots P5 à P8) |
| [docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md) | Ce que chaque service exécute en production, et pourquoi il existe |
| [docs/context/](docs/context/) | **Contexte produit** : maturité par service (RUM, supervision IA, Logs), grille d'évaluation, écarts et critères de sortie |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Guide d'intégration client : snippet, options, consent mode, CSP, RGPD, dépannage |
| [packages/agent-node/README.md](packages/agent-node/README.md) | Agent backend Node.js (`node -r @mip/agent-node/register`) |
| [packages/rum-mobile/README.md](packages/rum-mobile/README.md) | SDK React Native (crashes, écrans, réseau, événements) |
| [docs/API_CONSOLE.md](docs/API_CONSOLE.md) · [docs/RUM_READ_API.md](docs/RUM_READ_API.md) | API de lecture v1 (ITSM/CI-CD) + résumé partenaire |
| [docs/MULTITENANT.md](docs/MULTITENANT.md) · [docs/ALERTING.md](docs/ALERTING.md) | Multi-tenant / RBAC · alerting (webhook/Slack ; e-mail à brancher) |
| [docs/CONFORMITE.md](docs/CONFORMITE.md) · [docs/DPA.md](docs/DPA.md) | Conformité RGPD (résidence UE, DSAR, scrub PII) · modèle de DPA (art. 28) |
| [docs/DOCUMENTS-HORS-DEPOT.md](docs/DOCUMENTS-HORS-DEPOT.md) | **Ce qui n'est pas ici** : documents commerciaux (offre, démo, scan marché) et documents d'un client nommé. Présents sur le poste, hors dépôt, et listés avec leur contenu |
| [docs/LIMITES.md](docs/LIMITES.md) | Limites du produit : liste du 10/06/2026 (v0.1 à v0.3), mise à jour P8.8 du 18/09/2026 |
| [DEPLOY.md](DEPLOY.md) | Déploiement (Neon + Railway + Vercel), snippet et recette — **en partie périmé** : décrit encore le service Railway `ingest`, supprimé le 21/09/2026, et lui attribue les migrations, reprises par le `scheduler` ([docs/TOPOLOGIE_BACKEND.md](docs/TOPOLOGIE_BACKEND.md)) |
| [BUILD_LOG.md](BUILD_LOG.md) | Journal factuel du build (valeurs réelles mesurées, pièges, décisions) |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |
| [docs/archive/](docs/archive/) | Rapports de sprint & plans historiques (PLAN, ROADMAP_V02/V03, RAPPORT_NUIT/V04/V05) — non maintenus, valeur d'archive |

## Statut

<!-- genere:readme-statut -->
<!-- Zone écrite par `node scripts/readme-sections.mjs` depuis apps/console/lib/couverture.generated.json, l'extraction de docs/RUM_PARITY_STATUS.md. Ne pas la modifier à la main : tests/unit/readme.test.ts la régénère et compare. -->

État relevé le **23/09/2026** sur `8a5f3d1` par le document de couverture [docs/RUM_PARITY_STATUS.md](docs/RUM_PARITY_STATUS.md) : **49** capacités recensées, **35** déployées, **aucune** éprouvée sur des données réellement ingérées — le vocabulaire du document n'a pas de verdict au-dessus de `deploye_non_eprouve`.

| Verdict | Capacités |
|---|--:|
| `deploye_non_eprouve` | 35 |
| `livre_non_deploye` | 5 |
| `livre_avec_defaut_connu` | 2 |
| `en_revue` | 0 |
| `bloque_acces_externe` | 4 |
| `non_retenu` | 1 |
| `non_commence` | 2 |

Le document ne recense que les capacités des lots P5 à P8 : les écrans plus anciens de la console n'y ont pas de verdict, et ce README ne leur en donne pas. La vitrine (`/presentation`) reprend les mêmes verdicts, ligne par ligne.

Tests comptés au relevé, pas aujourd'hui : 3815 tests unitaires verts (266 fichiers) ; suite SQL verte, 637 tests (45 fichiers) dont 13 ignorés (2 fichiers).
<!-- /genere -->
