---
title: 'MIP RUM — P2 contexte navigateur, identité et événements manuels'
type: 'feature'
created: '2026-09-15'
status: 'done'
review_loop_iteration: 0
baseline_commit: '35187b6afe29d3dcd6176a448bd57caa9e16ad53'
context:
  - '_bmad-output/implementation-artifacts/spec-rum-event-foundation.md'
  - '_bmad-output/planning-artifacts/SOLUTION_DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Le SDK ne sait conserver ni contexte global, ni identité métier pseudonymisée, ni vue nommée, timing ou évaluation de feature flag. `beforeSend` ne connaît pas le type d'événement et les attributs personnalisés hors `track().props` disparaissent à l'ingestion.

**Approach:** Introduire un état d'enveloppe immuable dans le SDK web, exposer des APIs compatibles avec `track()`, puis persister une projection bornée et scrubbed dans les tables événement/session et `rum_event_index`. Les identifiants utilisateur et compte sont HMAC-hashés côté serveur avant toute file ou écriture.

## Boundaries & Constraints

**Always:** Appliquer la précédence `global < user/account < view < action < event-local`; figer un snapshot au moment de l'émission; réserver `mip.*`, session, trace, app et sampling au SDK; borner noms/clefs à 100 caractères, chaînes à 500, profondeur à 4, 64 clefs et 16 Kio sérialisés; scrubber côté serveur; préserver `beforeSend(attributes)` en lui ajoutant seulement un second argument optionnel; conserver consentement, sampling et retry.

**Ask First:** Générer, installer ou faire tourner `IDENTITY_HASH_SECRET` en production; modifier la taxonomie métier autorisée; changer la sémantique d'une identité existante ou lancer un backfill.

**Never:** Persister, mettre en file, journaliser ou placer dans une URL un identifiant utilisateur/compte brut; permettre au contexte d'écraser un champ réservé; faire de `addAction()` la corrélation automatique P3; ajouter Explorer, fournisseur de feature flags, parité RN/Node ou recherche SQL arbitraire.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Contextes superposés | global, user, view puis local partagent une clef | L'événement conserve la valeur locale et un snapshot indépendant | Valeurs hors limites supprimées avant émission puis à l'ingestion |
| Identité configurée | `setUser`/`setAccount` avant un événement | Seuls les HMAC app-scopés atteignent file et base | Secret absent : identités omises et santé dégradée, télémétrie maintenue |
| Vue et timing | `startView`, puis `addTiming(name)` | Route normalisée conservée, vue stable, durée relative au début de vue | Nom/timestamp invalide : appel refusé sans span |
| Feature flag | évaluation puis événement suivant | Évaluation bornée émise et incluse au contexte de vue futur | Objet/valeur non supporté rejeté |
| Compatibilité | ancien `track` et `beforeSend(attrs)` | Même contrat et même sampling; `meta` reste optionnel | `null` continue de supprimer l'événement |
| DSAR identité | identifiant brut soumis par un admin | POST protégé, hash en mémoire, résultat scoped sans valeur brute en URL/audit | Secret absent ou cible inconnue : refus explicite sans fuite |

</frozen-after-approval>

## Code Map

- `packages/rum-sdk/src/index.ts:79-318` — couture unique émission/consentement/sampling/navigation et API publique actuelle; les champs réservés sont aujourd'hui mutables via `beforeSend`.
- `packages/rum-sdk/src/types.ts:1-122`, `otlp-encode.ts:107-129` — contrat public et encodeur limité aux scalaires; sérialiser le contexte JSON explicitement.
- `packages/rum-sdk/src/context.ts:4-52` — route/navigation SPA; y rattacher l'état de vue sans perdre la route normalisée.
- `apps/ingest/supabase/functions/_shared/otlp.mjs:217-240,720-965` — parse JSON, session et classification; seul endroit où accepter contexte borné et identités déjà hashées.
- `apps/console/app/api/ingest/v1/traces/route.ts:55`, `apps/ingest/lib/receiver.mjs:156` — deux ports actifs qui doivent injecter le HMAC avant parsing/persistance différée.
- `apps/ingest/lib/pg-ingest.mjs:175-410`, `apps/ingest/lib/ingest-differe.mjs:43-50` — écritures immédiates/différées; aucune identité brute ne doit entrer dans `ingest_raw`.
- `apps/ingest/sql/migration-v65.sql:9-180` — projection, RLS, purge et métering à étendre additivement en v66.
- `apps/console/app/admin/privacy/page.tsx:35-176`, `lib/queries-dsar.ts:45-225` — DSAR actuel en GET/visitor; déplacer la saisie brute derrière une action POST et requêter par hash.
- `tests/unit/{sdk-v02,otlp,rum-event-index,dsar}.test.ts`, `tests/integration/rum-event-index-sql.test.ts` — compatibilité, limites, round-trip, purge et non-fuite à étendre.

## Tasks & Acceptance

**Execution:**

- [x] `packages/rum-sdk/src/event-context.ts`, `index.ts`, `types.ts` — ajouter l'enveloppe, les limites et les APIs global/user/account/view/action/timing/flag/error; conserver les contrats existants.
- [x] `apps/ingest/lib/identity-hash.mjs`, ports traces actifs et `otlp.mjs` — HMAC app-scopé avant toute persistance, contexte rescrubbé et métadonnées typées.
- [x] `apps/ingest/sql/migration-v66.sql`, `pg-ingest.mjs` — ajouter colonnes/contraintes/GIN, dual-write, RLS/purge/DSAR et compatibilité pré-v66 sans modifier le métering.
- [x] `apps/console/app/admin/privacy/*`, `lib/{dsar,queries-dsar,health}.ts` — DSAR POST par identité et avertissement de santé si le secret manque.
- [x] `tests/unit/*`, `tests/integration/*`, documentation SDK/API — prouver précédence, immutabilité, compatibilité, limites, scrub, HMAC, immédiat/différé et absence de fuite.

**Acceptance Criteria:**

- Given un contexte défini avant un événement, when le lot traverse SDK, OTLP et PostgreSQL, then son snapshot scrubbed est stocké et filtrable sans mutation rétroactive.
- Given le même identifiant brut dans deux apps, when il est ingéré avec un secret, then les hashes diffèrent et aucune forme brute n'apparaît dans la sortie aplatie, `ingest_raw`, la base, les logs ou les URLs DSAR.
- Given un SDK v0.4 utilisant `track()` et `beforeSend(attrs)`, when P2 est activée, then son comportement de consentement, sampling, suppression et export reste compatible.
- Given l'absence de v66 ou du secret, when le code est déployé, then les sources existantes restent ingérées, l'identité est omise et l'état dégradé est observable.

## Spec Change Log

- 2026-09-15 — Implémentation P2 terminée et passée en revue technique locale : enveloppe SDK, HMAC avant file, migration v66, DSAR HMAC, compatibilité v65 et parcours `visitor_id` historique préservé.

## Design Notes

`addAction()` émet un événement manuel typé et un identifiant d'enveloppe, mais P3 reste propriétaire de la fenêtre causale et de `rum_action`. Le HMAC est injecté aux deux ports Node actifs; le cœur partagé ne lit jamais l'environnement et ne renvoie jamais l'identifiant brut. `addFeatureFlagEvaluation()` émet l'évaluation puis la conserve dans le contexte de la vue pour les événements futurs.

## Verification

**Commands:**

- `pnpm test:unit` — expected: APIs, compatibilité, limites, confidentialité et contrat OTLP passent.
- `pnpm test:sql` — expected: v66, immédiat/différé, idempotence, DSAR et métering passent.
- `pnpm test:isolation` — expected: nouvelles colonnes/projections restent fail-closed par tenant.
- `pnpm --filter @mip/rum-sdk size-check` — expected: bundle cœur reste sous 35 Kio gzip.
- `pnpm build` — expected: SDK, ingestion, console et types compilent.

**Résultats finaux (2026-09-15) :** 1180/1180 tests unitaires, 43/43 tests PostgreSQL sur schémas v66 et v65 réels, isolation multi-tenant fail-closed, budget SDK 16,3 Kio gzip et build monorepo réussis. Les bases locales jetables utilisées sont `p2_context_test`, `p2_v65_test` et `p2_isolation_final`; aucune migration v66 ni aucun secret n'a été appliqué en production.

## Suggested Review Order

**Contrat et émission navigateur**

- Entrée principale : snapshot, hook compatible et API manuelles réunis dans un pipeline unique.
  [`index.ts:174`](../../packages/rum-sdk/src/index.ts#L174)

- Les couches de contexte bornées appliquent la précédence et figent chaque événement.
  [`event-context.ts:150`](../../packages/rum-sdk/src/event-context.ts#L150)

- Une identité différente ouvre une session technique distincte sans changer le visiteur.
  [`session.ts:79`](../../packages/rum-sdk/src/session.ts#L79)

- Tracing et replay relisent la session courante aux frontières asynchrones.
  [`apispans.ts:60`](../../packages/rum-sdk/src/apispans.ts#L60)

- Le replay vide son chunk avant chaque rotation d'identité.
  [`replay.ts:185`](../../packages/rum-sdk/src/replay.ts#L185)

**Sécurité d'ingestion**

- Le HMAC app-scopé remplace les identités brutes avant parseur ou file.
  [`identity-hash.mjs:55`](../../apps/ingest/lib/identity-hash.mjs#L55)

- La route Next applique cette frontière avant toute écriture transactionnelle.
  [`route.ts:36`](../../apps/console/app/api/ingest/v1/traces/route.ts#L36)

- Le receveur self-host partage exactement le même traitement traces et logs.
  [`receiver.mjs:140`](../../apps/ingest/lib/receiver.mjs#L140)

- Le parseur rescrubbe contexte et taxonomie avant de construire la projection.
  [`otlp.mjs:122`](../../apps/ingest/supabase/functions/_shared/otlp.mjs#L122)

**Persistance et vie privée**

- La migration additive pose colonnes, contraintes et index sans casser v65.
  [`migration-v66.sql:1`](../../apps/ingest/sql/migration-v66.sql#L1)

- L'écrivain détecte le schéma réel pour préserver la fenêtre pré-migration.
  [`pg-ingest.mjs:299`](../../apps/ingest/lib/pg-ingest.mjs#L299)

- Export et effacement DSAR utilisent un snapshot transactionnel app-scopé.
  [`queries-dsar.ts:191`](../../apps/console/lib/queries-dsar.ts#L191)

- La frontière POST garantit des sorties URL et audit sans identifiant brut.
  [`dsar-identity-actions.ts:26`](../../apps/console/lib/dsar-identity-actions.ts#L26)

- L'admin expose la recherche pseudonymisée tout en conservant le parcours visiteur historique.
  [`page.tsx:25`](../../apps/console/app/admin/privacy/page.tsx#L25)

**Preuves et livraison**

- Le build copie une source unique vers les deux bundles effectivement distribués.
  [`build.mjs:22`](../../packages/rum-sdk/build.mjs#L22)

- Les deux ports actifs prouvent le remplacement du brut avant PostgreSQL.
  [`identity-ingest-ports.test.ts:81`](../../tests/unit/identity-ingest-ports.test.ts#L81)

- Le round-trip v66 couvre écriture, file différée et DSAR A/B.
  [`rum-browser-context-identity-sql.test.ts:115`](../../tests/integration/rum-browser-context-identity-sql.test.ts#L115)

- Une base v65 réelle prouve la compatibilité pendant le déploiement.
  [`rum-browser-context-v65-sql.test.ts:44`](../../tests/integration/rum-browser-context-v65-sql.test.ts#L44)

- La CI crée explicitement le second schéma de compatibilité v65.
  [`ci.yml:145`](../../.github/workflows/ci.yml#L145)
