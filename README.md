# MIP RUM

[![CI](https://github.com/jt33120/mip-rum/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/jt33120/mip-rum/actions/workflows/ci.yml)

**Real User Monitoring OpenTelemetry-native et souverain**, avec corrélation **synthétique ↔ réel** — le créneau MIP : croiser ce que voient les robots (monitoring synthétique DEM) avec ce que vivent les vrais utilisateurs.

Démontré en production le 10/06/2026 sur `plateforme.groupement-it.com` : sur `/login`, le robot mesure **1,14 s (état « ok »)** pendant que le LCP p75 réel est à **4,04 s (« poor »)** — un écart de **+254 %** invisible au synthétique seul. C'est exactement le problème que ce produit rend visible.

## Pourquoi celui-là

- **OTel-native, vérifiable sur le fil** : le SDK émet de l'OTLP/HTTP JSON standard (`POST /v1/traces`). Aucun format propriétaire — le backend est remplaçable par un Collector OTel + ClickHouse sans toucher au SDK (chemin documenté dans `infra/`).
- **Souverain** : données hébergées en UE (Supabase eu-west-3, Paris) et architecture on-prem-ready. Pas de dépendance à un SaaS US d'observabilité.
- **Corrélation synthétique↔RUM** : le différenciateur MIP. Vue côte à côte robot vs réel par route, écarts surlignés, détection d'« angles morts » (robot ok / utilisateurs en souffrance).

## Architecture

```
[App web cliente] -> [MIP RUM SDK 16,3 KB gzip] --OTLP/HTTP JSON--> [Ingestion /v1/traces] --> [Postgres]
                                                                                                 ^    |
[Synthétique DEM (mippoc ou seed)] --> [sync-synthetic] ---------------------------------------/     v
                                                                          [Console RUM Live (Next.js)]
```

- SDK Web lean (OTel sdk-trace-web + web-vitals, sans instrumentation contrib) : Core Web Vitals (seuils 2026), erreurs JS, routes SPA normalisées, sessions anonymisées. v0.2 : resource timings, long tasks, breadcrumbs, consent mode RGPD, file de retry, clé d'API.
- Ingestion : parser OTLP partagé (`_shared/otlp.mjs`) entre l'edge function Deno (prod Supabase) et le dev-server Node (local/CI). Scrub PII à l'ingestion, idempotence par `span_id`.
- Backend Postgres par défaut ; ClickHouse = cible grand volume (cf. `infra/clickhouse.notes.md`).

## Démarrage local (100 % local, aucun secret)

```bash
pnpm install
docker compose -f apps/ingest/docker-compose.yml up -d     # Postgres :5433 + schéma
docker exec -i mip-rum-db psql -U postgres -d mip_rum \
  < apps/ingest/sql/migration-v02.sql                      # migration v0.2 (idempotente)
pnpm --filter @mip/rum-sdk build                           # SDK -> dist/mip-rum.js
node apps/ingest/dev-server.mjs                            # ingestion locale :4318
node demo/serve.mjs                                        # mini-site de démo :8080
pnpm --filter console dev                                  # console :3000
node apps/sync-synthetic/src/sync.mjs seed                 # runs robot pour /correlation
```

## Outillage IA (BMAD + graft)

Le dépôt est câblé pour deux outils d'assistance, versionnés mais **non installés par le clone** :

```bash
npm install -g @nanonets/graft   # requis : .mcp.json et les hooks appellent le binaire `graft`
graft build                      # (re)génère le graphe de code dans graft/ — local, gitignoré, ~30 s
```

- **[graft](https://github.com/trailhq/Graft)** indexe le monorepo en un graphe de code (`graft ask`, `graft callers`,
  `graft skeleton`, `graft blast`) que l'agent interroge au lieu de tout relire. Le graphe vit dans `graft/`,
  **jamais commité** : chaque poste régénère le sien. `.ignore` le garde greppable malgré le gitignore.
  Sans l'installation globale ci-dessus, le serveur MCP déclaré dans `.mcp.json` ne démarre pas.
- **[BMAD](https://github.com/bmad-code-org/bmad-method)** (module `bmm`) fournit les skills `bmad-*` de
  `.claude/skills/` — configuration dans `_bmad/`, artefacts produits dans `_bmad-output/`. Nécessite
  [`uv`](https://docs.astral.sh/uv/) : les skills lancent leurs scripts Python via `uv run`.
  Point d'entrée : le skill `bmad-help`.

## Tests

```bash
pnpm test:unit          # vitest (parser OTLP, routes, sessions, ratings)
pnpm test:e2e           # playwright — lance lui-même ingest/démo/console (Postgres requis)
```

La CI GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) rejoue tout ça sur un Postgres de service : build SDK + unitaires, puis E2E Chromium avec schéma + migration appliqués au démarrage.

## Workspaces

| Workspace | Rôle |
|---|---|
| `packages/rum-sdk` | SDK Web (émetteur OTLP maison + web-vitals, 16,3 Ko gzip), build esbuild IIFE `mip-rum.js` |
| `packages/agent-node` | Agent backend **zéro-config** Node.js (`node -r @mip/agent-node/register`) : span `http.server` sans changement de code |
| `packages/rum-mobile` | SDK **React Native** : crashes, écrans, réseau (traceparent), événements → mêmes tables (`device_type=mobile`) |
| `apps/ingest` | Receiver OTLP `/v1/traces`, `/v1/logs`, `/v1/replay` (edge functions Deno + dev-server Node) + SQL (schéma, migrations) |
| `apps/sync-synthetic` | Synchro synthétique → `syn_snapshot` (interface `SyntheticSource` : seed ou export mippoc) |
| `apps/extension` | Extension navigateur MV3 (injection du SDK par domaine enregistré) |
| `apps/console` | Console RUM Live (Next.js 15) : Overview, Pages, Erreurs, Sessions, Tracing (waterfall), Corrélation, Logs, IA… |

## Documentation

| Document | Contenu |
|---|---|
| [docs/context/](docs/context/) | **Contexte produit** : maturité par service (RUM, supervision IA, Logs), grille d'évaluation, écarts et critères de sortie |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Guide d'intégration client : snippet, options, consent mode, CSP, RGPD, dépannage |
| [packages/agent-node/README.md](packages/agent-node/README.md) | Agent backend Node.js zéro-config (`node -r @mip/agent-node/register`) |
| [packages/rum-mobile/README.md](packages/rum-mobile/README.md) | SDK React Native (crashes, écrans, réseau, événements) |
| [docs/API_CONSOLE.md](docs/API_CONSOLE.md) · [docs/RUM_READ_API.md](docs/RUM_READ_API.md) | API de lecture v1 (ITSM/CI-CD) + résumé partenaire |
| [docs/MULTITENANT.md](docs/MULTITENANT.md) · [docs/ALERTING.md](docs/ALERTING.md) | Multi-tenant / RBAC · alerting (webhook/Slack ; e-mail à brancher) |
| [docs/CONFORMITE.md](docs/CONFORMITE.md) · [docs/DPA.md](docs/DPA.md) | Conformité RGPD (résidence UE, DSAR, scrub PII) · modèle de DPA (art. 28) |
| [docs/OFFRE.md](docs/OFFRE.md) | Positionnement commercial : comparatif marché honnête, arguments grands comptes FR, pricing indicatif |
| [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Déroulé de démo 10 min (DSI grand compte) : checklist, plan B hors-ligne, objections/réponses |
| [docs/LIMITES.md](docs/LIMITES.md) | Limites explicites du produit, ce que v0.2/v0.3 traitent, ce qui reste |
| [DEPLOY.md](DEPLOY.md) | Déploiement cloud (Supabase + Vercel) + snippet prod + recette |
| [BUILD_LOG.md](BUILD_LOG.md) | Journal factuel du build (valeurs réelles mesurées, pièges, décisions) |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |
| [docs/archive/](docs/archive/) | Rapports de sprint & plans historiques (PLAN, ROADMAP_V02/V03, RAPPORT_NUIT/V04/V05) — non maintenus, valeur d'archive |

## Statut

- **v0.1** : POC terminé et **déployé en production** (ingestion Supabase Paris, console Vercel, snippet live sur la plateforme G-IT). DoD 1-4 vérifiés en live, tests 36 unitaires + 5 E2E verts.
- **v0.2** : livrée (sprint nuit du 10→11/06/2026) — resource timings, breadcrumbs, consent RGPD, clés d'API, filtres globaux, sessions détaillées, erreurs groupées, alerting, CI. Voir [docs/archive/ROADMAP_V02.md](docs/archive/ROADMAP_V02.md) et [CHANGELOG.md](CHANGELOG.md).
- **v0.3** : sprint nuit 2 — session replay (rrweb, module séparé), RBAC console (rôles admin/viewer), webhooks d'alerte sortants, géo par timezone (zéro IP), rate limit durable, détection d'anomalies (z-score) + **health score** en Overview, chemin ClickHouse bench-é en local. Voir [docs/archive/ROADMAP_V03.md](docs/archive/ROADMAP_V03.md).
