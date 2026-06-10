# BUILD_LOG — POC MIP RUM

Journal factuel du build, étape par étape. Matière du bilan client (PLAN §15).

Environnement de build : macOS (Darwin 25.1.0), Node v26.0.0, pnpm 9.15.9, Docker 29.2.1, supabase CLI 2.67.1, vercel CLI 41.4.1. Pas de deno ni psql en local → Postgres via Docker, serveur d'ingestion dev en Node (la fonction Deno partage le même parser, cf. S2).

---

## S0 — Scaffolding

- **Ce qui a marché** : monorepo pnpm workspaces créé (rum-sdk / ingest / sync-synthetic / console), arbo conforme PLAN §4.1, PLAN.md copié, git initialisé.
- **Décisions** :
  - Secrets cloud (SUPABASE_ACCESS_TOKEN / VERCEL_TOKEN) absents de l'env → build 100 % local S0→S5, S6 préparé via DEPLOY.md (conforme au protocole).
  - Postgres local via docker-compose (plus léger que `supabase start` qui tire ~10 images) ; le schéma est appliqué par migration au démarrage du conteneur.
- **Écarts** : néant à ce stade.

## S1 — SDK « Hello Web Vital »

- **Ce qui a marché** : LCP réel capté (web-vitals attribution) → span OTLP `webvital.LCP` → exporté en OTLP/HTTP JSON vers l'endpoint local (:4318). Validation automatisée en headless Chromium (Playwright) : 1 POST `/v1/traces`, payload conforme à la spec OTLP (resourceSpans/scopeSpans/spans, attributs KeyValue typés).
- **Valeurs réelles** : bundle S1 = **19,2 KB gzip** (58,5 KB raw) — déjà sous la cible ≤ 30 KB. LCP mesuré en headless : 292 ms (rating `good`).
- **Décisions** :
  - Versions épinglées exactes : OTel api 1.9.1 / sdk-trace-web 2.7.1 / exporter-trace-otlp-http 0.218.0 / web-vitals 5.3.0 (majeure 5 conforme au PLAN, 5.2→5.3 entre temps) / esbuild 0.28.0. Lockfile committé.
  - Setup lean : `StackContextManager`, **aucune instrumentation contrib** (document-load/fetch/user-interaction) — les vitals/erreurs/pageviews sont des spans dédiés fabriqués à la main ; rien d'autre n'est persisté en base de toute façon. Gain de bundle significatif vs ~60 KB du full auto-instrumentation.
  - Rating calculé côté SDK avec les **seuils 2026** (LCP<2,0s / INP<200ms / CLS<0,1) — web-vitals embarque encore les anciens seuils (LCP good <2,5s), on ne s'en sert pas.
- **Piège constaté** (utile pour S2) : l'exporter OTLP JSON encode `webvital.value` en `intValue` quand la valeur est entière, `doubleValue` sinon → le parser d'ingestion doit déstructurer les deux (confirme l'avertissement PLAN §7.2).

## S2 — Ingestion + stockage

- **Ce qui a marché** : Postgres 15 (docker-compose, port 5433) avec schéma auto-appliqué par migration ; dev-server Node parse l'OTLP JSON et écrit en base (transaction, idempotence par `span_id` unique) ; flux complet démo headless → `rum_metric` (LCP 112 ms, rating good) + `rum_session` upsertée. Préflight CORS : `OPTIONS → 204` + `Access-Control-Allow-Origin`/`-Headers` corrects, origine G-IT déjà whitelistée.
- **Ce qui n'a pas marché** : 1er `docker pull postgres:15` interrompu (coupure réseau, « unexpected EOF ») — résolu au retry. Pas de `supabase start` : stack locale Docker jugée trop lourde (~10 images) vs un simple postgres:15.
- **Décisions** :
  - **Parser OTLP partagé** en JS pur (`apps/ingest/supabase/functions/_shared/otlp.mjs`) : importé tel quel par le dev-server Node (local) et l'edge function Deno (prod, S6). Une seule source de vérité, zéro build, unit-testable.
  - Schéma PLAN §5 **complété** : `app_id`/`route` dénormalisés sur `rum_metric`/`rum_error` (référencés par la vue corrélation mais absents de l'extrait du plan), `span_id unique` partout (idempotence §7.2), RPC `upsert_rum_session` (incrément `page_count` côté SQL, utilisable par supabase-js).
  - **Rating calculé à l'ingestion** (seuils 2026) = source de vérité unique en base ; le rating envoyé par le SDK n'est pas utilisé (défense en profondeur, vérifiable).
  - Scrub PII à l'ingestion : query strings retirées des URLs/sources, messages tronqués à 1000 c., stacks à 4000 c. (PLAN §14).
- **Écarts** : l'edge function Deno est écrite mais **non testée localement** (pas de runtime deno sur la machine) — le parser, lui, est testé via le dev-server Node qui partage le même module. Risque résiduel limité au câblage supabase-js, à vérifier à S6.
