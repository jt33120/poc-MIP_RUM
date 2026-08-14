# DEPLOY — Mise en production (Neon + Vercel + snippet G-IT)

> **⚠ Le projet Supabase `mip-rum-poc` n'existe plus** (constaté le 14/08/2026 :
> plus aucun enregistrement DNS, API de gestion `"Resource has been removed"`).
> Toute la pile a été déplacée : la **base** sur Neon (région UE), et
> l'**ingestion** — qui tournait sur le compute Supabase — dans la console
> Next.js sur Vercel. Le détail, les vérifications et ce qui reste à faire sont
> dans **`docs/NEON_MIGRATION.md`**.
>
> **L'ingestion ne redémarrera pas tant que le snippet du client pointe vers
> l'ancienne URL Supabase** (§4 ci-dessous).

| Ressource | URL |
|---|---|
| Ingestion OTLP | `https://mip-rum-console.vercel.app/api/ingest/v1/traces` |
| Ingestion logs | `https://mip-rum-console.vercel.app/api/ingest/v1/logs` |
| Ingestion replay | `https://mip-rum-console.vercel.app/api/ingest/v1/replay` |
| Console RUM Live | `https://mip-rum-console.vercel.app` |
| SDK hébergé | `https://mip-rum-console.vercel.app/mip-rum.js` |
| Base de données | Neon `mip-rum-poc-eu` (`rough-firefly-49250892`, **aws-eu-central-1**, base `neondb`) |
| Projet Vercel | `julian-talous-projects/mip-rum-console` |

## 1. Neon — base de données

La base est déjà en place (schéma v51 + données migrées et vérifiées, cf.
`docs/NEON_MIGRATION.md`). Pour repartir de zéro sur un nouveau projet Neon :

```bash
# 1.1 Créer le projet — RÉGION UE obligatoire (résidence des données annoncée
#     dans le README, docs/CONFORMITE.md et docs/DPA.md).
NEON_API_KEY=<clé> npx neonctl@latest projects create \
  --name mip-rum-poc-eu --region-id aws-eu-central-1 --pg-version 17

# 1.2 Appliquer le schéma puis TOUTES les migrations, dans l'ordre (identique
#     à ce que rejoue la CI contre un Postgres vierge).
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/ingest/sql/schema.sql
for f in apps/ingest/sql/migration-v*.sql; do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f"
done

# 1.3 Rôle de connexion restreint de la console (créé NOLOGIN par migration-v47 ;
#     lui donner un mot de passe pour qu'il puisse se connecter).
psql "$DATABASE_URL" -c "alter role console_ro login password '<PWD_FORT>'"
```

> **Extensions.** `pg_net` n'existe pas sur Neon et `pg_cron` ne s'installe que
> dans la base `postgres` du projet : les blocs `cron.schedule(...)` /
> `net.http_post(...)` des migrations sont sautés silencieusement (ils sont tous
> gardés par `if exists (pg_extension …)`). Leur remplacement est en §6.

> **Clé d'API d'ingestion (`REQUIRE_API_KEY`).** Par défaut l'ingestion est
> *fail-open*. Une fois toutes les apps porteuses d'une clé, passer
> `REQUIRE_API_KEY=true` pour rejeter (403) tout `app_id` inconnu **ou sans clé**
> (durcissement E1-S1) — sinon un tiers peut injecter sous l'`app_id` d'une app
> sans clé.

### Vérifications immédiates (après déploiement Vercel, avant de toucher au site)

```bash
# CORS préflight depuis l'origine G-IT -> attendu: 204 + Access-Control-Allow-Origin
curl -si -X OPTIONS "https://mip-rum-console.vercel.app/api/ingest/v1/traces" \
  -H "Origin: https://plateforme.groupement-it.com" \
  -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type" | head -6

# POST d'un payload OTLP d'exemple -> attendu: {"partialSuccess":{}} puis 1 ligne en base
curl -s "https://mip-rum-console.vercel.app/api/ingest/v1/traces" \
  -H "content-type: application/json" -H "Origin: https://plateforme.groupement-it.com" \
  -d @tests/fixtures/otlp-sample.json
```

## 2. Vercel — console RUM Live

```bash
cd apps/console
# DATABASE_URL = rôle console_ro sur Neon (mot de passe généré lors de la migration
# du 13/08/2026, transmis hors-repo à Julian ; pour le régénérer :
# Neon console > Roles > console_ro > Reset password, ou
# ALTER ROLE console_ro LOGIN PASSWORD '…' via le SQL editor Neon). Utiliser l'endpoint POOLER
# (ajouter -pooler au nom d'hôte, cf. Neon console > Connection Details) plutôt que
# l'endpoint direct : la console ouvre plusieurs connexions par instance serverless.
vercel env add DATABASE_URL production   # coller: postgres://console_ro:<PWD_console_ro>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
# AUTH_SECRET = secret de signature des sessions JWT — OBLIGATOIRE en prod (sinon la
# console refuse de démarrer : fail-closed, jamais le secret de dev versionné).
vercel env add AUTH_SECRET production    # coller: openssl rand -hex 32
# METRICS_TOKEN = (optionnel) active GET /api/metrics (Prometheus, santé interne).
# Non défini ⇒ endpoint désactivé (404, fail-closed). Scrape : Authorization: Bearer <token>.
vercel env add METRICS_TOKEN production  # coller: openssl rand -hex 32
vercel --prod
# Noter l'URL: https://mip-rum-console.vercel.app  (sert aussi le SDK: /mip-rum.js)
```

> **Rôle de connexion.** La console se connecte sous le rôle restreint **`console_ro`**
> (pas `postgres`) : RLS reste actif et l'accès passe par des policies dédiées `cro_*`.
> Le modèle COMPLET est codifié dans les migrations — tables de base + écriture + vues en
> **`migration-v16.sql`** (parité repo↔live), tables ultérieures dans leur migration (v12,
> v13, v15). Un déploiement propre reproduit donc l'accès console sans geste manuel.
> Si une table console reste vide en prod alors que les données existent, vérifier sa
> policy `console_ro` :
> `psql "$DATABASE_URL" -c "select tablename, policyname from pg_policies where 'console_ro'=any(roles)"`.

> `apps/console/public/mip-rum.js` est le build IIFE du SDK (committé pour le POC).
> Pour le regénérer : `pnpm --filter @mip/rum-sdk build && cp packages/rum-sdk/dist/mip-rum.js apps/console/public/`.

## 3. Synthétique pour la corrélation (avant la démo)

```bash
# seed aligné sur l'app du vrai site (routes clés G-IT) — ou brancher l'API mippoc via l'adapter
DATABASE_URL="$DATABASE_URL" node apps/sync-synthetic/src/sync.mjs seed gip-plateforme
```

(Adapter les routes de `SEED_MEASURES` dans `apps/sync-synthetic/src/sync.mjs` aux routes réelles de la plateforme si besoin. La source réelle mippoc se branche en implémentant `fetchSnapshots()` — interface `SyntheticSource`, cf. BUILD_LOG S5.)

## 4. Snippet à coller dans le `<head>` de plateforme.groupement-it.com

**Action humaine (Julian)** — URLs réelles déjà en place, coller tel quel :

```html
<!-- MIP RUM — POC (retirer après la démo) -->
<script src="https://mip-rum-console.vercel.app/mip-rum.js"></script>
<script>
  MIPRum.init({
    endpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
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
javascript:(()=>{const s=document.createElement('script');s.src='https://mip-rum-console.vercel.app/mip-rum.js';s.onload=()=>MIPRum.init({endpoint:'https://mip-rum-console.vercel.app/api/ingest/v1/traces',appId:'gip-plateforme',clientId:'groupement-it',env:'prod',sampleRate:1.0});document.head.appendChild(s)})()
```

## 5. Recette finale (DoD PLAN §2.2)

1. Naviguer sur la plateforme (2-3 pages, fermer l'onglet) → onglet Réseau : POST OTLP JSON visibles (preuve « OTel sur le fil »).
2. `select * from rum_metric order by id desc limit 10;` (SQL editor Neon) → vitals avec `app_id='gip-plateforme'`.
3. Console Vercel : Overview p75 + Pages + Erreurs + Sessions alimentées.
4. `/correlation` : robot vs réel pour ≥1 route, écart surligné.

## 6. Tâches planifiées (rétention, rollups, metering, alertes)

`pg_cron` et `pg_net` ne sont pas utilisables sur Neon (cf.
`docs/NEON_MIGRATION.md` §3.3-3.4). La planification passe par **Vercel Cron**,
déclaré dans `apps/console/vercel.json`, vers trois routes :

| Route | Planification | Contenu |
|---|---|---|
| `/api/cron/tick` | `*/5 * * * *` | `check_alerts`, `check_slo_burn`, sonde uptime, livraison des webhooks, réconciliation |
| `/api/cron/hourly` | `5 * * * *` | `refresh_rum_rollups(26)`, `check_new_errors`, `check_ai_op_anomalies` |
| `/api/cron/daily` | `17 3 * * *` | `purge_rum_tenants(30)`, `meter_tenant_usage()` |

```bash
# OBLIGATOIRE : sans CRON_SECRET, les routes refusent (503, fail-closed) et
# RIEN ne tourne — ni purge, ni rollups, ni alertes.
vercel env add CRON_SECRET production     # coller: openssl rand -hex 32
```

Déclenchement manuel (debug) :

```bash
curl -sS -H "Authorization: Bearer $CRON_SECRET" \
  https://mip-rum-console.vercel.app/api/cron/tick
# -> 200 si toutes les étapes passent, 207 en échec partiel (détail par étape)
```

Les fonctions SQL sous-jacentes n'ont pas changé et restent appelables à la
main :

```bash
psql "$DATABASE_URL" -c "select purge_rum_tenants(30)"   # {app: lignes supprimées}
psql "$DATABASE_URL" -c "select check_alerts()"
```

Hors Vercel (self-host), les runners Node historiques restent valables :

```bash
RETENTION_DAYS=30 node apps/ingest/purge.mjs --loop
node apps/ingest/dispatch-alerts.mjs --loop
```

## Dépannage

| Symptôme | Cause probable | Fix |
|---|---|---|
| Erreur CORS dans la console navigateur | origine absente de la whitelist | socle statique dans `apps/ingest/supabase/functions/_shared/cors.mjs`, ou `app_registry.allowed_origins` de l'app (pris en compte sans redéploiement, cache 60 s) |
| **302 vers `/login` sur le POST d'ingestion** | `/api/ingest/*` ne contourne plus le middleware d'auth | vérifier le bypass en tête de `apps/console/middleware.ts` — sans lui, TOUTE l'ingestion tombe en silence |
| 403 sur le POST | `REQUIRE_API_KEY=true` et l'app n'a pas de clé (ou clé fausse) | donner une clé à l'app (`app_registry.api_key_hash`) **avant** d'activer le flag, ou repasser à `false` |
| Rien en base mais POST 200 | `mip.app_id` manquant (payload rejeté) | vérifier `appId` dans `MIPRum.init` |
| Console vide | `DATABASE_URL` manquant/faux sur Vercel | `vercel env ls` / re-add + redeploy |
| Purge/rollups/alertes ne tournent pas | `CRON_SECRET` non défini ⇒ routes cron en 503 (fail-closed) | `vercel env add CRON_SECRET production` puis redeploy (cf. §6) |
| Alertes jamais livrées | `pg_net` n'existe pas sur Neon : la livraison passe par `/api/cron/tick` | vérifier que le cron tourne et que `alert_delivery.status` sort de `queued` |
