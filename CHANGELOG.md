# CHANGELOG — MIP RUM

Historique des versions. Détail factuel (valeurs mesurées, pièges, décisions) dans [BUILD_LOG.md](BUILD_LOG.md).

## v0.2 — EN COURS (sprint nuit 10→11/06/2026)

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
