# CHANGELOG — MIP RUM

Historique des versions. Détail factuel (valeurs mesurées, pièges, décisions) dans [BUILD_LOG.md](BUILD_LOG.md).

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
