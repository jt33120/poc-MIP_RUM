# État de couverture RUM — P5 à P8

Relevé le **18 septembre 2026**, sur `master` à **`2f216cb`** (fusion de la PR #211).

> Les PR **#210** (P8.7, GeoIP, v85) et **#211** (P8.6, connecteur de tickets, v84) étaient **ouvertes
> et non fusionnées** au début de ce relevé ; elles ont été **fusionnées pendant sa rédaction**, à
> 12:52 et 12:59 UTC. Leurs verdicts (`D12`, `D13`, `D14`) et l'état des déploiements ont été repris
> après fusion, et les suites rejouées sur le résultat.

Ce document répond à une seule question, capacité par capacité : **est-ce que le produit sait faire
X, et qu'est-ce qui le prouve ?** Il est écrit pour la personne qui reprend le produit sans avoir
suivi les livraisons. Une ligne sans preuve nommée n'y figure pas.

Il ne remplace pas les journaux de livraison ([delivery-p5](../_bmad-output/implementation-artifacts/delivery-p5.md),
[p6](../_bmad-output/implementation-artifacts/delivery-p6.md),
[p7](../_bmad-output/implementation-artifacts/delivery-p7.md),
[p8](../_bmad-output/implementation-artifacts/delivery-p8.md)) : il les **recoupe**. Là où un chiffre
annoncé ne se retrouve pas, c'est la mesure qui est écrite, et l'écart est signalé au § 8.

---

## 1. Le vocabulaire des verdicts

Sept valeurs, et sept seulement. Chacune dit exactement où la capacité s'arrête sur les cinq axes du
plan (`implémenté`, `testé localement`, `déployé`, `vérifié sur vraie app`, `bloqué`).

| Verdict | Implémenté | Testé en local | Déployé | Éprouvé sur donnée réelle | Ce que le mot engage |
|---|:--:|:--:|:--:|:--:|---|
| `deploye_non_eprouve` | oui | oui | oui | **non** | Le code est sur `master`, ses tests nommés sont verts sur ce poste, et un environnement l'exécute. Il n'a jamais rencontré une donnée réellement ingérée. |
| `livre_non_deploye` | oui | oui | **non** | non | Le code est sur `master` et testé, mais rien ne l'exécute : migration non appliquée, paquet non publié, ou surface volontairement fermée. |
| `livre_avec_defaut_connu` | oui | **partiellement** | oui | non | Le code est en service, et un défaut **nommé dans la ligne** subsiste. La CI ne l'attrape pas. |
| `en_revue` | oui | oui (CI de la PR) | **non** | non | Le code **n'est pas sur `master`** : une PR ouverte le porte. Rien de ce qui suit ce verdict ne tourne nulle part. |
| `bloque_acces_externe` | partiel ou nul | selon la ligne | non | non | Ce qui manque **n'est pas du code** : un dépôt tiers, un compte, un appareil, une URL publique, une fenêtre d'exploitation. |
| `non_retenu` | — | — | — | — | Écarté par une décision **datée et citée** dans la ligne. |
| `non_commence` | **non** | non | non | non | Rien n'est livré. Ni interface, ni table, ni test. |

Deux règles de lecture, posées une fois :

- **`deploye_non_eprouve` est le meilleur verdict de ce document.** Aucune capacité de P5 à P8 n'est
  `éprouvée sur donnée réelle`, parce qu'aucune donnée n'a été ingérée depuis les déploiements
  (§ 6.2). Ce n'est pas un détail de forme : un écran juste sur des fixtures peut être faux sur du
  trafic, et personne ne l'a regardé.
- **Une table vide n'est pas un zéro.** Là où une capacité n'existe pas (crashes natifs), le produit
  affiche « Non collecté » et n'a délibérément créé aucune table. C'est un choix, redit à chaque
  ligne concernée.

---

## 2. Comment les preuves de ce document ont été relevées

Toutes les commandes ci-dessous ont été rejouées le 18/09/2026 dans un worktree propre de `2f216cb`,
sur PostgreSQL 15.18 en conteneur (port 5433), bases jetables `p88_*` créées puis supprimées.
**`DATABASE_URL` n'a été ni lue, ni employée, ni affichée ; aucune base de production n'a été
touchée.**

| Commande | Résultat mesuré |
|---|---|
| `pnpm install --frozen-lockfile` | vert |
| `pnpm build:sdk` | vert |
| `pnpm exec vitest run tests/unit --exclude '**/.claude/**'` | **168 fichiers, 2 436 tests verts, 0 ignoré** |
| `pnpm test:sql` **tel que la CI le joue** (6 bases dédiées) | vert — voir la ligne suivante pour ce que cela cache |
| `pnpm test:sql` **avec les 7 bases** (dont `SQL_TEST_PRE_V83_DATABASE_URL`) | **1 ÉCHEC** sur 413 tests — `backfill-idempotency-sql.test.ts` › « P8.2 — code publié AVANT migration-v83 » (§ 8.2) |
| `pnpm test:isolation` | vert — « isolation multi-tenant PROUVÉE EN BASE » |
| `pnpm test:alerting` | vert — « alerting mature (3 piliers) VÉRIFIÉ » |
| `pnpm --filter console exec tsc --noEmit` | vert |
| `pnpm --filter @mip/rum-sdk exec tsc --noEmit` | **ÉCHEC** — `packages/rum-sdk/src/replay.ts(242,11): error TS2322` |
| `pnpm -r build` sur dépôt fraîchement installé | **ÉCHEC** — `apps/extension` (§ 8.3) |
| `pnpm -r build` après `pnpm build:sdk` | vert, 13 paquets, console incluse |

**L'ordre des tests unitaires compte.** Sans `pnpm build:sdk` préalable, `tests/unit/agent-node-process.test.ts`
échoue (`Could not resolve "@mip/rum-core"`) et ses 10 tests sont perdus. La CI fait le build avant ;
un relevé local qui l'oublie mesure 10 tests de moins et croit avoir trouvé un défaut.

**Déploiements constatés le 18/09/2026** (API Railway et API Vercel, pas un journal) :

| Cible | SHA | État | Domaine public |
|---|---|---|---|
| Console Vercel `mip-rum-console` | `2f216cb` | READY, cible `production` | oui |
| Railway `ingest` | `2f216cb` | SUCCESS, `node services/ingest/server.mjs`, healthcheck `/health` | **aucun** (ni domaine Railway, ni domaine personnalisé) |
| Railway `scheduler` | `2f216cb` | SUCCESS | aucun |
| Railway `mcp` | `6485f45` | SUCCESS | `mcp-production-201c.up.railway.app` |

**Les migrations v84 et v85 sont appliquées en production**, et cela se lit sans toucher la base : le
journal de pré-déploiement du service `ingest` (`node node_modules/ingest/migrate.mjs`) rend, le
18/09 à **13:30:35 UTC**, `migration appliquée · migration-v84.sql · 113 ms`, puis `migrations à jour ·
total 80 · appliquées 1 · modifiées 0`. Une seule appliquée : v85 était donc **déjà** enregistrée —
ce que le journal de P8.7 date de 13:27.

Cela **contredit `delivery-p8.md`**, qui porte encore « v84 (non appliquée en production) ». Le
journal a été écrit avant la fusion ; la fusion l'a démenti une demi-heure plus tard. C'est une bonne
illustration de ce que vaut une ligne d'état recopiée plutôt que relevée.

---

## 3. Le fait d'exploitation qui change la lecture de tout le reste

**Le service Railway `ingest` n'a aucun domaine public.** Il est vivant, il a un healthcheck, il
migre la base au démarrage — et rien ne l'atteint depuis l'internet. Vérifié par `list-domains` et
`describe-service` : `serviceDomains: []`, `customDomains: []`. Le service `mcp`, lui, en a un ; la
différence n'est donc pas une limite de la plateforme.

**Le trafic de production entre par Vercel**, sur `apps/console/app/api/ingest/v1/traces/route.ts`,
qui importe exactement le même parseur et le même writer que le backend (`flattenOtlp`,
`secureOtlpIdentities`, `writeRows` depuis `ingest/`). Les deux chemins écrivent la même chose ; un
seul est joignable.

Conséquences, à lire avant les lignes `D14`, `A6` et `C*` :

1. **Tout ce qui n'existe que dans l'image Railway ne s'exécute pas sur le trafic réel.** C'est le cas
   de la base GeoIP de P8.7 (§ 4.4, `D14`).
2. **Le port d'ingestion direct `POST /v1/sourcemaps`** (`apps/ingest/lib/receiver.mjs`, P5.4) n'est
   atteignable par aucune CI cliente en l'état. Le port console `POST /api/sourcemaps` l'est.
3. Ouvrir un domaine sur `ingest` est une opération d'une minute ; elle n'a pas été faite, et rien
   dans le dépôt ne la documente comme décidée.

---

## 4. Les capacités, une par ligne

**49 capacités**, en six familles : suivi des erreurs (10), analyse et exploration (9), runtimes
instrumentés (10), exploitation et conformité (14), surfaces d'accès (3), chaîne de livraison (3).
Répartition des verdicts : `deploye_non_eprouve` **34** · `livre_non_deploye` **5** ·
`bloque_acces_externe` **4** · `livre_avec_defaut_connu` **3** · `non_commence` **2** ·
`non_retenu` **1**. Le verdict `en_revue` ne sert plus : les deux lignes qui le portaient (`D12`,
`D14`) ont été fusionnées pendant la rédaction.

**Zéro capacité éprouvée sur donnée réelle.** Les 34 lignes `deploye_non_eprouve` sont le meilleur
résultat de ce document, et il s'arrête avant la production.

### 4.1 Suivi des erreurs

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| A1 | Ouvrir une erreur et retrouver sa session, son action, sa trace, son rejeu | `deploye_non_eprouve` | `apps/console/lib/queries-errors.ts`, migration v69 ; `tests/integration/error-queries-p51-sql.test.ts`, `tests/e2e/error-tracking.spec.ts` ; PR #182/#183 | Un lien n'apparaît que si la relation existe dans la **même** app ; une trace étrangère rend 404. Le rejeu positionné est borné au contenu réellement disponible. |
| A2 | Compter les occurrences sans les confondre avec les lignes ni les personnes | `deploye_non_eprouve` | `sum(occurrences)` dans `queries-errors.ts` ; jeu de recette « 38 partout » de `error-queries-p51-sql.test.ts` | `visitors_affected`, `identified_users_affected` et `sessions_affected` sont rendus séparément et valent `null` quand l'identité est inconnue. Un backend sans session ne donne **aucun** impact utilisateur. |
| A3 | Capter les erreurs du navigateur au-delà des exceptions (console, ressources, CSP, réseau) | `deploye_non_eprouve` | `packages/rum-sdk/src/errors.ts`, config `captureErrors` ; `tests/unit/error-collection.test.ts` ; PR #184 | **Les quatre catégories sont opt-in et activées pour aucune app.** Le navigateur ne fournit pas toujours le statut HTTP d'une ressource : il reste `null`, jamais inféré. |
| A4 | Capter les erreurs d'un service Node ou Python sans inventer de session | `deploye_non_eprouve` | migration v70, `_shared/error-normalize.mjs` ; `tests/integration/error-backend-otel-sql.test.ts`, `tests/integration/agent-node-backend-events-sql.test.ts` ; PR #185 | Aucun émetteur backend ne tourne en production. Une double instrumentation log + span **sans** `mip.exception_id` commun n'est pas fusionnée, et n'est pas signalée à l'écran. |
| A5 | Dé-minifier une pile avec une source map | `deploye_non_eprouve` | migration v71, `apps/ingest/lib/error-symbolication.mjs` ; `tests/integration/sourcemaps-p54-sql.test.ts` ; PR #186 | Aucune map n'a jamais été déposée par une application réelle. Une map arrivée **après** les premières occurrences améliore l'affichage sans changer l'identité de l'issue — et peut donc ouvrir une seconde issue. |
| A6 | Déposer des source maps depuis une CI (jeton dédié, CLI, port direct) | `deploye_non_eprouve` | `scripts/upload-sourcemaps.mjs`, `apps/ingest/lib/sourcemap-upload.mjs`, `/admin/sourcemaps`, table `sourcemap_upload_token` | Le port backend direct vit sur le service Railway **sans domaine public** (§ 3) : en l'état, seule la route console est joignable, avec ses lots ≤ 3 Mio. Le branchement dans une CI cliente est `D10`. |
| A7 | Regrouper les occurrences en issues stables et versionnées | `deploye_non_eprouve` | migration v72, `error_issue` / `error_issue_alias` / `error_grouping_config` ; `tests/unit/error-grouping-v2.test.ts`, `tests/integration/error-issues-sql.test.ts` ; PR #187 | **Le regroupement v2 n'est activé pour aucune application.** Un « Script error. » sans contexte reste explicitement peu discriminant, et la clé retombe sur un repli marqué `low_confidence`. |
| A8 | Trier une issue : statut, assignation, commentaire, lien de ticket manuel | `deploye_non_eprouve` | migrations v73/v74, `POST /api/v1/issues/:id/{triage,comments,links}` avec `expectedRevision` (409) ; `tests/unit/error-triage.test.ts` ; PR #188/#189 | Le commentaire libre d'un opérateur **n'est pas scrubé** lorsque l'issue survit à un effacement : MIP ne peut pas savoir s'il cite une donnée personnelle. Une revue humaine reste nécessaire (`delivery-p8.md`, écarts P8.1). |
| A9 | Distinguer une régression d'une réapparition | `deploye_non_eprouve` | ordre des marqueurs de déploiement dans la transaction d'ingestion ; `error-issues-sql.test.ts` | Sans marqueur de déploiement comparable (même release, release absente, ordre inconnu), l'écran affiche « Réapparition à vérifier » et **ne rouvre pas** l'issue. Une issue `ignored` reste `ignored`. |
| A10 | Alerter sur une nouvelle issue ou un pic par issue | `deploye_non_eprouve` | outbox transactionnelle v73, règles `issue:<uuid>` réutilisant `route_alert` ; `pnpm test:alerting` vert le 18/09 | Hors données suffisantes, la règle rend `no_data`, jamais un zéro silencieux. Les alertes « nouvelle erreur » **historiques** restent fondées sur l'empreinte, pas sur l'issue. |

### 4.2 Analyse et exploration

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| B1 | Appliquer les mêmes filtres partout | `deploye_non_eprouve` | `apps/console/lib/query-contract.ts`, `query-compiler.ts`, `surfaces.ts` ; `tests/integration/query-contract-sql.test.ts`, `tests/e2e/navigation-filtres.spec.ts` ; PR #192 | Les lectures historiques `logs`, SVI et assistant IA filtrent encore par l'**app nommée**, pas par le périmètre effectif. Une surface qui ne sait pas appliquer un filtre l'**annonce** non appliqué au lieu de l'ignorer. |
| B2 | Découper par navigateur, système, appareil, pays estimé, release, route | `deploye_non_eprouve` | migration v75, `_shared/dimensions.mjs` ; `tests/unit/dimensions.test.ts`, `tests/integration/dimensions-v75-sql.test.ts` ; PR #191/#193 | **Tout ce qui précède v75 a ses dimensions à `NULL`**, affichées « Inconnu ». Un iPad sous iPadOS 13+ est compté *desktop*. Pas de groupe « Autres » : additionner des p75 n'a pas de sens. |
| B3 | Chercher une session | `deploye_non_eprouve` | `apps/console/lib/sessions-search.ts` ; `tests/unit/analyses-p63.test.ts` | **Égalité stricte sur trois champs seulement** : identifiant technique exact, route normalisée, release. Ni motif, ni préfixe, ni recherche par identité — décision de produit, pas une fonction en attente. |
| B4 | Mesurer les ressources et les blocages du fil principal | `deploye_non_eprouve` | `apps/console/lib/resources.ts` ; `tests/integration/analyses-p63-sql.test.ts` | Les ressources sont celles **retenues par le SDK** (seuil 300 ms, 20 par page vue) : un échantillon biaisé vers le lent, jamais extrapolé. Aucune somme de durées de blocages. |
| B5 | Explorer librement un jeu de données borné | `deploye_non_eprouve` | registre fermé `apps/console/lib/analytics-schema.ts`, `analytics-compiler.ts`, `POST /api/v1/explorer/query`, `GET /api/v1/explorer/schema`, écran `/explorer` ; `tests/integration/analytics-explorer-sql.test.ts`, `tests/e2e/analytics-explorer.spec.ts` ; PR #194 | Les identifiants SQL viennent **exclusivement** du registre : aucune clé arbitraire, aucune formule libre, aucun scan sans limite. Dépassement de budget → `503 query_budget_exceeded`, jamais une série de zéros. |
| B6 | Construire un tableau de bord graphique et en être propriétaire | `deploye_non_eprouve` | migration v79, `dashboard.owner_id`, `DASHBOARD_ACTIONS` ; `tests/integration/saved-views-v79-sql.test.ts`, `tests/e2e/dashboards-analytics.spec.ts` ; PR #195 | 24 cartes par tableau, 4 lectures simultanées, aucun rafraîchissement automatique. Une carte invalide reste **visible** avec son diagnostic ; elle n'est pas supprimée pour faire de la place. |
| B7 | Enregistrer une vue d'Explorer | `deploye_non_eprouve` | table `analytics_saved_view` (v79), `GET/POST /api/v1/explorer/views` | 50 vues par compte **et** par app. Aucune vue publique ni partage app-wide : une vue appartient à un compte et à **une app nommée**. |
| B8 | Exporter en CSV | `deploye_non_eprouve` | même AST, mêmes permissions, mêmes bornes ; tests d'export de P6.5 | 10 000 lignes au plus, **troncature écrite dans le fichier**. Une cellule commençant par `=`, `+`, `-` ou `@` est préfixée d'une apostrophe. |
| B9 | Répondre vite sur de gros volumes (agrégats horaires) | `deploye_non_eprouve` | migration v80, `apps/console/lib/analytics-rollups.ts`, `predeploy-v80-indexes.sql` | Un agrégat ne sert que s'il porte **toutes** les dimensions demandées et la même population ; sinon relecture brute. Les distincts ne sont **jamais** servis par agrégat. Les temps publiés valent pour un jeu synthétique sur un poste : **ce n'est pas un SLA**. |

### 4.3 Runtimes instrumentés

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| C1 | Instrumenter une application React Native : vues, actions, erreurs JS | `livre_non_deploye` | `packages/rum-mobile/src/{navigation,interactions,causal,rejets,trace}.ts` ; `tests/unit/rum-mobile-p73.test.ts` (65 tests), `tests/integration/rum-runtime-parity-sql.test.ts` ; PR #204 | **Tout est éprouvé contre des doubles.** Aucun appareil, aucun simulateur, aucun bundle Metro. `traceOrigins` est devenu une **liste fermée** (paquet 0.3.0) : une liste vide ne propage plus rien, ce qui casse la corrélation des intégrations existantes tant qu'elles n'ont pas déclaré leurs origines. |
| C2 | Consentement, file hors-ligne et transport côté mobile | `livre_non_deploye` | `packages/rum-mobile/src/{consent,session,queue,transport,persist}.ts` ; `tests/unit/rum-mobile-p72.test.ts` (44 tests) ; PR #202 | **Le stockage durable (`offline.persistent`) est désactivé par défaut.** Son activation en production dépend de P8.1, désormais livré — mais la bascule n'a pas été faite et n'a jamais tourné sur un appareil. |
| C3 | Compter un visiteur mobile | `livre_non_deploye` | `identity_persistence = memory` dans `packages/rum-mobile` ; écart consigné dans `delivery-p7.md` | **Le visiteur mobile est un tirage mémoire remis à zéro à chaque lancement** : les compteurs de visiteurs mobiles **surestiment** les personnes. C'est un défaut connu, non corrigé. |
| C4 | Mesurer le démarrage JS jusqu'au premier écran | `livre_non_deploye` | `js_start_to_first_screen_ms` ; `rum-mobile-p73.test.ts` | Ce n'est **pas** un démarrage natif. Sans appel à `markFirstScreenRendered()`, la mesure est absente — pas nulle. Aucun ANR n'est déduit d'un timer JS. |
| C5 | Instrumenter un service Node | `deploye_non_eprouve` | `packages/agent-node` : `track`, `captureException`, `withContext`, `flush` ; `tests/unit/agent-node.test.ts`, `tests/unit/agent-node-process.test.ts` (vrais processus), `agent-node-backend-events-sql.test.ts` ; PR #200 | Aucun service Node n'émet vers la production. Les rejets non gérés hors mode `throw` ne sont pas observés. Le vidage durable à l'arrêt fatal n'est pas garanti : **un export peut être perdu à la mort du processus.** |
| C6 | Instrumenter un service FastAPI | `deploye_non_eprouve` | `integrations/fastapi/mip_rum_middleware.py` (ContextVar) ; `python3 -m unittest discover -s integrations/fastapi` en CI | Un seul framework (FastAPI/Starlette), un seul saut : ni propagation backend→backend, ni span DB. |
| C7 | Lire l'état d'une application mobile (`/mobile`, API, MCP) | `deploye_non_eprouve` | migration v82, `apps/console/app/mobile/`, `GET /api/v1/mobile/summary`, outil MCP `mip_rum_mobile_summary` ; `tests/integration/rum-mobile-p75-sql.test.ts` (19 tests), `tests/e2e/mobile-console.spec.ts` ; PR #207 | L'écran est déployé, **aucune session RN réelle ne l'alimente**. Crashes natifs, ANR et démarrage natif s'affichent « Non collecté », jamais `0` ni « 100 % sans crash ». Le taux rendu est `js_error_free_session_rate`, pas un « crash-free ». |
| C8 | Déclarer ce qu'un runtime mobile sait faire (capacités) | `deploye_non_eprouve` | table `mobile_capabilities` (v82), `verified_at` hors de portée du client ; `pnpm test:isolation` le vérifie en base | **Aucune interface d'opérateur pour poser `verified_at`** : c'est un `update` direct documenté, sans droit RBAC. Une capacité déclarée par le SDK ne vaut pas une recette. |
| C9 | Distribuer le paquet React Native | `bloque_acces_externe` | `packages/rum-mobile/package.json` porte `private: true` ; `scripts/verify-sdk-packaging.mjs` (36 contrôles verts) prouve les exports CJS/ESM/types | Aucune publication npm ni store. Quatre décisions manquent : registre cible, compte de publication, nom définitif, politique de versions et de dépréciation. |
| C10 | Annoncer une plage de compatibilité React Native | `bloque_acces_externe` | `packages/rum-mobile/MATRICE-RUNTIME.md` | **La matrice est vide, cellule par cellule, et le dit.** Aucune version réelle de React Native, React, Hermes, JSC, Metro, iOS, Android, Fabric, Paper, React Navigation ni Expo n'a été exécutée. Rien ne doit être promis à un client sur ce point. |

### 4.4 Exploitation, vie privée et conformité

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| D1 | Effacer les données d'une personne sans qu'un writer les recrée | `deploye_non_eprouve` | migration v81, `apps/ingest/lib/privacy-barriere.mjs` (`withAppIngestTransaction`, `pg_advisory_xact_lock`) ; `tests/integration/dsar-concurrency-sql.test.ts` — **17 tests, dix interleavings**, attente lue dans `pg_locks`, aucun `sleep` ; PR #205 | **Aucun effacement réel n'a été demandé depuis l'activation.** Le protocole est prouvé par 17 tests de concurrence, pas par la production. Aucun mécanisme automatique ne refuse un writer antérieur à v81 : c'est à l'exploitant de vérifier. |
| D2 | Refuser durablement les données d'une personne effacée | `deploye_non_eprouve` | table `privacy_erasure_barrier` ; `app_registry.privacy_barrier_mode = 'enforce'` posé le 18/09/2026 pour les 7 applications du registre (`delivery-p8.md`, `docs/CONFORMITE.md` § 3.1) | Politique retenue le **18/09/2026** : conservation **sans expiration** (`expires_at` reste `NULL`). La barrière **est** une donnée pseudonyme, et on ne prétend pas le contraire. **Aucune voie de réactivation n'existe** — ni fonction SQL, ni drapeau SDK. Sous `enforce`, un chunk de rejeu arrivé avant son ancre OTLP est **perdu**, pas différé : le SDK web ne rejoue pas. |
| D3 | Exporter les données d'une personne (art. 15) | `deploye_non_eprouve` | `/admin/privacy`, `apps/console/lib/{dsar,queries-dsar}.ts` ; export en `repeatable read, read only`, sans verrou d'ingestion | Un export **refuse** de s'exécuter sur `id_kind = 'device_class'` (ancien `user_hash`), pour ne pas joindre les données d'un tiers. Un événement totalement anonyme, nouvelle session et sans identifiant commun, **n'est pas rattachable** à une personne. |
| D4 | Effacer toutes les données d'une application | `deploye_non_eprouve` | `erase_app_data` (v81), qui **suspend l'ingestion dans le registre** sous la même transaction ; vérifié en base le 18/09 : `analytics_saved_view`, `dashboard`, `backfill_run`, `error_status`, `svi_*`, `rum_log`, `rum_ai`, `mobile_capabilities` sont bien couverts | La configuration d'exploitation (`slo`, `goal`, `notify_channel`, `uptime_check`, `read_tokens`, `deploy_marker`, `extension_scope`…) **n'est pas supprimée** : objets d'exploitation, pas données de personnes. `tenant_usage_daily` et `app_registry` survivent volontairement. |
| D5 | Purger selon la rétention | `deploye_non_eprouve` | `purge_rum_app` / `purge_rum_tenants`, travail planifié `apps/ingest/jobs/planifie.mjs` | **La rétention ne couvre toujours pas les tables SVI.** Vérifié en base le 18/09 : `purge_rum_app` ne cite pas `svi_call`, alors que `erase_app_data` le fait. Écart préexistant, non corrigé. |
| D6 | Isoler les locataires en base | `deploye_non_eprouve` | `scripts/verify-tenant-isolation.mjs`, rejoué vert le 18/09 sur base dédiée : requêtes **sans aucun `WHERE app_id`**, jouées sous le rôle `console_ro` | Un périmètre `[]` vaut **zéro accès**, plus « sans restriction » (corrigé en P6.2). L'isolation est prouvée en base ; elle ne dispense pas les lectures applicatives de lier `app_id`. |
| D7 | Restaurer une sauvegarde sans ressusciter des données effacées | `non_commence` | — (rien dans le dépôt) | **La garantie d'effacement ne porte pas sur les sauvegardes.** Une restauration PITR antérieure à un effacement devrait rejouer les barrières avant de rouvrir lectures et ingestion ; cette procédure n'est ni écrite, ni éprouvée. C'est écrit tel quel dans `docs/CONFORMITE.md` § 3.1. |
| D8 | Préparer une reprise d'historique (plan, dry-run, vérification) | `livre_non_deploye` | migration **v83 non appliquée en production** ; `scripts/backfill-rum.mjs` (6 sous-commandes, 4 reconstructions), `apps/ingest/lib/backfills/` ; `tests/integration/backfill-idempotency-sql.test.ts` (52 tests), `tests/unit/backfill-p82.test.ts` ; PR #208 | L'outil lit `BACKFILL_DATABASE_URL`, **jamais** `DATABASE_URL`. `--app all` est refusé. Aucun écran de console : le journal se lit par CLI et par SQL. **3 de ses 52 tests — la fenêtre de déploiement v82→v83 — ne tournent jamais en CI** (§ 8.2). |
| D9 | Exécuter une reprise d'historique en production | `non_retenu` | **Décision de l'utilisateur du 18/09/2026 : ne pas exécuter.** Périmètre mesuré en production et rapporté avec la décision : ≈ **97 lignes** de `rum_event` sans projection dans `rum_event_index` — 90 sur `gip-plateforme` (19/08 → 15/09), 7 sur `mip-rum-console` (08/09 → 15/09) — sur 4 046 lignes indexées | **Ces chiffres n'ont pas été recontrôlés pour ce document** : aucune base de production n'a été interrogée (§ 2), et ils n'apparaissent dans aucun fichier du dépôt. Ils sont repris tels que la décision les énonce. Obstacle pratique complémentaire : le port 5432 est refusé depuis le poste de livraison (`ECONNREFUSED`). L'outillage, ses tests et son dry-run sont livrés (`D8`) ; **seule l'exécution manque.** |
| D10 | Brancher l'upload de source maps dans la CI du client | `bloque_acces_externe` | côté MIP, tout existe : CLI, port console, port backend, jetons app-scopés expirants (`A6`) | Manquent : accès au dépôt et au build du client, `app_id` MIP, convention de release, destination d'ingestion, jeton d'upload dans les secrets CI. **Jamais entamé.** Les accès du dépôt MIP ne valent pas accès au dépôt client. |
| D11 | Recevoir les crashes natifs iOS/Android, les symboliser, les rattacher à un appareil | `non_commence` | — | **Rien n'est livré**, et c'est délibéré : P7.5 n'a créé **aucune table de crash natif**, parce qu'une table vide se lirait comme un zéro. Manquent un choix de moteur ou de fournisseur, une application native, des builds signés, des symboles et des appareils. Un `ErrorUtils` JS **n'est pas** un crash natif. |
| D12 | Créer un ticket chez un fournisseur depuis une issue | `deploye_non_eprouve` | **PR #211 fusionnée le 18/09 à 12:59**, CI verte (6 contrôles) ; migration **v84 appliquée en production à 13:30:35 UTC** (journal de pré-déploiement `ingest`) ; `apps/ingest/lib/integrations/tickets/{adapter,dispatcher}.mjs`, tables `ticket_integration` / `ticket_outbox` / `ticket_webhook_event`, écrans `/admin/ticket-integrations`. **Un vrai ticket a été créé** dans un dépôt bac à sable — c'est la seule ligne de P5 à P8 qui ait touché un système externe réel | **Déployé et inerte** : aucune intégration n'est configurée, `TICKET_INTEGRATIONS` n'est pas posé, et l'interface d'administration reste cachée tant qu'aucun fournisseur n'est branché **et testé**. Un seul fournisseur (GitHub Issues), présenté dans le produit comme une étape vers l'ITSM de MIP — « ServiceNow, **sous réserve de confirmation** », et personne n'a confirmé. Aucune écriture MIP → fournisseur après la création : résoudre une issue ne ferme pas le ticket. Le lien manuel de P5.6 continue de fonctionner **sans** connecteur, et un test le prouve. |
| D13 | Recevoir les changements d'état du fournisseur (webhook) | `bloque_acces_externe` | route `apps/console/app/api/webhooks/tickets/[integrationId]/route.ts` déployée sur Vercel avec `2f216cb` ; signature HMAC-SHA256 sur corps brut, comparaison à temps constant, identifiant de livraison unique en base ; tests contre un double fidèle (corps modifié, secret tiers, signature tronquée, non hexadécimale, absente) — PR #211 | **Le webhook n'a jamais reçu de livraison d'un vrai fournisseur.** L'URL est désormais publique, mais aucune intégration n'existe : toute livraison reçoit le même `404` qu'une intégration inconnue. Manquent un espace cible et ses droits, un secret de webhook, et la politique de synchronisation — cinq décisions, pas cinq tickets. Aucune synchronisation de statut n'a été observée en vrai. |
| D14 | Préciser le pays par une base IP→pays | `deploye_non_eprouve` | **PR #210 fusionnée le 18/09 à 12:52**, CI verte ; migration **v85 appliquée en production** (déduite du journal de pré-déploiement : `total 80 · appliquées 1`, la seule étant v84) ; `apps/ingest/lib/geoip-db.mjs`, `_shared/geoip.mjs`, `infra/docker/Dockerfile.backend` ; `tests/unit/geoip-db.test.ts` (193 l.), `tests/integration/geoip-v85-sql.test.ts` | **Le GeoIP ne résout aucun pays sur le trafic actuel, et la fusion n'y change rien.** La base est embarquée dans l'**image Railway**, et le service `ingest` n'a pas de domaine public (§ 3) ; la route Vercel, qui reçoit tout le trafic, **n'appelle délibérément pas** la résolution locale — un commentaire du code l'explique — et ne pose que la provenance `cdn`. La base elle-même n'est pas versionnée : elle reste **à déposer**. Pays seulement : ni ville, ni région, ni coordonnées ; la base « City Lite » est refusée par le chargeur. **Aucun enrichissement rétrospectif n'est possible** : l'adresse des visites passées n'a jamais été stockée, et ce lot ne commence pas à la stocker. |

### 4.5 Surfaces d'accès

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| E1 | Lire par l'API publique v1 | `deploye_non_eprouve` | `apps/console/app/api/v1/` — 18 familles de routes, enveloppe `{meta,data}` ; `tests/unit/api-v1-contract.test.ts`, OpenAPI servi par `/api-docs` | Les jetons `CONSOLE_API_TOKENS` sont **strictement en lecture** : aucun droit d'écriture, aucun droit d'upload, quelle que soit la route. Aucune de ces routes n'a été appelée sur de la donnée réellement ingérée. |
| E2 | Lire par MCP | `deploye_non_eprouve` | `apps/mcp/lib/catalogue.mjs` — **16 outils** comptés le 18/09 (`mip_rum_list_apps` … `mip_rum_mobile_summary`) ; job CI `mcp-smoke` qui compare ce nombre en dur ; service Railway `mcp` sur `6485f45`, avec domaine public | Read-only par construction. Le catalogue n'expose **pas encore les dimensions** de P6 : les outils P4/P5 restent sur app, période et appareil. |
| E3 | Écrire par API (triage, tableaux de bord, vues enregistrées) | `deploye_non_eprouve` | contrôle de session admin + Origin, `expectedRevision` et `409` ; `dashboard-access.ts`, `tests/unit/dashboards.test.ts` | Viewer et demo ne gagnent **aucun** droit d'écriture. Un administrateur scopé n'est plus transverse : c'est un écart assumé de P6.5 par rapport au modèle « admin global ». |

### 4.6 Chaîne de livraison

| # | Capacité | Verdict | Preuve | Limite |
|---|---|---|---|---|
| F1 | Construire le dépôt de bout en bout | `livre_avec_defaut_connu` | `pnpm -r build` vert **après** `pnpm build:sdk` : 13 paquets, `apps/console` incluse | **Défaut : `pnpm -r build` échoue sur un dépôt fraîchement installé** (§ 8.3). `apps/extension` ne déclare aucune dépendance d'espace de travail vers `@mip/rum-sdk` : rien n'ordonne les deux builds. La CI ne voit pas le défaut parce qu'elle construit les SDK d'abord. |
| F2 | Vérifier les types | `livre_avec_defaut_connu` | `pnpm --filter console exec tsc --noEmit` **vert** ; `pnpm --filter @mip/rum-sdk exec tsc --noEmit` **en échec** sur `packages/rum-sdk/src/replay.ts(242,11)` : `Uint8Array<ArrayBufferLike>` n'est pas assignable à `BodyInit` | **Défaut : aucun workflow de CI ne joue `tsc --noEmit`** — vérifié par `grep -rn 'tsc' .github/workflows/` : aucune occurrence, pour aucun paquet. L'échec du SDK web est donc invisible de la CI, et le restera. Il est antérieur à P7 et n'a été corrigé par aucun lot. |
| F3 | Rejouer la recette SQL complète en CI | `livre_avec_defaut_connu` | job « E2E Playwright (Postgres service) » : `test:sql`, `test:isolation`, `test:alerting`, `test:svi` | **Défaut : deux suites ne tournent jamais en CI**, faute de la variable qui les déclenche — les bancs de mesure (`BENCH_DATABASE_URL`) et la fenêtre de déploiement v82→v83 (`SQL_TEST_PRE_V83_DATABASE_URL`). Elles passent quand on la fournit (§ 8.2). |

---

## 5. Les sujets transverses, vérifiés jusqu'à leur dernier chemin

Un sujet transverse n'est pas déclaré fait tant qu'il manque un chemin d'écriture ou de lecture. Les
quatre demandés par la spec, contrôlés un par un et non déduits des journaux.

### 5.1 Effacement — **fermé côté code, jamais exercé**

Tous les chemins d'écriture passent par `withAppIngestTransaction` : traces, logs, rejeu, dépôt
différé, drain, rafraîchissement des agrégats, et les quatre reconstructions de `D8`. Le catalogue
des tables enfants est comparé au **catalogue PostgreSQL** par un test, plus à une liste recopiée —
c'est ce qui referme le trou de v79/v80 (§ 7). Vérifié en base sur les migrations appliquées dans
l'ordre : `erase_app_data` cite bien `analytics_saved_view`, `dashboard`, `backfill_run`,
`error_status`, `svi_call`, `rum_log`, `rum_ai`, `mobile_capabilities`.

**Trois chemins restent ouverts** : les sauvegardes (`D7`), le texte libre des commentaires de triage
(`A8`), et la purge de rétention des tables SVI (`D5`). Aucun effacement réel n'a été joué.

### 5.2 Périmètre d'application — **fermé, et prouvé sans filtre applicatif**

`pnpm test:isolation` rejoue le schéma complet sur base dédiée, se met dans la peau du rôle
`console_ro` et lit **sans aucun `WHERE app_id`**. Verdict du 18/09 : « isolation multi-tenant
PROUVÉE EN BASE ». Côté applicatif, un périmètre `[]` vaut zéro accès depuis P6.2, une app hors
périmètre est refusée plutôt que rabattue, et une session enregistrée sous A ne peut plus être mise à
jour par B (`ErreurPorteeApp`, 409).

**Reste ouvert** : les lectures historiques `logs`, SVI et assistant IA filtrent par l'app nommée, pas
par le périmètre effectif.

### 5.3 Échantillonnage — **fermé sur le principe, jamais observé sur du trafic**

Le comptage est `observed` partout : occurrences = somme des répétitions **effectivement reçues**.
Aucun multiplicateur automatique. L'avertissement d'échantillonnage est fondé sur la probabilité
d'inclusion d'une erreur (`sr + (1 − sr) × esr`), pas sur le taux de session. `weighted_count` reste
réservé aux tuiles de qualité et ne se compare pas à `observed_count`.

**Reste ouvert** : aucun taux d'échantillonnage réel n'a été observé, puisqu'aucun trafic n'est arrivé
depuis les déploiements. Le chiffre affiché en production serait donc, aujourd'hui, celui de la
configuration, pas celui d'une mesure.

### 5.4 Identité — **fermé côté serveur, faux côté mobile**

Le HMAC est app-scopé et calculé **avant** la file, aux deux ports serveur ; aucun secret HMAC ne vit
dans un SDK. Un hash fourni par un client n'est jamais accepté comme autorisation d'identité. Le
`visitor_id` web est un tirage aléatoire persisté localement — un pseudonyme, pas une donnée anonyme,
et `docs/CONFORMITE.md` le dit.

**Reste faux** : le visiteur **mobile** est un tirage mémoire remis à zéro à chaque lancement
(`C3`). Tant que ce n'est pas corrigé, un compteur de visiteurs mobiles surestime les personnes. Ce
chemin de lecture est donc, lui, ouvert.

---

## 6. Les limites explicites demandées par la spec § 9

### 6.1 Absence de données anciennes

Chaque migration crée une frontière avant laquelle la donnée n'existe pas, et **aucune reprise
d'historique n'a été exécutée** (`D9`). Concrètement :

| Frontière | Avant elle |
|---|---|
| v64 | Occurrences sous-comptées dans les agrégats ; irrécupérables si le SDK ne les a jamais envoyées. |
| v65 | Aucune projection `rum_event_index` : les signaux ne sont pas explorables. |
| v69 | Enveloppe d'erreur absente : pas de `trace_id`, pas de source, pas de contexte P2. |
| v72 | Aucune issue : seulement des groupes par empreinte. |
| v75 | Dimensions à `NULL`, affichées « Inconnu » — navigateur, système, appareil, env, release. |
| v82 | Aucun `runtime` déclaré, aucune capacité mobile. |
| v85 (**non appliquée**) | Aucune provenance de pays : `geo_source` restera `NULL`, affiché « Inconnue » et non « fuseau », parce que ce serait vraisemblable et faux derrière un CDN. |

Une marque d'invalidation d'agrégat plus vieille que 26 h n'est jamais levée : l'heure concernée est
relue **brute** jusqu'à une reprise. Lent, jamais faux.

### 6.2 Aucune recette sur vraie application, nulle part

**C'est la limite qui domine ce document.** Aucun écran, aucune API, aucun outil MCP de P5 à P8 n'a
été éprouvé sur des données réellement ingérées depuis les déploiements. Les journaux la portent
déjà, lot par lot : « la colonne *Vérifié sur vraie app* est **non** partout, sans exception »
(`delivery-p6.md`), « aucune ligne de P7 n'a tourné en production, ni sur un appareil »
(`delivery-p7.md`), « aucun événement n'est arrivé depuis le 17/09 17:23 » (`delivery-p8.md`).

**Cette dernière date n'a pas été recontrôlée ici** : elle demanderait d'interroger la production, ce
que ce travail s'est interdit. Elle est reprise telle que `delivery-p8.md` l'énonce.

Ce que cela veut dire, sans détour : un écran juste sur fixtures peut être faux sur du trafic ; une
requête rapide sur 1,2 M de lignes synthétiques peut être lente sur de vraies données biaisées ; et un
tableau qui affiche `0` ne prouve pas l'absence de problème quand rien n'arrive.

### 6.3 Échantillonnage observé

Voir § 5.3. Les populations ne s'additionnent pas : lignes ≠ occurrences, sessions ≠ visiteurs ≠
identités déclarées. Une métrique sans dénominateur rend `null`, pas `0`.

### 6.4 Le pays est approximatif, et le restera

Aujourd'hui, le pays vient du **fuseau horaire du terminal** — un réglage que la personne choisit, et
une zone qui couvre souvent plusieurs pays — ou, derrière un CDN, de l'en-tête pays posé par celui-ci.
Le libellé est « Pays estimé » partout : écran, API, catalogue MCP, commentaires de colonne,
`docs/CONFORMITE.md`. Ce n'est **pas** une géolocalisation.

`D14` est fusionné et déployé, et n'y change rien. Une base IP→pays situerait une **adresse**, souvent
celle d'un opérateur, d'un relais d'entreprise ou d'un VPN — toujours pas une personne. Et en l'état
elle ne résout rien du tout, faute d'être sur le chemin qui reçoit le trafic (§ 3).

**Aucune adresse IP n'est stockée, nulle part, sous aucune forme** — ni en clair, ni hachée, ni
tronquée. C'est pour cela qu'aucun enrichissement rétrospectif du pays n'est possible : c'est une
limite définitive et voulue, pas une dette.

### 6.5 Nombre de frameworks réellement instrumentés

| Runtime | Instrumenté | Réellement exécuté |
|---|---|---|
| Navigateur (SDK web) | oui | oui, en E2E Playwright sur Chromium |
| Node (agent) | oui | oui, en **vrais processus** (`agent-node-process.test.ts`) |
| Python / FastAPI | oui, **un seul framework** | oui, `unittest` en CI |
| React Native | oui, sur le papier | **non** — aucune version de RN, React, Hermes, JSC, Metro, iOS, Android, Fabric, Paper, React Navigation ni Expo n'a été lancée (`C10`) |
| iOS / Android natifs | **non** | non (`D11`) |

Un seul framework backend, un seul saut de tracing : ni propagation backend→backend, ni span de base
de données.

### 6.6 Erreurs sans pile

Une erreur sans pile exploitable est **regroupée avec une confiance explicitement basse**
(`low_confidence`), pas fusionnée au jugé. Un « Script error. » sans contexte reste peu discriminant,
et le produit le dit au lieu de le masquer. Aucun regroupement par ressemblance de message : c'est
interdit dans l'effacement comme dans le regroupement.

Une pile non symboliquée reste **visible avec sa raison** (`symbolication_status` :
`pending` / `resolved` / `unavailable` / `failed`). Une mauvaise source map produit `unavailable`,
jamais une fausse pile.

### 6.7 Export fatal éventuellement perdu

Trois pertes possibles, toutes connues et aucune corrigée :

1. **Node** — le vidage durable à l'arrêt fatal n'est pas garanti (`C5`) : un processus qui meurt peut
   emporter son export.
2. **Rejeu web sous `enforce`** — un chunk arrivé avant son ancre OTLP reçoit `425` et **n'est pas
   persisté** ; le SDK web ne rejoue pas, donc le chunk est perdu (`D2`). C'est le prix de ne plus
   créer aveuglément une session minimale qui contournait la barrière.
3. **File mobile** — le stockage durable est désactivé par défaut (`C2`) : à la fermeture de
   l'application, le tampon mémoire part avec elle.

---

## 7. La leçon de méthode, parce qu'elle a coûté trois fois

**Trois fusions propres au texte ont cassé quelque chose sans qu'aucun conflit ne soit déclaré.** Les
trois sont vérifiées dans l'historique de ce dépôt.

| # | Ce qui a cassé | Preuve | Ce qu'on ne voyait pas |
|---|---|---|---|
| 1 | **`master` rouge une heure, Vercel en échec** — une borne de points compilée contre un plan sans fenêtre | `delivery-p6.md` : CI verte sur `6dc0363`, **rouge sur `ae9d171`** ; « la console ne compile pas : `./lib/analytics-schema.ts:977:54 — Type error: 'query' is possibly 'null'` » ; production restée sur `05a58d0` ; corrigé par la PR #197 | `git` n'a signalé **aucun** conflit sur la ligne fautive. La PR a été fusionnée **49 secondes après son démarrage**, avant que sa CI n'ait de verdict. |
| 2 | **`master` non installable** — `pnpm-lock.yaml` recousu entre deux paquets voisins | commit `4b9516e` : « `@types/node` est passé de `packages/agent-node` … à `packages/rum-core`, qui ne le déclare précisément pas. **Aucun des deux parents ne portait cette ligne à cet endroit : c'est le texte du merge, pas une intention.** `pnpm install --frozen-lockfile` échoue donc sur master, et avec lui toute la CI et tout déploiement. » | Le verrou est un fichier que personne ne relit. L'échec est total et immédiat, mais il n'apparaît qu'à la première installation propre. |
| 3 | **Effacement client incomplet, et silencieux** — `erase_app_data` a perdu `analytics_saved_view` et `dashboard` entre v79 et v80 | `delivery-p8.md` : « v79 (P6.5) et v80 (P6.6) ont été écrites en parallèle et fusionnées sans conflit déclaré : v80 a repris la définition d'avant v79 » ; vérifié en base avant v81 : `prosrc like '%analytics_saved_view%'` → `f` | **Le test de v79 ne le voyait pas** : le test *précédent* rejoue `migration-v79.sql`, ce qui restaure la définition juste avant l'assertion. Un client effacé gardait ses vues et ses tableaux de bord. |
| **4** | **La fenêtre de déploiement de P8.2 est rouge** — `geo_source`, colonne ajoutée par v85 (P8.7), fait échouer une suite de P8.2 | mesuré sur `2f216cb`, § 8.2 : `column "geo_source" of relation "rum_session" does not exist` | **La CI ne joue pas cette suite** : sa variable `SQL_TEST_PRE_V83_DATABASE_URL` n'est pas dans `ci.yml`. P8.7 a ajouté **la sienne** et protégé **sa** suite par `_resetColonnesCache()` ; celle qu'elle cassait était hors de son champ de vision. **Encore ouvert.** |

**La cause est commune aux quatre : une PR fusionnée avant que la CI du *commit de fusion* ait rendu
son verdict — et, pour la quatrième, une CI qui ne joue même pas le test concerné.** Une branche
verte ne dit rien du résultat de sa fusion, et une CI verte ne dit rien des tests qu'elle saute.
Quatre parades sont déjà écrites dans le code ou évidentes, et elles suffisent si on s'y tient :

- ne jamais **recopier** une fonction SQL pour la modifier : partir de `prosrc` **en place**, et
  échouer bruyamment si le point d'insertion n'est pas trouvé exactement une fois (forme adoptée par
  v83) ;
- comparer les listes de tables au **catalogue** PostgreSQL, jamais à une liste recopiée (adopté par
  v81) ;
- attendre le verdict de la CI **du commit de fusion**, pas celui de la branche ;
- ne jamais laisser une suite dépendre d'une variable que la CI ne pose pas : un test qu'on ne joue
  pas n'est pas un test, c'est une intention.

---

## 8. Les écarts entre ce que les journaux annoncent et ce qui a été mesuré

### 8.1 Chiffres de `test:sql` — l'inventaire de fichiers est faux dans `delivery-p8.md`

`delivery-p8.md` (P8.2) écrit : « `pnpm test:sql` : **22 fichiers, 314 tests verts, 26 ignorés**
(24 fichiers au total, 2 ignorés faute de leurs bases dédiées : le banc P6.6 et la fenêtre v65) ».

Mesuré le 18/09 sur `ed33e27` — l'état de `master` au moment où ce relevé a commencé — avec les cinq
bases dédiées de la CI : **24 fichiers verts et 2 ignorés, soit 26 au total, pas 24** ; **349 tests
verts, 16 ignorés, 365 au total**. `ls tests/integration/` en comptait bien 26. L'écart de **tests**
s'explique (la fenêtre v65 a été fournie ici et pas là) ; l'écart de **fichiers**, non : le journal
sous-compte l'inventaire de deux fichiers, et identifie mal les deux suites ignorées — ce sont les
**deux bancs** (`explorer-bench-p66`, `rum-mobile-bench-p75`), gouvernés par `BENCH_DATABASE_URL`, et
non « le banc P6.6 et la fenêtre v65 ».

Même journal, section P8.1 : « 23 fichiers, 276 tests verts, 12 ignorés ». Les deux relevés du même
fichier ne sont pas cohérents entre eux sur le nombre d'ignorés.

Après fusion de #210 et #211, sur `2f216cb` : **28 fichiers** et **413 tests** au total.

### 8.1 bis `delivery-p8.md` dit v84 « non appliquée » ; elle l'est

Le tableau d'état du journal porte « v84 (non appliquée en production) ». Elle a été appliquée
**automatiquement** à 13:30:35 UTC par la commande de pré-déploiement du service `ingest`, une demi-
heure après la fusion (§ 2). Le journal n'a pas menti : il a été écrit avant, et n'a pas été relu
après. C'est la raison d'être de ce document.

### 8.2 Deux suites ne tournent jamais en CI — et l'une d'elles est maintenant rouge

Comparaison des variables consommées par les tests et de celles fournies par `ci.yml`, sur
`2f216cb` :

```
consommées : SQL_TEST_DATABASE_URL, SQL_TEST_V65…, SQL_TEST_V68…, SQL_TEST_PRE_V71…,
             SQL_TEST_PRE_V81…, SQL_TEST_PRE_V83…, SQL_TEST_PRE_V85…, BENCH_DATABASE_URL
fournies   : SQL_TEST_DATABASE_URL, SQL_TEST_V65…, SQL_TEST_V68…, SQL_TEST_PRE_V71…,
             SQL_TEST_PRE_V81…, SQL_TEST_PRE_V85…
```

Deux manquent, et leurs suites sont `describe.skip`-ées **en silence**. Le détail est parlant :
**P8.7 a ajouté sa propre variable de fenêtre (`SQL_TEST_PRE_V85_DATABASE_URL`) à `ci.yml`, et celle
de P8.2 est toujours absente.** L'omission est donc un oubli, pas une politique.

**`SQL_TEST_PRE_V83_DATABASE_URL`** — la fenêtre de déploiement « code publié **avant**
migration-v83 » de P8.2, 3 tests. Mesuré sur `2f216cb` :

| Comment on le joue | Résultat |
|---|---|
| Comme la CI le joue (6 bases, sans `PRE_V83`) | **26 fichiers verts, 2 ignorés (28) ; 397 tests verts, 16 ignorés (413)** — vert |
| Avec les 7 bases (`PRE_V83` fournie, base au schéma v82) | **1 ÉCHEC** sur 413 : `backfill-idempotency-sql.test.ts` › « P8.2 — code publié AVANT migration-v83 » › « le dry-run fonctionne SANS la migration » |

L'erreur exacte :

```
error: column "geo_source" of relation "rum_session" does not exist
 ❯ writeRowsWithClient apps/ingest/lib/pg-ingest.mjs:620
 ❯ withAppIngestTransaction apps/ingest/lib/privacy-barriere.mjs:183
```

**C'est le même défaut que P7.5 avait déjà payé une fois**, et il est revenu par la même porte. Le
cache de colonnes de `pg-ingest.mjs` est indexé **par table, pas par base** (`colonnesCache`, TTL de
60 s). La suite écrit dans une **seconde** base au schéma plus ancien depuis le même processus : elle
reprend la liste relevée sur la base complète, y trouve `geo_source` — ajoutée par **v85, donc par
P8.7** — et cite une colonne que la base cible ne peut pas accepter. `_resetColonnesCache()` existe
et neuf suites SQL l'appellent, **dont `geoip-v85-sql.test.ts`, écrite par P8.7 elle-même** ;
`backfill-idempotency-sql.test.ts` ne l'appelle pas.

Autrement dit : **P8.7 connaissait le piège, a protégé sa propre suite, et a cassé celle qu'elle ne
pouvait pas voir — parce que la CI ne la joue pas.** C'est le quatrième exemplaire du schéma du § 7,
et le seul encore ouvert au moment où ce document est écrit.

**Ce défaut n'est pas corrigé ici** : ce sous-lot ne modifie ni code ni test. Il se reproduit avec une
base jetable au schéma v82 :

```sh
SQL_TEST_DATABASE_URL=<base complète> SQL_TEST_PRE_V83_DATABASE_URL=<base v82> \
  pnpm exec vitest run tests/integration/backfill-idempotency-sql.test.ts --no-file-parallelism
# 1 failed | 51 passed (52)
```

**`BENCH_DATABASE_URL`** — les deux bancs de mesure (Explorer P6.6, mobile P7.5). Les chiffres de
performance publiés dans `delivery-p6.md` et `delivery-p7.md` ne sont **jamais** revérifiés par la
CI. Une régression de performance passerait sans un mot.

### 8.3 `pnpm build` ne fonctionne pas depuis un dépôt propre

Le script racine `build` vaut `pnpm -r build`. Sur un worktree fraîchement installé, il **échoue** :

```
apps/extension build: ENOENT ... path: '../../packages/rum-sdk/dist/mip-rum.js'
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  extension@0.4.3 build
```

Cause : `apps/extension/package.json` ne déclare **aucune** dépendance d'espace de travail vers
`@mip/rum-sdk`, alors que son `build.mjs` copie `packages/rum-sdk/dist/mip-rum.js`. `pnpm` n'a donc
aucune raison d'ordonner les deux. Après `pnpm build:sdk`, `pnpm -r build` est vert. La CI ne voit
rien parce qu'elle appelle `pnpm build:sdk` en premier — et `delivery-p8.md` annonce « `pnpm -r build`
: vert » sans préciser cette condition.

**Non corrigé : ce travail ne modifie aucun code.**

### 8.4 `tsc --noEmit` du SDK web — l'écart est réel, et la CI ne le verra jamais

`pnpm --filter @mip/rum-sdk exec tsc --noEmit` échoue sur
`packages/rum-sdk/src/replay.ts(242,11): error TS2322` — `Uint8Array<ArrayBufferLike>` n'est pas
assignable à `BodyInit`. `delivery-p7.md` le consigne comme « échec PRÉ-EXISTANT non joué par la CI ».
**Confirmé, et aggravé d'un cran** : `grep -rn 'tsc' .github/workflows/` ne rend **aucune**
occurrence. Aucun workflow ne joue `tsc --noEmit`, pour aucun paquet — pas même pour la console, qui
passe pourtant. La vérification des types n'est couverte par la CI d'aucune façon.

### 8.5 Ce que je n'ai pas pu vérifier

- **Le contenu réel de la base de production** : nombre de lignes, date de la dernière ingestion,
  périmètre chiffré de `D9`, état des barrières d'effacement. `DATABASE_URL` était interdite pour ce
  travail et n'a pas été employée. Tout cela est **attribué** à sa source (journal de livraison, ou
  décision du 18/09/2026) et non recontrôlé.
  **Exception : les migrations appliquées**, que les journaux de pré-déploiement Railway donnent sans
  qu'on ait à ouvrir la base (§ 2) — et c'est par là qu'on a vu que le journal était périmé.
- **Le comportement de la façade Railway sur `X-Real-IP`** (`D14`) : il n'existe aucun déploiement
  exposé sur lequel le sonder, puisque `ingest` n'a pas de domaine.
- **La date de la dernière ingestion** (« 17/09 17:23 », `delivery-p8.md`) : reprise telle quelle.

---

## 9. Reliquat à nettoyer

**Le dépôt bac à sable `jt33120/mip-rum-tickets-sandbox` existe toujours.** Vérifié le 18/09 par
`gh api` : privé, créé le 18/09/2026 à 12:44 UTC, non archivé. Il a été ouvert pour éprouver le
connecteur de tickets de `D12` et n'a pas pu être supprimé — le jeton de la session `gh` ne porte pas
le droit `delete_repo`. **À supprimer avec un jeton qui en dispose**, ou à archiver si son unique
ticket doit rester consultable comme preuve.

---

## 10. Pourquoi il n'y a pas de verdict global « fini »

La spec § 9 l'interdit tant que des points obligatoires restent ouverts. Ils sont cinq, et aucun n'est
une affaire de rédaction :

1. **Aucune recette sur vraie application** (§ 6.2). Aucune capacité de ce document n'a franchi la
   colonne « éprouvé sur donnée réelle ». C'est le point le plus lourd, et le moins cher à lever.
2. **P8.4 — source maps dans la CI du client** (`D10`) : jamais entamé, bloqué sur des accès externes.
3. **P8.5 — crashes natifs, symboles, appareils** (`D11`) : jamais entamé, et volontairement sans
   table, pour qu'aucun écran ne montre un faux zéro.
4. **Un test rouge, que la CI ne joue pas** (§ 8.2, § 7 n° 4) : la fenêtre de déploiement de P8.2
   échoue depuis que v85 a ajouté `geo_source`. Déclarer « CI verte » sans le dire serait exactement
   le genre de vérité partielle que ce document existe pour empêcher.
5. **Deux défauts connus, non corrigés** : `tsc --noEmit` du SDK web en échec sans qu'aucun workflow
   ne le joue (§ 8.4), et `pnpm -r build` inopérant depuis un dépôt propre (§ 8.3).

**P8.3 (`D9`) est le seul point fermé par une décision plutôt que par une livraison** : ne pas
exécuter, le 18/09/2026, périmètre mesuré à ≈ 97 lignes. Cette décision ne rouvre rien, mais elle ne
referme pas non plus les cinq autres.

**P8.6 et P8.7 ne sont plus ouverts** : fusionnés pendant ce relevé, migrations v84 et v85 appliquées,
code déployé. Ils ne bloquent plus rien — ils s'ajoutent simplement aux 32 capacités livrées et jamais
éprouvées sur du trafic.

---

## 11. Par où commencer, si l'on reprend le produit

Dans cet ordre, parce que chaque étape éclaire la suivante.

1. **Faire arriver du trafic, puis regarder.** Réactiver un émetteur sur une application de recette,
   attendre quelques centaines d'événements, et ouvrir `/errors`, `/explorer`, un tableau de bord et
   `/mobile` sur ces données. C'est l'étape qui manque à **toutes** les lignes de ce document, et
   c'est la moins chère.
2. **Décider du sort de `ingest`.** Soit on lui ouvre un domaine — et `D14` et le port direct de `A6`
   deviennent atteignables —, soit on acte que Vercel est le seul chemin, et on déplace ce qui en
   dépend. En l'état, une capacité livrée ne s'exécute nulle part sans que rien ne l'annonce.
3. **Réparer la fenêtre de déploiement de P8.2, puis la mettre dans la CI** (§ 8.2). Une ligne dans
   `ci.yml` et un `_resetColonnesCache()` dans la suite. Tant que ce n'est pas fait, personne ne sait
   si le code publié survit à la prochaine migration — et c'est justement ce que cette suite existe
   pour dire.
4. **Mettre `tsc --noEmit` et les bancs dans la CI** (§ 8.2, § 8.4), puis corriger `replay.ts:242` et
   l'ordre de build de `apps/extension`. Quatre corrections courtes, qui rendent vraie la phrase
   « la CI est verte ».
5. **Écrire la procédure de restauration** (`D7`). C'est le seul trou de ce document qui touche une
   garantie déjà annoncée à un client dans `docs/CONFORMITE.md`.

---

*Document de couverture P8.8. Il vaut par ce qu'il refuse d'affirmer autant que par ce qu'il affirme :
une ligne sans preuve nommée n'est pas un verdict, c'est une opinion.*
