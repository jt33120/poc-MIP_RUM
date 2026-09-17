# Livraison P5 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-error-tracking-p5.md](spec-rum-error-tracking-p5.md).
Base : `11e9f346474db10abef111c8a120a1cecfd41997` (P4 livré, v68 sur Neon).

Une case n’est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | Branche | Implémenté | Testé localement | Déployé | Vérifié sur vraie app | Bloqué |
|---|---|---|---|---|---|---|
| P5.1 — corrélation, compteurs, détail scoped | `feat/datadog-rum-error-tracking-p5-1` | oui | oui | v69 Neon ; code en cours | — | — |
| P5.2 — collecte navigateur opt-in | — | — | — | — | — | — |
| P5.3 — erreurs OTel/backend | — | — | — | — | — | — |
| P5.4 — source maps CI | — | — | — | — | — | — |
| P5.5 — groupes versionnés | — | — | — | — | — | — |
| P5.6 — triage, régressions, notifications | — | — | — | — | — | — |

## P5.1 — détails fiables et corrélation

Démarré le 16/09/2026 sur `feat/datadog-rum-error-tracking-p5-1` (commit de baseline `3fe73ea` : plan et specs embarqués).

### Décisions d’implémentation

Contrat relu avant codage par trois revues contradictoires exécutées contre le code et PostgreSQL 15 (SQL/ingestion,
lecture console, API/UI). Décisions retenues :

- **Migration v69 additive** : 12 colonnes nullable (ou `context` par défaut `{}`) sur `rum_error`, contrainte
  `rum_error_envelope_v69` `NOT VALID` (aucun parcours de la table chaude sous verrou), `lock_timeout` de 5 s. Aucun
  index : l’existence d’une trace passe par `rum_span_trace_idx`.
- **Pas de source d’erreur dans `rum_event_index.source_name`** : migration-v67 revalide sa taxonomie fermée à chaque
  rejeu des tests SQL, et une valeur v69 y ferait échouer tous les `beforeAll` suivants. Aucun lecteur P5.1 n’en a
  besoin ; P6.1 (dimensions indexées) tranchera avec une colonne dédiée.
- **Enveloppe dérivée côté serveur** : source (`browser_js`, `react_native_js`…) déduite du runtime MIP et du
  `mip.error_kind`, `handled` connu seulement quand il l’est réellement, `is_fatal` jamais inféré, trace/span parent
  natifs validés (l’identifiant de trace synthétique du SDK mobile devient NULL), `service` NULL pour les SDK RUM MIP,
  `env` conservé comme « déclaré par l’émetteur » et exclu des filtres P5.1.
- **Durcissement d’ingestion** : NUL (U+0000) remplacé avant écriture, nombres en notation exponentielle retirés des
  contextes/props, `error_type`/`kind`/`lineno`/`colno` bornés — un attribut hostile ne doit plus annuler un lot entier.
  L’empreinte de regroupement reste l’algorithme actuel (P5.5).
- **Lecture console unique `queries-errors.ts`** : une base filtrée (app, `[from,to)`, appareil dont tablette, segment,
  bots, apps internes) partagée par liste, totaux, tendance, exemplaire et occurrences dans un seul snapshot ;
  compteurs `sum(occurrences)` en `float8`, ratios de couverture en division réelle, personnes touchées `null` quand
  l’identité est inconnue (compteurs historiques `sessions`/`users_affected` inchangés).
- **Échantillonnage** : avertissement fondé sur la probabilité d’inclusion d’une erreur
  (`sr + (1 − sr) × esr`), pas sur le taux de session ; aucune pondération.
- **Portée** : `apps = []` vaut zéro accès (pages et API). Un fingerprint présent dans plusieurs apps autorisées
  produit un choix (console) ou un `400` explicite (API), jamais un `limit 1` arbitraire.
- **Liens** : session, rejeu, trace et span parent affichés seulement si la relation existe dans la même app ; la page
  trace filtre ses spans par app et valide le span parent demandé.
- **Rejeu positionné** : `rrweb-player@2.0.1` tel qu’installé n’instancie jamais son `Replayer` (onglet rejeu inerte) ;
  le lecteur monte directement `@rrweb/replay@2.0.1`, déjà présent dans le lockfile comme dépendance transitive.

### Preuves

Locales (17/09/2026, PostgreSQL 15 jetable, build de production de la console) :

- `pnpm test:unit` : 124 fichiers, 1 357 tests verts ; `tsc --noEmit` console vert.
- Suites SQL sur bases neuves : `test:isolation`, `test:alerting`, `test:svi` verts ; `test:sql` 10 fichiers,
  72 tests, dont `error-envelope-v69-sql` (rejeu, contrainte, NUL/1e308, différé, purge/DSAR, fenêtre v68→v69) et
  `error-queries-p51-sql` (jeu de recette : 38 partout sur A/24 h/desktop, 47 et couvertures 45/47 et 38/47 tous
  appareils, 43 sur 7 j, 49 bots inclus, choix [A 38, B 13], curseur µs sans perte, liens, échantillonnage).
- Playwright (build de production) : 47 verts, 2 ignorés préexistants, dont `error-tracking.spec.ts` (liste→détail
  38, liens, trace/session étrangères en 404, choix d'app, rejeu positionné/indisponible, clavier, 390/768/1440 px),
  `rum-flow`, `erreurs-fenetre`, `events-explorer`, `tracing`, `versions-loaf`.

Production :

- Neon PG 17.11 : `migration-v69.sql` appliquée le 17/09/2026 en une transaction (verrou 811100, registre
  `schema_migration`, checksum identique à `migrate.mjs`) via l'API SQL HTTPS de Neon — le port 5432 est fermé depuis
  le poste de livraison. Vérifié : 12 colonnes, `rum_error_envelope_v69` non validée.

### Suivis identifiés hors P5.1

- **CI** : ajouter `SQL_TEST_V68_DATABASE_URL` (+ `create database mip_rum_v68`) au job SQL de `ci.yml` ; le jeton
  GitHub de livraison n'a pas le scope `workflow`. Sans lui, les cas « code avant v69 » des nouveaux tests SQL sont
  ignorés en CI (ils passent en local).
- **Navigation client** : un `<Link>` vers la même route avec une autre query ne navigue plus une fois les prefetchs
  de la barre latérale terminés (reproduit sur « Réinitialiser » de `/events`, P4). P5.1 contourne par des ancres
  natives sur ses liens même-route ; corriger la cause dans la coquille de la console.
- **Ingestion** : surrogate UTF-16 isolé dans `mip.context`/props (jsonb 22P02) et NUL dans les champs de span non
  passés par `anyValue` (span/trace ids, logs) peuvent encore annuler un lot.
- **Portée** : `scopeApp` (lib/api/params.ts) traite `apps = []` comme sans restriction pour les autres routes v1 ;
  `/api/replay/[sessionId]` lit `replay_chunk` sans borne `app_id`.
- **DSAR identité** : l'effacement par identité passe par `rum_session.user_id_hash` ; des lignes d'erreur écrites
  sous une autre identité dans la même session ne sont pas atteintes (même limite déjà présente sur `rum_event`).
- **Liste** : pas de badge de source par groupe (la source est portée par l'exemplaire du détail).
