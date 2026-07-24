# MIP RUM — Revue produit A→Z (méthode BMAD) & readiness commercialisation

> Revue inspirée de **BMAD** (Analyst → PM/PRD → Architecte → PO/SM/épics-stories),
> ancrée sur un audit factuel du code (4 axes : packaging/intégration, maturité
> front, robustesse/sécurité, architecture data/scale). Objectif : corriger,
> durcir, et faire évoluer MIP RUM vers un produit **robuste, fini, à l'UI
> intelligente, prêt à commercialiser ou intégrer** dans des SaaS existants.

---

## 0. Résumé exécutif (Analyst)

**Reframe de la thèse.** « Le front est une démo, le back est dockerisé et
intégrable » est **partiellement vrai et sous-estime le front** :

- **Le front console N'EST PAS une démo** : ~44 pages Next.js 15 / React 19,
  auth JWT + SSO OIDC/PKCE, RBAC app-scopé sur 3 couches, onboarding self-serve,
  et une **couche IA anti-hallucination réelle** (citations vérifiées serveur,
  fallback déterministe). C'est un **produit console quasi-production**, mono-marque
  et à isolation multi-tenant « souple ».
- **Le back EST intégrable et self-hostable dans le principe** (parseur OTLP pur JS
  qui tourne en Deno **et** en Node, reads sur `pg` standard, `Dockerfile.ingest` +
  compose, off-ramp ClickHouse conçu), **mais pas encore turnkey** : l'image Docker
  **n'a jamais été buildée**, la console n'est pas conteneurisée, 2 edge functions
  n'ont pas de jumeau Node, rien n'est publié (npm/PyPI), et le ClickHouse n'est
  pas câblé.

**Verdict global de readiness : ~65–70 % d'un produit commercialisable.**
L'ingénierie est **nettement au-dessus du POC** (563 tests, CI complète, RLS +
search_path durcis, scrub PII, secrets fail-closed, dogfooding). Les blocages ne
sont pas de la « dette pourrie » mais des **défauts de posture et de couverture
sur les chemins qui font vendre** : intégrité d'ingestion, isolation dure,
packaging OEM, scale prouvé, et l'identité légale/DPA.

**Deux produits, une base.** La bonne lecture commerciale :
1. **« MIP Engine »** — moteur d'observabilité **OTel-natif, souverain,
   self-hostable / OEM** (ingestion + stockage + read-API + SDKs). *C'est le cœur
   vendable / intégrable.*
2. **« MIP Console »** — UI de supervision **intelligente**, vitrine + option
   white-label/SaaS. *C'est le différenciateur et la démo qui vend le moteur.*

---

## 1. État des lieux — scorecard de maturité (Analyst)

| Pilier | Verdict | Base factuelle |
|---|---|---|
| **Console / Front** | 🟢 Quasi-prod | JWT/OIDC, RBAC app-scopé, ~44 pages cohérentes, design system, empty states 39/44 |
| **UI intelligente** | 🟢 Prod (remarquable) | Assistant LLM souverain (Mistral→Anthropic) avec citations **vérifiées serveur** ; briefing déterministe + LLM ; anomalies z-score ; health score composite |
| **Ingestion (moteur)** | 🟢 Solide | OTLP/HTTP JSON standard, parseur pur JS (Deno+Node), clock-skew guard, scrub PII, idempotence `span_id` |
| **Read-API** | 🟢 Solide | `/rum/summary` (token DB révocable) + `/api/v1/*` (14 routes, OpenAPI, ETag, rate-limit) |
| **SDKs / agents** | 🟡 Mixte | Web SDK v0.4.3 **haut** (prod) ; agent-node v0.1 + FastAPI **moyen** ; RN v0.1 **bas** ; **aucun publié** |
| **Packaging / OEM** | 🟠 Beta | `Dockerfile.ingest`+compose écrits **mais jamais buildés** ; console non conteneurisée ; edge `v1-replay`/`uptime` sans jumeau Node |
| **Sécurité / intégrité** | 🟠 À durcir | Ingestion **fail-open/spoofable par défaut** ; rate-limit best-effort ; isolation multi-tenant **applicative, pas RLS** |
| **Data / scale** | 🟡 Plafond POC | Postgres seul, **~1–10 M events/j** ; ClickHouse **conçu+benché mais non câblé** ; `/rum/summary` scanne le brut, sans cache ni rollups |
| **Rétention / RGPD** | 🟢 Solide | Purge par tenant (pg_cron), DSAR Art.17 (`erase_app_data`/`erase_session`), zéro IP, replay TTL 30 j |
| **Tests / CI** | 🟢 Solide | 563 tests unitaires + 4 e2e Playwright + migrations en ordre sur Postgres réel |
| **Commercial / légal** | 🔴 Bloquant | Identité légale/DPO/SIREN en **placeholders** ; pas de billing/plans/signup |

Légende : 🟢 prêt · 🟡 à compléter · 🟠 à durcir (chantier) · 🔴 bloquant.

---

## 2. Vision produit (PM — PRD condensé)

### 2.1 Positionnement
**Moteur RUM/observabilité OTel-natif, souverain (UE, zéro IP), self-hostable et
intégrable** — avec une **console intelligente** en option. Se distingue de
Datadog/Sentry/Grafana par : **souveraineté** (self-host, données UE), **OTel
natif** (pas de lock-in agent), et une **UI IA fiable** (citations vérifiées).

### 2.2 Segments & modes de livraison
1. **OEM / embarqué dans un SaaS existant** (cas UTI/`gip-plateforme`) : le SaaS
   client émet du RUM/OTel vers le moteur et lit `/rum/summary` (façade). *Le plus
   proche du prêt.*
2. **Self-host souverain** (grand compte / secteur public UE) : `docker compose up`
   du moteur + console, données chez le client.
3. **SaaS multi-tenant** (à terme) : signup, org, billing — le plus loin.
4. **White-label** de la console (revendeurs/agences) : thème par tenant + embed.

### 2.3 Exigences (extrait)
**Fonctionnelles (FR)** : ingestion OTLP multi-signaux (traces/vitals/erreurs/logs/
replay/spans DB) ; read-API scopée par token ; console supervision + alerting +
SLO + uptime ; onboarding self-serve ; UI IA (assistant, briefing, anomalies).
**Non-fonctionnelles (NFR) — les manques prioritaires** :
- **NFR-Sécurité** : ingestion authentifiée par défaut (anti-spoof/anti-poisoning) ;
  isolation multi-tenant **garantie par RLS** ; rate-limit durable.
- **NFR-Scale** : soutenir ≥ 10⁷–10⁸ events/j (dialecte ClickHouse) ; reads sur
  rollups + cache court.
- **NFR-Packaging** : image Docker **buildée & prouvée** ; SDKs **publiés** ;
  console conteneurisable.
- **NFR-Conformité** : DPA/identité légale réelles.

### 2.4 UI intelligente — cap
La base est excellente (citations vérifiées, briefing déterministe). Évolutions :
détection d'incident proactive (« ce déploiement a dégradé LCP p75 de X % »),
explications root-cause reliées au waterfall front→serveur→DB, recommandations
priorisées, et un **mode assistant conversationnel scopé tenant** exposable en OEM.

---

## 3. Revue d'architecture & corrections (Architecte)

### 3.1 Architecture actuelle
`SDK/Collector → OTLP/HTTP JSON → edge (Deno) / dev-server (Node) → flattenOtlp →
Postgres → console_ro (pg) → Next.js (read-API + console)`. Ops via pg_cron/pg_net
(purge, alertes, uptime, metering) avec fallbacks CLI Node.

### 3.2 Architecture cible (productisation)
- **Découpler de Supabase/Vercel/Deno** : promouvoir `dev-server.mjs` (Node) au rang
  de runtime d'ingestion de 1re classe ; porter `v1-replay`/`uptime`/`v1-logs` en
  Node ; sortir purge/alertes/uptime de pg_cron/pg_net vers un **sidecar planifié**.
- **Abstraire le stockage** : implémenter `lib/dialect.ts` (`DB_DIALECT=postgres|
  clickhouse`) et **câbler + tester** le schéma ClickHouse (aujourd'hui non exécuté
  en CI) pour le palier « milliards d'events ».
- **Reads sur rollups + cache** : `/rum/summary` doit lire `rum_rollup_hourly`
  (aujourd'hui `RUM_USE_ROLLUPS` off par défaut) et gagner un cache court (SWR/edge)
  ; agrandir le pool `console_ro` (max:5 → 20) + PgBouncer.
- **Intégrité d'ingestion** : `REQUIRE_API_KEY=true` par défaut pour tout tenant
  payant, valider `app_id` contre le registre, supprimer les apps « keyless »,
  rate-limit durable.
- **Isolation par RLS** : passer le rôle console d'« owner » à restreint + policies
  sur une GUC `app.current_app_id` (backstop si un `WHERE app_id=` manque).

### 3.3 Corrections — regroupées par nature
**🔴 Bloquants commercialisation**
- **B1** Ingestion fail-open/spoofable par défaut (data-poisoning). *(HIGH-1)*
- **B2** Identité légale/DPA en placeholders. *(LOW-8)*
- **B3** Image Docker jamais buildée/prouvée (crédibilité OEM). *(packaging)*

**🟠 Durcissement (avant tout tenant payant)**
- **D1** Isolation multi-tenant par RLS (aujourd'hui applicative). *(MEDIUM-4)*
- **D2** Rate-limit durable (ingestion + read-API, aujourd'hui best-effort/in-memory). *(HIGH-2)*
- **D3** Unifier l'auth `v1-logs` sur `_shared/auth.mjs` (divergence réintroduite). *(MEDIUM-3)*
- **D4** Test d'intégration du contrat `/rum/summary` (401/403/429 + forme) — absent. *(MEDIUM-5)*
- **D5** Scale reads : rollups + cache + pool + `session_id` index sur `rum_error`. *(data #1,#2,#7)*
- **D6** Load-test réel en CI (capacité cloud inconnue). *(MEDIUM-6)*

**🟢 Stratégique (faire évoluer)**
- **S1** Packaging OEM : dockeriser la console (`output:standalone`), porter les
  edge restantes en Node, **publier** les SDKs (npm/PyPI), unifier le versioning.
- **S2** ClickHouse câblé (`dialect.ts`) pour le palier scale.
- **S3** SaaS multi-tenant : couche `org`, signup, billing (metering déjà là,
  **enforcement quota à activer**).
- **S4** White-label : brand par tenant (les tokens CSS-var existent déjà) + embed
  (layout réduit + `frame-ancestors` + auth par read-token).
- **S5** UI intelligente v2 (incident proactif, root-cause, reco).

**⚪ Hygiène / dette faible**
- Nettoyer les résidus post-split `rum_ai` **au moment d'appliquer v44** :
  `lib/dsar.ts` liste encore `rum_ai` (DSAR **cassera** après le DROP), types morts
  dans `queries-summary.ts`, commentaires périmés `lib/xsom-ai.ts`. *(LOW-7 — pas un
  bug tant que v44 n'est pas appliquée, mais à faire dans la même PR que v44.)*
- `uptime_result` sans purge (croissance non bornée) ; `@ts-nocheck` sur les 4 edge
  functions ; erreurs de livraison d'alerte avalées en silence.

---

## 4. Roadmap en épics (PO / SM) — stories & séquencement

> Séquencement conseillé : **E1 → E2 → E3** débloquent la vente OEM/self-host ;
> **E4/E5/E6** ouvrent le SaaS/white-label ; **E7** est continu.

### E1 — Sécurité & intégrité (débloque tout tenant payant) · *~1 sprint*
- E1-S1 : `REQUIRE_API_KEY=true` par défaut + validation `app_id` vs registre +
  fin des apps keyless ; garder un mode POC explicite. **QA** : test « app inconnue
  → 403 », « clé absente → 403 ».
- E1-S2 : rate-limit durable (ingestion + read-API) sur store partagé (PG/Redis).
- E1-S3 : RLS multi-tenant (rôle restreint + GUC `app.current_app_id` + policies).
  **QA** : pentest « un token tenant A ne lit jamais B » même sans `WHERE app_id=`.
- E1-S4 : unifier `v1-logs` sur `_shared/auth.mjs` (+ redeploy edge).
- E1-S5 : test d'intégration `/rum/summary` (401/403/429/forme `ai_status`).

### E2 — Packaging OEM (crédibilité « dockerisé/intégrable ») · *~1 sprint*
- E2-S1 : **builder & prouver** `docker compose up --build` (ingest+DB), publier un
  smoke-test CI Docker. *(lève B3)*
- E2-S2 : dockeriser la console (`output:standalone` + multi-stage pnpm).
- E2-S3 : porter `v1-replay`, `uptime` (et achever `v1-logs`) en jumeaux Node ;
  sidecar planifié pour purge/alertes/uptime hors pg_cron.
- E2-S4 : **publier** `@mip/rum-sdk`, `@mip/agent-node`, `@mip/rum-mobile` (npm) et
  la middleware FastAPI (PyPI) ; unifier le versioning (changesets).
- E2-S5 : documenter le chemin **OTel standard** (attribut `mip.app_id` via
  Collector) comme intégration de 1re classe.

### E3 — Scale prouvé · *~1–2 sprints*
- E3-S1 : `lib/dialect.ts` + `DB_DIALECT`, câbler + **tester** ClickHouse en CI.
- E3-S2 : reads sur `rum_rollup_hourly` (activer par défaut) + pré-agg quantile
  (tdigest/CH) + cache court sur `/rum/summary` ; pool `console_ro`↑ + PgBouncer.
- E3-S3 : batcher les upserts de sessions (supprimer le 2×N RPC/req) + envisager `COPY`.
- E3-S4 : **load-test** en CI (soak/spike) avec un seuil de capacité documenté.

### E4 — SaaS multi-tenant · *~2 sprints*
- E4-S1 : entité `org`/`tenant` au-dessus d'`app_id` + rôles org-admin/app-viewer.
- E4-S2 : signup self-serve + vérif e-mail + provisioning JIT.
- E4-S3 : billing (plans, Stripe) + **activer l'enforcement quota** (metering déjà là).

### E5 — White-label & embed · *~1 sprint*
- E5-S1 : brand par tenant (`display_name/logo_url/accent_hex/locale` dans
  `app_registry`, injectés en CSS-var) ; dé-hardcoder `#f89101`/`#003399`.
- E5-S2 : surface **embed** (layout réduit + `frame-ancestors` par tenant + auth
  read-token) ; widgetiser un dashboard.

### E6 — Commercial & légal · *continu, mais B2 bloquant*
- E6-S1 : remplir identité légale/DPO/SIREN, faire relire le DPA (**bloquant vente**).
- E6-S2 : pricing/plans, page tarifs, e-mail d'alerte (canal payant).

### E7 — UI intelligente v2 · *continu*
- Incident proactif (corréler `deploy_marker` ↔ dégradation), root-cause reliée au
  waterfall front→serveur→DB (déjà instrumenté), recommandations priorisées,
  assistant conversationnel scopé tenant exposable en OEM.

---

## 5. Quick wins (< 1 jour chacun, sûrs)
1. **Pool `console_ro` 5 → 20** (`apps/console/lib/db.ts`) — supprime la saturation
   sous multi-onglets. *(effet immédiat, risque nul)*
2. **`session_id` index sur `rum_error`** (migration) — tue le join asymétrique.
3. **Purge `uptime_result`** (l'ajouter aux fonctions de purge) — borne la croissance.
4. **Nettoyer les commentaires périmés `lib/xsom-ai.ts`** (« retombe sur rum_ai »).
5. **Cache court (`s-maxage`) sur `/rum/summary`** en lecture — allège Postgres.
6. **Défaut `RUM_USE_ROLLUPS=1`** là où c'est déjà supporté (`queries-grid`).

## 6. Recommandation de séquencement & décision
- **Pour vendre en OEM/self-host vite** (cas UTI et similaires) : **E1 + E2 + E6-S1**
  suffisent à passer de « beta crédible » à « produit livrable » (~2–3 sprints).
- **Pour un SaaS multi-tenant** : ajouter **E3 (scale) + E4 (org/billing) + D1 (RLS)**.
- **Différenciation** : **E7 (UI intelligente)** est déjà en avance — capitaliser dessus
  dans le pitch, c'est le point le plus fort face aux acteurs établis.

*Décision suggérée : démarrer par **E1 (sécurité/intégrité)** — c'est le premier
réflexe d'un acheteur enterprise (pentest ingestion + isolation), et ça débloque
tout tenant payant. Les quick wins §5 peuvent partir en parallèle immédiatement.*
