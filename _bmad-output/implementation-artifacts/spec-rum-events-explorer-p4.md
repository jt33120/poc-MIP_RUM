---
title: 'P4 — Explorer d’événements et attributs custom'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 0
baseline_commit: 'eef7f897ec05aecba4b5831f454b87ac72db5c1b'
context:
  - '_bmad-output/planning-artifacts/SOLUTION_DESIGN.md'
  - '_bmad-output/planning-artifacts/architecture/architecture-poc-MIP_RUM-2026-08-25/ARCHITECTURE-SPINE.md'
  - '_bmad-output/implementation-artifacts/spec-rum-event-foundation.md'
  - '_bmad-output/implementation-artifacts/spec-rum-browser-context-identity.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les événements `track()` et leurs propriétés scrubbed sont stockés, mais restent impossibles à explorer, filtrer, suivre dans le temps ou réutiliser dans un dashboard, une alerte ou le MCP. `/api/v1/events` demeure un journal minimal et n’applique pas réellement ses filtres `period/device`.

**Approach:** Construire un Explorer custom sur `rum_event` et `rum_session`, sans casser P1. Une sémantique unique de comptage, période, scope et sampling alimentera UI, API/MCP, widget `event_count` et alerte `event:<nom>`.

## Boundaries & Constraints

**Always:** appliquer `app_id` dans chaque SQL et joindre par `(app_id, session_id)`; préserver `events/page/limit/offset`; utiliser paramètres liés et allowlists; borner noms, attributs, facettes et fenêtres; n’exposer que les données scrubbed; limiter les filtres aux primitives top-level de `props` ou `context`; signaler les comptes observés potentiellement biaisés par le sampling; couvrir vide, chargement, erreur, clavier et mobile; appliquer puis vérifier v68 sur Neon avant la production.

**Ask First:** rupture de `/api/v1/events`, modification de rétention/facturation, attribut brut, requête transverse sans fenêtre ou changement du sampling.

**Never:** accepter SQL, JSONPath, regex ou clé non validée; extrapoler le sampling; bâtir un graphe depuis la page paginée; inclure P5 Error Tracking, P6 Explorer générique, P7 mobile/Node ou P8 backfill/tiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Exploration | app, période, nom/attribut optionnels | total, buckets, facettes bornées et journal cohérents | état vide sans total inventé |
| Attribut typé | clé sûre et valeur string/number/bool/null | égalité JSON exacte sur `props` ou `context`, indexable | `400` pour clé, type ou taille invalide |
| Pagination live | curseur `(ts,id)` opaque | lecture stable; `offset` reste accepté | `400` invalide; offset borné à 10 000 |
| Scope hostile | viewer A demande app B | SQL et réponse restent sur le scope A réellement appliqué | aucune métadonnée de B |
| Sampling biaisé | sessions error-biased | chiffres bruts et avertissement partout | aucune pondération implicite |
| Migration absente | code avant v68 | lecture P1 disponible, enrichissement fail-soft | diagnostic explicite |

</frozen-after-approval>

## Code Map

- `apps/ingest/sql/migration-v68.sql`, `apps/ingest/supabase/functions/_shared/otlp.mjs` — index GIN, propriétés bornées et alerting event.
- `apps/console/lib/queries-events.ts` — parseurs, requêtes scoped de liste, tendances, facettes et avertissement sampling.
- `apps/console/app/api/v1/events/route.ts`, `apps/console/lib/api/openapi.ts` — contrat v1 enrichi et documenté sans casser P1.
- `apps/console/app/events/`, `apps/console/components/nav-items.tsx` — Explorer responsive sous Performance.
- `apps/console/lib/dashboards.ts`, `apps/console/lib/widget-data.ts`, `apps/console/app/dashboards/` — widget `event_count` configuré par nom.
- `apps/console/lib/queries-v2.ts`, `apps/console/app/alerts/`, `apps/console/components/alerts/` — validation, libellé, formulaire et évaluation `event:<nom>`.
- `apps/mcp/`, `apps/console/app/api-docs/` — outil `mip_rum_list_events`, pagination et documentation dérivée.

## Tasks & Acceptance

**Execution:**
- [x] `apps/ingest/sql/migration-v68.sql`, `_shared/otlp.mjs` — ajouter index/limites et étendre threshold/baseline sans table ni backfill.
- [x] `apps/console/lib/queries-events.ts` — centraliser un contrat de filtre sûr partagé par liste, agrégats et facettes; employer les buckets de `PERIODS` et un curseur opaque, avec fallback P1.
- [x] `apps/console/app/api/v1/events/route.ts`, `lib/api/openapi.ts` — appliquer période/device/scope et ajouter nom, attributs, tendance, facettes, pagination.
- [x] `apps/console/app/events/`, `components/nav-items.tsx` — livrer filtres nom/attribut, série avec alternative textuelle, journal et drill-down session.
- [x] `apps/console/lib/dashboards.ts`, `lib/widget-data.ts`, `app/dashboards/` — ajouter `event_count` et son export CSV sur la même requête.
- [x] `apps/console/lib/queries-v2.ts`, `app/alerts/`, `components/alerts/`, `migration-v68.sql` — accepter `event:<nom>`, threshold et baseline zero-filled, sans nouveau cron.
- [x] `apps/mcp/`, `apps/console/app/api-docs/` — ajouter l’outil read-only et supprimer toute liste documentaire manuelle divergente.
- [x] `tests/unit/`, `tests/integration/`, `tests/e2e/`, `scripts/verify-alerting.mjs` — couvrir entrées hostiles, pagination, sampling, isolation A/B, index, API/MCP, dashboard, alertes et UX.

**Acceptance Criteria:**
- Given des événements scrubbed, when on filtre par nom/attribut sur 1h/24h/7d, then Explorer, widget, API et MCP partagent valeurs et périmètre.
- Given une règle `event:checkout`, when son compte franchit un seuil ou une baseline sur sa fenêtre, then `check_alerts()` produit au plus l’événement dédupliqué attendu et ne lit aucune autre app.
- Given un viewer scopé ou des entrées hostiles, when les surfaces sont exercées, then aucune fuite, SQL dynamique, scan sans borne ou payload incontrôlé n’apparaît.
- Given v68 appliquée sur Neon et le SHA déployé, when les smoke tests production sont joués, then `/events`, `/api/v1/events`, le MCP, le widget et l’alerte fonctionnent sur données réelles sans régression P1–P3.

## Spec Change Log

- 2026-09-16 — Revue contradictoire P4 : correction des curseurs à précision microseconde, snapshot cohérent, facettes legacy, filtres globaux, fallback explicite, alertes alignées sur leur fenêtre et sampling, payload borné avant scrub, MCP/CI et pré-déploiement concurrent des index. Aucun changement de l’intent approuvé.

## Design Notes

`rum_event_index` reste la projection générique minimale P1; `rum_event.name/props` porte l’enrichissement custom. Les facettes se limitent aux primitives top-level fréquentes après app+période+nom. Explorer, widget et alertes partagent les mêmes primitives de comptage.

## Verification

**Commands:**
- `pnpm test:unit` — unités et contrats P1–P4 verts.
- `SQL_TEST_DATABASE_URL=… pnpm test:sql` — intégration PostgreSQL réelle, migrations et écriture bornée vertes.
- `pnpm test:isolation` — RLS et scope SQL A/B verts avec le rôle de lecture réel.
- `pnpm test:alerting` — threshold/baseline `event:<nom>`, sampling, isolation et index verts.
- `pnpm exec playwright test tests/e2e/events-explorer.spec.ts --workers=1` — Explorer clavier/mobile, période/device et curseur `(ts,id)` verts.
- `pnpm --filter console exec tsc --noEmit && pnpm --filter console build` — types et build production verts.
- application idempotente de v68 via `DATABASE_URL`, puis `pg_indexes`/`pg_get_functiondef` — Neon confirmé.
- vérification du SHA déployé, `/api/v1/openapi`, `/api/v1/events`, `tools/list` MCP et flux UI réel — production conforme au commit fusionné.

## Suggested Review Order

**Contrat de lecture partagé**

- Centralise scope, période, attributs typés, bots, segment et sampling.
  [`queries-events.ts:205`](../../apps/console/lib/queries-events.ts#L205)

- Préserve les microsecondes PostgreSQL pour une pagination sans perte.
  [`queries-events.ts:157`](../../apps/console/lib/queries-events.ts#L157)

- Fige journal et agrégats dans un snapshot cohérent.
  [`queries-events.ts:306`](../../apps/console/lib/queries-events.ts#L306)

**Frontière d’ingestion et schéma**

- Borne et scrubbe en une traversée avant toute écriture.
  [`otlp.mjs:147`](../../apps/ingest/supabase/functions/_shared/otlp.mjs#L147)

- Protège le déploiement et contraint les payloads futurs.
  [`migration-v68.sql:1`](../../apps/ingest/sql/migration-v68.sql#L1)

- Compare chaque baseline à la vraie fenêtre de règle.
  [`migration-v68.sql:126`](../../apps/ingest/sql/migration-v68.sql#L126)

- Sérialise, scope et documente le sampling des alertes.
  [`migration-v68.sql:174`](../../apps/ingest/sql/migration-v68.sql#L174)

- Précrée les index sans bloquer l’ingestion Neon.
  [`predeploy-v68-indexes.sql:1`](../../apps/ingest/sql/predeploy-v68-indexes.sql#L1)

**Surfaces produit**

- Assemble filtres, tendance, journal, états et pagination responsive.
  [`page.tsx:69`](../../apps/console/app/events/page.tsx#L69)

- Enrichit `/api/v1/events` sans rompre sa forme P1.
  [`route.ts:16`](../../apps/console/app/api/v1/events/route.ts#L16)

- Persiste un widget événement configuré par son nom.
  [`actions.ts:77`](../../apps/console/app/dashboards/actions.ts#L77)

- Adapte le formulaire vers la métrique `event:<nom>`.
  [`alerts/actions.ts:41`](../../apps/console/app/alerts/actions.ts#L41)

- Dérive l’outil MCP read-only et valide ses filtres dépendants.
  [`catalogue.mjs:147`](../../apps/mcp/lib/catalogue.mjs#L147)

**Preuves et automatisation**

- Prouve mobile, scope device/période et égalités de timestamp.
  [`events-explorer.spec.ts:55`](../../tests/e2e/events-explorer.spec.ts#L55)

- Verrouille le SQL borné, scopé et fail-soft.
  [`queries-events-explorer.test.ts:23`](../../tests/unit/queries-events-explorer.test.ts#L23)

- Exécute l’alerting événement sur PostgreSQL dédié en CI.
  [`ci.yml:128`](../../.github/workflows/ci.yml#L128)
