# DEPLOY — Mise en production (Neon + Railway + Vercel + snippet G-IT)

> **Le backend a quitté Vercel.** L'ingestion OTLP et les travaux planifiés
> tournent désormais sur un projet Railway dédié, `mip-rum-backend` — voir la
> section **1 bis**. La console reste sur Vercel et devient un client de ces
> services. Les routes `/api/ingest/*` et `/api/cron/*` de la console
> subsistent comme filet le temps de la bascule ; elles appellent exactement le
> même code (`apps/ingest`), donc les deux chemins ne peuvent pas diverger.

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

> **Extensions.** Ni `pg_net` ni `pg_cron` ne sont utilisables sur Neon
> (`pg_net` absent de la liste autorisée ; `pg_cron` refusé à la création, y
> compris dans la base `postgres` du projet). Les blocs `cron.schedule(...)` /
> `net.http_post(...)` des migrations sont donc sautés silencieusement — ils sont
> tous gardés par `if exists (pg_extension …)`. Leur remplacement est en §6.

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

## 1 bis. Railway — le backend

Projet `mip-rum-backend`, environnement `production`. Trois services.

| Service | Image | Commande | Écoute | Redémarrage |
|---|---|---|---|---|
| `ingest` | `Dockerfile.backend` | `node services/ingest/server.mjs` | oui, healthcheck `/health` | `ON_FAILURE`, 10 essais |
| `scheduler` | `Dockerfile.backend` | `node services/scheduler/worker.mjs` | facultatif (`/health`, `/status`) | `ALWAYS` |
| `mcp` | **`Dockerfile.mcp`** | `node services/mcp/http.mjs` | oui, healthcheck `/health` | `ON_FAILURE`, 10 essais |

Domaine public du serveur MCP : `https://mcp-production-201c.up.railway.app`
(`POST /mcp`, jeton porteur exigé — cf. `docs/MCP.md`).

`ingest` et `scheduler` partagent une image : même noyau, mêmes dépendances,
seule la commande change. `mcp` a la sienne — non par exception, mais parce
qu'**il ne doit pas pouvoir atteindre la base**. C'est le seul service
pilotable par un modèle de langage ; sans `pg` ni `DATABASE_URL`, une injection
de prompt réussie ne donne que ce que le jeton de l'appelant permettait déjà de
lire. Cf. `docs/MCP.md`.

**Les migrations sont une étape du déploiement.** Le service `ingest` porte la
commande pre-deploy `node node_modules/ingest/migrate.mjs` : le schéma ne peut
plus être en retard sur le code. Le runner tient un registre `schema_migration`,
applique chaque fichier dans sa propre transaction, et sait adopter une base
existante sans rien rejouer.

### Variables

`DATABASE_URL` est la SEULE variable indispensable, et elle n'est pas dans le
dépôt : la poser dans Railway (Variables du service, ou variable partagée de
l'environnement). Même valeur que sur Vercel — rôle `neondb_owner`, endpoint
pooler. Sans elle, la commande pre-deploy s'arrête net sur
`{"level":"error","service":"migrate","msg":"DATABASE_URL absent"}` : c'est le
comportement voulu, pas une panne.

| Variable | Service | Valeur posée |
|---|---|---|
| `DATABASE_URL` | `ingest`, `scheduler` | **à poser** |
| `MIGRATE_BASELINE` | `ingest` | `migration-v51.sql` |
| `REQUIRE_API_KEY` | `ingest` | `false` |
| `RATE_LIMIT_PER_MIN` | `ingest` | `600` |
| `INGEST_DEFERRED` | `ingest` | `false` |
| `INGEST_DRAIN_MS` | `ingest` | `250` (si différé) |
| `PGPOOL_MAX` | `ingest` / `scheduler` | `8` / `4` |
| `PORT` | les trois | `8080` |
| `NODE_ENV`, `LOG_LEVEL` | `ingest`, `scheduler` | `production`, `info` |
| `MIP_CONSOLE_URL` | `mcp` | `https://mip-rum-console.vercel.app` |
| `GEOIP_IP_SOURCE` | `ingest` | **non posée** (= GeoIP éteint) |
| `GEOIP_DB_PATH` | `ingest` | non posée (base cherchée dans l'image) |
| `GEOIP_MAX_AGE_DAYS` | `ingest` | non posée (`180`) |

> **GeoIP optionnel (P8.7).** Éteint tant que `GEOIP_IP_SOURCE` n'est pas posée,
> et c'est voulu : un déploiement dont personne n'a décrit la façade ne doit pas
> deviner d'où lire une adresse IP. Valeurs : `none` (défaut), `socket` (adresse
> de la connexion), `railway` (`X-Real-IP`, exigée avec un marqueur d'arête
> Railway), `xff:<n>` (`X-Forwarded-For` avec `n` relais de confiance — on lit le
> n-ième EN PARTANT DE LA DROITE, ce qui ignore tout préfixe forgé par le client).
>
> **État de fait au 18/09/2026 : le service `ingest` n'a AUCUN domaine public**
> (relevé par l'API Railway). Le trafic de production entre par
> `https://mip-rum-console.vercel.app/api/ingest/v1/traces`, c'est-à-dire la
> console sur Vercel — où le pays vient du fuseau, et à défaut de
> `x-vercel-ip-country` (provenance `cdn`). Poser `GEOIP_IP_SOURCE` sur le
> service Railway ne changerait donc rien tant qu'aucun domaine ne l'expose. Le
> GeoIP local sert l'ingestion **auto-hébergée** — conteneur, VM, hébergeur
> souverain —, là où aucun CDN ne fournit d'en-tête pays.
>
> **La base n'est pas dans le dépôt** (4,5 Mio, renouvelée tous les mois).
> `Dockerfile.backend` la télécharge à la construction et vérifie son empreinte ;
> un échec n'arrête PAS la construction, l'image part alors sans base et
> l'ingestion fonctionne comme avant. `--build-arg GEOIP_FETCH=0` pour une
> construction sans sortie réseau ; la base se monte alors sur un volume via
> `GEOIP_DB_PATH`. Voir `apps/ingest/data/README.md`.
>
> `GET /health` du service `ingest` annonce l'état réel :
> `{"geoip":{"source_ip":"railway","etat":"actif","version":"dbip-country-lite-2026-09","raison":null}}`.

> **Ingestion différée (`INGEST_DEFERRED`).** À `true`, le receveur débarque le lot
> dans `ingest_raw` et rend la main ; un travailleur du même processus écrit la
> suite toutes les `INGEST_DRAIN_MS`. Mesuré : p95 divisé par deux, débit ×2,5
> (`scripts/bench-ingest.mjs`). **`ingest_raw` est UNLOGGED** : PostgreSQL la vide
> après un arrêt brutal, donc un lot acquitté `200` mais pas encore drainé est
> perdu définitivement. C'est pour ça que le défaut est `false` — le compromis se
> choisit. `/admin/health` montre la file, les lots abandonnés et l'âge du plus
> vieux ; `GET /health` du service annonce `ingest_deferred`.

**`mcp` ne prend ni `DATABASE_URL` ni jeton d'API**, et ce n'est pas un oubli :
il relaie le jeton de l'appelant vers l'API v1. Lui en donner un ferait de son
URL publique un contournement de l'authentification — quiconque la trouve lirait
les données de tous les clients. Il n'a donc aucun secret à stocker, ni à
faire fuir. Un domaine généré est en revanche nécessaire : c'est l'URL que les
clients MCP appelleront.

> **`scheduler_lease` est passée dans le schéma (v54).** Elle naissait à
> l'exécution, par le scheduler. La console la lit pourtant, sur la vitrine
> PUBLIQUE : tant que le scheduler n'avait pas tourné, chaque visite anonyme
> provoquait un `relation "scheduler_lease" does not exist`. Rien à faire côté
> production — la table existe déjà, la migration est un no-op sur elle.

**`MIGRATE_BASELINE=migration-v51.sql`, et pourquoi.** La base Neon est déjà au
niveau v51 mais n'a pas de registre : sans étalonnage, le premier passage
rejouerait 49 fichiers sur une base qui les a déjà. L'étalonnage les marque
comme appliqués SANS les exécuter, puis applique v52 et v53. La variable peut
rester posée : elle est sans effet une fois le registre écrit, et elle est
ignorée si la base est vierge (garde `to_regclass('public.rum_session')`) —
sans quoi une base recréée hériterait d'un registre qui ment.

### Région et branche — faits le 09/09/2026

Les trois services tournent en **`europe-west4-drams3a`** (Amsterdam) et suivent
**`master`**. Relevé dans `multiRegionConfig` des trois services après la
bascule depuis `us-west2` ; le journal du scheduler confirme la base atteinte :
`ep-old-math-b2lu8752-pooler.c-6.eu-central-1.aws.neon.tech`.

La région n'est **pas** exposée par l'API publique de Railway ni par
`update-service` (« Scaling (replicas/regions) … not handled by this tool »).
Deux façons de la changer : le tableau de bord, Service → Settings → Regions,
ou l'agent Railway, qui écrit `multiRegionConfig` puis commite les changements
en attente. Le retirer de l'ancienne région se fait en la passant à `null` dans
le même patch, sans quoi le service tourne dans les deux.

Amsterdam plutôt que Francfort : Railway n'offre pas Francfort. C'est la région
la plus proche de la base, à ~350 km — l'aller-retour transatlantique disparaît,
et le traitement reste en UE.

> Cela ne règle pas la souveraineté. Railway Corp est une société de droit
> américain, comme Vercel et Neon ; une région européenne n'y change rien. Le
> point reste listé comme bloquant sur la page de présentation.

### Le seul réglage qui reste manuel

**Jeton pour le MCP** : ajouter une entrée à `CONSOLE_API_TOKENS` **côté Vercel**
(pas côté Railway), scopée si le client MCP est un partenaire —
`jeton-uti@uti-portail` ne verra que cette app, par le serveur MCP comme par
l'API. Le service `mcp` n'a pas besoin d'en connaître la valeur : il relaie
celui de l'appelant.

> Railway Corp est une société de droit américain, comme Vercel et Neon. Ce
> déplacement rapproche le calcul de la donnée et lève les limites de
> planification ; il ne règle **pas** la question de la souveraineté, qui reste
> listée comme bloquante sur la page de présentation.

### Bascule de l'ingestion (à faire quand le backend est vérifié)

Une fois `ingest` en bonne santé et un domaine généré, pointer le SDK dessus :
`NEXT_PUBLIC_RUM_ENDPOINT` n'est plus lu pour le dogfooding (la console poste
toujours chez elle), donc la bascule se fait dans les extraits d'intégration
remis aux clients et dans `apps/console/lib/ingest-endpoint.ts`.

---

## 2. Vercel — console RUM Live

> **`regions: ["fra1"]` dans `apps/console/vercel.json`.** Sans cette clé, les
> fonctions serveur étaient servies depuis `iad1` (Washington) — mesuré à
> l'en-tête `x-vercel-id`. La base est à Francfort : chaque rendu de page
> traversait l'Atlantique par requête SQL, et le traitement avait lieu hors UE.
> `fra1` est la même ville que la base.
>
> Le fichier n'accepte **aucune** propriété hors schéma : une clé de
> commentaire (`"//regions"`) fait échouer la validation et donc tout le
> déploiement — `should NOT have additional property`. Les explications vont
> ici, pas dans le JSON.

```bash
cd apps/console
# DATABASE_URL = rôle PROPRIÉTAIRE `neondb_owner` (⚠ PAS console_ro — voir l'encadré
# ci-dessous, ce serait une console vide). Utiliser l'endpoint POOLER (ajouter
# -pooler au nom d'hôte, cf. Neon console > Connection Details) plutôt que
# l'endpoint direct : la console ouvre plusieurs connexions par instance serverless.
vercel env add DATABASE_URL production   # coller: postgres://neondb_owner:<PWD>@<endpoint>-pooler.<region>.aws.neon.tech/neondb?sslmode=require
# AUTH_SECRET = secret de signature des sessions JWT — OBLIGATOIRE en prod (sinon la
# console refuse de démarrer : fail-closed, jamais le secret de dev versionné).
vercel env add AUTH_SECRET production    # coller: openssl rand -hex 32
# METRICS_TOKEN = (optionnel) active GET /api/metrics (Prometheus, santé interne).
# Non défini ⇒ endpoint désactivé (404, fail-closed). Scrape : Authorization: Bearer <token>.
vercel env add METRICS_TOKEN production  # coller: openssl rand -hex 32
# DEMO_USER_APPS = (optionnel) ouvre le compte de démonstration de la vitrine
# publique : /demo pose une session SANS mot de passe, en lecture seule, et le
# bouton « Voir le compte démo » apparaît sur /presentation. La valeur EST le
# périmètre : la liste des app_id visibles, séparés par des virgules. Non définie
# ⇒ démo fermée (aucun bouton, /demo renvoie vers /login) ; la retirer la referme.
# Aucune ligne à créer en base : la session est construite depuis cette variable,
# toujours en rôle viewer, jamais admin, jamais « toutes les apps ».
# ⚠ Ce que voient ces apps devient PUBLIC : routes, temps de chargement, messages
# d'erreur. À ne renseigner qu'avec des apps où c'est acceptable.
vercel env add DEMO_USER_APPS production   # coller: mip-rum-console,insight-performance
# DEMO_USER_EMAIL = (optionnel) étiquette de la session dans audit_log.
# Défaut: demo@mip-rum.local
vercel --prod
# Noter l'URL: https://mip-rum-console.vercel.app  (sert aussi le SDK: /mip-rum.js)
```

> **⚠ Rôle de connexion : `neondb_owner`, PAS `console_ro`.** C'est un changement
> par rapport à l'ère Supabase, et il est mesuré, pas théorique. La base Neon porte
> TOUTES les migrations, dont **v47**, qui remplace les anciennes policies
> permissives `using (true)` par un vrai filtrage `app_id = any(current_app_ids())`
> visant `console_ro`. Or `current_app_ids()` lit la GUC `app.current_app_id`, que
> seule `withTenant()` pose — et la console utilise ~53 requêtes `q()` directes
> contre **une seule** via `withTenant()`.
>
> Compté sur la base de prod Neon :
>
> | Rôle | Lignes visibles dans `rum_session` |
> |---|---|
> | `neondb_owner` (propriétaire) | **407** |
> | `console_ro` tel que la console interroge aujourd'hui | **0** → console entièrement vide |
> | `console_ro` + GUC posée | 23 (le tenant demandé) |
>
> Le propriétaire n'est pas soumis au RLS tant que `FORCE ROW LEVEL SECURITY` n'est
> pas posé — et v47 explique pourquoi il ne l'est délibérément pas (les fonctions
> `security definer` d'alerting/purge/metering verraient zéro ligne).
>
> **Sur Supabase, `console_ro` fonctionnait parce que v47 n'y avait jamais été
> appliquée** : les policies permissives d'origine laissaient tout passer. Le
> filtrage était donc décoratif là-bas — ce n'est pas une protection qu'on perd ici.
>
> **Durcissement (travail à part, non fait) :** repasser à `console_ro` suppose de
> faire passer les requêtes de la console par `withTenant()` (cf. `apps/console/lib/db.ts`),
> puis de re-tester chaque page. Tant que ce n'est pas fait, `console_ro` = console vide.
> Les grants du rôle sont en place sur Neon (il a fallu rejouer les migrations APRÈS
> la création du rôle : les blocs `grant` sont gardés par `if exists (pg_roles …)` et
> `console_ro` n'est créé qu'en v47, donc au premier passage ils étaient tous sautés).

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

| Route | Planification | Déclencheur | Contenu |
|---|---|---|---|
| `/api/cron/tick` | `*/5 * * * *` | GitHub Actions | `check_alerts`, `check_slo_burn`, sonde uptime, livraison des webhooks, réconciliation |
| `/api/cron/hourly` | `5 * * * *` | GitHub Actions | `refresh_rum_rollups(26)`, `check_new_errors`, `check_ai_op_anomalies` |
| `/api/cron/daily` | `17 3 * * *` | Vercel Cron | `purge_rum_tenants(30)`, `meter_tenant_usage()` |

⚠️ Le plan Vercel **Hobby n'accepte que des crons quotidiens** (un `*/5` dans
`vercel.json` fait échouer tout le déploiement). D'où le partage : le quotidien
sur Vercel, les deux autres via `.github/workflows/cron.yml`. En passant Vercel
en **Pro**, on peut tout remettre dans `vercel.json` et supprimer le workflow.

```bash
# OBLIGATOIRE : sans CRON_SECRET, les routes refusent (503, fail-closed) et
# RIEN ne tourne — ni purge, ni rollups, ni alertes.
vercel env add CRON_SECRET production     # coller: openssl rand -hex 32

# La MÊME valeur doit être posée en secret GitHub Actions (sinon les ticks
# fréquents reçoivent 401) :
#   Settings > Secrets and variables > Actions > New repository secret
#   nom: CRON_SECRET
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
