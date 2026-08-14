# Migration Supabase → Neon (13–14/08/2026)

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
  hors-repo), `rolbypassrls=false` — identique à la posture du rôle Supabase.
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
`apps/ingest/lib/pg-ingest.mjs`, importé à la fois par le dev-server Node et par
les routes Next.js — une seule implémentation, dans le même esprit que
`_shared/otlp.mjs` pour le parsing. Les gardes de prod sont conservées à
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

- `DATABASE_URL` → Neon UE, rôle `console_ro`, **endpoint pooler**
  (cf. `DEPLOY.md` §2). C'est ce qui bascule réellement la prod sur Neon.
- `REQUIRE_API_KEY` : laisser à `false` tant que **toutes** les apps actives
  n'ont pas de clé — sinon 403 immédiat (durcissement E1-S1).

### 3.3 `pg_cron` — absent de `neondb`

`pg_cron` existe sur Neon (v1.6) mais ne s'installe QUE dans la base `postgres`
du projet, jamais dans `neondb` (`create extension pg_cron` y échoue :
*"can only create extension in database postgres"*, vérifié). Toutes les
migrations gardent leurs `cron.schedule(...)` derrière
`if exists (pg_extension where extname='pg_cron')` : sur `neondb` le test est
faux, les blocs sont sautés, **et tous les jobs planifiés sont donc inactifs**
(purge de rétention, rollups horaires, metering, SLO burn, anomalies, nouvelles
erreurs, sonde uptime, réconciliation des livraisons d'alerte). Rien ne casse —
tout est fail-soft — mais rien ne tourne. Deux voies : `cron.schedule_in_database(…,
database := 'neondb')` depuis la base `postgres` du projet, ou Vercel Cron
appelant des routes dédiées.

### 3.4 `pg_net` — indisponible sur Neon

`create extension pg_net` est refusé (*"not in the allowed extensions list"*).
Les alertes webhook qui postaient via `net.http_post` **ne peuvent pas
fonctionner** sur Neon. Le seul chemin est le dispatcher Node déjà écrit pour ce
cas (`apps/ingest/dispatch-alerts.mjs`), qui a besoin d'un hôte.

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
