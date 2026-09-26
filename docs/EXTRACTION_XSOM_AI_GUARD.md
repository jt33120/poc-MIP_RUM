# Extraction de la supervision IA vers `xsom-ai-guard`

> **Document historique — spécification du 20/07/2026, relue le 26/09/2026.** Il décrit la supervision
> IA telle qu'elle existait dans `mip-rum` **avant** son extraction, et la solution proposée pour
> l'extraire. L'extraction est faite : la décision est l'[ADR-0001](ADR-0001-supervision-ia-xsom.md) ;
> la page `/ai`, les routes `/api/v1/ai*`, le cron OpenRouter et les bibliothèques IA ont quitté la
> console le 21/07/2026 (commits `f14d97c0`, `c24ba5e4`, `4a5407c7`), et `/api/rum/summary` lit la
> partie IA chez xSOM par une façade (`apps/console/lib/xsom-ai.ts`, PR #129). Les fichiers cités plus
> bas (`supabase/functions/…`, `app/api/v1/ai/route.ts`, `lib/openrouter.ts`…) n'existent plus, et
> « aujourd'hui » y veut dire le 20/07/2026. À archiver sous `docs/archive/SCISSION_XSOM_AI_GUARD.md`
> quand les documents qui le citent (`docs/API_CONSOLE.md`, `docs/context/`) auront suivi.

> **But du document.** Décrire de façon exhaustive le stack technique et le backend
> de la **supervision IA d'API** tels qu'ils existent aujourd'hui dans `mip-rum`,
> puis donner la **solution technique d'implémentation** pour :
> 1. **cloner** cette supervision IA dans le repo `xsom-ai-guard` (sens « sortie ») ;
> 2. **remplacer ici** le code local par de simples **appels API** vers `xsom-ai-guard`
>    (sens « retour »), pour supprimer la redondance.
>
> Toutes les définitions (DDL, types, requêtes) sont données **verbatim** parce que
> l'objectif est un clonage fidèle, pas une reformulation.

---

## 0. TL;DR

- La « supervision IA » = **surveiller les appels LLM du backend d'un client** (coût,
  tokens, latence, TTFT, taux d'erreur/refus, anomalie de coût z-score, budget, qualité
  perçue). Elle est **backend-native** : les données arrivent d'un backend externe (celui
  d'UTI), pas du front.
- Elle repose sur **une seule table dédiée `rum_ai`** (1 ligne = 1 appel LLM), une vue
  d'anomalie `v_ai_op_anomaly`, une table de budget crédits `openrouter_balance`, un cache
  `ai_briefing`, et **réutilise** le squelette d'alerting générique (`alert_rule`,
  `alert_event`, `route_alert()`…).
- **Point structurant pour la découpe** : l'IA est produite par un **exportateur backend
  séparé** du RUM front. Les deux flux sont déjà indépendants côté producteur → **la couture
  d'ingestion est naturelle** (il « suffit » de repointer l'exportateur backend d'UTI vers
  `xsom-ai-guard`).
- **Points durs** (couplages) : les signaux qualité (👎/régénération/CSAT) transitent par
  la table **partagée `rum_event`** (émise par le front), l'attribution coût/utilisateur
  s'appuie sur `rum_session.user_hash`, et le read-API `/api/rum/summary` renvoie **RUM+IA
  fusionnés** dans un seul payload. Ces trois points décident de l'architecture cible (§6-7).

---

## 1. Périmètre : qu'est-ce que « la supervision IA » ?

Elle se compose de **trois canaux distincts** — à ne pas confondre :

| Canal | Signal | Producteur | Entrée | Stockage |
|---|---|---|---|---|
| **1. Performance/coût IA** | 1 span `gen_ai.*` par appel LLM (provider, model, tokens, cost, latence, TTFT, status/erreur) | **Backend externe (UTI)** via OTLP | edge `v1-traces` | table dédiée **`rum_ai`** |
| **2. Qualité IA** | événements `ai_feedback` (👍/👎), `ai_regenerate` | **Front** (`MIPRum.track(...)`) | edge `v1-traces` (canal générique) | table **partagée `rum_event`** (`name in (...)`) |
| **3. CSAT** | note de satisfaction `feedback` (widget étoiles) | **Front** (`MIPRum.track('feedback',{score})`) | edge `v1-traces` (canal générique) | table **partagée `rum_event`** (`name='feedback'`) |

- `refusal_rate`, `regen_rate`, `thumbs_down_rate`, `csat` **ne sont pas des objets de base** :
  ils sont **calculés à la lecture** (TypeScript console) à partir de `rum_ai` (canal 1) et
  `rum_event` (canaux 2-3).
- **À ne PAS embarquer** dans l'extraction : le *copilote IA de la console* (briefing/assistant
  qui résume le RUM avec un LLM). C'est une feature interne indépendante de `rum_ai`
  (`lib/assistant*.ts`, `lib/briefing.ts`, `components/AskAssistant.tsx`, `app/api/{ask,assist,briefing}` …).

---

## 2. Stack technique actuel, couche par couche

Chaîne complète : **Producteur (UTI backend)** → **Ingestion (edge Deno)** → **Base (Postgres/Supabase)** → **Read-API (Next.js)** → **Console UI (Next.js)**.

### 2.1 Producteur — EXTERNE (rien à cloner ici, tout à documenter)

**Constat vérifié : il n'existe AUCUNE instrumentation IA productrice dans ce repo.**
Les spans `gen_ai.*` sont émis par le backend d'UTI (`uti-platform`, FastAPI/Python). Les
deux SDK backend livrés ici (`@mip/agent-node`, middleware FastAPI `mip_rum_middleware.py`)
n'émettent que des spans `http.server` — **pas d'IA**.

Le « contrat producteur » vit dans les **docs** (ce sont littéralement des prompts destinés à
une session Claude sur `uti-platform`) :

> Les documents `*_UTI.md` cités ci-dessous sont écrits pour un client nommé et ne sont **pas
> dans le dépôt** — voir [DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md).

- `docs/AI_UTI.md` — contrat des spans `gen_ai` + squelette Python `record_ai_call(...)`
  (corps `...`, à implémenter côté UTI). Champs : `provider`, `model`, `operation`
  (`chat`/`embeddings`), `input_tokens`, `output_tokens`, `cost` (optionnel), `route`,
  `error.type`, `session_id`. **Aucun contenu utilisateur** exfiltré, métadonnées seulement.
- `docs/AI_SESSION_BACKGROUND_UTI.md` — propager le `session_id` RUM (`tracestate: mip=s:<id>`)
  dans les tâches IA de fond.
- `docs/AI_MAPPING_UTI.md` — inventaire des usages IA + direction schéma futur (colonnes
  `units`/`unit_kind`/`data_class`… non implémentées).
- `docs/RUM_READ_API.md` (§ qualité) — contrat des events front `ai_regenerate` / `ai_feedback`.
- `docs/SNIPPET_UTI.md` — valeurs de prod (`appId: "gip-plateforme"`, endpoint…).

Config producteur (backend UTI) : `MIP_RUM_ENDPOINT`, `MIP_RUM_APP_ID`, `MIP_RUM_API_KEY`.

> **Conséquence pour la découpe (clé).** Comme le producteur IA est déjà un exportateur
> **backend** distinct de l'exportateur **front** (RUM), déplacer l'IA revient surtout à
> **repointer `MIP_RUM_ENDPOINT` du backend UTI** vers `xsom-ai-guard`. Le front RUM continue
> de pointer vers `mip-rum`. Voir §6.3.

### 2.2 Ingestion — edge function Deno `v1-traces`

- Fichier : `supabase/functions/v1-traces/index.ts` (fonction Deno retirée en P1, lisible au tag `pre-reorg`) (endpoint
  `POST /functions/v1/v1-traces`, OTLP/HTTP JSON).
- Détection + extraction IA : `packages/backend/shared/otlp.mjs`,
  fonction `flattenOtlp()`, **branche `gen_ai` lignes 316-366** (verbatim en §3.1).
- Un span est reconnu « IA » si `name==="gen_ai"` **ou** `name` commence par `gen_ai.`
  **ou** l'attribut `gen_ai.request.model` **ou** `gen_ai.system` est présent.
- Estimation de coût : `packages/backend/shared/ai-pricing.mjs`,
  `aiCostUsd(provider, model, promptTokens, completionTokens)` (table de prix par
  préfixe, USD / 1M tokens ; `openrouter` ⇒ 0 car le coût réel `gen_ai.usage.cost` est
  attendu inline ; le coût réel prime toujours).
- Écriture : `await ins("rum_ai", ai)` (`v1-traces/index.ts:151`), soit
  `supabase.from("rum_ai").upsert(batch, { onConflict:"span_id", ignoreDuplicates:true })`
  (idempotent sur `span_id`, retry sur erreur transitoire). Un span IA **ne crée pas** de
  `rum_session` (corrélation logique via `session_id`).

**Auth / garde de l'ingestion** (aucune auth passerelle : `--no-verify-jwt` **obligatoire**
car les beacons n'ont pas de header `Authorization`) :
- Identité = attribut ressource **`mip.app_id`** (requis ; absent ⇒ ligne rejetée), lu dans
  la table **`app_registry`** (cache 60 s).
- Clé API optionnelle **`mip.api_key`** hachée SHA-256 vs `app_registry.api_key_hash`
  (`shared/auth.mjs` `checkApiKey` ; gouverné par env `REQUIRE_API_KEY`, **défaut `false` =
  fail-open**). ⚠️ `v1-logs` **duplique** cette logique au lieu d'importer `shared/auth.mjs`
  → à unifier lors de l'extraction.
- CORS : `shared/cors.mjs`, allowlist statique **∪** `app_registry.allowed_origins` des apps
  actives (membership exacte ; origine non listée ⇒ pas de header CORS).
- Rate limit : `rateLimitedDurable(appId)` (`shared/auth.mjs`), fenêtre glissante in-isolate
  + RPC durable `rate_check` (défaut `RATE_LIMIT_PER_MIN=600`, fail-open si la DB tombe).

**Env de l'edge** : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (auto-injectés, writes en
`service_role` = bypass RLS), `REQUIRE_API_KEY` (`false`), `RATE_LIMIT_PER_MIN` (`600`),
`MAX_BODY_BYTES` (`2_000_000`), `MAX_SPANS_PER_REQUEST` (`20_000`).

### 2.3 Base de données — Postgres/Supabase (projet POC `nupxrdpsliqptqnjkmgw`, eu-west-3)

Objets **dédiés IA** :

| Objet | Type | Fichier (migration) | Rôle |
|---|---|---|---|
| `rum_ai` | table | `packages/db/sql/migration-v20.sql:7` | 1 ligne = 1 appel LLM (cœur) |
| `v_ai_op_anomaly` | vue | `migration-v39.sql:16` | anomalie de coût z-score par fonction×route |
| `check_ai_op_anomalies()` | fonction (SECURITY DEFINER) | `migration-v39.sql:57` | émet un `alert_event` par anomalie |
| cron `mip-ai-op-anomaly` | pg_cron | `migration-v39.sql:102` | `*/30 * * * *` → `check_ai_op_anomalies()` |
| `openrouter_balance` | table | `migration-v24.sql:6` | historique solde crédits (budget provider) |
| `ai_briefing` | table | `migration-v28.sql:6` | cache du briefing IA (feature interne, cf. §1) |
| branche `ai_cost` de `check_alerts()` | fonction | `migration-v38.sql:42` | budget IA = règle `metric='ai_cost'` |
| branche `ai_cost` de `metric_baseline()` | fonction | `migration-v38.sql:147` | baseline saisonnière pour l'alerte budget |

Objets **partagés** dont l'IA dépend (à cloner aussi) :

| Objet | Fichier | Pourquoi l'IA en dépend |
|---|---|---|
| `rum_session` | `schema.sql:7` | attribution coût/utilisateur (`join … user_hash`) |
| `rum_event` (+ index v22) | `migration-v02.sql:49` | signaux qualité (canaux 2-3) : `name in ('ai_regenerate','ai_feedback','feedback')` |
| `alert_rule` (+ alters v17) | `migration-v02.sql:62` | budget IA = ligne `metric='ai_cost'` |
| `alert_event` (+ alters v17, `rule_id` nullable) | `migration-v02.sql:75` | toutes les alertes IA s'y écrivent |
| `alert_delivery` | `migration-v03.sql:38` | livraison webhook/slack |
| `notify_channel` | `migration-v17.sql:35` | routage par sévérité |
| `severity_rank()` | `migration-v17.sql:52` | helper de `route_alert()` |
| `route_alert()` | `migration-v17.sql:161` | routeur de notification (appelé par les 2 fonctions IA) |
| `metric_baseline()`, `check_alerts()` | `migration-v38.sql` | moteur d'alerte partagé (branches `ai_cost`) |

Accès lecture console : **rôle Postgres restreint `console_ro`** (login, **pas** de BYPASSRLS,
soumis au RLS ; app-scoping fait en SQL `where app_id=$1`, pas par RLS). `rum_ai` : policy
`cro_sel_rum_ai (using true)`.

> **Dettes/pièges DB relevés** (à corriger dans le clone) :
> - **`rum_ai` n'a AUCUN chemin de rétention/effacement** : jamais ajouté à
>   `purge_rum()/erase_app_data()/erase_session()` (TODO v20 jamais fait). Idem `ai_briefing`,
>   `openrouter_balance`.
> - **USD uniquement** partout (`cost_usd numeric(12,6)`, `openrouter_balance.currency='USD'`) —
>   pas d'EUR.
> - Les events `ai_feedback`/`ai_regenerate` n'ont **aucune validation serveur** (lignes
>   `rum_event` libres) et restent vides tant qu'UTI ne les émet pas.
> - `net.http_post` (pg_net) et `cron.*` (pg_cron) = extensions Supabase-cloud ; chaque usage
>   est gardé par `pg_extension`/`pg_roles` existence-check (dégrade en silence en CI/local).
>   **Toute grant/policy/revoke DOIT être wrappée** `if exists (select 1 from pg_roles where rolname='...')` — le DB de test CI n'a pas les rôles cloud.

### 2.4 Read-API — Next.js (`apps/console`, App Router). Il n'y a **pas** de repo `read-api` séparé.

**Deux surfaces d'auth distinctes** (ne pas confondre) :

| Surface | Endpoint(s) | Store de token | Portée |
|---|---|---|---|
| **PRIMAIRE (le contrat UTI)** | `GET /api/rum/summary` | table DB `read_tokens` (SHA-256) | 1 token → 1 `app_id` |
| Secondaire (tranches fines) | `GET /api/v1/ai`, `/ai/costs`, `/ai/credits` | env `CONSOLE_API_TOKENS` | suffixe `token@app` |

Les deux passent par le pool `console_ro` (`apps/console/lib/db.ts`, `q()`).

**PRIMAIRE — `GET /api/rum/summary`** (`apps/console/app/api/rum/summary/route.ts`) :
- Params : `app` (défaut = app du token ; si fourni doit == app du token sinon 403),
  `window` ∈ `24h|7d|30d` (défaut `30d`, `7j` toléré). **Pas** de `device/from/to`.
- Auth : `Authorization: Bearer <token>` opaque, préfixe `mrk_`, résolu par SHA-256 dans
  `read_tokens` (`where token_hash=$1 and revoked_at is null`) → `{id, app_id}` ; sinon 401.
  Token créé via UI admin, affiché une seule fois, révocation soft.
- Rate limit : `RUM_READ_RATE_LIMIT` (défaut 60) req/min **par token** (in-memory, best-effort).
- **Pas de CORS, pas d'`OPTIONS`** (server-to-server, le token ne va jamais au navigateur).
- Réponse : objet `RumSummary` **à plat** (pas d'enveloppe `{meta,data}`), qui **mélange RUM
  et IA**. Champs IA : `ai_calls`, `ai_tokens`, `ai_cost_usd`, `ai_p75_latency_ms`,
  `ai_error_rate`, `ai_by_model[]`, `ai_top_users[]`, `ai_by_operation[]`, `ai_series[]`.
- Builder : `rumSummary()` dans `apps/console/lib/queries-summary.ts` (12 requêtes en
  `Promise.all`, dont **8 IA**). Types & SQL verbatim en §3.
- ⚠️ **Aucun zod, aucune entrée OpenAPI, aucun test de forme** pour cet endpoint : le contrat
  n'est garanti que par les interfaces TS de `queries-summary.ts` + la prose de
  `docs/RUM_READ_API.md`. **Porter ces interfaces telles quelles = schéma de référence.**
- Piège handover : la portée UTI est **`gip-plateforme`**, pas `uti` (un mauvais scope renvoie
  `200` tout-à-zéro, sans erreur). Cf. `docs/HANDOVER_UTI.md`.

**SECONDAIRE — `/api/v1/ai*`** (wrappées par `apps/console/lib/api/handle.ts` : auth →
rate-limit → filtres → `fn` → enveloppe `{meta,data}` + ETag/304 + CORS) :
- Auth Bearer via `CONSOLE_API_TOKENS` (env, `token` ou `token@app1;app2`, comparaison
  `timingSafeEqual`) — `apps/console/lib/api/auth.ts`. CORS via `CONSOLE_API_ALLOWED_ORIGINS`.
- `GET /api/v1/ai` → `{overview, byModel, byRoute, daily, recent}` (params `app`, `period`
  ∈ `1h|24h|7d`, `recent` 0..200).
- `GET /api/v1/ai/costs` → `{group_by, rows, unattributed?}` (`group_by` ∈ `user|model|route`).
- `GET /api/v1/ai/credits` → solde OpenRouter `{status, balance, …}` (sans filtre app).
- OpenAPI machine : `GET /api/v1/openapi` (`apps/console/lib/api/openapi.ts`, schémas
  `Ai*` lignes 316-356). Le `/rum/summary` n'y est **pas**.
- Cron : `apps/console/app/api/cron/openrouter-balance/route.ts` (poll solde OpenRouter,
  enregistré dans `apps/console/vercel.json`).

Libs read : `queries-ai.ts` (10 fonctions, 100% `rum_ai`), `queries-openrouter.ts` +
`openrouter.ts`, `ai-costs.ts` (allowlist `group_by`), `ai-catalog.ts` (gouvernance PII,
catalogue de 6 routes en dur — stopgap en attendant émission `data_class` à la source).

### 2.5 Console UI — pages & composants

- **`/ai`** (`apps/console/app/ai/page.tsx`) : LA page dédiée « Performance IA » (hero
  coût/volume, « Satisfaction ↔ IA », « Fiabilité — échecs par type », « Gouvernance des
  données » PII, tables par modèle/route/derniers appels). 100% server-rendered.
- **`/alerts`** : page générique ; seul couplage IA = l'option `ai_cost` du menu métrique
  (`components/alerts/RuleFields.tsx`) + libellé « budget IA journalier ».
- Composants dédiés : `components/ai/{AiGovernanceRow,AiCallRow,AiModelRow,AiRouteRow}.tsx`
  (+ `AiBar.tsx`, `AiKpi.tsx` = **code mort**). ⚠️ `components/ai/format.ts` est **partagé**
  (importé par `app/map/page.tsx` et `app/forecast/page.tsx`) → le déplacer avant suppression.
- Nav/glossaire : `nav-items.tsx:62` (`/ai`), `Nav.tsx` (`ai` dot), `icons.tsx:112`,
  `presentation-content.ts:96-99`, `glossary.ts:184-188`, `dsar.ts:30` (liste `rum_ai`).

---

## 3. Le contrat de données (le cœur à cloner — verbatim)

### 3.1 Attributs OTLP `gen_ai.*` (producteur → ingestion) et branche d'extraction

`packages/backend/shared/otlp.mjs:316-366` :

```js
// v0.8 : appel LLM (conventions OTel GenAI `gen_ai.*`, émis par le back —
// session optionnelle via tracestate/mip.session_id). Coût estimé à
// l'ingestion (le coût réel `gen_ai.usage.cost` prime s'il est fourni). -> rum_ai.
const isGenAi =
  span.name === "gen_ai" ||
  span.name.startsWith("gen_ai.") ||
  a["gen_ai.request.model"] != null ||
  a["gen_ai.system"] != null;
if (isGenAi) {
  const aiSpanId = span.spanId ?? a["mip.span_id"] ?? null;
  const provider = a["gen_ai.system"] ?? a["mip.ai.provider"] ?? null;
  const model =
    a["gen_ai.request.model"] ?? a["gen_ai.response.model"] ?? a["mip.ai.model"] ?? null;
  if (!aiSpanId || (!provider && !model)) { rejected++; continue; }
  const num = (v) => (typeof v === "number" ? v : null);
  const promptTokens = num(a["gen_ai.usage.input_tokens"] ?? a["gen_ai.usage.prompt_tokens"]);
  const completionTokens = num(a["gen_ai.usage.output_tokens"] ?? a["gen_ai.usage.completion_tokens"]);
  const totalTokens =
    num(a["gen_ai.usage.total_tokens"]) ??
    (promptTokens != null && completionTokens != null ? promptTokens + completionTokens : null);
  const billed = num(a["gen_ai.usage.cost"]); // coût réel provider s'il est fourni
  const errType = a["error.type"] ?? a["gen_ai.error.type"] ?? null;
  ai.push({
    span_id: aiSpanId,
    trace_id: span.traceId ?? a["mip.trace_id"] ?? null,
    session_id: sessionFromTraceState(span.traceState) ?? a["mip.session_id"] ?? null,
    app_id: appId,
    route: normalizeRouteTemplate(a["gen_ai.route"] ?? a["mip.route"]) ?? a["mip.route"] ?? null,
    provider,
    model,
    operation: a["gen_ai.operation.name"] ?? null,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
    cost_usd: billed != null ? billed : aiCostUsd(provider, model, promptTokens, completionTokens),
    latency_ms: durationMsBetween(span.startTimeUnixNano, span.endTimeUnixNano) ?? num(a["gen_ai.latency_ms"]),
    ttft_ms: num(a["gen_ai.server.time_to_first_token"] ?? a["gen_ai.ttft_ms"]),
    status: errType ? "error" : "ok",
    error_type: errType,
    ts: nanosToDate(span.startTimeUnixNano, now),
  });
  continue;
}
```

**Table de correspondance `attribut OTLP → colonne `rum_ai`` (le contrat producteur) :**

| Champ logique | Attribut(s) OTLP acceptés (par priorité) | Colonne |
|---|---|---|
| fonction/opération | `gen_ai.operation.name` | `operation` |
| modèle | `gen_ai.request.model` › `gen_ai.response.model` › `mip.ai.model` | `model` |
| provider | `gen_ai.system` › `mip.ai.provider` | `provider` |
| prompt tokens | `gen_ai.usage.input_tokens` › `gen_ai.usage.prompt_tokens` | `prompt_tokens` |
| completion tokens | `gen_ai.usage.output_tokens` › `gen_ai.usage.completion_tokens` | `completion_tokens` |
| total tokens | `gen_ai.usage.total_tokens` (sinon dérivé) | `total_tokens` |
| coût | `gen_ai.usage.cost` (réel ; sinon estimé) | `cost_usd` |
| latence | span `end−start` › `gen_ai.latency_ms` | `latency_ms` |
| time-to-first-token | `gen_ai.server.time_to_first_token` › `gen_ai.ttft_ms` | `ttft_ms` |
| succès/refus | `error.type` › `gen_ai.error.type` (présent ⇒ `status='error'`) | `status`, `error_type` |
| route | `gen_ai.route` › `mip.route` | `route` |
| session | `tracestate: mip=s:<id>` › `mip.session_id` | `session_id` |
| span/trace id | `spanId`/`mip.span_id`, `traceId`/`mip.trace_id` | `span_id`, `trace_id` |
| app | attribut **ressource** `mip.app_id` | `app_id` |
| clé API | attribut **ressource** `mip.api_key` | (routage/auth seulement) |

Règle de rejet (= la seule « validation ») : ligne droppée sauf si `span_id` **et** (provider
**ou** model) présents. `regeneration/thumbs/csat` ne sont **PAS** portés sur le span IA.

### 3.2 Schéma `rum_ai` (DDL verbatim — `migration-v20.sql:7-31`)

```sql
create table if not exists rum_ai (
  id                bigint generated always as identity primary key,
  span_id           text unique not null,
  trace_id          text,
  session_id        text,
  app_id            text not null,
  route             text,
  provider          text,
  model             text,
  operation         text,
  prompt_tokens     integer,
  completion_tokens integer,
  total_tokens      integer,
  cost_usd          numeric(12,6),
  latency_ms        double precision,
  ttft_ms           double precision,
  status            text not null default 'ok',   -- 'ok' | 'error'
  error_type        text,
  ts                timestamptz not null default now()
);

create index if not exists idx_ai_app_ts on rum_ai (app_id, ts desc);
create index if not exists idx_ai_model   on rum_ai (app_id, model);
create index if not exists idx_ai_route   on rum_ai (app_id, route);
create index if not exists brin_ai_ts     on rum_ai using brin (ts);
```

RLS (`migration-v20.sql:33-42`, garde `pg_roles`) :

```sql
alter table rum_ai enable row level security;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select on rum_ai to console_ro;
    if not exists (select 1 from pg_policies where tablename = 'rum_ai' and policyname = 'cro_sel_rum_ai') then
      create policy cro_sel_rum_ai on rum_ai for select to console_ro using (true);
    end if;
  end if;
end $$;
```

### 3.3 Vue d'anomalie z-score (`v_ai_op_anomaly`, `migration-v39.sql:16-47`)

```sql
create or replace view v_ai_op_anomaly as
with daily as (
  select app_id, coalesce(operation,'') as operation, coalesce(route,'') as route,
         date_trunc('day', ts)::date as d, sum(cost_usd) as cost
  from rum_ai
  where ts >= current_date - interval '8 days' and ts < current_date
  group by 1, 2, 3, 4
),
stats as (
  select app_id, operation, route, avg(cost) as mean, stddev_samp(cost) as sd
  from daily group by 1, 2, 3
  having count(*) >= 3 and stddev_samp(cost) > 0
),
recent as (
  select app_id, coalesce(operation,'') as operation, coalesce(route,'') as route,
         coalesce(sum(cost_usd), 0) as cost
  from rum_ai
  where ts >= now() - interval '24 hours'
  group by 1, 2, 3
)
select r.app_id,
       nullif(r.operation, '') as operation,
       nullif(r.route, '')     as route,
       round(r.cost::numeric, 4)                    as cost_24h,
       round(s.mean::numeric, 4)                    as mean_daily,
       round(((r.cost - s.mean) / s.sd)::numeric, 1) as z_score
from recent r
join stats s using (app_id, operation, route)
where (r.cost - s.mean) / s.sd > 3;
```

Fonction cron `check_ai_op_anomalies()` (`migration-v39.sql:57`) : parcourt la vue, dédup
6 h par identifiant stable `fonction X / route Y / app Z`, insère un `alert_event`
(`rule_id=null, slo_id=null, severity='warning'`) et appelle `route_alert(...)`. Cron
`mip-ai-op-anomaly` = `*/30 * * * *`.

### 3.4 Types de réponse read-API (verbatim — `apps/console/lib/queries-summary.ts`)

```ts
export interface SummaryAiModel { provider: string|null; model: string|null; calls: number; tokens: number; cost_usd: number; }
export interface SummaryAiUser  { user_hash: string; calls: number; cost_usd: number; }

export interface SummaryAiOperation {
  operation: string | null;
  route: string | null;
  calls: number;
  cost_usd: number;
  tokens: number;
  p75_latency_ms: number | null;
  ttft_p75_ms: number | null;
  error_rate: number | null;
  anomaly: boolean;              // z > 3 (via v_ai_op_anomaly)
  anomaly_score: number | null;  // z-score (null si pas en anomalie)
  refusal_rate: number | null;   // status=error & error_type ~ refus/guardrail/safety/moderation
  regen_rate: number | null;     // rum_event name='ai_regenerate' / calls
  thumbs_down_rate: number | null; // down/(up+down) via name='ai_feedback'
  csat: number | null;           // sessions notées >=4/5 ayant utilisé la fonction
}
export interface SummaryAiSeriesPoint { date: string; calls: number; cost_usd: number; p75_latency_ms: number|null; error_rate: number|null; }
```

Requêtes SQL correspondantes (les 8 sous-requêtes IA de `rumSummary`) : KPIs
(`queries-summary.ts:201`), `ai_by_model` (`:212`), `ai_top_users` (`:221`),
`ai_by_operation` **avec refusal_rate** (`:242`), `ai_series` (`:270`), anomalie
(`:292`, lit `v_ai_op_anomaly`), regen/thumbs (`:306`, lit `rum_event`), CSAT (`:319`,
`rum_ai ⋈ rum_event name='feedback'`, seuil score≥4). Verbatim disponible dans le fichier ;
règle contractuelle : **une métrique absente = `null`, jamais la clé omise** ; taux arrondis
à 4 décimales.

Types read secondaire (`queries-ai.ts`) : `AiOverview`, `AiModelRow`, `AiRouteRow`,
`AiGovRow`, `AiDailyRow`, `AiCallRow`, `AiUserCostRow`, `AiSatisfactionRow`, `AiErrorRow`,
`AiUnattributedCost`.

---

## 4. Les coutures / couplages (ce qui rend la découpe non triviale)

| # | Couture | Nature | Impact découpe |
|---|---|---|---|
| **C1** | **Ingestion partagée** `v1-traces` : IA (`gen_ai`) et RUM (vitals/erreurs/sessions) arrivent au même endpoint | Producteurs déjà distincts (backend vs front) | **Facile** : repointer l'exportateur backend UTI vers `xsom-ai-guard`. |
| **C2** | **`rum_event` partagé** : les signaux qualité (👎/regen/CSAT) sont émis par le **front** RUM et stockés côté `mip-rum` | `xsom-ai-guard` a besoin de ces events pour `regen_rate`/`thumbs_down_rate`/`csat` | **Dur** : décider dual-emit vers xsom OU API interne mip→xsom OU garder le calcul qualité côté mip. |
| **C3** | **`rum_session.user_hash`** : l'attribution coût/utilisateur joint `rum_ai → rum_session` | `xsom-ai-guard` n'a pas les sessions RUM | **Moyen** : soit `session_id`/`user_hash` voyagent sur le span IA, soit API de résolution. |
| **C4** | **`/api/rum/summary` renvoie RUM+IA fusionnés** | Contrat UTI unique | **Structurant** : soit facade (mip appelle xsom et fusionne), soit UTI appelle 2 endpoints. |
| **C5** | **Alerting partagé** (`alert_rule`/`alert_event`/`route_alert`/`notify_channel`) | Les alertes IA écrivent dans les mêmes tables que le RUM | **Moyen** : `xsom-ai-guard` embarque **sa propre** copie du backbone d'alerte. |
| **C6** | **`ai_briefing`** est en réalité la feature *copilote console*, pas la supervision IA | Faux ami | **Ne pas migrer** avec la supervision (sauf si xsom veut aussi le copilote). |

---

## 5. Solution technique — Sens 1 : cloner la supervision IA dans `xsom-ai-guard`

### 5.1 Deux stratégies d'implémentation

- **Stratégie A — « lift-and-shift » (la plus rapide).** Répliquer à l'identique la tranche
  Supabase(Postgres) + edge Deno + read-API Next dans le projet `xsom-ai-guard` (nouveau
  projet Supabase dédié). On reprend les migrations, `otlp.mjs` (branche `gen_ai` seule),
  `ai-pricing.mjs`, la table `rum_ai`, la vue, les fonctions, et on réexpose les endpoints.
  Recodage minimal. Recommandé si `xsom-ai-guard` peut héberger un Postgres Supabase + une
  edge function.
- **Stratégie B — ré-implémentation native.** Si `xsom-ai-guard` est en FastAPI (stack
  probable : FastAPI + Supabase + Vercel), on garde **le même modèle de données et le même
  SQL** (portés en migrations), et on ré-implémente uniquement la couche HTTP : un endpoint
  FastAPI reçoit l'OTLP `gen_ai` (même logique d'extraction que §3.1) et écrit dans `rum_ai` ;
  des routes FastAPI exposent les mêmes réponses (§3.4). **Le contrat de données ne change
  pas** — seul le runtime change.

> Recommandation : **Stratégie A pour la base** (le SQL est la valeur, il est déjà éprouvé et
> gardé CI-safe), et choix du runtime d'ingestion (edge Deno vs FastAPI) selon la stack réelle
> de `xsom-ai-guard`. On tranchera quand `xsom-ai-guard` aura détaillé son stack.

### 5.2 Ordre de portage DB (dépendances)

1. **Prérequis partagés** : `rum_session` (`schema.sql`), `rum_event` (`v02` + index `v22`).
2. **Backbone d'alerte** : `alert_rule` (`v02`+`v17`), `alert_event` (`v02`+`v17`, `rule_id`
   nullable), `alert_delivery` (`v03`), `notify_channel` (`v17`), `severity_rank()` (`v17`),
   `route_alert()` (`v17`), `metric_baseline()`/`check_alerts()` (`v38`, branches `ai_cost`),
   + helpers `slo_status()` etc. requis par `check_alerts`.
3. **`rum_ai`** (`v20`) + 4 index + RLS/grants.
4. **`openrouter_balance`** (`v24`) + RLS (`v24`+`v34`).
5. **`v_ai_op_anomaly`** (`v39`), **`check_ai_op_anomalies()`** (`v39`), cron
   `mip-ai-op-anomaly` (`v39`).
6. (Optionnel, seulement si xsom veut le copilote) `ai_briefing` (`v28` + RLS `v34`→`v36`).
7. **Rôle** `console_ro` (ou équivalent restreint) + rappel : **wrapper toutes les
   grant/policy/revoke** dans `if exists (select 1 from pg_roles where rolname='...')`.

### 5.3 Code d'ingestion à porter

- `shared/otlp.mjs` — **seulement la branche `gen_ai`** (§3.1) + helpers utilisés
  (`sessionFromTraceState`, `normalizeRouteTemplate`, `durationMsBetween`, `nanosToDate`
  avec la garde anti-dérive d'horloge).
- `shared/ai-pricing.mjs` — table de prix + `aiCostUsd()`.
- `shared/{auth,cors,limits}.mjs` + table `app_registry` + RPC `rate_check` (auth/CORS/rate).
- Env : `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REQUIRE_API_KEY`, `RATE_LIMIT_PER_MIN`,
  `MAX_BODY_BYTES`, `MAX_SPANS_PER_REQUEST`. Déploiement **`--no-verify-jwt`**.

### 5.4 Endpoints que `xsom-ai-guard` devra exposer (pour le sens 2)

Pour que `mip-rum` remplace son code local par des appels, `xsom-ai-guard` doit offrir au
minimum :

- **`POST /v1/ai-traces`** (ou réutiliser `/v1/traces` OTLP) — ingestion des spans `gen_ai`
  (contrat §3.1). Auth par `app_id` + `api_key` (même modèle).
- **`GET /ai/summary?app=<id>&window=24h|7d|30d`** — renvoie **exactement** le sous-objet IA
  du `RumSummary` (§3.4) : `{ ai_calls, ai_tokens, ai_cost_usd, ai_p75_latency_ms,
  ai_error_rate, ai_by_model[], ai_top_users[], ai_by_operation[], ai_series[] }`. Auth par
  token type `read_tokens` (SHA-256, 1 token → 1 app). C'est **le** endpoint que la facade
  `/api/rum/summary` de `mip-rum` appellera.
- **`GET /ai`, `/ai/costs`, `/ai/credits`** — équivalents des `/api/v1/ai*` (si UTI ou la
  console en ont besoin en direct).
- Idéalement un **`GET /ai/openapi`** pour figer le contrat.

---

## 6. Solution technique — Sens 2 : remplacer le code local par des appels API

Une fois `xsom-ai-guard` debout et ses API détaillées, on retire la logique IA de `mip-rum` :

### 6.1 Seam principal — `/api/rum/summary` en **facade**

Dans `apps/console/lib/queries-summary.ts`, **remplacer les 8 sous-requêtes IA + le merge**
par **un seul appel server-to-server** :

```ts
// AVANT : 8 requêtes SQL sur rum_ai/rum_event + v_ai_op_anomaly + merge (lignes ~201-413)
// APRÈS :
const ai = await fetch(
  `${process.env.XSOM_AI_URL}/ai/summary?app=${encodeURIComponent(app)}&window=${windowKey}`,
  { headers: { Authorization: `Bearer ${process.env.XSOM_AI_TOKEN}` }, cache: "no-store" },
).then((r) => (r.ok ? r.json() : null));
// puis on étale ai.* dans l'objet RumSummary ; si null -> champs IA à 0/[] (dégradation douce).
```

→ Le contrat UTI **reste identique** (payload fusionné), mais le calcul IA est délégué. La
moitié RUM (sessions/vitals/erreurs/routes) **ne bouge pas**.

### 6.2 Suppressions console (fichiers 100% IA)

Supprimables une fois la supervision IA externalisée :
`app/ai/page.tsx` ; `app/api/v1/ai/route.ts`, `.../ai/costs/route.ts`, `.../ai/credits/route.ts` ;
`app/api/cron/openrouter-balance/route.ts` (+ entrée `vercel.json`) ; `lib/queries-ai.ts`,
`lib/queries-openrouter.ts`, `lib/openrouter.ts`, `lib/ai-costs.ts`, `lib/ai-catalog.ts` ;
`components/ai/{AiGovernanceRow,AiCallRow,AiModelRow,AiRouteRow,AiBar,AiKpi}.tsx`.

À **stripper** (fichiers partagés, retirer seulement la part IA) :
`lib/queries-summary.ts` (les 8 requêtes IA → l'appel §6.1) ; `lib/queries-v2.ts` (retirer
`"ai_cost"` de `ALERT_METRICS` + `METRIC_LABELS`) ; `lib/api/openapi.ts` (blocs `Ai*`) ;
`nav-items.tsx:62`, `Nav.tsx` (`ai`), `icons.tsx:112`, `presentation-content.ts:96-99`,
`glossary.ts:184-188`, `dsar.ts` (retirer `rum_ai`) ; `components/alerts/RuleFields.tsx`
(option/aide `ai_cost`). **Avant** de supprimer `components/ai/`, **déplacer
`components/ai/format.ts`** vers `lib/format.ts` et repointer `app/map/page.tsx` +
`app/forecast/page.tsx`.

Côté DB `mip-rum` : quand plus rien ne lit `rum_ai`, retirer table `rum_ai`,
`openrouter_balance`, vue `v_ai_op_anomaly`, `check_ai_op_anomalies()`, cron
`mip-ai-op-anomaly`, branches `ai_cost` de `check_alerts()`/`metric_baseline()`, et
`rum_ai` de `dsar.ts`. (Migration de dépréciation, après bascule vérifiée.)

### 6.3 Ingestion — re-router les spans `gen_ai`

Deux options (cf. C1) :
- **Option recommandée** : le backend UTI ajoute/repointe son exportateur IA
  (`MIP_RUM_ENDPOINT` backend) vers `xsom-ai-guard/v1/ai-traces`. Le front RUM reste sur
  `mip-rum`. Séparation nette, aucun forward.
- **Option transitoire** : `mip-rum` `v1-traces` **forwarde** les spans `gen_ai` reçus vers
  `xsom-ai-guard` (double-write le temps de la bascule), puis on coupe la branche locale.

### 6.4 Couture qualité (C2/C3) — la décision à trancher

Les métriques `regen_rate/thumbs_down_rate/csat` ont besoin de `rum_event` (front, côté
`mip-rum`) et `csat`/`user_hash` de `rum_session`. Trois designs possibles :
- **(a) Dual-emit** : le front émet aussi `ai_feedback`/`ai_regenerate`/`feedback` vers
  `xsom-ai-guard` → xsom calcule tout, autonome. (Le plus propre à terme ; le front parle à 2
  backends.)
- **(b) API interne** `mip-rum → xsom` : `mip-rum` expose un endpoint « events qualité IA par
  session/opération/route » que xsom interroge pour compléter `ai_by_operation`.
- **(c) Split du calcul** : xsom calcule les métriques `rum_ai` pures (coût/tokens/latence/
  refus/anomalie) ; `mip-rum` garde le calcul qualité (regen/thumbs/csat) et les injecte dans
  la facade `/rum/summary`. (Le moins de mouvement, mais garde de l'IA côté mip.)

> Recommandation pragmatique : **(c) en phase 1** (bascule rapide, xsom possède le cœur
> `rum_ai`), **(a) en phase 2** si on veut que `xsom-ai-guard` soit 100% autonome sur la
> qualité IA.

---

## 7. Checklist de découpe & décisions à trancher

**À porter dans `xsom-ai-guard` (récap) :** modèle `rum_ai` + vue + fonctions + cron + backbone
d'alerte + prérequis `rum_session`/`rum_event` + ingestion `gen_ai` (`otlp.mjs` branche +
`ai-pricing.mjs` + auth/cors/limits) + read-API (`/ai/summary`, `/ai`, `/ai/costs`,
`/ai/credits`) + types §3.4 comme schéma de référence.

**À corriger au passage (dette) :** rétention/effacement de `rum_ai` (RGPD) ; unifier l'auth
`v1-logs` sur `shared/auth.mjs` ; rate-limit in-memory → store partagé si multi-instance ;
ajouter un test de forme sur la réponse `/ai/summary` (absent aujourd'hui).

**Décisions produit à trancher (elles fixent l'archi) :**
1. **C4** — `/api/rum/summary` reste une **facade** fusionnée (recommandé, contrat UTI
   inchangé) *ou* UTI appelle **deux** endpoints ?
2. **C1/6.3** — UTI **repointe** son exportateur IA vers xsom (recommandé) *ou* `mip-rum`
   **forwarde** ?
3. **C2/6.4** — signaux qualité : **(c)** puis **(a)** (recommandé) *ou* API interne **(b)** ?
4. **Runtime d'ingestion** xsom : edge Deno (lift-and-shift) *ou* FastAPI (natif) ? → dépend
   du stack réel de `xsom-ai-guard`, à confirmer.
5. `ai_briefing` (copilote console) : **hors périmètre** supervision — le garder dans `mip-rum`
   sauf demande explicite.

---

## 8. Références fichiers (index rapide)

- Ingestion IA : `packages/backend/shared/otlp.mjs:316-366`,
  `.../shared/ai-pricing.mjs`, `.../v1-traces/index.ts:151`.
- DB : `packages/db/sql/migration-v20.sql` (`rum_ai`), `-v24` (`openrouter_balance`),
  `-v28` (`ai_briefing`), `-v38` (branches `ai_cost`), `-v39` (`v_ai_op_anomaly`,
  `check_ai_op_anomalies`, cron), `-v02/-v03/-v17` (backbone d'alerte).
- Read-API : `apps/console/app/api/rum/summary/route.ts`, `apps/console/lib/queries-summary.ts`,
  `apps/console/lib/{read-tokens,queries-read-tokens}.ts`, `apps/console/app/api/v1/ai*/route.ts`,
  `apps/console/lib/{queries-ai,queries-openrouter,openrouter,ai-costs,ai-catalog}.ts`,
  `apps/console/lib/api/{handle,auth,params,cors,ratelimit,openapi}.ts`.
- Console UI : `apps/console/app/ai/page.tsx`, `apps/console/components/ai/*`.
- Contrat producteur (docs) : `docs/AI_UTI.md`, `docs/AI_SESSION_BACKGROUND_UTI.md`,
  `docs/AI_MAPPING_UTI.md`, `docs/RUM_READ_API.md`, `docs/HANDOVER_UTI.md`, `docs/SNIPPET_UTI.md`.
