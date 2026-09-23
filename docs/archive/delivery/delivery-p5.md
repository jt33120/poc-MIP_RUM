# Livraison P5 — journal des sous-lots

Référence : [PLAN-CLAUDE-P5-P8.md](PLAN-CLAUDE-P5-P8.md) · [spec-rum-error-tracking-p5.md](spec-rum-error-tracking-p5.md).
Base : `11e9f346474db10abef111c8a120a1cecfd41997` (P4 livré, v68 sur Neon).

Une case n’est cochée que sur preuve. « Testé localement » ne vaut ni déploiement ni recette sur vraie app.

## État des sous-lots

| Sous-lot | PR | Migration (Neon, appliquée le 17/09/2026) | Implémenté | Testé localement | CI | Déployé (master `8219de6`) | Vérifié sur vraie app |
|---|---|---|---|---|---|---|---|
| P5.1 — corrélation, compteurs, détail scoped | #182, #183 | v69 (HTTPS, avant merge) | oui | oui | verte | oui | non — aucune erreur ingérée depuis |
| P5.2 — collecte navigateur opt-in | #184 | — | oui | oui | verte | oui | non — catégories opt-in non activées |
| P5.3 — erreurs OTel/backend | #185 | v70 (pre-deploy Railway) | oui | oui | verte | oui | non — aucun émetteur backend en prod |
| P5.4 — source maps CI | #186 | v71 (pre-deploy Railway) | oui | oui | verte | oui | non — aucun upload client (P8.4) |
| P5.5 — groupes versionnés, issues | #187 | v72 (pre-deploy Railway) | oui | oui | verte | oui | non — v2 activé pour aucune app |
| P5.6 — triage, régressions, notifications | #188, #189 | v73, v74 (pre-deploy Railway) | oui | oui | verte (#189 ; #188 mergée E2E rouge, corrigée par #189) | oui | non |

État production relevé le 17/09/2026 : `schema_migration` porte v69 à v74 ; statuts de déploiement `Vercel`,
`ingest`, `scheduler`, `mcp` en succès sur `8219de6` ; `rum_error` compte 5 lignes, la dernière ingérée le
16/09/2026 à 08:30 UTC, `error_issue` et `error_grouping_config` sont vides. La recette sur vraie app reste donc à
jouer : envoyer une erreur réelle, activer le regroupement v2 d'une app (fonction SQL d'activation de v72), puis
contrôler liste, issue, triage et notification.

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

## P5.2 à P5.6 — synthèse

- **P5.2 (#184)** : `addError(error, context, { fingerprint })`, configuration `captureErrors` avec catégories opt-in
  console, ressources, CSP et réseau (non interceptées et rejets non gérés toujours actifs), plafonds par catégorie,
  échantillonnage et consentement respectés ; bundles SDK reconstruits.
- **P5.3 (#185, v70)** : exceptions portées par les événements de span OpenTelemetry et les logs structurés écrites
  dans `rum_error` sans session inventée ; identité déterministe par événement, `mip.exception_id` pour dédupliquer
  log + span, lignes réellement insérées seules comptées ; une exception dérivée n'est pas un événement facturé de
  plus mais reste une erreur ; agent Node et middleware FastAPI capturent les erreurs de requête sans changer la
  terminaison du processus ni le statut réellement envoyé.
- **P5.4 (#186, v71)** : symbolication partagée console/ingestion, upload atomique validé avant écriture, port
  backend `POST /v1/sourcemaps` et jetons dédiés app-scopés expirants, CLI `scripts/upload-sourcemaps.mjs`, page
  `/admin/sourcemaps`, cache borné (32 entrées / 64 Mio) et analyse linéaire résistante aux fichiers hostiles.
- **P5.5 (#187, v72)** : normalisation multi-moteurs, clé v2 calculée en ombre sur chaque nouvelle occurrence,
  `error_issue` / `error_issue_alias` / `error_grouping_config`, activation et retour arrière par app via fonctions
  SQL, anciens liens redirigés ou choix d'issue, API `/api/v1/issues` et outils MCP en lecture.
- **P5.6 (#188, #189, v73, v74)** : triage admin avec `expectedRevision` (409), assignation, commentaires et liens
  de tickets, journal d'activité, régression décidée dans la transaction d'ingestion selon l'ordre des marqueurs de
  déploiement, notifications par outbox livrées par le dispatcher existant, alertes de pic `issue:<uuid>` avec
  `no_data` explicite ; v74 corrige sans toucher aux données (release bornée, verrou non bloquant, notifications des
  issues antérieures à v73).

## Suivis consolidés

- ~~**Navigation client bloquée**~~ — **résolu en P6.2** (`delivery-p6.md`) : la cause était les frontières
  `loading.tsx` de `/events`, `/errors` et `/actions`, qui laissaient la transition racine suspendue sans ping.
  Retirées, la navigation et `router.refresh()` commettent en ~200 ms ; les ancres natives de P5.1 redeviennent des
  `<Link>` et un test E2E verrouille le comportement. Le rechargement complet du workflow d'issue (P5.6) reste, pour
  une autre raison : il remet les formulaires sur l'issue relue.
- **Recette sur vraie app** : aucune erreur ingérée depuis le déploiement ; regroupement v2 activé pour aucune app.
- **Ingestion** : surrogate UTF-16 isolé dans `mip.context`/props (jsonb 22P02), NUL dans les champs de span non
  passés par `anyValue`, `mip.release` non borné à l'ingestion, contrôle de caractères de P5.4/P5.5 plus permissif
  que PostgreSQL.
- ~~**Portée**~~ — **résolu en P6.2** : une liste d'apps vide ne vaut plus « sans restriction » (403 partout, et
  `token@` compris), une app hors périmètre est refusée au lieu d'être rabattue, et `/api/replay/[sessionId]` lit
  `replay_chunk` borné à l'app de la session.
- **DSAR** : effacement par identité fondé sur `rum_session.user_id_hash` (lignes écrites sous une autre identité dans
  la même session non atteintes) ; exceptions dont la session est inconnue à l'écriture (P8.1).
- **Alertes** : les alertes « nouvelle erreur » historiques restent fondées sur l'empreinte ; une source map arrivée
  après les premières occurrences peut ouvrir une seconde issue ; double instrumentation log + span sans identifiant
  commun non signalée à l'écran (colonnes `origin_signal` / `exception_id` disponibles).
- **Backend** : vidage durable à l'arrêt fatal (P7/P8) ; rejets non gérés hors mode `throw` non observés côté Node ;
  la fonction Supabase historique des logs ne dérive pas d'exceptions.
- **Liste** : pas de badge de source par groupe.
- **Nommage** : branches futures en `feat/rum-…` ; « Datadog » ne désigne qu'une référence de comparaison
  fonctionnelle, aucun SDK, API ni compte Datadog n'est utilisé.
