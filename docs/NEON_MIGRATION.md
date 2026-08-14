# Migration base de données Supabase → Neon (13/08/2026)

## Ce qui a été fait

- **Schéma** : `apps/ingest/sql/schema.sql` + les 49 migrations (`migration-v02`
  à `migration-v51`, dans l'ordre — le même jeu que rejoue la CI contre un
  Postgres vierge) rejouées intégralement sur Neon, statement par statement
  (283 statements, aucune erreur). Neon est donc au niveau **v51** — le repo —
  alors que la base Supabase de prod, vérifiée au même moment, s'arrête un cran
  avant (pas de tables `svi_*` : elles n'existent pas encore côté Supabase).
  Rien n'a été perdu ; Neon a simplement 6 tables vides en plus (`svi_call`,
  `svi_call_link`, `svi_leg`, `svi_quality_sample`, `svi_queue_sample`,
  `svi_step`), prêtes pour quand l'ingestion SVI sera activée.
- **Données** : les 36 tables `public` copiées intégralement — **251 059 lignes
  au total, comptage vérifié table par table (36/36 identiques)** entre
  Supabase et Neon au moment de la bascule. `replay_chunk` (données binaires
  `bytea`, chunks rrweb gzippés, 18,7 Mo) vérifié **octet pour octet** (md5
  identique de chaque côté sur échantillon). Colonnes `jsonb` (attribution web-
  vitals, layout dashboard…) vérifiées structurellement intactes.
- **Rôle `console_ro`** : recréé sur Neon avec `LOGIN` + mot de passe généré
  (transmis hors-repo). `rolbypassrls=false`, à l'identique du rôle Supabase de
  prod actuel (vérifié — pas une régression de posture RLS).
- **Séquences** (`bigserial` / `identity`) réalignées sur le `max(id)` réellement
  chargé, pour qu'un futur insert applicatif ne percute pas un id déjà repris
  de Supabase.
- **Code** : `apps/console/lib/db.ts` ne pointe plus la CA Supabase épinglée
  (`apps/console/lib/supabase-ca.ts` + `apps/console/certs/supabase-ca.crt`
  supprimés) — TLS vérifié contre le magasin CA système, valable pour Neon
  comme pour n'importe quelle base cloud. Le comportement local (docker-compose,
  sans TLS) est inchangé.
- Supabase **n'a pas été modifié ni supprimé** — la migration est une copie,
  pas un déplacement. La base de prod Supabase continue de tourner et de
  recevoir du trafic normalement ; c'est le filet de sécurité si besoin de
  revenir en arrière.

## Ce qui N'A PAS été fait — à trancher avant de supprimer le projet Supabase

### 1. Résidence des données — UE → US

Le connection string Neon fourni pointe sur **`us-east-2` (Ohio, AWS)**. La
base Supabase actuelle est en **`eu-west-3` (Paris)** — et la résidence UE est
mise en avant comme argument produit explicite : le README (« Souverain :
données hébergées en UE… Pas de dépendance à un SaaS US ») et
`docs/CONFORMITE.md` / `docs/DPA.md` s'appuient dessus. Basculer vers
`us-east-2` **contredit ces documents et l'argumentaire commercial actuel**
pour un client apparentant à un GIP français. Neon propose des régions UE
(Frankfurt `eu-central-1`, Londres `eu-west-2`). Si la résidence UE reste
requise, il faut recréer le projet Neon dans une région UE et rejouer cette
migration (le script est réutilisable) — **je n'ai pas pris cette décision à
la place de Julian**, je n'ai fait que suivre le connection string fourni.

### 2. Edge Functions d'ingestion — compute, pas seulement base

`v1-traces`, `v1-logs`, `v1-replay`, `uptime` (`apps/ingest/supabase/functions/`)
tournent sur le **compute Supabase (Deno Edge Functions)** et utilisent le
client `supabase-js` (RPC + upsert PostgREST), pas une connexion Postgres brute.
Neon ne fournit **aucun compute** (base de données uniquement) : ces 4 fonctions
n'ont nulle part où tourner sur Neon telles quelles, et supprimer le projet
Supabase les supprime avec lui.

**Impact concret si le projet Supabase est supprimé sans y toucher** :
`https://nupxrdpsliqptqnjkmgw.supabase.co/functions/v1/v1-traces` — l'URL codée
en dur dans le snippet **actuellement en production sur
`plateforme.groupement-it.com`** — se met à 404. L'ingestion RUM du client
s'arrête net, silencieusement (le SDK a une file de retry mais pas de fallback
d'URL).

Migrer ces fonctions est un chantier séparé, pas un détail : elles devraient
être réécrites en client Postgres brut (le pattern existe déjà et tourne en
prod dans `apps/ingest/dev-server.mjs` — mêmes tables, mêmes RPC, aucune
dépendance `supabase-js`) puis hébergées ailleurs (routes Vercel, puisque la
console y est déjà). Non fait ici : décision d'architecture + redéploiement du
snippet client, hors du périmètre « migrer les tables ».

### 3. `pg_cron` — existe sur Neon, mais pas où on l'attend

`pg_cron` (v1.6) est disponible sur Neon mais **seulement installable dans la
base `postgres` du projet**, jamais dans `neondb` (`create extension pg_cron`
y échoue : *"can only create extension in database postgres"*, vérifié en
direct). Toutes les migrations gardent leurs `cron.schedule(...)` derrière
`if exists (pg_extension where extname='pg_cron')` — sur `neondb` ce test est
faux, donc **tous les jobs planifiés (purge quotidienne, rollups horaires,
metering, SLO burn, anomalies IA, nouvelles erreurs, sonde uptime,
réconciliation des livraisons d'alerte) sont actuellement INACTIFS sur Neon**,
comme en local/CI aujourd'hui. Rien ne casse (tout est fail-soft), mais rien
ne tourne non plus tant que ce n'est pas branché — via
`cron.schedule_in_database(..., database := 'neondb')` depuis la base
`postgres`, ou via les runners Node déjà écrits pour ce cas
(`apps/ingest/purge.mjs --loop`, `apps/ingest/dispatch-alerts.mjs --loop`) qu'il
faudrait alors héberger quelque part (même chantier que le point 2).

### 4. `pg_net` — absent de Neon, sans workaround

Confirmé : `create extension pg_net` échoue sur Neon (*"not in the allowed
extensions list"*). Les alertes webhook (`check_alerts`, `check_slo_burn`,
`route_alert`…) qui postent via `net.http_post` **ne peuvent pas fonctionner
sur Neon, point final** — pas une histoire de configuration. Le seul chemin
est le dispatcher Node déjà écrit pour ce cas précis
(`apps/ingest/dispatch-alerts.mjs`), qui a besoin d'un hôte pour tourner en
continu (même chantier que le point 2 : Vercel Cron + route API, ou un petit
worker).

### 5. Sécurité — signalé par l'advisor Supabase, pas corrigé

`public.alert_config` a RLS **désactivé** côté Supabase (et donc aussi côté
Neon, répliqué à l'identique) — n'importe qui avec la clé `anon` peut lire/
écrire cette table. Ce n'est pas lié à la migration ; je ne l'ai pas corrigé
pour ne pas bloquer un accès existant sans policy de remplacement. SQL de
remédiation (à valider avant d'exécuter — une policy est nécessaire derrière,
sinon la table devient illisible) :
```sql
ALTER TABLE public.alert_config ENABLE ROW LEVEL SECURITY;
```

## Pour finaliser la bascule (une fois les points ci-dessus tranchés)

1. `vercel env add DATABASE_URL production` avec la chaîne Neon (`console_ro`,
   endpoint **pooler**, cf. `DEPLOY.md` §2).
2. Redéployer la console (`vercel --prod`).
3. Vérifier `/rum/summary`, `/dashboards`, `/alerts` en prod contre Neon.
4. Seulement APRÈS avoir réglé les points 1-4 ci-dessus (résidence, ingestion,
   cron, webhooks) : supprimer le projet Supabase.

## Rollback

Aucune action destructive n'a été faite côté Supabase — la base de prod tourne
toujours normalement. Revenir en arrière = remettre l'ancien `DATABASE_URL`
Supabase sur Vercel, rien d'autre.
