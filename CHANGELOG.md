# CHANGELOG — MIP RUM

Historique des versions. Détail factuel (valeurs mesurées, pièges, décisions) dans [BUILD_LOG.md](BUILD_LOG.md).

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
