---
title: 'MIP RUM — P1 fondation d''événements unifiée'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0ecfe2ca12d39ba2534c7f412f588b786cc33807'
context:
  - '_bmad-output/planning-artifacts/SOLUTION_DESIGN.md'
  - '_bmad-output/implementation-artifacts/spec-rum-parity-p0-safety-truth.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les signaux RUM sont répartis entre tables spécialisées. Ni une API ni les futures surfaces Explorer/actions ne disposent d’un journal commun, stable et cloisonné pour parcourir les événements sans multiplier des unions fragiles ou relire des champs sensibles.

**Approach:** Ajouter une projection append-only `rum_event_index` des signaux RUM déjà normalisés, l’écrire de façon idempotente dans les chemins immédiat et différé, puis l’exposer par une lecture v1 paginée. Le métering, les tables sources et les interfaces Explorer/actions restent inchangés.

## Boundaries & Constraints

**Always:** Construire l’index après scrub/normalisation; conserver `app_id`, `session_id`, `ts`, route scrubbed, type contrôlé et identité native; RLS fail-closed et suppression app/session doivent couvrir la projection; ordre stable `ts DESC, id DESC`; la projection ne doit jamais augmenter les quotas ou le métering.

**Ask First:** Ajouter logs, SVI, replay, corps de log, props arbitraires ou tout autre texte libre à l’index; exposer une UI Explorer, une recherche plein texte, des attributs personnalisés ou un flux fournisseur.

**Never:** Copier `visitor_id`, `user_hash`, UA, URL brute, message/stack d’erreur, props JSON, log body ou secret; modifier les tables sources, leur idempotence ou le nombre d’événements facturés; inclure un signal inconnu/rejeté; contourner RLS/RBAC ou rendre le nouveau endpoint public.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Signal RUM reconnu | pageview, vital, exception, resource, longtask, breadcrumb, track/frustration ou span avec `span_id` | Une ligne minimale indexée, référencée par `(kind, source_span_id)` | Les champs non nécessaires restent absents |
| Rejeu immédiat/différé | Même lot normalisé rejoué | Une seule projection par identité native | `ON CONFLICT` est inerte |
| Signal incomplet | Signal sans `span_id` ou type inconnu | Aucune ligne d’index | Signal source existant reste traité comme aujourd’hui |
| Lecture viewer A | `app=B`, kind invalide ou offset hors borne | Aucune donnée B; paramètres normalisés/refusés | Scope signé et pagination v1 s’appliquent |
| Effacement | Purge app ou effacement session | Aucune projection orpheline | Même transaction/fonction de suppression |

</frozen-after-approval>

## Code Map

- `apps/ingest/supabase/functions/_shared/otlp.mjs:564-900` — seul point où les spans sont classés, scrubbed et convertis en collections RUM; dériver l’index depuis ces lignes, jamais depuis le payload brut.
- `apps/ingest/lib/pg-ingest.mjs:229-369` — transaction d’écriture immédiate et conflits par `span_id`; ajouter la projection sans l’ajouter aux compteurs de quota.
- `apps/ingest/lib/ingest-differe.mjs:19-48` — complète les collections aplaties avant leur écriture; conserver la projection dans les lots différés.
- `apps/ingest/sql/migration-v64.sql:299-328`, `migration-v61.sql:195`, `migration-v63.sql:70`, `migration-v30.sql:67` — métering explicite et fonctions de purge/effacement à redéfinir dans une migration v65.
- `apps/console/lib/api/{handle,params,pagination,openapi}.ts` et `app/api/v1/sessions/route.ts` — contrat v1, RBAC, cache/ETag, filtres scoped et pagination à réutiliser.
- `apps/console/lib/db.ts:115-136`, `migration-v47.sql:86-152` — modèle RLS tenant `console_ro`; la nouvelle table doit déclarer explicitement RLS/policy/grant.
- `tests/unit/{otlp,api-v1,api-v1-hardening}.test.ts`, `tests/integration/ingest-differe-sql.test.ts`, `scripts/verify-tenant-isolation.mjs` — preuves de parser, API, différé et fail-closed à étendre.

## Tasks & Acceptance

**Execution:**

- [x] `apps/ingest/sql/migration-v65.sql` — créer `rum_event_index`, ses contraintes/indices, RLS et les définitions de purge/DSAR; exclure explicitement la table du métering.
- [x] `apps/ingest/supabase/functions/_shared/otlp.mjs` — produire `eventIndex` uniquement depuis les collections RUM reconnues et déjà scrubbed, avec identité native obligatoire.
- [x] `apps/ingest/lib/{pg-ingest,ingest-differe}.mjs` — persister l’index dans la transaction et compléter les lots différés, sans changer les écritures sources.
- [x] `apps/console/lib/queries-events.ts`, `app/api/v1/events/route.ts`, `lib/api/openapi.ts` — fournir la liste v1 scoped, filtrable par `kind`, ordonnée/paginée et documentée.
- [x] `tests/unit/*`, `tests/integration/*`, `scripts/verify-tenant-isolation.mjs` — prouver idempotence, absence de PII/copied props, non-métering, effacement, RLS et contrat API.

**Acceptance Criteria:**

- Given a normalized RUM batch, when it is ingested twice through either path, then each eligible native signal has exactly one index row.
- Given a signal without a native span identity or outside the supported RUM kinds, when it is ingested, then it creates no index row and does not alter source behavior.
- Given an indexed row, when it is inspected, then it contains no prohibited identity, free-text or raw-props field.
- Given a scoped viewer, when it lists events with hostile app/pagination/kind parameters, then it receives only its authorized app rows in deterministic order.
- Given a session/app erasure, when it completes, then no matching index row remains and tenant usage is unchanged by the projection.

## Spec Change Log

## Design Notes

`kind` is a closed projection category (`pageview`, `vital`, `error`, `resource`, `longtask`, `breadcrumb`, `event`, `span`), while the source-specific name remains a bounded optional label. Logs and SVI require distinct retention and identity decisions, so P1 deliberately does not silently absorb them.

## Verification

**Commands:**

- `pnpm test:unit` — expected: parser, API and privacy regressions pass.
- `pnpm test:sql` — expected: v65, idempotence, purge and metering assertions pass on PostgreSQL.
- `pnpm test:isolation` — expected: `rum_event_index` is tenant-scoped and fail-closed.
- `pnpm build` — expected: API and OpenAPI compile.

## Suggested Review Order

**Projection sûre et identité native**

- Dérive uniquement des collections déjà normalisées et rejette les identités non natives.
  [`otlp.mjs:76`](../../apps/ingest/supabase/functions/_shared/otlp.mjs#L76)

- Consolide les vitals avant d'insérer une projection idempotente.
  [`pg-ingest.mjs:257`](../../apps/ingest/lib/pg-ingest.mjs#L257)

- Persiste la projection hors comptage après les lignes sources.
  [`pg-ingest.mjs:389`](../../apps/ingest/lib/pg-ingest.mjs#L389)

**Schéma, confidentialité et cloisonnement**

- Contraintes SQL : taxonomies fermées, span OTLP et unicité par tenant.
  [`migration-v65.sql:9`](../../apps/ingest/sql/migration-v65.sql#L9)

- Réemploie la normalisation de route puis applique un RLS fail-closed.
  [`migration-v65.sql:51`](../../apps/ingest/sql/migration-v65.sql#L51)

- Retention, effacement app/session et file différée retirent toute projection associée.
  [`migration-v65.sql:68`](../../apps/ingest/sql/migration-v65.sql#L68)

**Parité immédiat/différé**

- Reconstruit l'index des lots historiques après migration, sans stocker de texte libre.
  [`ingest-differe.mjs:49`](../../apps/ingest/lib/ingest-differe.mjs#L49)

**Contrat API v1 scoped**

- Lit seulement la projection, avec filtre borné et ordre déterministe.
  [`queries-events.ts:58`](../../apps/console/lib/queries-events.ts#L58)

- Réutilise RBAC et réponses v1, en refusant les types invalides.
  [`route.ts:10`](../../apps/console/app/api/v1/events/route.ts#L10)

- Publie les statuts et schémas du nouveau contrat dans l'OpenAPI.
  [`openapi.ts:180`](../../apps/console/lib/api/openapi.ts#L180)

**Régressions ciblées**

- Prouve le schéma, l'idempotence, les purges et l'absence de métering.
  [`rum-event-index-sql.test.ts:1`](../../tests/integration/rum-event-index-sql.test.ts#L1)

- Exerce les refus v1 et les limites de pagination sans fuite inter-tenant.
  [`api-v1-events-route.test.ts:1`](../../tests/unit/api-v1-events-route.test.ts#L1)
