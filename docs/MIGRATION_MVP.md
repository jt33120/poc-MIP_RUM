# Plan de migration & MVP — monitoring `uti-platform` (gip-plateforme)

> État au 2026-07-01. But : rendre l'outil RUM **totalement opérationnel et sans
> ambiguïté** sur la plateforme cobaye `uti-platform` (= app `gip-plateforme`,
> prod `https://plateforme.groupement-it.com`), en réactivant ce qui avait été
> écrit mais **jamais déployé en base de prod**.

## 1. Diagnostic — dérive code ↔ base de prod

Le **code** (console Next.js + SDK + ingestion) et les **tests** vont jusqu'au niveau
« entreprise » (dashboards, SLO, metering, alerting mature, sourcemaps, ClickHouse-ready).
Mais la **base Supabase de prod** (`mip-rum-poc`, ref `nupxrdpsliqptqnjkmgw`) s'est
arrêtée aux migrations **v05 + durcissement sécu v10/v11** (dernière : 2026-06-17).

Conséquence : des pages de la console interrogent des **tables absentes** → elles
s'affichaient vides en silence (fail-soft). C'est le « front ambigu ».

**Ce qui tourne (frais, vérifié) :** vitals, erreurs, sessions, pageviews, resources,
longtasks, breadcrumbs, tracing (197k spans, dont 192k back / 2.9k front). Ingestion
edge `v1-traces` (v8) + `v1-replay` (v3) ACTIVE.

**Ce qui était coupé (tables/fonctions jamais migrées) :** dashboards, SLO,
sourcemaps, usage/metering/quota/retention, alerting v16/17 (sévérité, baseline,
canaux), index BRIN. **Éteint faute de données/runner :** session replay
(`replay_sample_rate=0`), synthetic (`syn_snapshot` figé au 10 juin), events custom.
**Sécurité :** ingestion en `REQUIRE_API_KEY=false` (fail-open).

## 2. Phase 1 — Base de prod v05 → v19 (FAIT via migrations)

Migrations idempotentes & additives, appliquées **dans cet ordre** (dépendances :
v14 après v12+v13 ; v18 après v14) :

```
v07 (page_count) · v08 (alert_delivery.attempts) · v09 (purge 30j + cron)
v12 (BRIN + rum_rollup_hourly + cron horaire) · v13 (sourcemap + rum_error.release)
v14 (purge multi-tenant + RGPD erase_*) · v15 (metering + quota + tenant_usage_daily)
v16 (parité console_ro : fixe rum_span/rate_counter) · v17 (alerting baseline+SLO+canaux)
v18 (dashboards) · v19 (SELECT app_registry pour console_ro)
```

Chaque nouvelle table embarque son propre `ENABLE RLS` + grants `console_ro` + policy
(pattern v05/v10). **Sécurité data vérifiée** : purge à rétention **30 j**, plus vieille
donnée = 21 j → aucune suppression immédiate (la rétention mordra ~10 juillet, comportement
attendu). Jobs pg_cron créés : rollups (`5 * * * *`), metering (`5 3 * * *`),
purge (`17 3 * * *`), slo-burn (`*/5 * * * *`).

→ **Effet : toutes les pages de la console deviennent réelles sans changer une ligne de
code console** (le code référençait déjà ces tables).

## 3. Phase 2 — Alerting actionnable (MVP)

1. `check_alerts()` (réécrit v17) tourne via pg_cron. `route_alert()` livre aux canaux
   par sévérité (webhook via `pg_net` en cloud, ou file `alert_delivery` livrée par
   `dispatchOnce` — `packages/backend/lib/dispatch-alerts.mjs` —, que le `scheduler`
   appelle à chaque tick).
2. **Règles de départ** créées pour `gip-plateforme** (modifiables dans `/alerts`) :
   - LCP p75 > 2500 ms (warning), INP p75 > 200 ms (warning), taux d'erreur > 1 % (critical).
3. **Notifications** : créer un `notify_channel` (webhook Slack/Discord) — *fournir l'URL*.
   Sans canal, les événements restent visibles dans `/alerts` (acquittables).

## 4. Phase 3 — Sécu ingestion (clé API), cutover sans coupure

En 2 temps pour ne pas casser le flux actuel (snippet sans clé) :

1. **Maintenant** : hash de la clé stocké dans `app_registry.api_key_hash` pour
   `gip-plateforme` (+ `demo-app`, `mip-rum-console` si on enforce globalement). Sans effet
   tant que l'enforcement est OFF.
2. **Snippet uti** déployé avec la clé (`docs/SNIPPET_UTI.md`, document client hors dépôt :
   voir [DOCUMENTS-HORS-DEPOT.md](DOCUMENTS-HORS-DEPOT.md)).
3. **Vérif** : beacons `v1-traces` 200 portant la clé (nouvelles lignes en base).
4. **Bascule** : passer la variable d'env de l'edge function `REQUIRE_API_KEY=true`
   (Supabase → Edge Functions → `v1-traces` → Secrets). À ce moment **toutes** les apps
   actives doivent avoir une clé + snippet à jour, sinon leur ingestion tombe en 403.

## 5. Phase 4 — Replay & Synthetic (runbook)

**Replay** (rrweb) : activé via la config SDK `replay: 0.1` (dans le snippet) + pour mémoire
`update app_registry set replay_sample_rate = 0.1 where app_id = 'gip-plateforme'`. Les
chunks partent vers `v1-replay` (déjà ACTIVE) ; lecture dans `/sessions/[id]`.

**Synthetic** (robot → `/correlation`) : relancer le runner
`tools/sync-synthetic/src/sync.mjs` (adapters `seed` = données déterministes, `mippoc-json`
= exports DEM réels). Nécessite `DATABASE_URL`. Pour un flux continu : cron toutes les 15 min
(`*/15 * * * * DATABASE_URL=… node tools/sync-synthetic/src/sync.mjs seed`). Tant que le
runner ne tourne pas, `/correlation` affiche honnêtement « pas de donnée robot récente ».

## 6. Phase 5 — Snippet dans uti-platform

Voir **`docs/SNIPPET_UTI.md`** : prompt prêt à coller pour une session Claude dédiée à
`uti-platform`. Front only ; ne touche pas au back OTel (192k spans).

## 7. Vérification (definition of done MVP)

- [ ] 11 migrations appliquées ; tables `dashboard/slo/notify_channel/sourcemap/tenant_usage_daily/rum_rollup_hourly` présentes.
- [ ] Console prod : `/dashboards`, `/slo`, `/admin/usage` ne sont plus vides/cassées.
- [ ] `/alerts` : règles visibles ; `check_alerts()` planifié (cron.job).
- [ ] Snippet uti déployé ; beacons `v1-traces` 200 avec clé ; nouvelles lignes RUM.
- [ ] `REQUIRE_API_KEY=true` basculé après vérif.
- [ ] `tsc` + 288 tests unit verts ; `next build` OK.

## 8. Rollback

Migrations additives : en cas de souci, `DROP` les objets nouveaux (tables/fonctions/jobs)
sans impacter les données RUM existantes. `REQUIRE_API_KEY` : repasser à `false` restaure
le fail-open instantanément. Snippet : retirer les 2 `<script>`.

## 9. Contexte LOT C (front Angular) — déjà amorcé

Le repo porte déjà (branche `claude/rum-product-review-jcoas6`) l'**API REST v1**
(`/api/v1/*`, lecture seule, Bearer `CONSOLE_API_TOKENS` + CORS `CONSOLE_API_ALLOWED_ORIGINS`),
socle de l'**option B** du cadrage `docs/CADRAGE_LOT_C.md` : le front **Angular 20 de MIP**
consomme le RUM **sans réécrire la console**. C'est la voie recommandée pour « un front
totalement adapté ». Décision à prendre : *option B* (API + intégration légère, ~6–10 j·h)
vs *option A* (module Angular natif, ~23–34 j·h, requiert le repo console MIP).
