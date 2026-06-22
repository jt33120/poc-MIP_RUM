# CHANGELOG — MIP RUM

Historique des versions. Détail factuel (valeurs mesurées, pièges, décisions) dans [BUILD_LOG.md](BUILD_LOG.md).

## v0.14 — 2026-06-18 (P1 — auto-observabilité : /metrics + santé interne)

Périmètre : opérer MIP RUM comme un produit **supervisé**. **Lecture seule**, aucune migration de données. Endpoint `GET /api/metrics` + page admin `/admin/health`. Détail : [docs/OBSERVABILITY.md](docs/OBSERVABILITY.md).

- **`/api/metrics`** : exposition **Prometheus** (ingestion 5 min par type, sessions, apps actives, alertes non acquittées, livraisons par statut, **retard de métering** = détection cron mort). **Auth par token** `METRICS_TOKEN` (header Bearer) ; **fail-closed** (404 si le token n'est pas défini) ; bypass middleware de session (scrape sans cookie) ; aucune PII.
- **`/admin/health`** (admin) : même snapshot en cartes, seuils de couleur sur le retard de métering.
- **Architecture** : `lib/queries-health.ts` (`internalHealth`, un aller-retour, **fail-soft** → `/metrics` ne 500 jamais) ; `lib/metrics-format.ts` (**pur, testé** : `healthToMetrics` + `toPrometheus`, HELP/TYPE unique, labels échappés, null omis).
- **Parité corrigée en passant — `migration-v19`** : `console_ro` n'avait **pas** de `SELECT` sur `app_registry` dans le repo (v05 = INSERT/UPDATE seulement ; le SELECT + `cro_sel_app_registry` n'existaient qu'en prod). Sans ça, le **sélecteur d'app de toute la console** + `/metrics` renverraient 0 sous `console_ro` sur un déploiement propre. Codifié (idempotent, nom identique au live → no-op prod). Même famille que finding #1 / v16.
- Preuves : `scripts/verify-health.mjs` (PG réel : comptages + retard métering + exécution `console_ro`) ; **+4** tests (`toPrometheus`) → **258** verts ; idempotence 2 passes ; `tsc` + `next build` OK (routes `/api/metrics`, `/admin/health`).

## v0.13 — 2026-06-18 (P1 — tableaux de bord configurables + export)

Périmètre : laisser chaque équipe composer ses vues et les exporter (CSV / PDF). Contrat SQL `apps/ingest/sql/migration-v18.sql` ; console `/dashboards`. Détail : [docs/DASHBOARDS.md](docs/DASHBOARDS.md).

- **Modèle** : table `dashboard(name, app_id, layout jsonb, …)` — un dashboard = une liste de **widgets** sérialisée ; aucune nouvelle table de données (les widgets réutilisent les requêtes existantes). Widgets v1 : `vital_p75`, `traffic`, `slow_routes`, `top_errors`, `frustration` (scopés app + période/device globaux ; route-scoping = suivi).
- **Helpers purs** `lib/dashboards.ts` : `normalizeLayout` (types connus, métrique valide requise pour `vital_p75`, borné `MAX_WIDGETS`=24, fail-soft) appliqué en lecture **et** écriture. `lib/widget-data.ts` : `resolveWidget` → forme uniforme value|table (réutilise vitalsP75/dailyTraffic/slowRoutes/errorGroups/topFrustrations) ; `widgetToCsv` (RFC 4180).
- **Console** : `/dashboards` (liste + création), `/dashboards/[id]` (rendu des widgets, ajout/retrait/réordonnancement, renommage, suppression), **export CSV** `GET /api/dashboards/[id]/export` (auth `getUser`), **PDF** via impression navigateur. CRUD via server actions.
- **Conformité** : RLS + accès `console_ro` (v18, motif #1) ; `erase_app_data` redéfini pour purger les dashboards **scopés** (RGPD), les non scopés préservés.
- Preuves : `scripts/verify-dashboards.mjs` **7/7** sur PG réel (CRUD, RLS + R/W `console_ro`, effacement RGPD) ; **+6** tests (`normalizeLayout`) → **260** verts ; idempotence 2 passes ; `tsc` + `next build` OK (routes `/dashboards`, `/dashboards/[id]`, `/api/dashboards/[id]/export`).

## v0.12 — 2026-06-18 (P1 — alerting mature : baselines, SLO, routing)

Périmètre : faire passer l'alerting du **seuil statique** au niveau **grand compte**. Contrat SQL `apps/ingest/sql/migration-v17.sql` ; console `/alerts` (règles + canaux) et nouvelle page `/slo`. Détail : [docs/ALERTING.md](docs/ALERTING.md).

- **Baselines dynamiques** : `alert_rule.mode='baseline'` → alerte sur l'écart au **normal saisonnier** (médiane/MAD au même jour-de-semaine + heure, `metric_baseline()`), au lieu d'un seuil fixe. Garde-fou ≥ 4 échantillons & MAD > 0 (pas de fausse alarme sur historique mince). Réduit le bruit (#1 reproche des seuils fixes).
- **SLO & error-budget** : table `slo`, `slo_status()` (atteinte / budget / **burn-rate 14,4×**), `check_slo_burn()` (pg_cron 5 min) → `alert_event` **critical** rattaché au SLO. Flux d'événements **unifié** (`alert_event.rule_id` OU `slo_id`). Page `/slo` (barre d'atteinte, statut ok/à-risque/manqué, badge « burn rapide »).
- **Routing multi-canal + sévérité** : `alert_rule.severity` (info/warning/critical) ; table `notify_channel` + `route_alert()` notifie **N canaux** filtrés par sévérité (webhook/Slack via `pg_net`), **en plus** du webhook historique. **E-mail/SMS** = canal tracé `skipped`, **non livré** (service payant — décision commerciale, hook prêt).
- Accès `console_ro` des nouvelles tables (`slo`, `notify_channel`) + idempotence sur `alert_rule`/`alert_event` (motif du finding #1).
- Preuves : `scripts/verify-alerting.mjs` **11/11** sur PG réel (threshold rétro-compat, baseline déclenche sur l'anomalie **mais pas sur le normal**, SLO + burn, routing par sévérité, lecture `console_ro`) ; idempotence 2 passes ; `lib/alerting.ts` pur + **8** tests (`sloView`, `severityRank`). Suite : **262** verts ; `tsc` + `next build` OK (routes `/alerts`, `/slo`).

## v0.11 — 2026-06-18 (parité `console_ro` repo↔live + fix Tracing)

Périmètre : codifier dans le repo le modèle d'accès `console_ro` qui n'existait qu'en prod (appliqué à la main en v0.3) — suite du finding #1. **`apps/ingest/sql/migration-v16.sql`** (idempotente, gardée par l'existence du rôle).

- **Drift corrigé** : les policies/grants `console_ro` des **tables de base** (`rum_metric`, `rum_error`, `rum_event`, `rum_pageview`, `rum_session`, `rum_resource`, `rum_longtask`, `rum_breadcrumb`, `syn_snapshot`, `replay_chunk`) + écriture (`console_user`, `audit_log`, `alert_rule`, `alert_event`) + vues (`v_*`) n'étaient **pas** versionnés. Un **déploiement propre / reprise (DR)** depuis le repo aurait donné une **console aveugle** (RLS active, aucune policy → 0 ligne), CI/local (connexion propriétaire) restant verts. Noms de policies **identiques au live** ⇒ réexécution sur la prod = **no-op exact**.
- **Bug latent EN PROD corrigé** : `rum_span` (lu en direct par `/tracing`, `queries-customers`, `queries.ts`) et `rate_counter` avaient un **GRANT SELECT mais aucune policy** `console_ro` → 0 ligne. **La page Tracing était vide sous `console_ro`.** Policy `cro_sel_span` / `cro_sel_rate` ajoutée.
- Preuve : **`scripts/verify-console-ro.mjs`** étendu (lecture `console_ro` des tables de base dont `rum_span`, == propriétaire) ; idempotence 2 passes **sans doublon de policy**. Suite unitaire inchangée (**254**).

## v0.10 — 2026-06-18 (P1 — signaux de frustration & attribution INP)

Périmètre : combler un écart concurrentiel face à FullStory/Dynatrace DEM — mesurer la **frustration utilisateur** (pas seulement la lenteur navigateur). Console : nouvelle page **/ux**. Détail dans [docs/FRUSTRATION.md](docs/FRUSTRATION.md).

### SDK — détection rage & dead clicks (`packages/rum-sdk/src/frustration.ts`)
- **Rage click** : ≥ 3 clics sur la même cible en < 1 s (émis **une fois par rafale**). **Dead click** : clic sur un élément d'aspect actionnable (`button`/`a`/`role=button`/… ou `cursor:pointer`) sans **aucune réaction** (mutation DOM, navigation, scroll) sous 1,5 s. Logique **pure & testée** (`RageDetector`, `isDeadClick`) ; câblage via un `MutationObserver` partagé + écouteurs nav/scroll. Cap 20/page (réinitialisé par navigation), cible lisible ≤ 80 c, **opt-out** `frustration:false`. Conservateur (sous-reporte plutôt que faux positifs ; aucune coordonnée ni saisie capturée).
- Bundle cœur : **26,3 Ko gzip** (≤ 35 ; +0,5 Ko).

### Ingestion — span `frustration` → `rum_event` (nom réservé `frustration.<kind>`)
- Choix volontaire (leçon des findings #1/#4) : **réutiliser `rum_event`** plutôt qu'une nouvelle table → hérite de toute la plomberie (policy `console_ro`, purge par rétention, effacement RGPD, métering, index `(app_id, name, ts)`). `target` **scrubbé** (PII) ; `kind` hors {rage,dead} **rejeté**.

### Console — page `/ux` (`lib/queries-frustration.ts`)
- **Signaux de frustration** (top rage/dead par route × cible) + **interactions lentes** : éléments responsables classés par **INP p75** via l'attribution `webvital.attribution` (déjà captée en P0, désormais exploitée). Filtres app/device/période standards, fail-soft.

### Preuves
- +14 unitaires (`frustration` : détecteurs ; `otlp` : mapping rage/dead, défaut `count`, kind invalide, scrub cible) ; snapshot OTLP étendu au span `frustration`. Suite : **254** verts.
- `scripts/verify-frustration.mjs` : agrégats + attribution INP **sur Postgres réel**. `tsc` + `next build` OK (route `/ux`).

> **Finding repo↔live relevé en passant (hors périmètre, à arbitrer)** : les policies/grants `console_ro` des **tables de base** (rum_event/metric/error/session…) ne sont **pas** dans les migrations du repo (appliquées à la main en v0.3). La prod fonctionne, mais un **déploiement propre** depuis le repo donnerait une console aveugle. Même famille que le finding #1.

## v0.9 — 2026-06-18 (recette adversariale P0 — correctifs)

Périmètre : correctifs issus de la recette QA/sécurité adversariale des 5 P0 (PR #18→#23). Aucune régression ; preuves rejouées sur **Postgres 16 réel** (`pg_virtualenv`).

### 🔴 #1 — accès `console_ro` aux tables v0.8 (piège « CI vert ≠ prod OK »)
- **Vérifié en live** : la console se connecte sous le rôle **restreint `console_ro`** (sans `BYPASSRLS`), pas sous le propriétaire — son accès passe par des **policies `cro_*`** (19 en prod). Le commentaire de `migration-v10.sql` affirmait l'inverse (« connexion propriétaire ») : **corrigé** (DEPLOY.md faisait foi).
- **Bug latent corrigé** : les 3 tables v0.8 (`rum_rollup_hourly` v12, `sourcemap` v13, `tenant_usage_daily` v15) n'avaient **pas** le bloc `console_ro` (RLS + grant + policy) que portent toutes les autres tables console. Au déploiement, `/admin/usage` aurait été vide, l'upload de source map aurait échoué (*permission denied*) et les rollups auraient été illisibles — **alors que CI/local (connexion propriétaire) restaient verts**. Bloc gardé ajouté à v12/v13/v15 (motif `cro_*` de v0.3/v05).
- Preuve : **`scripts/verify-console-ro.mjs`** (NEW) rejoue le déploiement complet *avec* `console_ro` et prouve lecture + upsert sous RLS, plus l'isolement (un rôle sans policy voit 0).

### 🟠 #2 — `AUTH_SECRET` fail-closed en production
- `lib/auth.ts` signait le JWT de session avec un **secret de dev versionné** si `AUTH_SECRET` était absent (cookie admin forgeable). Désormais `resolveAuthSecret()` **lève en production** si la variable manque (fallback dev toléré hors prod). Variable **documentée** dans DEPLOY.md. +5 tests unitaires (`auth`).

### 🟡 #3 — égalité rollup == brut au **bord** de la fenêtre 14 j
- Le brut filtrait `ts > now()-14d`, le rollup `hour > now()-14d` : une métrique dans l'heure-frontière divergeait. Filtres **alignés** sur `>= date_trunc('hour', now()) - 14d` des deux côtés (BRIN-friendly, équivalence exacte). `verify-rollups.mjs` gagne un **cas-bord** dédié (toujours Δ=0).

### 🟡 #4 — `rum_rollup_hourly` purgé & effacé (RGPD)
- `purge_rum_app` applique désormais la rétention **aussi aux rollups** (croissance bornée) ; `erase_app_data` **efface les agrégats dérivés** d'un client (art. 17). `tenant_usage_daily` reste volontairement préservé (facturation durable, comptage sans PII). +3 assertions dans `verify-conformite.mjs`.

### 🟡 #5 — note d'exploitation (clé d'API)
- DEPLOY.md documente le passage en **`REQUIRE_API_KEY=true`** une fois toutes les apps porteuses d'une clé (sinon injection cross-tenant possible sous un `app_id` sans clé). Comportement *fail-open* inchangé (continuité POC).

Recette : **240 unitaires** verts (+5) ; `verify-rollups` / `verify-console-ro` / `verify-conformite` / `verify-tenant` / `verify-oidc-jit` verts sur PG16 ; migrations idempotentes (2 passes, `console_ro` présent) ; `tsc` + `next build` OK.

## v0.8 — 2026-06-17 (sécurité base + scrub PII serveur)

Périmètre : durcissement sécurité suite à l'alerte Supabase, et défense en profondeur sur les données personnelles. Contrats : `apps/ingest/sql/migration-v10.sql`, `migration-v11.sql` (RLS + fonctions) ; parser partagé `_shared/otlp.mjs` + nouveau `_shared/scrub.mjs`.

### Sécurité base de données (migrations v10/v11, appliquées en prod)
- **RLS activé sur toutes les tables du schéma `public`** (sans policy ⇒ API PostgREST `anon`/`authenticated` fermée). Corrige `rls_disabled_in_public` et `sensitive_columns_exposed` (`console_user.password_hash`). L'ingestion (`service_role`, BYPASSRLS) et la console (connexion Postgres directe sous le rôle propriétaire) ne sont pas impactées car personne ne passe par l'API publique.
- Vues retirées de l'accès API ; fonctions **`SECURITY DEFINER`** fermées à l'API (dont la purge destructrice) avec `EXECUTE` conservé pour `service_role` ; **`search_path` figé** sur toutes les fonctions (anti-injection). Advisors sécurité : 14 → 3 (restants non bloquants : `rls_enabled_no_policy` INFO = état voulu, `pg_net in public` = défaut Supabase). Migrations **idempotentes** et gardées par `if exists (pg_roles)` (CI/local sans les rôles Supabase).

### Échantillonnage intelligent biaisé-erreurs (A1 — SDK)
- Avant, une session hors `sampleRate` ne renvoyait **rien** (erreurs comprises) : on perdait les sessions à incident, les plus utiles. Désormais (`packages/rum-sdk/src/sampling.ts`), trois modes décidés une fois par session et **persistés** : **full** (fraction `sampleRate`), **error-biased** (routine supprimée mais erreurs conservées ; la 1ʳᵉ erreur **promeut** la session en full pour capter le contexte post-incident), **off** (opt-in via `keepOnError: false`).
- Nouvelles options `keepOnError` (défaut `true`) et `errorSampleRate` (défaut `1.0`) : on garde 100 % des sessions à erreur tout en échantillonnant le trafic nominal. Intégré au point d'émission (`index.ts`) en amont de la gate de consentement.
- Bundle cœur inchangé côté budget : **25,7 Ko gzip** (≤ 35 Ko). Tests : +8 unitaires (`sampling` : décision + promotion). Suite : **179 unitaires** verts.

### Scrub PII serveur (A2 — défense en profondeur)
- Nouveau module **`_shared/scrub.mjs`** (runtime-agnostic, sans dépendance) : `scrubText` / `scrubUrl` / `scrubProps`. Masque emails, schémas d'autorisation (Bearer/Basic), JWT (ancré `eyJ`), clés à préfixe (`sk-`, `mip_`), affectations sensibles (`password=…`, `api_key:…`), IPv4 et longues suites de chiffres (cartes/téléphones), en gardant le texte de diagnostic lisible.
- Appliqué dans le parser partagé `_shared/otlp.mjs` (donc **parité dev-server Node ↔ edge Deno**) aux champs libres : `message`/`stack` d'erreur (scrub **avant** troncature), `url`/`referrer`/`source`, et `props` d'événements (`track.*`). Front **et** back. On ne se fie plus au seul `beforeSend` client.
- Tests : +16 unitaires (`scrub` : motifs + bout-en-bout via `flattenOtlp` prouvant 0 PII connue en sortie ; non-régression de l'agrégat d'identifiants pointés de stack). Suite : **171 unitaires** verts.

### Contrat OTLP verrouillé + durcissement du parser (A5 — ingestion)
- **Test snapshot** (`tests/unit/otlp-snapshot.test.ts` + `tests/fixtures/otlp-snapshot.json`) : fige la sortie de `flattenOtlp` pour un payload représentatif (tous les types de spans — pageview, vital, exception, resource, longtask, breadcrumb, `track.*`, `http.client`, `http.server`, span SERVER OTel standard — scrub PII inclus). Toute évolution du parser devient visible en revue.
- **Durcissement OTel** : le parser ne jette plus jamais sur un payload malformé/hostile (resourceSpans/scopeSpans/spans/attributes non-array, éléments null/scalaires, span sans nom ou nom non-string, `AnyValue` déformé, `startTimeUnixNano` non numérique → `ts` = maintenant). Tout ce qui n'est pas exploitable est compté `rejected`. +15 tests (snapshot + batterie d'entrées hostiles). Suite : **194 unitaires** verts.

### Outillage capacité (B2 — outil, sans run)
- **`scripts/load-bench.mjs`** : bench de charge paramétrable (env `TARGET_EVENTS`/`CONCURRENCY`/`ENDPOINT`/`DATABASE_URL`…) qui étend `load-light.mjs`. Phase charge (débit soutenu events/s + latences POST p50/p95/p99) puis phase requêtes (p50/p95 des requêtes console lourdes à volume). Générateur réaliste (routes pondérées, 1 lente) validé contre le vrai parser `flattenOtlp`. Mode `--dry-run` (auto-test sans réseau/base). `main()` gardé → importable/testable. **À lancer contre une base type-prod (pas le free tier)** ; doc d'usage + emplacement des résultats dans `infra/clickhouse.notes.md`. +4 tests unitaires (suite **198** verte). B1 (corrélation synthétique réelle) reste en attente d'une décision MIP / d'un accès mippoc.

### ClickHouse prod-grade (C2 — P0 « scale grand compte », préparation autonome)
- Le chemin CH était prouvé en local (Δ=0, ×15 compact) mais le schéma restait un sous-ensemble sans rétention ni pré-agrégation. Ajout de **`infra/clickhouse/schema.prod.sql`** : jeu de tables **complet** (metric/pageview/error/resource/longtask/session), `device_type` **dénormalisé** (filtre device sans JOIN), **TTL 30 j** (RGPD), codecs colonne (Gorilla/DoubleDelta + ZSTD), et surtout une **MV `AggregatingMergeTree`** `rum_metric_p75_hourly_ch` (`quantileTDigestState`/`countState`/`sumState` horaire) pour tenir le **multi-milliards** (la console lit la pré-agrégation, pas les lignes brutes).
- **`scripts/load-bench.mjs` cible désormais ClickHouse** (`STORE=clickhouse`) : phase requêtes en dialecte CH (`quantileTDigest`/`toStartOfHour`/`uniqExact`), comptage et nettoyage via le writer HTTP — preuve de **capacité** rejouable contre l'instance cible le jour J. `writer.mjs` gagne le **binding serveur natif** `{name:Type}` (`chSearchParams`, anti-injection), exposé à `query()`/`exec()`.
- **Runbook de bascule** `infra/clickhouse/DEPLOY.md` : topologie Collector→CH, étapes store-par-store, couche **dialecte console** (~50 lignes, 3 idiomes équivalents prouvés), conformité/exploitation (sauvegardes, durcissement, supervision), et **options d'hébergement** (ClickHouse Cloud UE vs auto-géré Scaleway/OVH/Clever Cloud vs on-prem) — seul vrai pré-requis restant. +7 tests unitaires (binding CH + sélection de dialecte). Suite : **205 unitaires** verts. *(SQL CH validé à l'application contre l'instance live, pas en CI.)*

### Runway Postgres/Supabase (P0 scale — plan « full Supabase »)
- Décision : **rester sur Supabase** (= Postgres) tant que MIP ne finance pas d'infra dédiée — ClickHouse ne paie qu'au multi-milliards, son chemin reste prêt sur l'étagère (cf. ci-dessus). En attendant, on **repousse le mur de Postgres** sans changer de techno (**`apps/ingest/sql/migration-v12.sql`**) : **index BRIN** sur les colonnes temporelles (append-only → scans 7 j/14 j bornés) + **rollup horaire pré-agrégé** `rum_rollup_hourly` (`device_type` dénormalisé, sommes **exactement mergeables** : good/total pondérés, pageviews, erreurs) avec `refresh_rum_rollups(p_hours)` idempotent (backfill 30 j + **pg_cron** horaire gardé pour CI/local).
- La console lit le rollup pour les vues 14 j scan-lourdes (**heatmap santé** + **trafic quotidien**) derrière le flag **`RUM_USE_ROLLUPS`** (défaut **off** → comportement inchangé tant que les rollups ne sont pas peuplés). Les p75 (non mergeables) restent sur les lignes brutes + BRIN.
- **Égalité rollup == brut prouvée Δ=0** sur Postgres réel (6 cas, filtres app/device) via **`scripts/verify-rollups.mjs`** (même esprit que le bench ClickHouse). Suite : **205 unitaires** verts ; `tsc` + `next build` OK.

### SSO enterprise — OpenID Connect (P0)
- **Connexion SSO** de la console via **OIDC (Authorization Code + PKCE)** — un grand compte branche son IdP (Azure AD/Entra, Okta, Keycloak, Google…). Implémentation **standard** (tout IdP conforme), login email/mot de passe gardé en repli. Cœur pur testable (`apps/console/lib/oidc.ts` : config, PKCE S256, URL d'autorisation, **mapping claims → rôle/apps**) + partie réseau isolée (`oidc-remote.ts` : discovery, échange de code, validation ID token via JWKS).
- **Flux** : `/api/auth/oidc/login` (PKCE + state anti-CSRF + nonce anti-rejeu en cookies httpOnly courts) → IdP → `/api/auth/oidc/callback` (validation signature/`iss`/`aud`/`nonce`, mapping, session). Middleware : `/api/auth/*` exclu de la garde (auth dans le handler).
- **RBAC piloté par l'IdP** : `OIDC_ROLE_CLAIM` + `OIDC_ADMIN_VALUES` → admin/viewer ; `OIDC_APPS_CLAIM` → viewer scopé. Sans claim de rôle, le rôle géré dans la console est **préservé**. **Provisioning JIT** : `console_user` créé/maj à la connexion (`password_hash` sentinelle `sso:oidc` → mot de passe impossible).
- Validation : **+14 tests unitaires** (`tests/unit/oidc.test.ts` : PKCE, URL, mapping, config). **Provisioning JIT prouvé sur Postgres réel** (`scripts/verify-oidc-jit.mjs` : création viewer, override IdP, préservation du rôle console). Suite : **219 unitaires** verts ; `tsc` + `next build` OK. Doc : `docs/SSO.md` (env, mapping, exemple Keycloak, suivi SCIM/logout). *(Échange de code/JWKS validé contre l'IdP réel, pas en CI.)*

### Dé-minification des erreurs — source maps (P0 #3)
- En prod les stacks sont minifiées (`at a (main.abc.js:1:4567)`) : pilier « erreurs » cosmétique. Ajout d'un **moteur de symbolication source map v3 ZÉRO-DÉPENDANCE** (`apps/console/lib/sourcemap.ts` : décodage VLQ, parsing `mappings`, recherche dichotomique, parsing de stack Chrome/Firefox) — pas de wasm, importable côté serveur Next. Dé-minification **à l'affichage** (lazy), jamais à l'ingestion.
- **Association par version** : le SDK envoie `release` (option → attribut resource `mip.release`), stockée sur `rum_error` (`migration-v13`). Source maps stockées par `(app_id, release, filename)` (table `sourcemap`), **uploadées via `POST /api/sourcemaps`** (admin). La page d'un groupe d'erreurs affiche la stack **dé-minifiée** (badge + release) quand une map existe, sinon la stack brute (repli).
- Validation : **+11 tests unitaires** (`tests/unit/sourcemap.test.ts` : round-trip décodage VLQ via un encodeur **indépendant**, résolution de position, réécriture de stack). Extraction `mip.release` prouvée dans le snapshot OTLP (release `1.4.2`). `migration-v13` appliquée sur Postgres 16 éphémère (colonne + table). SDK **25,8 Ko gzip** (≤ 35). Suite : **216 unitaires** verts ; `tsc` + `next build` OK. Doc : `docs/SOURCEMAPS.md`. *(Upload par jeton CI + rétention = suivi.)*

### Conformité — rétention par tenant + droit à l'effacement (P0 #4)
- Exigences éliminatoires d'AO grand compte rendues **vérifiables** (pas seulement documentées), via **`migration-v14`** : **rétention configurable PAR CLIENT** (`app_registry.retention_days` ; `purge_rum_tenants(default_days)` purge chaque app selon SA rétention, sinon défaut 30 j, planifié pg_cron) et **droit à l'effacement RGPD** — `erase_app_data(app_id)` (offboarding : toute la télémétrie d'un client, FK-safe) et `erase_session(session_id)` (personne concernée). `audit_log`/`console_user` jamais effacés.
- **Prouvé sur Postgres 16 réel** (`scripts/verify-conformite.mjs`, 8 assertions) : rétention par tenant honorée (app 7 j vs 60 j vs défaut 30 j), effacement app/session complet, registre préservé.
- **Dossier de conformité** `docs/CONFORMITE.md` (résidence UE, inventaire & classification des données, RGPD by design, rétention, droits des personnes, sécurité, sous-traitants, **trajectoire ISO 27001 / SecNumCloud / HDS** avec gap analysis) + **modèle de DPA** `docs/DPA.md` (art. 28). Aucune nouvelle dépendance ; suite unitaire inchangée (**230** verte). *(Aucune certification acquise — trajectoire documentée, décision direction.)*

### Isolation multi-tenant — métering & quotas (P0 #5)
- Comble le manque « mesure de consommation (facturation) + quotas » (**`migration-v15`**) : **`tenant_usage_daily`** (agrégat **durable**, survit à la purge → historique de facturation conservé) alimenté par **`meter_tenant_usage(day)`** (idempotent, events = total des lignes ingérées/jour, planifié 3 h 05 avant la purge) ; vue **`v_tenant_usage_month`** ; **quota mensuel par client** (`app_registry.monthly_quota`) + **`tenant_quota_status(app_id)`** (used/quota/over, **fail-open**).
- **Console** : page admin **`/admin/usage`** (consommation du mois par client + barre de quota + dépassements) + lien nav. Helper pur `lib/usage.ts` (vue quota).
- **Prouvé sur Postgres 16 réel** (`scripts/verify-tenant.mjs`, 7 assertions : métering events/sessions/erreurs, quota over/illimité, usage mensuel, idempotence). **+5 tests unitaires** (`quotaView`). Suite : **235 unitaires** verts ; `tsc` + `next build` OK. Doc : `docs/MULTITENANT.md` (modèle d'isolation + métering/quotas + hook d'enforcement + roadmap RLS-par-tenant). *(Enforcement dur des quotas + RLS-par-tenant = suivi.)*

## v0.6 — 2026-06-12 (déploiement zéro-touch : injection front + backend codeless)

Périmètre : poser le RUM **sans modifier le code du client** — pour les sites COTS / legacy / gérés par un tiers, et les backends multi-langages. Aucune migration SQL (purement additif : générateurs côté console + parser d'ingestion). Détail : [docs/INTEGRATION.md](docs/INTEGRATION.md) §8-9.

### Injection front zéro-touch (console)
- **Trois configurations d'injection générées et préremplies** dans le wizard client (étape 2) : **Cloudflare Worker** (HTMLRewriter — injecte les 2 balises dans le `<head>` **et réécrit la CSP** : `script-src` du SDK + `connect-src` de l'ingestion, le seul des trois à corriger la CSP), **nginx** (`ngx_http_sub_module` : `sub_filter` avant `</head>` + neutralisation de la compression amont), **Google Tag Manager** (tag HTML All Pages, self-service ; async + ne corrige pas la CSP). Aucune n'embarque la clé d'API (clé front optionnelle).
- Fusion CSP pure et testée (`mergeCsp` dans `lib/onboarding.ts`) : ajoute les origines en respectant le fallback `default-src`, sans dupliquer ni élargir un `*` existant — répliquée en JS dans le Worker généré.
- Note explicite pour le cas **SPA statique** (Vercel/Netlify/S3) : pas de proxy HTML dans la chaîne → Cloudflare devant ou snippet en dur (cas plateforme.groupement-it.com).

### Backend codeless (ingestion)
- **L'ingestion accepte les spans serveur OpenTelemetry standard** (semconv `http.route` / `http.request.method` / `http.response.status_code`, `kind=SERVER`, trace/span/parent au niveau du span, session via `tracestate: mip=s:<id>`, template `{id}`→`:id`) **en plus** du middleware MIP `http.server`. Changement purement additif au parser partagé (`_shared/otlp.mjs`, edge + dev-server) : un client lance son app sous un agent d'auto-instrumentation OTel (Python/Java/.NET/Go/Node…) → spans back corrélés, **zéro ligne de code applicatif**.
- **Adaptateur Collector téléchargeable** (`otel-collector.yaml`) : filtre les spans serveur (1 par requête), injecte `mip.app_id` + `mip.api_key`, exporte en `otlphttp encoding: json` vers l'ingestion.
- Assistant IA enrichi du contrat d'injection (3 points front + CSP) et du backend codeless (agent OTel + Collector).
- Tests : +17 unitaires (`injection-v06` : fusion CSP, génération Worker/nginx/GTM dont **validation syntaxique du Worker généré**, ingestion des spans serveur OTel standard, corrélation front↔back). Suite : **131 unitaires** verts, aucune régression (parser additif).

## v0.5 — 2026-06-11 (sprint jour 2, onboarding clients self-service)

Périmètre : page « Clients » dans la console — un agent MIP ajoute un client sans SQL ni redéploiement. Contrat : `apps/ingest/sql/migration-v05.sql` (`app_registry.allowed_origins/created_by/notes`).

### Onboarding self-service (/admin/customers)
- **Création guidée d'une app cliente** : formulaire admin (nom, app_id, client, domaines, notes) → clé d'API générée serveur (`mip_<32hex>`), stockée hashée sha256, **affichée une seule fois** (stash mémoire, même mécanique que les mots de passe utilisateurs), action auditée.
- **CORS dynamique** : les origines autorisées passent du code (const en dur) à la base — edge functions v1-traces **v5** + v1-replay v2 + dev-server unissent socle statique ∪ `app_registry.allowed_origins` (cache 60 s). Ajouter/modifier un domaine client = effectif en ≤ 60 s, zéro redéploiement.
- **Wizard d'intégration 5 étapes** (`/admin/customers/[appId]`) : config (origines à chaud, rotation de clé) → snippet front généré avec les vraies valeurs (variante consentement RGPD, notes CSP, placement par stack) → middleware backend téléchargeable (FastAPI prouvé en prod + **Express/Connect nouveau, zéro dépendance, testé** + protocole générique) → **checklist live** (premières vitals, sessions 24 h, spans front, spans back — auto-refresh 5 s) → compte viewer scopé prérempli (`/admin/users?app=`).
- **Assistant IA d'intégration** (env-gated `MISTRAL_API_KEY` — souverain, prioritaire — ou `ANTHROPIC_API_KEY` ; admin only, rate-limité) : génère le middleware pour une stack non couverte ou diagnostique « rien n'arrive » — system prompt nourri du protocole et des pièges vécus (pydantic-settings, proxy, CSP, head). Sans clé : encart désactivé, le wizard déterministe reste le chemin nominal.
- Tests : 115 unitaires (+12 : validations, statut, snippet, **middleware Express réel** contre le parser) + 10 E2E (+2 : création → clé one-shot → ingestion au nom du client → checklist verte ; lien viewer prérempli). Spec à compte admin dédié (couvre la course seed-admin constatée).

## v0.4 — 2026-06-11 (sprint jour, tracing distribué)

Périmètre : tracing front→back (décision Julian : ClickHouse prod abandonné — zéro budget, PG suffit au MVP). Contrat : `apps/ingest/sql/migration-v04.sql` (`rum_span`, vue `v_trace`, purge 30 j étendue).

### Tracing distribué (front→back par trace_id)
- SDK 0.4.0 : fetch **et** XMLHttpRequest instrumentés (axios = XHR) — `traceparent` W3C + `tracestate: mip=s:<session>` sur les appels same-origin (+ allowlist `trace`), span `http.client` (méthode, url scrubbée, statut, durée). Endpoints d'ingestion exclus, cap 100/page, cœur 25,5 KB gzip (+0,8).
- Middleware FastAPI `integrations/fastapi/mip_rum_middleware.py` : **1 fichier stdlib, zéro dépendance**, passthrough sans env vars, span `http.server` (route template, statut, durée serveur), batch 5 s / 20 spans best effort. Posé sur uti-platform (PR #37 mergée).
- Ingestion : spans `http.client`/`http.server` → `rum_span` (tier front/back, session nullable côté back), corrélation par `trace_id` (vue `v_trace`, `network_ms` = total − serveur).
- Console : page **/tracing** (couverture de corrélation, appels API navigateur avec part serveur, routes backend p75/p95/5xx, traces les plus lentes → session) + appels API dans la timeline session (`200 · serveur 211 ms`).
- Tests : 103 unitaires (+12) + 8 E2E (+2, dont bout-en-bout réel fetch/XHR→FastAPI→base→console) + 6 unittest python (CI : job dédié).

### En prod
- Edge function v1-traces **v4**, migration appliquée, console déployée, SDK v0.4 servi à G-IT. Span front réel constaté depuis plateforme.groupement-it.com (`POST /api/auth/login`, 272 ms, trace propagée à travers le proxy Vercel). Incident : 3 min d'ingestion down au 1er déploiement edge (placeholder), réparé via CLI — détail BUILD_LOG.

## v0.3 — 2026-06-11 (sprint nuit 2, livré et déployé)

Périmètre : [ROADMAP_V03.md](ROADMAP_V03.md). Contrat de données verrouillé avant build (`apps/ingest/sql/migration-v03.sql` : `replay_chunk`, `console_user`, `audit_log`, `alert_delivery`, `rate_counter` + `rate_check()`, vue `v_anomaly`, `check_alerts()` v2 avec garde pg_net). Dépendances épinglées : rrweb 2.0.1, rrweb-player 2.0.1, bcryptjs 3.0.3, jose 6.2.3.

### Alerting sortant, géo, rate limit durable (B1)
- Webhooks d'alerte : `net.http_post` (pg_net, cloud) + dispatcher node local, payload JSON générique compatible Slack, traçabilité par ligne `alert_delivery`.
- Géolocalisation **par timezone** : attribut `mip.tz` côté SDK → mapping tz→pays à l'ingestion → `rum_session.geo_country`. Granularité pays, zéro adresse IP stockée.
- Rate limit durable : compteur SQL partagé entre isolats edge (`rate_check()`), fallback mémoire.

### Session replay (B2)
- Module SDK **séparé lazy-chargé** `mip-rum-replay.js` (rrweb) : opt-in par app (`replay_sample_rate`), masquage des saisies par défaut, respect du consent, chunks gzip (CompressionStream) vers `POST /v1/replay`, caps 2 min / 1 Mo par session. Le bundle cœur reste inchangé (23,8 KB gzip ≤ budget 35 KB).
- Console : player rrweb dans la vue session (onglet Replay), chunks servis par une route API authentifiée.

### RBAC console (B3)
- Login email + mot de passe (bcryptjs, JWT cookie httpOnly signé) en remplacement du basic auth ; rôles **admin** / **viewer** (scopé à une liste d'apps) ; gestion des utilisateurs (admin) ; `audit_log` des actions sensibles. `/mip-rum*.js` et `/v1/*` restent publics.

### ClickHouse (B4)
- Chemin prod prouvé en local : docker-compose officiel, schéma MergeTree, writer dans le dev-server derrière `STORE=clickhouse|both`, bench 100 k events avec comparaison des p75 PG vs CH — chiffres dans `infra/clickhouse.notes.md`.

### Produit & vente (B5)
- **Health score** par app en Overview, formule documentée 0-100 (`apps/console/lib/health.ts`) : 40 % vitals (part de mesures « good », LCP pondéré x2), 30 % erreurs (1 − erreurs/pages vues, plancher 0), 20 % stabilité (sessions sans erreur), 10 % anomalies (−2,5 pts par ligne `v_anomaly` 24 h). Libellés Excellent ≥ 90 / Bon ≥ 75 / Dégradé ≥ 50 / Critique < 50 ; composante sans donnée exclue avec renormalisation. Vérifié à la main sur l'échantillon local (SQL et rendu pris dos à dos) : global 181/207 mesures good pondérées + 28 err/86 pv + 15/40 sessions saines + 0 anomalie → 35,0 + 20,2 + 7,5 + 10 = 72,7 → **73 « Dégradé »**, identique au rendu console ; filtré `app=demo-app` : 181/191 + 27/83 + 12/36 + 0 → 74,8 → **75 « Bon »** (borne du libellé exercée), identique aussi.
- Badge « N anomalie(s) détectée(s) » + tableau des anomalies LCP 24 h (z-score, ancre `#anomalies`) ; respecte les filtres app/période (anomalies = 24 h fixes).
- Docs vente : [docs/OFFRE.md](docs/OFFRE.md) (comparatif marché honnête — le différenciateur est le créneau OTel/souverain/corrélation, pas la parité fonctionnelle ; pricing 3 paliers indicatif à valider MIP) et [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) (démo 10 min, plan B hors-ligne, objections/réponses).
- [docs/LIMITES.md](docs/LIMITES.md) : section v0.3 — résolu cette nuit vs vraies barrières enterprise restantes (mobile natif, mapping auto route↔mesure, ML, multi-région, certifications, support 24/7).

## v0.2 — 2026-06-11 (sprint nuit, livré)

Périmètre : [ROADMAP_V02.md](ROADMAP_V02.md). Contrat de données verrouillé avant build (`apps/ingest/sql/migration-v02.sql`). Traite les limites n° 1-4, 7-11, 14-18, 23, 24-25 de [docs/LIMITES.md](docs/LIMITES.md). Statut par chantier dans le rapport du matin (`RAPPORT_NUIT.md`).

### SDK (A1)
- Resource timings (ressources lentes, seuil `slowResourceMs` 300 ms, cap 20/page), long tasks (cap 30/page), breadcrumbs clics/navigations/erreurs (cap 50/page).
- Consent mode RGPD : `requireConsent` + `MIPRum.consent()` — zéro requête tant que non consenti.
- File de retry `localStorage` : un export raté est rejoué au prochain chargement.
- `apiKey` (attribut resource `mip.api_key`) ; `track()` désormais **persisté** (table `rum_event`).
- Bundle v0.2 mesuré : **23,8 KB gzip** (71,5 KB raw) — +1,5 KB pour 6 features, budget ≤ 35 KB largement tenu.

### Ingestion (A2)
- Migration v0.2 idempotente : tables `rum_resource`, `rum_longtask`, `rum_breadcrumb`, `rum_event`, `app_registry`, `alert_rule`, `alert_event` ; colonne `rum_error.fingerprint` ; vues `v_error_group` et `v_blind_spot`.
- Parser étendu (nouveaux spans), fingerprint d'erreurs (fnv1a sur type + message normalisé + 1er frame), inserts batch multi-lignes.
- Clé d'API vérifiée par sha256 contre `app_registry` ; enforcement opt-in via `REQUIRE_API_KEY` (défaut `false` — le snippet G-IT en prod continue de fonctionner sans modification).
- Rate limit 600 req/min/app. Parité dev-server Node ↔ edge function Deno.

### Console (A3 + A4)
- Sélecteurs globaux app / période (1 h / 24 h / 7 j) / device ; Overview avec tendances vs période précédente ; ressources lentes par route.
- Vue **session détaillée** : timeline pageviews + vitals + erreurs + breadcrumbs + long tasks.
- Erreurs **groupées par fingerprint** (occurrences, sessions touchées, sparkline, stack).
- Page `/alerts` : CRUD des règles, flux d'événements, acquittement.
- Corrélation v2 : série historisée robot vs réel + section « angles morts » (robot ok / réel poor).
- Basic auth (le SDK `/mip-rum.js` reste public), branding MIP, dogfooding (console auto-instrumentée, app `mip-rum-console`).

### Alerting & rétention
- Fonction SQL `check_alerts()` (fenêtre glissante, anti-spam tant qu'un événement non acquitté existe) ; planification pg_cron + webhook pg_net côté cloud.
- Rétention : purge quotidienne > 30 jours (pg_cron, cloud).

### CI & docs (A5)
- GitHub Actions : build SDK + vitest, puis E2E Playwright sur service `postgres:15` (schéma + migration appliqués, seed synthétique, Chromium).
- README produit, guide d'intégration client ([docs/INTEGRATION.md](docs/INTEGRATION.md)), ce CHANGELOG.

## v0.1 — 2026-06-10 (POC, déployé en production)

POC complet construit en une journée, déployé en cloud **et en production** sur `plateforme.groupement-it.com` (PR [uti-platform#36](https://github.com/jt33120/uti-platform/pull/36)), DoD 1-4 vérifiés en live.

### SDK Web (`packages/rum-sdk`)
- **22,3 KB gzip** (67,6 KB raw), OTel lean (`sdk-trace-web` sans instrumentation contrib) + web-vitals 5.3 attribution.
- 5 Core Web Vitals (LCP/INP/CLS/FCP/TTFB) avec **seuils 2026** (LCP < 2,0 s / INP < 200 ms / CLS < 0,1), erreurs JS (`error` + `unhandledrejection`), pageviews SPA (patch History API, routes normalisées `/partners/:id`), sessions anonymisées (`user_hash`, TTL 30 min, `localStorage`).
- **OTLP/HTTP JSON standard sur le fil** (`POST /v1/traces`) — vérifiable, backend remplaçable. Flush forcé au passage en arrière-plan (les INP/CLS finals partent avant l'unload). Hook `beforeSend`, `sampleRate`, `track()` (émis, non persisté en v0.1).

### Ingestion (`apps/ingest`)
- Parser OTLP **partagé** (`_shared/otlp.mjs`) entre edge function Deno (prod) et dev-server Node (local/CI) — une seule source de vérité, unit-testable.
- Rating recalculé à l'ingestion (défense en profondeur), scrub PII (query strings retirées, messages/stacks tronqués), idempotence par `span_id` unique, CORS en liste blanche stricte (préflight 204).
- Schéma Postgres : `rum_session`, `rum_pageview`, `rum_metric`, `rum_error`, `syn_snapshot`, RPC `upsert_rum_session`, vue `v_correlation` (agrégation de chaque côté **avant** le full outer join).

### Console RUM Live (`apps/console`)
- Next.js 15 + Recharts : Overview (p75 + ratings), Pages lentes, Erreurs JS, Sessions, **Corrélation** robot vs réel par route avec écart surligné. p75 en SQL (`percentile_cont`), rafraîchissement 5 s.

### Corrélation synthétique↔RUM (`apps/sync-synthetic`)
- Interface `SyntheticSource` (adapter) : `seed` (runs réalistes 24 h, PRNG déterministe) et `mippoc-json` (format réel constaté sur le MCP mippoc, `latency_ms = first_load_time`). La vraie API DEM se branche en implémentant `fetchSnapshots()`.

### Déploiement & preuve en prod
- Supabase `mip-rum-poc` (eu-west-3 **Paris**, free tier) + edge function `v1-traces` (`--no-verify-jwt`) ; console sur Vercel (`mip-rum-console.vercel.app`, sert aussi le SDK).
- Sécurité : RLS sans policy publique, rôle lecture seule `console_ro`, TLS vérifié (CA Supabase épinglée), secrets jamais en argv.
- **Chiffre clé en live** : `/login` — robot 1,14 s (« ok », score 96) vs LCP p75 réel 4,04 s (« poor ») → **écart +254 %**, le synthétique seul ne le voyait pas.

### Qualité
- 36 tests unitaires (vitest) + 5 E2E (Playwright, Chromium headless) verts ; charge légère : 1 000 events insérés en 0,3 s (~4 000 events/s) en local.
- Limites connues documentées dans [docs/LIMITES.md](docs/LIMITES.md) ; chemin de migration prod (Collector OTel + ClickHouse) dans `infra/`.
