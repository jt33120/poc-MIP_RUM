# Runbook — exploiter le backend MIP RUM

> Ce qu'on fait, dans quel ordre, et comment on revient en arrière. Il remplace la partie exploitation de [DEPLOY.md](../../DEPLOY.md), en partie périmé (il décrit encore le service `ingest`, supprimé le 21/09/2026). L'architecture est dans [docs/architecture/](../architecture/overview.md), chaque service a son README au même gabarit (`services/<x>/README.md`).
>
> **Mode actuel : base sur l'offre gratuite de Neon, cadences ralenties** ([ADR-0014](../architecture/adr/0014-base-gratuite.md)). Calcul suspendu du 24/09 au 1er octobre 2026 (quota dépassé).

## 1. Où regarder

| Question | Commande ou écran |
|---|---|
| Le quota de la base tient-il ? | `NEON_API_KEY=… node scripts/ops/conso-neon.mjs` — calcul du mois, projection, stockage ; code 1 au-delà de 80 % projetés. **Premier réflexe quand la base refuse les connexions.** |
| Que contient la production ? | `railway run --service scheduler node scripts/ops/releve-p0.mjs` — migrations, dernier événement par app, clés d'ingestion, tailles, cadence publiée, connexions (lecture seule) |
| Journaux d'un service | `railway logs --service <scheduler\|mcp\|collector\|notifier> --lines 200` (build : `--build`) |
| État d'un service | `curl https://<domaine>/live` (processus) · `/health` (processus + base — ne pas le sonder de l'extérieur, il réveille la base) · `/ready` et `/metrics` sous `Authorization: Bearer $METRICS_TOKEN` |
| Déploiements Railway | `railway deployment list --service <nom>` |
| Qui a fait quoi dans la console | table `audit_log` (écran `/admin/audit`) — **en ajout seul** depuis migration-v90 : un `update`, un `delete` ou un `truncate` y rend 42501. Rien ne l'efface, pas même l'effacement d'un client. |
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
- **Quand le quota est dépassé** : tout ce qui touche la base échoue (« Your account or project has exceeded the quota ») jusqu'au 1er du mois suivant. Rien à réparer dans le code. Le 1er : `railway redeploy --service scheduler --from-source`, vérifier `migrations à jour` et un tick `fait` dans `/ready`, puis `node scripts/ops/conso-neon.mjs`.
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
| `TICKET_SECRET_KEY` | la même valeur, à l'octet près, là où les références `enc:v1:` sont déchiffrées ; la changer impose de rechiffrer les références. |
| `API_DATABASE_URL` (`mip_api`) | `\password mip_api` (ci-dessous) → mettre à jour la variable partagée, ce qui redéploie `api`. Entre les deux, les connexions **nouvelles** du service échouent (les ouvertes tiennent) : une à deux minutes d'erreurs 500 sur l'API de lecture, la console n'est pas touchée (le relais retombe en local). |

### Le rôle de l'API : `mip_api`

migration-v89 crée `mip_api` **sans mot de passe** (`NOLOGIN`) : lecture seule, liste blanche ([ADR-0003](../architecture/adr/0003-roles-et-tenancy.md)). À faire **une fois**, après le pré-déploiement qui l'a appliquée — et d'abord sur la branche `repetition-p0`, v89 comprise, avant de fusionner v89 :

1. Générer le mot de passe dans le gestionnaire (`openssl rand -base64 32` si besoin), jamais ailleurs.
2. `psql` connecté en `neondb_owner`, puis :
   ```
   \password mip_api
   alter role mip_api login;
   ```
   `\password` hache le mot de passe **côté client** (SCRAM) : il ne passe ni par le journal de la base ni par l'historique du shell. **Pas par l'API ni la console Neon** : un rôle qu'elles créent ou modifient est membre de `neon_superuser`.
3. Se connecter en `mip_api` **par le pooler**, mot de passe demandé au clavier : `psql "host=<hôte>-pooler.<région>.aws.neon.tech dbname=neondb user=mip_api sslmode=require" -c "show default_transaction_read_only"` → `on`. Ce point n'a jamais été vérifié sur Neon (ADR-0003) : s'il échoue, s'arrêter là.
4. Créer la variable partagée Railway `API_DATABASE_URL` = `postgresql://mip_api:<mot de passe>@<hôte>-pooler.<région>.aws.neon.tech/neondb?sslmode=require` ; l'IaC du service `api` la lit (`ctx.shared.API_DATABASE_URL`).
5. Vérifier les droits réels, en lecture des catalogues seulement : `node services/api/build.mjs`, puis `read -rs DATABASE_URL && export DATABASE_URL` (la chaîne propriétaire, sans écho) et `node scripts/ci/verify-db-roles.mjs` → « conforme à sa liste blanche ».

### Les rôles de console-api : `mip_console` et `mip_identity` (C13)

migration-v93 crée les deux rôles **sans mot de passe** (`NOLOGIN`) : `mip_console` pour les écrans, les commandes et le RGPD, `mip_identity` pour la connexion et les sessions (listes : `packages/db/roles/console-api.mjs`). console-api continue de se connecter en propriétaire tant que ses deux variables ne sont pas posées. À faire **une fois**, après la mise en service de console-api, et d'abord sur `repetition-p0` :

1. Deux mots de passe, générés dans le gestionnaire.
2. `psql` connecté en `neondb_owner` : `\password mip_console`, `alter role mip_console login;`, puis de même pour `mip_identity`. **Pas par l'API ni la console Neon.**
3. Connexion de chacun **par le pooler** (`select current_user`), comme pour `mip_api`.
4. Variables partagées Railway `CONSOLE_DATABASE_URL` (rôle `mip_console`) et `IDENTITY_DATABASE_URL` (rôle `mip_identity`), chaînes du pooler ; puis la PR d'IaC qui les donne au service `console-api` **et retire son `DATABASE_URL`** — les deux ensemble, ou le service refuse de démarrer (une configuration partielle se voit au démarrage, pas à la première connexion).
5. Vérifier les droits réels : `node services/console-api/build.mjs`, puis (chaîne propriétaire, sans écho) `node scripts/ci/verify-db-roles-console.mjs` → « conformes à leurs listes ». Le journal de démarrage du service dit `roles: "mip_console + mip_identity"`.

## 7. Rafraîchir la base GeoIP (DB-IP)

La base DB-IP Lite (CC BY 4.0) est **dans l'image du collector**, décrite par un manifeste versionné. Au-delà de **180 jours** après son mois de livraison (`GEOIP_MAX_AGE_DAYS`), le collector la **refuse** : pays inconnu plutôt que pays périmé. La livraison `2026-09` sera refusée à partir de fin février 2027.

```bash
node scripts/fetch-geoip-db.mjs --update 2026-10   # télécharge, mesure, RÉÉCRIT packages/backend/data/dbip-country-lite.manifest.json
node scripts/fetch-geoip-db.mjs --verify           # sans réseau : la base déposée correspond au manifeste
```

Commiter le manifeste (jamais le fichier : il est ignoré), PR, fusion : l'image du collector se reconstruit et télécharge la nouvelle livraison en vérifiant son sha256. Tant que le relais porte le trafic, le GeoIP reste éteint (`GEOIP_IP_SOURCE=none`) : le rafraîchissement ne change rien en production, mais garde l'image prête pour P6b.G.

## 8. Restaurer une sauvegarde sans ressusciter des données effacées

> **Procédure écrite le 24/09/2026, jamais éprouvée.** À répéter sur la branche Neon `repetition-p0` avant d'en avoir besoin. Elle ferme en partie le point D7 du [document de couverture](../RUM_PARITY_STATUS.md) ; la partie « identités » reste manuelle (voir l'étape 5).

**Le piège.** Les barrières d'effacement (`privacy_erasure_barrier`) vivent dans la même base que les données. Restaurer à un instant **antérieur** à un effacement ressuscite les données effacées **et** fait disparaître la barrière qui empêchait de les réécrire.

**La fenêtre.** L'offre gratuite ne garde que **6 heures** d'historique (`history_retention_seconds` = 21 600, relu par `conso-neon.mjs`). Au-delà, pas de restauration à l'instant voulu.

1. **Geler les écritures.** Relais à 0 (`platform_flag`), scheduler et notifier à 0 réplique, collector à 0 réplique s'il est déployé. La console continue de recevoir : l'étape 3 la coupe.
2. **Garder l'état d'avant.** La restauration Neon conserve l'état courant sous une branche de sauvegarde (« preserve under »). En plus, exporter les barrières et les demandes :
   ```sql
   \copy (select * from privacy_erasure_barrier) to 'barrieres.csv' csv header
   \copy (select * from privacy_erasure_request where status = 'completed') to 'demandes.csv' csv header
   ```
3. **Restaurer** la branche `main` à l'instant choisi (console Neon → Restore, en gardant l'état courant sous un nom daté), puis **immédiatement** suspendre l'ingestion de toutes les applications — la suspension posée avant la restauration a disparu avec elle :
   ```sql
   update app_registry set ingestion_suspended_at = now(), ingestion_suspended_by = 'restauration';
   ```
4. **Reposer les barrières** perdues :
   ```sql
   create temp table b (like privacy_erasure_barrier);
   \copy b from 'barrieres.csv' csv header
   insert into privacy_erasure_barrier select * from b on conflict do nothing;
   ```
5. **Réeffacer ce que la restauration a ressuscité.** Sessions et visiteurs, en SQL, sous le verrou de chaque application :
   ```sql
   select erase_session(s.session_id)
     from rum_session s join b on b.app_id = s.app_id
      and ((b.subject_kind = 'session' and s.session_id = b.subject_key)
        or (b.subject_kind = 'visitor' and s.visitor_id = b.subject_key)
        or (b.subject_kind = 'user'    and s.user_id_hash = b.subject_key)
        or (b.subject_kind = 'account' and s.account_id_hash = b.subject_key));
   ```
   **Ce qui reste manuel** : les lignes d'une identité qui ne sont rattachées à aucune session (logs OpenTelemetry portant l'identité, lots encore en file). Les compter par l'écran `/admin/privacy` pour chaque identité ; tant qu'il en reste, ne pas rouvrir. L'effacement est une commande depuis C10 (`privacy.eraseIdentity`, `privacy.eraseVisitor`), exécutée par la console jusqu'à la mise en service de `console-api`.
6. **Remettre la protection** là où elle était : `update app_registry set privacy_barrier_mode = 'enforce' where app_id = any(…)`, d'après l'export de l'état d'avant.
7. **Rouvrir** : lever la suspension application par application (`ingestion_suspended_at = null`), remettre scheduler, notifier, collector, puis le relais à sa valeur.
8. **Tracer** : une ligne dans `audit_log` et dans le journal d'incident — instant restauré, barrières reposées, sessions réeffacées, identités vérifiées.

## 9. Incidents déjà vécus

| Date | Symptôme | Cause | Ce qui l'aurait vu plus tôt |
|---|---|---|---|
| 24/09/2026 | toute la production en échec : collecte en 500, travaux planifiés, écrans | quota de calcul Neon dépassé (110 / 100 CU-h), tick toutes les 5 min | `conso-neon.mjs` (projection du mois) ; cadence ralentie depuis ([ADR-0014](../architecture/adr/0014-base-gratuite.md)) |
| 23/09/2026 | deux sondes uptime « en panne » | des fixtures `ex.invalid` restées actives | le relevé P0 |
| 17 → 23/09/2026 | ingestion crue morte pendant des jours | aucune lecture du dernier événement par application | `releve-p0.mjs`, ligne « Dernier événement par application » |
