# DEPLOY — Mise en production POC (Supabase + Vercel + snippet G-IT)

Statut S6 : **DÉPLOYÉ le 10/06/2026** (via MCP Supabase + CLI Vercel, autorisé par Julian). Reste : **coller le snippet (§4)**.

| Ressource | URL |
|---|---|
| Ingestion OTLP | `https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces` |
| Console RUM Live | `https://mip-rum-console.vercel.app` |
| SDK hébergé | `https://mip-rum-console.vercel.app/mip-rum.js` |
| Projet Supabase | `mip-rum-poc` (`nupxrdpsliqptqnjkmgw`, eu-west-3 Paris, free tier) |
| Projet Vercel | `julian-talous-projects/mip-rum-console` |

Vérifié en live : préflight CORS origine G-IT → 204 ✅ · POST fixture → 200 + lignes en base ✅ · navigateur réel → cloud (5 vitals, CORS, beacon) ✅ · console branchée sur la base cloud (rôle lecture seule `console_ro`, TLS vérifié CA Supabase épinglée) ✅ · `/correlation` robot vs réel ✅.

> Les sections 1-3 ci-dessous documentent la procédure CLI équivalente (re-déploiement, autre environnement). Prérequis dans ce cas : `SUPABASE_ACCESS_TOKEN`/`VERCEL_TOKEN` ou login interactif. ⚠️ deux CLI vercel coexistent sur la machine : utiliser `~/.local/bin/vercel` (54.x), le brew (41.x) est trop vieux pour déployer.

## 1. Supabase — base + ingestion

```bash
cd mip-rum

# 1.1 Créer le projet (région Paris, narratif souveraineté) — ou via le dashboard
supabase projects create mip-rum-poc --org-id <ORG_ID> --region eu-west-3 --db-password '<PWD_FORT>'
# Récupérer le PROJECT_REF affiché (ex: abcdefghijklmnop)

# 1.2 Appliquer le schéma (tables + RPC + vue v_correlation)
supabase link --project-ref nupxrdpsliqptqnjkmgw
psql "$(supabase status 2>/dev/null | grep -o 'postgresql://.*')" -f apps/ingest/sql/schema.sql \
  || psql "postgresql://postgres:<PWD_FORT>@db.nupxrdpsliqptqnjkmgw.supabase.co:5432/postgres" -f apps/ingest/sql/schema.sql

# 1.3 Déployer l'edge function OTLP
#     ⚠️ --no-verify-jwt OBLIGATOIRE : les beacons navigateur n'ont pas de header Authorization
cd apps/ingest
supabase functions deploy v1-traces --project-ref nupxrdpsliqptqnjkmgw --no-verify-jwt
# (SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont injectées automatiquement dans la function)
```

Endpoint d'ingestion résultant : `https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces`
(Supabase impose le chemin `/functions/v1/<nom>` ; l'OTLP/HTTP accepte une URL d'endpoint arbitraire, le SDK la prend en config.)

### Vérifications immédiates (avant de toucher au site)

```bash
# CORS préflight depuis l'origine G-IT -> attendu: 204 + Access-Control-Allow-Origin
curl -si -X OPTIONS "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces" \
  -H "Origin: https://plateforme.groupement-it.com" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" | head -6

# POST d'un payload OTLP d'exemple -> attendu: {"partialSuccess":{}} puis 1 ligne en base
curl -s "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces" \
  -H "content-type: application/json" -H "Origin: https://plateforme.groupement-it.com" \
  -d @tests/fixtures/otlp-sample.json
```

## 2. Vercel — console RUM Live

```bash
cd apps/console
# DATABASE_URL = pooler Supabase (Settings > Database > Connection string, mode transaction, port 6543)
vercel env add DATABASE_URL production   # coller: postgres://console_ro.nupxrdpsliqptqnjkmgw:<PWD_console_ro>@aws-0-eu-west-3.pooler.supabase.com:6543/postgres
vercel --prod
# Noter l'URL: https://mip-rum-console.vercel.app  (sert aussi le SDK: /mip-rum.js)
```

> `apps/console/public/mip-rum.js` est le build IIFE du SDK (committé pour le POC).
> Pour le regénérer : `pnpm --filter @mip/rum-sdk build && cp packages/rum-sdk/dist/mip-rum.js apps/console/public/`.

## 3. Synthétique pour la corrélation (avant la démo)

```bash
# seed aligné sur l'app du vrai site (routes clés G-IT) — ou brancher l'API mippoc via l'adapter
DATABASE_URL="postgres://console_ro.nupxrdpsliqptqnjkmgw:<PWD_console_ro>@aws-0-eu-west-3.pooler.supabase.com:6543/postgres" \
  node apps/sync-synthetic/src/sync.mjs seed gip-plateforme
```

(Adapter les routes de `SEED_MEASURES` dans `apps/sync-synthetic/src/sync.mjs` aux routes réelles de la plateforme si besoin. La source réelle mippoc se branche en implémentant `fetchSnapshots()` — interface `SyntheticSource`, cf. BUILD_LOG S5.)

## 4. Snippet à coller dans le `<head>` de plateforme.groupement-it.com

**Action humaine (Julian)** — URLs réelles déjà en place, coller tel quel :

```html
<!-- MIP RUM — POC (retirer après la démo) -->
<script src="https://mip-rum-console.vercel.app/mip-rum.js"></script>
<script>
  MIPRum.init({
    endpoint: "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces",
    appId: "gip-plateforme",
    clientId: "groupement-it",
    env: "prod",
    sampleRate: 1.0
  });
</script>
```

### Test non-intrusif d'abord (PLAN §6.5) — bookmarklet, sans toucher au site

Créer un favori avec cette URL, l'ouvrir sur la plateforme :

```
javascript:(()=>{const s=document.createElement('script');s.src='https://mip-rum-console.vercel.app/mip-rum.js';s.onload=()=>MIPRum.init({endpoint:'https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces',appId:'gip-plateforme',clientId:'groupement-it',env:'prod',sampleRate:1.0});document.head.appendChild(s)})()
```

## 5. Recette finale (DoD PLAN §2.2)

1. Naviguer sur la plateforme (2-3 pages, fermer l'onglet) → onglet Réseau : POST OTLP JSON visibles (preuve « OTel sur le fil »).
2. `select * from rum_metric order by id desc limit 10;` (SQL editor Supabase) → vitals avec `app_id='gip-plateforme'`.
3. Console Vercel : Overview p75 + Pages + Erreurs + Sessions alimentées.
4. `/correlation` : robot vs réel pour ≥1 route, écart surligné.

## Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Erreur CORS dans la console navigateur | origine absente de la whitelist | `ALLOWED_ORIGINS` dans `apps/ingest/supabase/functions/v1-traces/index.ts`, redéployer |
| 401 sur le POST | function déployée avec verify_jwt | redéployer avec `--no-verify-jwt` |
| Rien en base mais POST 200 | `mip.app_id` manquant (payload rejeté) | vérifier `appId` dans `MIPRum.init` |
| Console vide | `DATABASE_URL` manquant/faux sur Vercel | `vercel env ls` / re-add + redeploy |
