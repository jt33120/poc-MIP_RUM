---
title: 'MIP RUM — P0 sécurité et vérité des mesures'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '7bc7c0bc54af7ebb08c5251d4992ecbe927021b6'
context:
  - '_bmad-output/planning-artifacts/SOLUTION_DESIGN.md'
  - '_bmad-output/planning-artifacts/CHANTIERS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les premières surfaces à étendre pour la parité Datadog contiennent des données insuffisamment protégées ou des chiffres inexacts : les libellés de breadcrumb échappent au scrub serveur, les dashboards peuvent franchir une frontière tenant, des répétitions d’erreurs sont perdues à la sortie de page, et plusieurs vues comptent des lignes au lieu d’occurrences réelles.

**Approach:** Livrer un socle P0 additive et rétrocompatible qui applique les mêmes règles de confidentialité, d’autorisation et de mesure sur toutes les surfaces existantes. Les phases Explorer, contexte, actions et erreurs v2 restent prévues, mais ne sont pas réalisées dans ce lot.

## Boundaries & Constraints

**Always:** Scrubber côté serveur avant toute persistance; répondre 404 sans révéler une ressource dashboard hors périmètre; conserver les snippets sans vraie clé; compter `sum(occurrences)` sans doubler le metering; préserver les comportements admin autorisés; ajouter des tests de non-régression et d’isolation.

**Ask First:** Déploiement de migration en production, activation d’une pondération d’affichage qualifiée d’« estimée », et tout changement de rétention ou de destination d’alerte.

**Never:** Stocker une identité, un secret ou un texte libre non scrubbed pour corriger le diagnostic; accorder un accès transverse implicite; ajouter une clé client réelle dans un snippet; démarrer les tables Explorer/actions ou une intégration fournisseur dans ce lot.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------------------|---------------------------|----------------|
| Breadcrumb sensible | Label contenant email ou JWT | Label persisté redacted après `flattenOtlp` | Entrée non textuelle devient `null` |
| Dashboard hors scope | Viewer A demande dashboard ou export B | Réponse 404 sans widget, app ou métadonnée B | Aucun fallback transverse |
| Répétitions avant sortie | Une erreur émise puis répétée avant navigation/pagehide | Drain final émet le nombre accumulé avant reset/flush | Le cap par empreinte reste actif |
| Erreur arrivée tardivement | `ts` ancien, ingestion après watermark | Une alerte nouvelle erreur est créée une seule fois | Rejeu n’en crée pas une seconde |
| Sans mesure Experience | Aucune LCP ni feedback | État « données insuffisantes », jamais `70/100` | Calcul existant inchangé avec données |

</frozen-after-approval>

## Code Map

- `apps/ingest/supabase/functions/_shared/otlp.mjs` — parser commun de tous les chemins; breadcrumb brut aux environs de `833`, erreurs et `occurrences` dans la même boucle.
- `apps/ingest/supabase/functions/_shared/scrub.mjs` — frontière déterministe `scrubText`/`scrubProps`; ne pas déplacer cette garantie dans le SDK.
- `apps/console/lib/queries-dashboards.ts`, `apps/console/app/dashboards/actions.ts`, `apps/console/app/dashboards/[id]/page.tsx`, `apps/console/app/api/dashboards/[id]/export/route.ts` — accès dashboard actuellement divergent; réutiliser l’auth utilisateur et `parseFilters`.
- `packages/rum-sdk/src/errors.ts`, `packages/rum-sdk/src/index.ts` — throttler d’erreurs et reset SPA; le flush OTLP actuel ne vide pas le compteur silencieux.
- `apps/ingest/sql/migration-v59.sql`, `migration-v56.sql`, `migration-v41.sql`, `apps/console/lib/queries*.ts` — sources des occurrences, rollups et détection de nouvelles erreurs.
- `apps/console/app/experience/page.tsx`, `apps/console/lib/onboarding.ts`, `apps/console/app/select/new/page.tsx` — états mesurés et copy du snippet.
- `tests/unit/scrub.test.ts`, `protection-ingestion.test.ts`, `dashboards.test.ts`, `alerting.test.ts`, `onboarding-v05.test.ts`, `scripts/verify-tenant-isolation.mjs` — points de preuve existants à étendre.

## Tasks & Acceptance

**Execution:**

- [x] `apps/ingest/supabase/functions/_shared/otlp.mjs` et `tests/unit/scrub.test.ts` — nettoyer puis borner chaque `breadcrumb.label`; prouver le round-trip email/JWT/IP redacted.
- [x] `apps/console/lib/dashboard-access.ts`, `app/dashboards/**`, `app/api/dashboards/[id]/export/route.ts` — centraliser l’autorisation dashboard, scoper les filtres et la liste d’apps, retourner 404 hors périmètre.
- [x] `packages/rum-sdk/src/errors.ts`, `index.ts`, tests d’ingestion — drainer les occurrences silencieuses à `visibilitychange`, `pagehide`, navigation SPA et `MIPRum.flush()` avant reset.
- [x] `apps/ingest/sql/migration-v64.sql` et requêtes/rollups concernés — ajouter l’horodatage d’ingestion et watermark idempotent pour nouvelles erreurs; sommer les occurrences sans ajouter la projection future au quota.
- [x] `apps/console/lib/queries*.ts`, `app/experience/page.tsx`, onboarding et leurs tests — supprimer les compteurs par lignes restants, indiquer les valeurs estimées lorsque pertinent, afficher l’état Experience honnête et corriger la copy de clé.
- [x] `scripts/verify-tenant-isolation.mjs` et tests ciblés — couvrir les accès page/CSV inter-tenant, les alertes tardives et l’absence de régression admin.

**Acceptance Criteria:**

- Given a sensitive breadcrumb, when it reaches any ingestion path, then no original secret or email is stored.
- Given a viewer scoped to app A, when it requests a dashboard, export, or transverse selector for app B, then it receives 404 and no B identifier.
- Given one emitted error followed by nine throttled repeats, when the page hides or navigates, then persisted occurrences total ten.
- Given late ingestion after the old lookback, when the scheduler runs twice, then exactly one new-error alert exists.
- Given `occurrences=37` and `occurrences=1`, when an affected rollup, summary, or alert is computed, then its error volume is 38 rather than 2.
- Given no usable Experience inputs, when the page renders, then it exposes "données insuffisantes" rather than a numerical score.

## Spec Change Log

## Design Notes

P0 deliberately keeps enforcement at the shared ingest and authorization boundaries. It does not compensate for bad data in the UI, and it does not infer authorization from an identifier’s unpredictability.

## Verification

**Commands:**

- `pnpm test:unit` — expected: all updated scrub, error, dashboard and onboarding tests pass.
- `pnpm test:sql` — expected: migrations, rollup and watermark behavior pass against PostgreSQL.
- `pnpm test:isolation` — expected: tenant isolation remains fail-closed.
- `pnpm build` — expected: SDK and console compile.
- `pnpm --filter @mip/rum-sdk size-check` — expected: core bundle remains within the 35 KB gzip budget.

## Suggested Review Order

**Cycle de vie SDK et confidentialité**

- Capture le contexte d’origine avant de drainer les répétitions silencieuses.
  [`index.ts:45`](../../packages/rum-sdk/src/index.ts#L45)

- Normalise et borne les breadcrumbs à la frontière serveur partagée.
  [`otlp.mjs:860`](../../apps/ingest/supabase/functions/_shared/otlp.mjs#L860)

**Cloisonnement dashboard**

- Centralise lecture, écriture et filtres sous le scope signé.
  [`dashboard-access.ts:15`](../../apps/console/lib/dashboard-access.ts#L15)

- Échoue avant toute résolution de widget ou génération CSV hors périmètre.
  [`route.ts:16`](../../apps/console/app/api/dashboards/[id]/export/route.ts#L16)

**Vérité des mesures SQL**

- Sépare heure d’ingestion et horloge émetteur pour les erreurs tardives.
  [`migration-v64.sql:8`](../../apps/ingest/sql/migration-v64.sql#L8)

- Verrouille le watermark et recalcule les rollups avec les occurrences réelles.
  [`migration-v64.sql:34`](../../apps/ingest/sql/migration-v64.sql#L34)

- Intègre les erreurs tardives aux rollups de la fenêtre opérationnelle.
  [`migration-v64.sql:198`](../../apps/ingest/sql/migration-v64.sql#L198)

**États honnêtes et distribution**

- Rend l’absence de LCP explicite, sans fabriquer de score numérique.
  [`ExperienceUnavailable.tsx:5`](../../apps/console/components/ExperienceUnavailable.tsx#L5)

- Force l’exécution des preuves SQL dans PostgreSQL en CI.
  [`ci.yml:140`](../../.github/workflows/ci.yml#L140)

**Preuves de non-régression**

- Rejoue alertes tardives, rollups et volumes compactés sur une vraie base.
  [`p0-safety-truth-sql.test.ts:60`](../../tests/integration/p0-safety-truth-sql.test.ts#L60)

- Couvre les gardes de scope dashboard et leurs surfaces d’export.
  [`dashboard-export-access.test.ts:1`](../../tests/unit/dashboard-export-access.test.ts#L1)
