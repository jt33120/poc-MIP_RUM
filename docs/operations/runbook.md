# Runbook — exploiter le backend MIP RUM

> Ce qu'on fait, dans quel ordre, et comment on revient en arrière. Il remplace la partie exploitation de [DEPLOY.md](../../DEPLOY.md) : pour exploiter, c'est ce document qui fait foi. L'architecture est dans [docs/architecture/](../architecture/overview.md), chaque service a son README au même gabarit (`services/<x>/README.md`).
>
> **Mode actuel : base sur l'offre gratuite de Neon, cadences ralenties** ([ADR-0014](../architecture/adr/0014-base-gratuite.md)). Calcul suspendu du 24/09 au 01/10/2026 (quota dépassé). Au 26/09, seuls `scheduler` et `mcp` sont déployés sur Railway ; migrations appliquées en production jusqu'à v86, v87 → v93 en attente ([état](../architecture/overview.md#état-au-26092026)).

## 1. Où regarder

| Question | Commande ou écran |
|---|---|
| Le quota de la base tient-il ? | `NEON_API_KEY=… node scripts/ops/conso-neon.mjs` — calcul du mois, projection, stockage ; code 1 au-delà de 80 % projetés. **Premier réflexe quand la base refuse les connexions.** |
| Que contient la production ? | `railway run --service scheduler node scripts/ops/releve-p0.mjs` — migrations, dernier événement par app, clés d'ingestion, tailles, cadence publiée, connexions (lecture seule) |
| Journaux d'un service | `railway logs --service <scheduler\|mcp\|collector\|notifier> --lines 200` (build : `--build`) — `collector` et `notifier` une fois créés |
| État d'un service | `curl https://<domaine>/live` (processus) · `/health` (processus + base — ne pas le sonder de l'extérieur, il réveille la base) · `/ready` et `/metrics` sous `Authorization: Bearer $METRICS_TOKEN` (le scheduler n'a pas de `METRICS_TOKEN` dans `.railway/railway.ts` : chez lui, les deux répondent 404) |
| Déploiements Railway | `railway deployment list --service <nom>` |
| Qui a fait quoi dans la console | table `audit_log` (écran `/admin/audit`) — **en ajout seul** une fois migration-v90 appliquée (pas encore en production au 26/09) : un `update`, un `delete` ou un `truncate` y rend alors 42501. Rien ne l'efface, pas même l'effacement d'un client. |
| Déploiements et journaux Vercel | tableau de bord Vercel, projet `mip-rum-console` (ou le MCP Vercel) |
| Les applies d'infrastructure | GitHub → Actions → « Railway IaC » (environnement `railway-production`, relecteur requis) |

## 2. Déployer

**Code.** Une PR vers `master`, CI verte, fusion. Vercel déploie la console à chaque fusion ; Railway reconstruit chaque service dont un **chemin surveillé** a changé (`watchPatterns`, `.railway/railway.ts`).

**Schéma.** Les migrations partent au **pré-déploiement du scheduler**, et à lui seul ([ADR-0004](../architecture/adr/0004-migrations.md)). Le journal doit dire `migrations à jour` avec `appliquees=N`. Un pré-déploiement en échec laisse l'ancien déploiement en service.

> ⚠ Un **`redeploy`** rejoue l'instantané et **n'exécute pas** le pré-déploiement. Pour appliquer une migration sans nouveau commit : `railway redeploy --service scheduler --from-source` (un vrai déploiement depuis la source), puis lire le journal.

**Infrastructure.** Toute modification de `.railway/railway.ts` passe par une PR : le job « Plan IaC » commente le plan et refuse toute destruction sans label `allow-destroy`. À la fusion, le job « Apply IaC » attend une **approbation** (Actions → Review deployments), puis applique le plan relu. Un apply **redéploie** les services modifiés ([ADR-0007](../architecture/adr/0007-iac-railway.md)). Deux applies en attente pour le même plan : approuver le premier, **rejeter** le second, sinon il bloque la file.

**Variables partagées d'un service nouveau** : à créer AVANT l'apply (Railway → projet → Settings → Shared Variables, environnement `production`). Le plan ne vérifie pas qu'elles existent. Liste en tête de `.railway/railway.ts`.

## 3. Revenir en arrière

| Ce qui casse | Geste | Effet |
|---|---|---|
| La console après un déploiement | Vercel → Instant Rollback vers le déploiement précédent | immédiat |
| Un service Railway | Railway → service → Deployments → Rollback, puis `git revert` de la cause | immédiat ; le revert empêche le prochain push de le redéployer |
| Une modification d'infrastructure | `git revert` de la PR → nouveau plan → apply approuvé | quelques minutes |
| Le relais d'ingestion | `update platform_flag set value = '0' where key = 'ingest_relay_pct';` | 30 s (cache des instances) ; toute la collecte revient à la console |
| Les écrans ou les écritures par console-api (la bascule) | `update platform_flag set value = '0' where key in ('console_api_ecrans_pct', 'console_api_commandes_pct');` — en mode strict : retirer `CONSOLE_API_STRICT` de Vercel et redéployer | 30 s ; la console sert elle-même ([mode d'emploi](bascule-console-api.md)) |
| La livraison par le notifier | `SCHEDULER_DELIVERY=on` sur le scheduler (IaC) et notifier à 0 réplique | au déploiement suivant du scheduler |
| Une migration | pas de retour : **la migration suivante corrige** | — |

## 4. Rejouer un travail planifié

```bash
railway run --service scheduler node services/scheduler/run-once.mjs tick     # ou hourly, daily
```

Il prend **le même bail** que le worker : si le worker tient la cadence, il le dit et sort en 3 sans rien faire. Codes : 0 fait · 2 configuration · 3 bail tenu ailleurs · 4 le travail a rendu un échec · 1 base injoignable.

## 5. La base gratuite : tenir le quota

- **Cadences** : `SCHEDULER_TICK_MIN=15` et `NOTIFIER_INTERVAL_MS=900000` (passes alignées 45 s après le tick). Calcul et limites : [README du scheduler, « Base gratuite »](../../services/scheduler/README.md).
- **Ce qui réveille la base** : chaque passage planifié, chaque beacon collecté, chaque écran de console ouvert (rafraîchi toutes les 5 s), chaque visite de la vitrine publique, chaque `/health`. Les supervisions externes visent **`/live`**.
- **Quand `conso-neon.mjs` projette plus de 80 %** : ralentir (`SCHEDULER_TICK_MIN=30`, `NOTIFIER_INTERVAL_MS=1800000`), fermer les onglets de console ouverts, ou passer en offre payante.
- **Quand le quota est dépassé** : tout ce qui touche la base échoue (« Your account or project has exceeded the quota ») jusqu'au 1er du mois suivant. Rien à réparer dans le code. Le 1er : d'abord rejouer les migrations en attente (v87 → v93 au 01/10/2026) sur la branche Neon `repetition-p0` — le migrateur de production, `node services/scheduler/migrate.mjs`, avec la chaîne de cette branche ; les rôles créés en SQL sont le point à vérifier ([ADR-0003](../architecture/adr/0003-roles-et-tenancy.md)) ; puis `railway redeploy --service scheduler --from-source`, vérifier `migrations à jour` (`appliquees=7`) et, dans le journal, un `travail terminé` du tick avec `ok: true` ; enfin `node scripts/ops/conso-neon.mjs`.
- **Pour un vrai produit** : offre payante, `SCHEDULER_TICK_MIN=5`, `NOTIFIER_INTERVAL_MS=15000`.

## 6. Les secrets

Où ils vivent : [architecture, « Qui détient quel secret »](../architecture/overview.md#qui-détient-quel-secret). Tous sont aussi dans le gestionnaire de mots de passe ; **jamais** dans le dépôt, un ticket ou une conversation.

| Secret | Rotation |
|---|---|
| `EDGE_PROXY_SECRET` | poser `nouveau,ancien` sur le collector → poser `nouveau` sur Vercel → retirer `ancien` du collector. Aucune coupure. |
| `WEBHOOK_SIGNING_SECRET` | poser `nouveau,ancien` sur le notifier (il signe avec le premier) → prévenir les destinataires → retirer `ancien`. |
| `METRICS_TOKEN` | changer la variable partagée → mettre à jour la supervision. |
| `CONSOLE_API_CLIENT_SECRETS` | poser `nouvelle,ancienne` (variable partagée) → poser `nouvelle` sur Vercel (`CONSOLE_API_CLIENT_SECRET`) → retirer `ancienne`. Aucune coupure. |
| `SESSION_SIGNING_KEYS` | `scripts/ops/generer-cles-session.mjs --rotation` → publier la nouvelle clé publique sur Vercel (`SESSION_PUBLIC_JWKS`) **avant** `--promouvoir` → `--retirer` une fois les sessions de l'ancienne expirées (README de `console-api`). |
| `RESEND_API_KEY` | créer une clé « Sending access » chez Resend → la poser → révoquer l'ancienne. **La clé du 23/09 a circulé en clair : à révoquer au premier branchement.** |
| `IDENTITY_HASH_SECRET` | **ne se tourne pas sans rupture** : les `user_id_hash` écrits avant ne correspondent plus. Si une fuite l'impose : nouveau secret + nouvelle empreinte (`scripts/ops/empreinte-identite.mjs`), dater la rupture par un marqueur de déploiement, et la dire dans la recherche RGPD. |
| `DATABASE_URL` (`neondb_owner`) | rotation du mot de passe par l'API Neon (`reset_password`), puis mise à jour de la variable partagée et des variables de service `preserve()`. Coupe aussi tout ancien déploiement Vercel (prévu en C12). |
| `API_DATABASE_URL` (`mip_api`) | `alter role mip_api password` (ci-dessous) → mettre à jour la variable partagée, ce qui redéploie `api`. Entre les deux, les connexions **nouvelles** du service échouent (les ouvertes tiennent) : une à deux minutes d'erreurs 500 sur l'API de lecture, la console n'est pas touchée (le relais retombe en local). |

### Le rôle de l'API : `mip_api`

migration-v89 crée `mip_api` **sans mot de passe** (`NOLOGIN`) : lecture seule, liste blanche ([ADR-0003](../architecture/adr/0003-roles-et-tenancy.md)). À faire **une fois**, après le pré-déploiement qui l'a appliquée — et d'abord sur la branche `repetition-p0`, v89 comprise, avant le déploiement du scheduler qui l'appliquera en production (v89 est fusionnée depuis le 24/09, #293) :

1. Générer le mot de passe dans le gestionnaire (`openssl rand -hex 32` : l'hexadécimal n'a aucun caractère à échapper dans une URL), jamais ailleurs.
2. `psql` connecté en `neondb_owner`, puis :
   ```
   \prompt 'Mot de passe : ' mdp
   alter role mip_api with login password :'mdp';
   ```
   **Pas `\password`** : Neon relaie tout changement de mot de passe à son plan de contrôle, qui refuse une empreinte SCRAM (« Neon only supports being given plaintext passwords », relevé du 27/09/2026). La variable `:'mdp'` garde le mot de passe hors de l'historique de `psql`. **Pas par l'API ni la console Neon** : un rôle qu'elles créent ou modifient est membre de `neon_superuser`. Vérifier : `select rolcanlogin, pg_has_role('mip_api','neon_superuser','member') from pg_roles where rolname='mip_api'` → `t | f`.
3. Se connecter en `mip_api` **par le pooler**, mot de passe demandé au clavier : `psql "host=<hôte>-pooler.<région>.aws.neon.tech dbname=neondb user=mip_api sslmode=require" -c "show default_transaction_read_only"` → `on`. Vérifié en production le 27/09/2026 ; s'il échoue, s'arrêter là.
4. Créer la variable partagée Railway `API_DATABASE_URL` = `postgresql://mip_api:<mot de passe>@<hôte>-pooler.<région>.aws.neon.tech/neondb?sslmode=require` ; l'IaC du service `api` la lit (`ctx.shared.API_DATABASE_URL`).
5. Vérifier les droits réels, en lecture des catalogues seulement : `node services/api/build.mjs`, puis `read -rs DATABASE_URL && export DATABASE_URL` (la chaîne propriétaire, sans écho) et `node scripts/ci/verify-db-roles.mjs` → « conforme à sa liste blanche ».

### Les rôles de console-api : `mip_console` et `mip_identity` (C13)

migration-v93 crée les deux rôles **sans mot de passe** (`NOLOGIN`) : `mip_console` pour les écrans, les commandes et le RGPD, `mip_identity` pour la connexion et les sessions (listes : `packages/db/roles/console-api.mjs`). console-api continue de se connecter en propriétaire tant que ses deux variables ne sont pas posées. À faire **une fois**, après la mise en service de console-api, et d'abord sur `repetition-p0` :

1. Deux mots de passe, générés dans le gestionnaire.
2. `psql` connecté en `neondb_owner` : `\prompt 'Mot de passe : ' mdp` puis `alter role mip_console with login password :'mdp';`, puis de même pour `mip_identity` (pas `\password`, refusé par Neon : voir `mip_api`). **Pas par l'API ni la console Neon.**
3. Connexion de chacun **par le pooler** (`select current_user`), comme pour `mip_api`.
4. Variables partagées Railway `CONSOLE_DATABASE_URL` (rôle `mip_console`) et `IDENTITY_DATABASE_URL` (rôle `mip_identity`), chaînes du pooler ; puis la PR d'IaC qui les donne au service `console-api` **et retire son `DATABASE_URL`** — les deux ensemble, ou le service refuse de démarrer (une configuration partielle se voit au démarrage, pas à la première connexion).
5. Vérifier les droits réels : `node services/console-api/build.mjs`, puis (chaîne propriétaire, sans écho) `node scripts/ci/verify-db-roles-console.mjs` → « conformes à leurs listes ». Le journal de démarrage du service dit `roles: "mip_console + mip_identity"`.

## 7. Rafraîchir la base GeoIP (DB-IP)

La base DB-IP Lite (CC BY 4.0) est **dans l'image du collector**, décrite par un manifeste versionné. Au-delà de **180 jours** après son mois de livraison (`GEOIP_MAX_AGE_DAYS`), le collector la **refuse** : pays inconnu plutôt que pays périmé. La livraison `2026-09` sera refusée à partir de fin février 2027.

```bash
node scripts/fetch-geoip-db.mjs --update 2026-10   # télécharge, mesure, RÉÉCRIT packages/backend/data/dbip-country-lite.manifest.json
node scripts/fetch-geoip-db.mjs --verify           # sans réseau : la base déposée correspond au manifeste
```

Commiter le manifeste (jamais le fichier : il est ignoré), PR, fusion : l'image du collector se reconstruit et télécharge la nouvelle livraison en vérifiant son sha256. Le relais ne transmet aucune adresse : le rafraîchissement ne vaut que pour la collecte directe (`GEOIP_IP_SOURCE=railway` depuis le 28/09/2026, pour le seul capteur de la console), et garde l'image prête pour la suite de P6b.G.

## 8. Restaurer une sauvegarde sans ressusciter des données effacées

> **Procédure éprouvée le 28/09/2026 sur la branche de répétition** `repetition-p0`, commande par commande (compte rendu en fin de section). Elle ferme en partie le point D7 du [document de couverture](../RUM_PARITY_STATUS.md). Restent manuels et non éprouvés : la partie « identités » de l'étape 5 (aucune identité en base ce jour-là) et les gestes d'exploitation des étapes 1 et 7, simulés.

**Le piège.** Une restauration remet **toute** la base à l'instant choisi, et les barrières d'effacement (`privacy_erasure_barrier`) vivent dans la même base que les données. Restaurer à un instant **antérieur** à un effacement ressuscite les données effacées **et** fait disparaître la barrière qui empêchait de les réécrire. Disparaissent avec elle (relevé du 28/09) : la demande d'effacement (`privacy_erasure_request`), sa ligne d'`audit_log`, la suspension d'ingestion posée par `erase_app_data` (l'application effacée revient avec ses données), un mode de protection activé après l'instant (`privacy_barrier_mode` retombe à `off`). `platform_flag` revient lui aussi à sa valeur d'alors, et tout ce qui a été collecté depuis est perdu.

**La fenêtre.** Le projet garde **24 heures** d'historique restaurable (`history_retention_seconds` = 86 400, porté le 28/09/2026 depuis 6 heures et relu par l'API le même jour ; `conso-neon.mjs` l'affiche). L'offre payante souscrite le 27/09/2026 (Launch) permet d'aller jusqu'à 7 jours, facturés au Go-mois d'historique : aller au-delà de 24 heures est une décision à prendre. Au-delà de la fenêtre, pas de restauration à l'instant voulu.

**Les outils.** `curl`, `jq`, la clé d'API Neon et la chaîne propriétaire de `main`, saisies sans écho. Le SQL passe par le point `/sql` de Neon, en HTTPS : il marche là où le port 5432 est fermé (c'était le cas le 28/09). Chaque appel y est sa propre transaction : ni table temporaire d'un appel à l'autre, ni `\copy`. Avec `psql`, les mêmes requêtes passent telles quelles.

```bash
read -rs NEON_API_KEY && read -rs CHAINE        # clé d'API, puis chaîne neondb_owner de main
PROJET=rough-firefly-49250892
MAIN=$(curl -sS "https://console.neon.tech/api/v2/projects/$PROJET/branches" -H "Authorization: Bearer $NEON_API_KEY" | jq -r '.branches[] | select(.name == "main") | .id')
HOTE=$(printf %s "$CHAINE" | sed -E 's#^[^@]*@([^/:?]+).*#\1#')
sql()      { curl -sS --fail-with-body "https://$HOTE/sql" -H "Neon-Connection-String: $CHAINE" -H 'Content-Type: application/json' -d "$(jq -nc --arg q "$1" '{query: $q, params: []}')"; }
sql_json() { curl -sS --fail-with-body "https://$HOTE/sql" -H "Neon-Connection-String: $CHAINE" -H 'Content-Type: application/json' -d "$(jq -nc --arg q "$1" --slurpfile f "$2" '{query: $q, params: [($f[0] | tojson)]}')"; }
```

1. **Geler les écritures.** Relais à 0 (`update platform_flag set value = '0' where key = 'ingest_relay_pct'`, en notant la valeur d'avant : 100 au 28/09), scheduler, notifier et collector à 0 réplique. La console continue de recevoir : l'étape 3 la coupe.
2. **Choisir l'instant et garder l'état d'avant.** L'instant, en UTC, juste avant l'incident (`INSTANT=2026-09-28T08:36:57Z`). La restauration garde l'état courant sous une branche de sauvegarde ; en plus, exporter ce qu'il faudra reposer — les barrières, les demandes, le registre (protection et suspensions), le journal depuis l'instant (1 s le 28/09) :
   ```bash
   sql 'select * from privacy_erasure_barrier' | jq .rows > barrieres.json
   sql "select * from privacy_erasure_request where status = 'completed'" | jq .rows > demandes.json
   sql 'select app_id, privacy_barrier_mode, ingestion_suspended_at, ingestion_suspended_by from app_registry' | jq .rows > registre.json
   sql "select user_email, action, detail, ts, request_id, actor_kind, app_id from audit_log where ts >= '$INSTANT' order by id" | jq .rows > audit.json
   ```
3. **Suspendre, restaurer, suspendre à nouveau.** Chaque instance d'ingestion, console comme collector, garde le registre des applications **60 s** en cache (`createPgAuth`, `packages/backend/lib/pg-ingest.mjs`). Posée une minute avant la restauration, la suspension est dans toutes les instances ; la restauration l'efface de la base, les caches la gardent jusqu'à leur relecture : la reposer **aussitôt** (2 s après, le 28/09). Le `where` ne touche pas une suspension déjà posée, celle d'un client effacé par exemple.
   ```bash
   SUSPENDRE="update app_registry set ingestion_suspended_at = now(), ingestion_suspended_by = 'restauration' where ingestion_suspended_at is null"
   sql "$SUSPENDRE" && sleep 60
   curl -sS --fail-with-body -X POST "https://console.neon.tech/api/v2/projects/$PROJET/branches/$MAIN/restore" \
     -H "Authorization: Bearer $NEON_API_KEY" -H 'Content-Type: application/json' \
     -d "$(jq -nc --arg b "$MAIN" --arg t "$INSTANT" --arg n "main-avant-restauration-$(date -u +%Y%m%d-%H%M)" \
           '{source_branch_id: $b, source_timestamp: $t, preserve_under_name: $n}')" | jq -c '[.operations[].action]'
   until [ "$(curl -sS "https://console.neon.tech/api/v2/projects/$PROJET/operations?limit=20" -H "Authorization: Bearer $NEON_API_KEY" \
               | jq '[.operations[] | select(.status == "running" or .status == "scheduling")] | length')" = 0 ]; do sleep 2; done
   sql "$SUSPENDRE"
   ```
   La restauration dure quelques secondes (3 à 4 s le 28/09, base de 357 Mo) ; le calcul redémarre, les connexions ouvertes sont coupées, l'hôte et la chaîne ne changent pas.
4. **Reposer** les barrières (avec leur date d'effacement et leur demande d'origine), les demandes, et les lignes d'`audit_log` perdues — réinsérées avec leur date, jamais réécrites : le journal est en ajout seul (v90).
   ```bash
   sql_json 'insert into privacy_erasure_barrier select * from json_populate_recordset(null::privacy_erasure_barrier, $1::json) on conflict do nothing' barrieres.json
   sql_json 'insert into privacy_erasure_request select * from json_populate_recordset(null::privacy_erasure_request, $1::json) on conflict (id) do nothing' demandes.json
   sql_json 'insert into audit_log (user_email, action, detail, ts, request_id, actor_kind, app_id)
             select e.user_email, e.action, e.detail, e.ts, e.request_id, e.actor_kind, e.app_id
               from json_populate_recordset(null::audit_log, $1::json) e
              where not exists (select 1 from audit_log a where a.ts = e.ts and a.action = e.action and a.detail is not distinct from e.detail)' audit.json
   ```
5. **Réeffacer ce que la restauration a ressuscité** (1 s le 28/09). Les sessions rattachées à une barrière, sous le verrou de leur application ; les lots encore en file ; les applications effacées par `erase_app_data` après l'instant :
   ```bash
   sql "select erase_session(x.session_id) from (select distinct s.session_id
          from rum_session s join privacy_erasure_barrier b on b.app_id = s.app_id
           and ((b.subject_kind = 'session' and s.session_id = b.subject_key)
             or (b.subject_kind = 'visitor' and s.visitor_id = b.subject_key)
             or (b.subject_kind = 'user'    and s.user_id_hash = b.subject_key)
             or (b.subject_kind = 'account' and s.account_id_hash = b.subject_key))) x"
   sql "select app_id, privacy_filtrer_file(app_id,
          array_agg(subject_key) filter (where subject_kind = 'session'), array_agg(subject_key) filter (where subject_kind = 'visitor'),
          array_agg(subject_key) filter (where subject_kind = 'user'),    array_agg(subject_key) filter (where subject_kind = 'account'))
          from privacy_erasure_barrier group by app_id"
   jq -c '[.[] | select(.ingestion_suspended_by == "erase_app_data") | .app_id]' registre.json > apps-effacees.json
   sql_json 'select app_id, erase_app_data(app_id) from json_array_elements_text($1::json) as app_id' apps-effacees.json
   ```
   **Ce qui reste manuel** : les lignes d'une identité qui ne sont rattachées à aucune session (erreurs, événements et index portant le HMAC). Les compter ; tant qu'il en reste, ne pas rouvrir, et les effacer par la commande `privacy.eraseIdentity` (écran `/admin/privacy`), exécutée par la console tant que les écritures n'ont pas basculé vers `console-api`. Elle exige l'identité en clair, ressaisie : la reprendre de la demande d'origine, la barrière n'en garde que le HMAC. Non éprouvé : aucune ligne de la base ne portait d'identité le 28/09.
   ```bash
   sql "select b.app_id, b.subject_kind, left(b.subject_key, 8) as cle,
          (select count(*) from rum_error t       where t.app_id = b.app_id and b.subject_key in (t.user_id_hash, t.account_id_hash))
        + (select count(*) from rum_event t       where t.app_id = b.app_id and b.subject_key in (t.user_id_hash, t.account_id_hash))
        + (select count(*) from rum_event_index t where t.app_id = b.app_id and b.subject_key in (t.user_id_hash, t.account_id_hash)) as lignes
          from privacy_erasure_barrier b where b.subject_kind in ('user', 'account')"
   ```
6. **Remettre la protection** là où elle était, d'après l'export :
   ```bash
   sql_json 'update app_registry r set privacy_barrier_mode = e.privacy_barrier_mode
               from json_populate_recordset(null::app_registry, $1::json) e
              where r.app_id = e.app_id and r.privacy_barrier_mode is distinct from e.privacy_barrier_mode
          returning r.app_id, r.privacy_barrier_mode' registre.json
   ```
7. **Rouvrir** : chaque suspension posée par la restauration reprend la valeur de l'export — levée pour une application ouverte, remise telle quelle pour un client effacé par `erase_app_data`. Puis scheduler, notifier, collector, et le relais à sa valeur.
   ```bash
   sql_json "update app_registry r set ingestion_suspended_at = e.ingestion_suspended_at, ingestion_suspended_by = e.ingestion_suspended_by
               from json_populate_recordset(null::app_registry, \$1::json) e
              where r.app_id = e.app_id and r.ingestion_suspended_by = 'restauration'
          returning r.app_id, r.ingestion_suspended_by" registre.json
   ```
8. **Tracer** : une ligne dans `audit_log` et dans le journal d'incident (§ 9) — instant restauré, barrières et demandes reposées, sessions et applications réeffacées, identités vérifiées.
   ```bash
   sql "insert into audit_log (user_email, action, detail, actor_kind) values ('<exploitant>', 'restauration', 'instant=$INSTANT barrieres=… demandes=… sessions=… applications=… identites=…', 'user')"
   ```

**Après.** La branche de sauvegarde garde l'état d'avant la restauration, **données effacées comprises** : la supprimer dès la restauration validée. D'après la documentation de Neon, la restauration y déplace les branches enfants de `main` (dont `repetition-p0`), et une branche qui a des enfants ne se supprime pas : réinitialiser d'abord `repetition-p0` depuis `main` (`restore` avec `source_branch_id` = `$MAIN`, sans instant), puis supprimer la sauvegarde. Le 28/09, sur la répétition, la sauvegarde était devenue le parent de `repetition-p0` ; réinitialisée depuis `main`, la répétition l'a quittée, et la sauvegarde s'est supprimée.

**Répétition du 28/09/2026.** Sur `repetition-p0` réinitialisée depuis `main` (3 s) :

- *Scénario.* Instant T0 = 08:36:57 UTC. Après T0 : la protection activée sur une application (`test`), un visiteur de `mip-rum-console` effacé par le code de la commande `privacy.eraseVisitor` (`dsarErase` avec sa ligne d'audit : une session, 237 lignes rattachées, dont 13 morceaux de rejeu ; barrières `visitor` et `session`), l'application `app-a` effacée par `erase_app_data`.
- *Restauration à T0* : 4 s d'opérations, même endpoint. Tout est revenu : la session et ses 237 lignes, les données d'`app-a` ; plus aucune barrière, demande, ligne d'audit d'effacement ni suspension ; `test` à `off`.
- *Étapes 2 à 8* : les commandes ci-dessus, chacune en une à deux secondes. La session est réeffacée ligne pour ligne, `app-a` aussi ; `test` repasse à `enforce`, `app-a` reste suspendue, les autres rouvrent.
- *Contrôle* par le noyau d'ingestion réel (`pg-ingest.mjs`) : un morceau de rejeu de la session effacée est refusé (`refus_barriere`), une nouvelle session du visiteur effacé aussi (session et page vue refusées), `app-a` répond « ingestion suspended ». Rien n'est écrit.
- *Non éprouvé* : les gestes Railway et `platform_flag` des étapes 1 et 7 (simulés), la partie « identités », et la restauration de `main` elle-même. La répétition est une branche enfant : Neon ne promet la restauration à un instant qu'aux branches racines — elle a pourtant été acceptée sur son propre historique. `main` est une branche racine.

## 9. Incidents déjà vécus

| Date | Symptôme | Cause | Ce qui l'aurait vu plus tôt |
|---|---|---|---|
| 24/09/2026 | toute la production en échec : collecte en 500, travaux planifiés, écrans | quota de calcul Neon dépassé (110 / 100 CU-h), tick toutes les 5 min | `conso-neon.mjs` (projection du mois) ; cadence ralentie depuis ([ADR-0014](../architecture/adr/0014-base-gratuite.md)) |
| 23/09/2026 | deux sondes uptime « en panne » | des fixtures `ex.invalid` restées actives | le relevé P0 |
| 17 → 23/09/2026 | ingestion crue morte pendant des jours | aucune lecture du dernier événement par application | `releve-p0.mjs`, ligne « Dernier événement par application » |
