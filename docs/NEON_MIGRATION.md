# Migration Supabase → Neon (13–14/08/2026)

> **Document historique, relu le 26/09/2026.** Il raconte la migration du 13–14/08/2026 et reste cité
> comme tel (`apps/console/lib/legal.ts`, `DEPLOY.md`). Trois choses ont changé depuis, et les sections
> concernées le disent en place : la planification (§ 3.3) et la livraison des webhooks (§ 3.4) sont
> passées au service Railway `scheduler` ([ADR-0008](architecture/adr/0008-scheduler-unique.md)) ; la base
> est restée sur l'offre gratuite de Neon, dont le quota de calcul a été dépassé le 24/09/2026 — calcul
> suspendu jusqu'au 01/10/2026 ([ADR-0014](architecture/adr/0014-base-gratuite.md)). L'exploitation
> d'aujourd'hui est au [runbook](operations/runbook.md), la topologie à [TOPOLOGIE_BACKEND.md](TOPOLOGIE_BACKEND.md).

> **État au 14/08/2026.** Le projet Supabase `mip-rum-poc`
> (`nupxrdpsliqptqnjkmgw`) **n'existe plus** : son sous-domaine ne résout plus
> (aucun enregistrement DNS) et l'API de gestion répond
> `"Resource has been removed"` (HTTP 400) là où un projet vivant répond 200.
> Il a donc disparu APRÈS la copie de la base (celle-ci a bien été lue
> intégralement le 13/08). **Aucune donnée n'a été perdue** — la copie vérifiée
> sur Neon fait foi. En revanche l'ingestion, qui vivait sur le compute
> Supabase, est tombée avec lui : c'est ce que la reprise décrite plus bas
> rétablit.

## 1. Base de données — faite et vérifiée

La base de prod vit désormais sur Neon, **en région UE** : projet
`mip-rum-poc-eu` (`rough-firefly-49250892`), `aws-eu-central-1` (Francfort),
Postgres 17, base `neondb`.

> Une première copie avait été faite sur un projet `aws-us-east-2` (Ohio) — la
> chaîne de connexion fournie au départ. Elle a été refaite en UE parce que la
> résidence européenne est un argument produit explicite (README,
> `docs/CONFORMITE.md`, `docs/DPA.md`) pour un client GIP français : la laisser
> aux États-Unis aurait rendu ces documents faux. Le projet Ohio a servi de
> source pour la copie UE (il contenait déjà la copie vérifiée prise pendant
> que Supabase existait encore) ; **il peut être supprimé** une fois la bascule
> confirmée.

- **Schéma** : `schema.sql` + les 49 migrations (`v02` → `v51`), dans l'ordre —
  le jeu exact que la CI rejoue contre un Postgres vierge — appliqués statement
  par statement (283 statements, aucune erreur). Neon est au niveau **v51**,
  celui du repo. La base Supabase, elle, s'était arrêtée un cran avant : Neon a
  donc 6 tables `svi_*` vides en plus, prêtes pour l'ingestion SVI.
- **Données** : les 36 tables `public`, **250 738 lignes**, comptage vérifié
  **table par table, 36/36 identiques**.
- **`replay_chunk`** (binaire `bytea`, chunks rrweb gzippés, 18,7 Mo) :
  vérifié par **md5 agrégé sur les 527 lignes** (`md5(string_agg(md5(body)…))`),
  identique des deux côtés — vérification exhaustive, pas un échantillon.
- **Rôle `console_ro`** : recréé avec `LOGIN` + mot de passe généré (transmis
  hors-repo), `rolbypassrls=false`. ⚠ **Ce n'est PAS le rôle à mettre dans
  `DATABASE_URL`** — voir §3.2 : la console serait vide. Ses grants ont dû être
  posés en rejouant les migrations APRÈS création du rôle (les blocs `grant` sont
  gardés par `if exists (pg_roles …)`, et `console_ro` n'est créé qu'en v47 : au
  premier passage ils étaient tous sautés).
- **Séquences** (`bigserial` / `identity`) réalignées sur le `max(id)` chargé,
  pour qu'un insert applicatif ne percute pas un id repris.

## 2. Ingestion — déplacée du compute Supabase vers la console Vercel

Les 4 edge functions (`v1-traces`, `v1-logs`, `v1-replay`, `uptime`) tournaient
sur le compute Supabase (Deno + `supabase-js`). Neon ne fournit pas de compute :
elles n'y avaient nulle part où tourner, et elles ont disparu avec le projet.

Elles sont reprises **dans la console Next.js déjà déployée sur Vercel** :

| Avant (Supabase, mort) | Maintenant (Vercel) |
|---|---|
| `…supabase.co/functions/v1/v1-traces` | `https://mip-rum-console.vercel.app/api/ingest/v1/traces` |
| `…supabase.co/functions/v1/v1-logs` | `https://mip-rum-console.vercel.app/api/ingest/v1/logs` |
| `…supabase.co/functions/v1/v1-replay` | `https://mip-rum-console.vercel.app/api/ingest/v1/replay` |

Le suffixe `/v1/traces` est conservé À DESSEIN : le SDK dérive l'endpoint replay
en remplaçant `/v1/traces` par `/v1/replay`
(`packages/rum-sdk/src/replay.ts`). Le client n'a donc qu'**un seul** champ à
changer dans son snippet (`endpoint`), et le replay suit tout seul.

**Pas de réécriture de la logique** : les inserts et l'auth vivent dans
`packages/backend/lib/pg-ingest.mjs`, importé à la fois par le dev-server Node et par
les routes Next.js — une seule implémentation, dans le même esprit que
`packages/backend/shared/otlp.mjs` pour le parsing (le dev-server est aujourd'hui
`services/collector/dev-server.mjs`). Les gardes de prod sont conservées à
l'identique : 413 sur la taille, 403 sur la clé d'API, 429 sur le débit
(compteur durable `rate_check`), séparation stricte 400 (requête fautive) /
500 (incident rejouable), écriture idempotente (`on conflict do nothing`).

Le middleware d'auth de la console laisse passer `/api/ingest/*` : les beacons
viennent de navigateurs anonymes sur le site du client, sans cookie de session.
Sans ce bypass, chaque beacon recevrait un 302 vers `/login` et l'ingestion
tomberait en silence (le SDK ne suit pas les redirections). L'authentification
d'ingestion reste la clé d'API dans le handler + le rate limit + la whitelist
CORS.

### Vérifié en exécution réelle (Postgres local, schéma + 49 migrations)

- POST des fixtures OTLP → `200 {"partialSuccess":{}}` + lignes réellement
  écrites (`rum_session`, `rum_pageview`, `rum_metric`, `rum_error`,
  `rum_resource`, `rum_longtask`, `rum_breadcrumb`).
- **Idempotence** : rejouer le même payload ne duplique rien (compte inchangé).
- `/v1/logs` → lignes dans `rum_log`. `/v1/replay` (corps gzip) → chunk stocké
  compressé, `events_count` correct.
- Préflight CORS depuis `https://plateforme.groupement-it.com` → 204 +
  `Access-Control-Allow-Origin` ; origine non autorisée → **aucun** en-tête
  `Allow-Origin`.
- JSON invalide → **400** (et non 500) ; corps replay non gzip → 400.
- 13 tests unitaires ajoutés sur le modèle d'auth porté (`tests/unit/pg-ingest.test.ts`) :
  keyless rejeté sous `REQUIRE_API_KEY` (durcissement E1-S1), app inconnue
  rejetée, fail-open si le registre n'a jamais chargé, fenêtre glissante,
  compteurs par app, repli si le SQL de débit tombe.

## 3. Ce qui reste à faire — action humaine requise

> Les points 3.3 (planification) et 3.4 (webhooks) sont **traités dans le
> code** ; il reste à définir `CRON_SECRET` sur Vercel pour qu'ils tournent.
> *(Au 14/08. Depuis le 25/09/2026, plus aucun code ne lit `CRON_SECRET` : voir § 3.3.)*

### 3.1 Mettre à jour le snippet chez le client (SEUL geste qui rétablit l'ingestion)

Tant que ce n'est pas fait, `plateforme.groupement-it.com` poste dans le vide :
l'ancienne URL n'existe plus. Dans le `<head>` du site (repo `uti-platform`) :

```diff
 <script>
   MIPRum.init({
-    endpoint: "https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces",
+    endpoint: "https://mip-rum-console.vercel.app/api/ingest/v1/traces",
     appId: "gip-plateforme",
     clientId: "groupement-it",
     env: "prod",
     sampleRate: 1.0
   });
 </script>
```

### 3.2 Variables d'environnement Vercel

- `DATABASE_URL` → Neon UE, rôle **`neondb_owner`** (⚠ **pas** `console_ro`),
  **endpoint pooler**. C'est ce qui bascule réellement la prod sur Neon.

  **Pourquoi pas `console_ro`, contrairement à l'ère Supabase.** La base Neon
  porte toutes les migrations, dont **v47**, qui remplace les policies permissives
  `using (true)` par un filtrage réel `app_id = any(current_app_ids())` visant
  `console_ro`. Cette fonction lit la GUC `app.current_app_id`, posée uniquement
  par `withTenant()` — or la console fait ~53 requêtes `q()` directes contre
  **une seule** via `withTenant()`. Mesuré sur la base de prod :

  | Rôle | Lignes visibles dans `rum_session` |
  |---|---|
  | `neondb_owner` | **407** |
  | `console_ro` (requêtes actuelles) | **0** → console vide |
  | `console_ro` + GUC | 23 |

  Sur Supabase, `console_ro` marchait parce que **v47 n'y avait jamais été
  appliquée** : le filtrage y était décoratif. On ne perd donc aucune protection
  réelle. Le durcissement (repasser à `console_ro`) est un chantier à part :
  faire passer les requêtes par `withTenant()` puis re-tester chaque page.

- `CRON_SECRET` → sinon les routes planifiées répondent 503 (fail-closed) et rien
  ne tourne. **La même valeur** doit être posée en secret GitHub Actions.
- `REQUIRE_API_KEY` : laisser à `false` tant que **toutes** les apps actives
  n'ont pas de clé — sinon 403 immédiat (durcissement E1-S1).

### 3.3 Planification — passée de `pg_cron` à Vercel Cron (fait)

> **Remplacé.** Le service Railway `scheduler` est devenu le seul déclencheur des
> travaux planifiés, sous un bail par cadence ([ADR-0008](architecture/adr/0008-scheduler-unique.md)).
> Le 23/09/2026 (commit `be290595`), les routes `/api/cron/*` sont passées à 410 et
> le workflow GitHub `cron.yml` et l'entrée `crons` de Vercel ont disparu ; les routes
> ont été supprimées le 25/09 (commit `2aecc493`). Le rejeu manuel d'une cadence passe
> par `services/scheduler/run-once.mjs`. Ce qui suit décrit l'état du 14/08.

`pg_cron` existe sur Neon (v1.6) mais ne s'installe QUE dans la base `postgres`
du projet, jamais dans `neondb` (`create extension pg_cron` y échoue :
*"can only create extension in database postgres"*, vérifié). Tous les blocs
`cron.schedule(...)` des migrations sont gardés par
`if exists (pg_extension where extname='pg_cron')` : sur `neondb` le test est
faux, ils sont sautés, et **aucun job planifié ne tournait**.

`cron.schedule_in_database(...)` depuis la base `postgres` du projet (la voie
recommandée par Neon) a aussi été essayée : **refusée** —
`permission denied to create extension "pg_cron"`. pg_cron est donc hors jeu,
pas seulement mal placé.

Les fonctions SQL sont inchangées — seul le DÉCLENCHEUR bouge. Trois routes
(`apps/console/app/api/cron/*`) :

| Route | Planification | Déclenchée par | Remplace |
|---|---|---|---|
| `/api/cron/tick` | `*/5 * * * *` | GitHub Actions | `mip-slo-burn`, `mip-uptime`, `reconcile-alert-deliveries`, + `check_alerts()` et la livraison des webhooks |
| `/api/cron/hourly` | `5 * * * *` | GitHub Actions | `refresh_rum_rollups`, `mip-new-errors`, `mip-ai-op-anomaly` |
| `/api/cron/daily` | `17 3 * * *` | **Vercel Cron** | `mip-purge-daily` (`purge_rum_tenants`), `mip-meter-daily` |

⚠ **Pourquoi deux déclencheurs.** Le plan Vercel **Hobby n'accepte que des crons
quotidiens** : déclarer `*/5 * * * *` dans `vercel.json` fait échouer le
déploiement ENTIER (constaté sur la PR — le message est explicite : *"Hobby
accounts are limited to daily cron jobs"*). Seul le job quotidien reste donc sur
Vercel ; les deux fréquences courtes passent par
`.github/workflows/cron.yml`, gratuit et sans limite de minutes sur ce dépôt
(public). Limites à connaître : le cron GitHub est best-effort (décalages de
quelques minutes possibles) et GitHub désactive les workflows planifiés après
60 jours sans activité sur le dépôt.

**Alternative propre si ces limites gênent** : passer Vercel en **Pro**, remettre
les trois entrées dans `vercel.json` et supprimer le workflow GitHub.

**Secrets requis** : `CRON_SECRET` **à la fois** dans les variables d'env Vercel
(la route le vérifie) et dans les secrets GitHub Actions (l'appelant l'envoie).
Les deux doivent porter la MÊME valeur, sinon 401.

**Auth** : `Authorization: Bearer $CRON_SECRET`, vérifié dans le handler
(le middleware laisse passer `/api/cron/*`, un scheduler n'ayant pas de cookie).
**Fail-closed** : sans `CRON_SECRET` défini, les routes refusent (503) plutôt
que de s'ouvrir — elles purgent des données et postent des webhooks.
⚠ **`CRON_SECRET` doit donc être défini sur Vercel**, sinon rien ne tourne.

Un échec n'annule pas les étapes suivantes : chaque étape est rapportée
individuellement (200 si tout passe, 207 en échec partiel, visible dans les
logs Vercel).

⚠ **Deux fréquences sont RÉDUITES** : `check_new_errors` passe de 15 min à
1 h, `check_ai_op_anomalies` de 30 min à 1 h — pour tenir dans le nombre de
jobs Vercel Cron. Une nouvelle erreur peut donc mettre jusqu'à 1 h à lever une
alerte. Si c'est trop, les sortir dans leur propre route planifiée.

### 3.4 Webhooks d'alerte — `pg_net` remplacé par le dispatcher Node (fait)

> **Depuis** : `dispatchOnce()` n'est plus appelé par une route de la console mais
> par le `scheduler` en service, à chaque tick. Le code de `master` confie la
> livraison au service `notifier` (`SCHEDULER_DELIVERY: "off"` dans `.railway/railway.ts`),
> déclaré mais pas encore créé sur Railway (relevé du 26/09/2026).

`create extension pg_net` est refusé sur Neon (*"not in the allowed extensions
list"*) : les alertes qui postaient via `net.http_post` **ne pouvaient plus
partir**. La livraison passe désormais par `dispatchOnce()`
(`packages/backend/lib/dispatch-alerts.mjs`, déjà écrit pour le cas local), appelé à
chaque tick de 5 min. Le rejeu borné avec backoff exponentiel et le passage en
`dead` au plafond sont conservés tels quels.

Vérifié bout en bout : une livraison `queued` est réellement POSTée (payload
Slack-compatible identique à celui de `check_alerts`), et la ligne passe à
`delivered / http 200`.

### 3.5 Sécurité — signalé, pas corrigé

`public.alert_config` a RLS désactivé (constaté côté Supabase, répliqué à
l'identique sur Neon). Non corrigé : activer RLS sans policy rendrait la table
illisible. À trancher :

```sql
ALTER TABLE public.alert_config ENABLE ROW LEVEL SECURITY;
-- + une policy adaptée, sinon la table devient inaccessible
```

### 3.6 Comprendre la disparition du projet Supabase

Le projet a été supprimé sans que ce soit une action de cette session. Vaut la
peine de vérifier l'historique du compte Supabase, les e-mails de notification,
et qui d'autre avait accès à l'organisation `rhvtwqcgdyqnxaqtxqgk`.

## 4. Rollback

Il n'y a plus de rollback vers Supabase : le projet n'existe plus. Le filet est
la double copie Neon (Ohio + UE), toutes deux vérifiées.
