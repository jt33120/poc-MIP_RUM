# ADR-0001 — La supervision IA quitte mip-rum pour xSOM AI Guard

- **Statut** : accepté (mise en œuvre par lots, cf. § Migration)
- **Date** : 2026-07
- **Portée** : `mip-rum` (RUM), `xsom-ai-guard` (supervision IA), `uti-platform` (consommateur)

## Contexte

Le POC `mip-rum` faisait trois choses : supervision **RUM** (perf web, erreurs,
sessions), **logs**, et **supervision IA d'API** (coût/tokens/latence/qualité des
appels LLM d'un backend client). On scinde ces responsabilités : centraliser toute
l'observabilité IA/LLM dans le produit existant **xSOM AI Guard**, et ramener
`mip-rum` à un **RUM pur**.

## Décision

- **xSOM AI Guard = seule source de vérité de l'observabilité IA/LLM.**
  - Prod : `https://xsom-ai-guard-production.up.railway.app` (base API `/v1`).
  - Ingestion (écriture) : `POST /v1/ai-traces`, header `X-Gateway-Token: <xsg_…>`,
    payload OTLP `gen_ai`, app portée par l'attribut de span `mip.app_id`.
  - Lecture : `GET /v1/ai/summary?app=<app>&window=7d`, header `Authorization: Bearer <xsr_…>`.
- **mip-rum = RUM (perf web / erreurs / sessions).** Sa partie IA n'est plus calculée
  ni ingérée localement : `/api/rum/summary` devient une **façade** qui lit xSOM.
- **uti-platform** émet le RUM vers mip-rum **et** les spans IA `gen_ai` vers xSOM
  (dual-emit), et lit sa supervision IA depuis xSOM.

## Contrat `/api/rum/summary` (façade)

La moitié RUM est inchangée. La section IA :

- nouveau champ **`ai_status: "ok" | "unavailable"`** ;
- champs `ai_*` **toujours présents mais nullables** : scalaires (`ai_calls`,
  `ai_tokens`, `ai_cost_usd`, `ai_p75_latency_ms`, `ai_error_rate`) → `number | null`,
  listes (`ai_by_model`, `ai_top_users`, `ai_by_operation`, `ai_series`) → `[]` quand
  indisponible ;
- si xSOM est injoignable (non configuré / 4xx-5xx / payload malformé / réseau /
  timeout), `ai_status="unavailable"` et les `ai_*` sont vides — **aucun recalcul
  local**. Le consommateur doit afficher « indisponible » plutôt que « 0 ».

Implémentation : `apps/console/lib/xsom-ai.ts` (`fetchAiSummary`, timeout 4 s, garde de
forme, ne lève jamais) + `resolveAi` dans `apps/console/lib/queries-summary.ts`.
Config runtime : `XSOM_AI_URL`, `XSOM_AI_TOKEN` (token `xsr_`), `XSOM_AI_TIMEOUT_MS`
(défaut 4000), positionnés en Production **et** Preview sur `mip-rum-console` (non revérifié
le 26/09/2026 : les variables du projet Vercel n'étaient pas lisibles).

## Conséquences

Retiré de mip-rum (RUM pur) :

- page console `/ai` + `components/ai/*` ; entrée de nav, mentions glossaire/marketing ;
- endpoints `/api/v1/ai`, `/ai/costs`, `/ai/credits` + cron `/api/cron/openrouter-balance` ;
- libs `queries-ai`, `queries-openrouter`, `openrouter`, `ai-costs`, `ai-catalog` ;
  schémas/paths OpenAPI `Ai*` ;
- métrique d'alerte `ai_cost` (option UI) ;
- ingestion des spans `gen_ai` (branche `flattenOtlp` + écriture `rum_ai` + `ai-pricing.mjs`).

Schéma (migration `v43`, **réversible**, aucun DROP) : `cron.unschedule('mip-ai-op-anomaly')`
+ `COMMENT` « DÉPRÉCIÉ » sur `rum_ai`, `openrouter_balance`, `v_ai_op_anomaly`. Les tables
restent lisibles pour audit/rollback ; `rum_ai` reste dans `dsar.ts` (effacement RGPD) tant
qu'elle existe. Le **DROP dur** (tables/vue/fonctions + branches `ai_cost` de
`check_alerts`/`metric_baseline`) est une migration **ultérieure différée**, après bake xSOM.

Conservé (feature RUM, hors périmètre IA) : le **copilote console** (`ai_briefing`,
`lib/assistant*`, `lib/briefing`) qui résume le RUM avec un LLM — indépendant de `rum_ai`.
Ce copilote a été retiré à son tour le 09/09/2026 (voir § État au 26/09/2026).

## Gates de bascule (avant merge/déploiement)

- **Gate A (données)** : la session xSOM confirme qu'un span réel UTI est ingéré (table
  `usage_events`). Conditionne le retrait de l'ingestion (`C6`) et le redeploy edge.
- **Gate B (contrat)** : la session UTI confirme qu'elle tolère `ai_status="unavailable"`
  + `ai_*` nullables (et que son chemin de lecture IA n'utilise plus `/api/v1/ai*`).
  Conditionne le retrait du fallback (`C5`).
- La migration de dépréciation (`C7`) est tenue derrière **A + B**.

## Migration (lots)

1. `C1` refactor formatters (neutre). 2. `C2` retrait page `/ai` + composants. 3. `C3`
retrait endpoints IA + libs mortes + OpenAPI. 4. `C4` retrait métrique `ai_cost`.
**[Gate B]** `C5` façade sans fallback + `ai_status`. **[Gate A]** `C6` retrait
ingestion `gen_ai`. **[Gates A+B]** `C7` migration `v43` de dépréciation. `C8` docs (ce
fichier + `RUM_READ_API.md` + `HANDOVER_UTI.md`, ce dernier hors dépôt —
[DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md)).

## État au 26/09/2026

Relevé dans le code de `master` ; ce qui suit complète la décision, il ne la remplace pas.

- **Le copilote console n'existe plus.** `lib/assistant*`, `lib/briefing` et le tutoriel ont
  été retirés le 09/09/2026 (commit `0759b0e0`) ; Mistral et Anthropic sont sortis du registre
  des sous-traitants le même jour (`docs/CONFORMITE.md` §7). La table `ai_briefing` reste
  dans le schéma.
- **Une page `/ai` existe de nouveau**, mais comme « espace partenaire » : elle lit la façade
  xSOM (`fetchAiSummary`) et ne stocke rien (`apps/console/app/ai/page.tsx`, ajoutée le
  23/07/2026). C'est une capacité fermée : ni la barre latérale ni l'URL ne l'ouvrent
  (`apps/console/lib/capacites.ts:6`).
- **Le DROP dur n'a pas eu lieu.** Il attend dans
  `packages/db/sql/pending/migration-v44-drop-deprecated-ai.sql`, hors de la séquence
  appliquée ; `rum_ai` figure toujours dans `apps/console/lib/dsar.ts` et dans les droits de
  `migration-v93.sql`.
- **La façade a un second hôte dans le code** : le service `api` (`services/api/server.mjs`,
  variable `XSOM_AI_URL`) sert aussi `/api/rum/summary`. Il est déclaré dans
  `.railway/railway.ts` mais pas créé sur Railway : en production, c'est la console qui répond.
