---
title: 'MIP RUM — P3 actions automatiques et corrélation causale'
type: 'feature'
created: '2026-09-16'
status: 'done'
review_loop_iteration: 1
baseline_commit: 'b08988d21a461bae1fbd4737082d74515334c388'
context:
  - '_bmad-output/implementation-artifacts/spec-rum-browser-context-identity.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Les clics restent de simples breadcrumbs et `addAction()` un événement isolé : aucun identifiant ne relie une interaction aux requêtes, ressources ou erreurs qu’elle déclenche. Les équipes ne peuvent donc ni expliquer une action en échec, ni classer les actions les plus coûteuses.

**Approach:** Ajouter un tracker causal navigateur, une projection `rum_action` et les liens `action_id` sur les signaux concernés, puis exposer une vue Top Actions scoped et une API v1. Le modèle est heuristique, borné et compatible avec les données et SDK P2.

## Boundaries & Constraints

**Always:** Ouvrir une action sur clic primaire interactif en phase capture; préférer `data-mip-action-name`, sinon un libellé accessible borné sans valeur de champ; exclure l’UI MIP; utiliser une fenêtre fixe de 5 s; le dernier clic gagne pour les nouveaux effets, tandis que fetch/XHR et erreurs conservent l’action capturée à leur origine; fermer aux frontières navigation, consentement refusé et rotation d’identité; scrubber nom, route et contexte côté serveur; préserver sampling, retry et `beforeSend`; rejouer la racine avant la première erreur d’une session `error-biased`; appliquer RLS, purge, DSAR et non-métering à `rum_action`.

**Ask First:** Modifier la fenêtre de 5 s, appliquer la migration v67 en production, lancer un backfill historique ou transformer les erreurs HTTP en error clicks.

**Never:** Lire une valeur de formulaire; persister un nom/contexte brut; casser `addAction()` P2; imposer une FK synchrone vers `rum_action`; attribuer une réponse tardive au clic courant; compter la projection deux fois; inclure Explorer P4, parité RN/Node ou fournisseur tiers.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clic nommé | Élément interactif avec override puis fetch | Action `click`, appel lié au même ID, route et contexte scrubbed | Override invalide revient au libellé borné |
| Actions chevauchées | Requête A, puis clic B avant sa réponse | Réponse A reste liée à A; nouveaux effets vont à B | Aucun lien inter-session |
| Erreur causale | Exception pendant une action | Erreur liée et un seul `frustration.error` pour l’action | Répétitions/drain gardent le snapshot initial |
| Sampling biaisé | Clic rejeté puis première exception | Racine originale rejouée avant frustration et erreur | Refus de consentement purge le candidat |
| Déploiement progressif | Code P3 sur schéma v66 | Ingestion historique continue sans colonnes P3 | Santé dégradée, aucune transaction cassée |

</frozen-after-approval>

## Code Map

- `packages/rum-sdk/src/index.ts:174-280,393-419`, `consent.ts` — pipeline unique sampling/contexte/hook/consent et API `addAction`; une racine refusée ou évincée ne doit jamais laisser d’enfant lié, et le refus interdit de rouvrir une action avant ré-accord.
- `packages/rum-sdk/src/{breadcrumbs,apispans,errors,resources,frustration}.ts` — clic capture, snapshots asynchrones et taxonomie `rage|dead|error`; figer action, session, contexte et époque de consentement à l’origine, y compris XHR, drain et dead-click différé.
- `packages/rum-sdk/src/event-context.ts:150-250` — enveloppe immuable P2 à réutiliser, sans y mêler l’horloge causale.
- `apps/ingest/supabase/functions/_shared/otlp.mjs:138-213,500-1158` — `eventMetadata()` lit déjà `action_id`; dériver actions et liens après scrub.
- `apps/ingest/supabase/functions/v1-traces/index.ts`, `apps/ingest/lib/{pg-ingest,ingest-differe}.mjs` — les deux receivers doivent dual-write les actions et filtrer colonnes/taxonomie selon le schéma pour rester compatibles v66.
- `apps/ingest/sql/migration-v65.sql`, `migration-v66.sql` — modèles RLS/purge/non-métering et colonnes P2 à étendre en v67.
- `apps/console/lib/queries-events.ts`, `lib/queries-frustration.ts`, `app/ux/page.tsx` — filtres scoped, API événement et restitution frustration à réutiliser.
- `apps/console/lib/queries.ts:394-462`, `components/sessions/Timeline.tsx:14-113` — timeline fusionnée et branche progressive v66/v67 à couvrir réellement.
- `apps/console/lib/api/{handle,params,openapi}.ts` — contrat paginé/RBAC de `/api/v1/actions`.

## Tasks & Acceptance

**Execution:**

- [x] `packages/rum-sdk/src/actions.ts`, `index.ts`, `consent.ts` — implémenter le tracker borné, clic automatique et action manuelle avec replay `error-biased`; figer l’enveloppe de racine et révoquer tout lien si racine absente, consentement refusé ou session changée.
- [x] `packages/rum-sdk/src/{breadcrumbs,apispans,errors,resources,frustration}.ts` — snapshotter l’action à l’origine pour fetch, XHR, ressource, erreur/drain et timer; exclure l’UI interne, les contenus de formulaire et les doubles clics de label; respecter opt-out et cap frustration.
- [x] `apps/ingest/supabase/functions/{_shared/otlp.mjs,v1-traces/index.ts}` — construire et écrire `actions`, propager les liens/route, accepter seulement `frustration.error`, scrubber et ne jamais casser un schéma v66 ni sa taxonomie.
- [x] `apps/ingest/sql/migration-v67.sql`, `lib/{pg-ingest,ingest-differe}.mjs` — créer `rum_action`, ajouter les liens/index et garantir upgrade v66, immédiat/différé, RLS, purge, DSAR et non-métering.
- [x] `apps/console/lib/queries-actions.ts`, `app/actions/*`, `app/api/v1/actions/route.ts`, `lib/api/openapi.ts` — livrer Top Actions/API scoped avec agrégats exécutés en PostgreSQL, filtres globaux et pagination totalement déterministe.
- [x] `apps/console/app/ux/page.tsx`, timeline, santé, docs et tests — intégrer error clicks/groupes causaux; tester les branches de lecture v66/v67 et garder la documentation cohérente.

**Acceptance Criteria:**

- Given une action suivie d’effets synchrones et asynchrones, when le lot traverse SDK, ingestion et PostgreSQL, then chaque effet conserve l’ID capturé à son origine et Top Actions agrège sans multiplication de jointures.
- Given une session `error-biased`, when la première erreur survient sous une action, then la racine est persistée avant ses signaux liés et aucune référence logique n’est orpheline.
- Given un viewer scoped à A, when il appelle la page ou l’API avec app B, then aucune action, session ou métadonnée B n’est révélée.
- Given v66 ou un lot P2 différé, when le code P3 le traite, then les sources existantes restent ingérées et le métering est inchangé.

## Spec Change Log

- 2026-09-16 — Implémentation P3 terminée : tracker causal SDK, dual-write v67 compatible v66, Top Actions/API, error clicks, timeline, RLS/DSAR/purge et vérifications automatisées.
- 2026-09-16 — Revue 1 : les receivers Supabase et Node divergeaient, des enfants pouvaient survivre à une racine refusée/évincée et plusieurs frontières n’étaient testées qu’en isolation. Code Map, tâches et vérification renforcés pour éviter l’état connu mauvais « liens orphelins ou lot v66 rejeté ». KEEP : fenêtre fixe 5 s, dernier clic pour les nouveaux effets, snapshots d’origine, replay error-biased ordonné, dual-write sans FK/non facturé, RLS/DSAR/purge, Top Actions/API/timeline, UI MIP exclue et bundles synchronisés.
- 2026-09-16 — Revue finale : consentement asynchrone versionné, rejeu OTLP sans faux parent, retry SPA non bloquant, appariement réseau maximal, allowlists Edge v65/v66/v67, pseudonymisation des noms via `beforeSend` et avertissement d’échantillonnage Top Actions. Bundles servis reconstruits et synchronisés.

## Design Notes

`rum_action` est une projection non facturée en dual-write avec `rum_event`. Les tables erreur, ressource, breadcrumb et span reçoivent un `action_id` indexé sans FK : l’ordre réseau, le retry et le déploiement progressif autorisent temporairement un enfant avant sa racine. Les ressources sont liées par leur timestamp de départ dans la fenêtre; cette attribution reste explicitement heuristique.

## Verification

**Commands:**

- `pnpm test:unit` — expected: fenêtre, concurrence, sampling, consentement, parser, API et UI passent.
- `pnpm test:sql` — expected: v67 fraîche/upgrade v66, receivers immédiats Node/Supabase, différé, agrégats Top Actions, idempotence, purge et non-métering passent.
- `pnpm test:isolation` — expected: `rum_action` et `/api/v1/actions` restent fail-closed entre tenants.
- `pnpm --filter @mip/rum-sdk size-check` — expected: bundle cœur reste sous 35 Kio gzip.
- `pnpm build` — expected: SDK, ingestion, console et types compilent.

**Results:**

- `pnpm test:unit` — 115 fichiers, 1 227 tests passants.
- `SQL_TEST_DATABASE_URL=<base-locale-jetable> SQL_TEST_V65_DATABASE_URL=<base-v65-locale-jetable> pnpm test:sql` — 8 fichiers / 51 tests passants, sans skip.
- `DATABASE_URL=<base-locale-jetable> pnpm test:isolation` — isolation A/B, fail-closed et droits `rum_action` passants.
- `pnpm --filter @mip/rum-sdk size-check` — 19,4 Kio gzip, sous le budget de 35 Kio.
- `pnpm build` — 11 workspaces construits; SDK, extension et console Next/types passants.
- Playwright local sur `/actions` — états dense et vide, thèmes clair/sombre, focus clavier et largeurs 390/768/1440 passants; largeur du document égale au viewport et aucune erreur console/HTTP.
- `git diff --check` — aucune erreur de whitespace. Aucune migration ni aucun backfill n’a été appliqué en production.

## Suggested Review Order

**Modèle causal navigateur**

- Commencer par l’état central : fenêtre, barrières, snapshots et promotion error-biased.
  [`actions.ts:49`](../../packages/rum-sdk/src/actions.ts#L49)

- Vérifier le filtre privacy, les frontières de consentement et l’ordre racine-enfants.
  [`index.ts:87`](../../packages/rum-sdk/src/index.ts#L87)

- Confirmer que les ressources s’attachent à leur départ, jamais à leur fin.
  [`resources.ts:10`](../../packages/rum-sdk/src/resources.ts#L10)

- Examiner le rejeu idempotent, les tombstones et la reprise non bloquante des SPA.
  [`retry.ts:356`](../../packages/rum-sdk/src/retry.ts#L356)

**Ingestion et schéma progressif**

- Suivre la projection unique des racines et des enfants depuis le payload OTLP.
  [`otlp.mjs:522`](../../apps/ingest/supabase/functions/_shared/otlp.mjs#L522)

- Contrôler les allowlists et replis exacts entre schémas v65, v66 et v67.
  [`write-causal.mjs:8`](../../apps/ingest/supabase/functions/_shared/write-causal.mjs#L8)

- Relire le modèle additif, les index, RLS, purge, DSAR et non-métering.
  [`migration-v67.sql:6`](../../apps/ingest/sql/migration-v67.sql#L6)

- Vérifier la parité du writer PostgreSQL immédiat avec le receiver Edge.
  [`pg-ingest.mjs:348`](../../apps/ingest/lib/pg-ingest.mjs#L348)

**Restitution Top Actions**

- Auditer le scope tenant et l’appariement réseau maximal sans double comptage.
  [`queries-actions.ts:61`](../../apps/console/lib/queries-actions.ts#L61)

- Vérifier les totaux non paginés et l’avertissement d’échantillonnage biaisé.
  [`queries-actions.ts:208`](../../apps/console/lib/queries-actions.ts#L208)

- Contrôler la restitution responsive et l’explication explicite de l’heuristique.
  [`page.tsx:16`](../../apps/console/app/actions/page.tsx#L16)

- Confirmer que l’API renvoie liste, résumé et pagination sous le scope viewer.
  [`route.ts:9`](../../apps/console/app/api/v1/actions/route.ts#L9)

**Preuves et non-régression**

- Rejouer les cas limites SDK : clics rejetés, consentement et ressources lentes.
  [`rum-actions-causal.test.ts:45`](../../tests/unit/rum-actions-causal.test.ts#L45)

- Vérifier le déploiement progressif PostgREST avec refus des colonnes inconnues.
  [`supabase-v1-traces-compat.test.ts:68`](../../tests/unit/supabase-v1-traces-compat.test.ts#L68)

- Relire la preuve SQL bout en bout, idempotence, coût, purge et cardinalité.
  [`rum-actions-causal-sql.test.ts:136`](../../tests/integration/rum-actions-causal-sql.test.ts#L136)

- Contrôler la preuve RLS fail-closed multi-tenant sur la nouvelle projection.
  [`verify-tenant-isolation.mjs:115`](../../scripts/verify-tenant-isolation.mjs#L115)
