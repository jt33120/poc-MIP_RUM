# Multi-tenant — isolation, métering & quotas (P0 #5)

> Comment MIP RUM sépare les clients (tenants = `app_id`), mesure leur consommation
> (facturation) et applique des quotas.

## Modèle d'isolation

| Couche | Mécanisme |
|---|---|
| **Identité tenant** | `app_id` sur toute ligne de télémétrie (résolu à l'ingestion via `mip.app_id` resource ; ligne sans `app_id` **rejetée**). |
| **Lecture console** | Toute requête filtre par `app_id`. **RBAC** : un `viewer` est scopé à une liste d'apps (`console_user.apps`) ; le contrat de requête (`apps/console/lib/query-contract.ts`) **refuse** toute app hors périmètre — l'API v1 répond `403 forbidden_app` — et une liste vide n'ouvre rien (jamais « toutes »). SSO : scope piloté par l'IdP (`OIDC_APPS_CLAIM`). |
| **Ingestion** | Clé d'API par app (hashée) ; rate-limit durable **par app** (`rate_check`). |
| **Repos / secrets** | RLS activé, policies **scopées par tenant** (migration-v47), inertes tant que la console se connecte en propriétaire (voir plus bas) ; secrets hashés. |
| **Effacement** | `erase_app_data(app_id)` isole et supprime tout un tenant (cf. `CONFORMITE.md`). |

## RLS par tenant (migration-v47) — ceinture, et pourquoi elle n'est pas encore bouclée

**L'état d'avant.** RLS était activé sur les 35 tables et chacune portait une policy —
mais **36 des 38 policies avaient pour prédicat `USING (true)`**. Le mécanisme était
allumé et configuré pour ne rien filtrer. S'y ajoutaient deux court-circuits :
`relforcerowsecurity` à false avec un propriétaire `postgres`, et un rôle applicatif
`BYPASSRLS`. Trois verrous en série, tous ouverts : l'isolation ne tenait qu'au
`WHERE app_id = …` présent dans chaque requête.

**Ce que v47 installe.** `current_app_ids()` lit la portée dans la GUC
`app.current_app_id` ; les policies `tenant_scope` filtrent sur elle (32 tables :
29 portant `app_id`, plus `alert_event` / `alert_delivery` / `uptime_result` via leur
parent). GUC absente ⇒ tableau vide ⇒ **aucune ligne** : fail-closed, jamais fail-open.

> **Une nouvelle table tenant ne s'auto-protège pas.** La boucle de v47 s'exécute
> **une fois**, à l'application : elle découvre les tables portant `app_id` à cet
> instant, il n'y a pas d'event trigger. Toute table créée par une migration
> ultérieure part **sans filtrage** tant qu'elle ne pose pas son propre
> `tenant_scope` (ou qu'on ne rejoue pas v47, ce qui est sûr — elle est idempotente).
> À traiter dans la migration qui crée la table, pas après.

> **Piège vérifié en développant v47.** Les policies permissives se combinent en **OU** :
> laisser une seule policy `using (true)` à côté d'une policy scopée annule le filtrage
> sans que rien ne le signale. v47 supprime donc les policies héritées **par prédicat**,
> jamais par nom. `scripts/verify-tenant-isolation.mjs` porte une assertion structurelle
> dédiée à ce mode de défaillance.

**Pas de `FORCE ROW LEVEL SECURITY`, délibérément.** FORCE ne soumet que le
*propriétaire* — or c'est l'identité d'exploitation dont les 10 fonctions
`security definer` (alerting, purge, uptime, metering) ont besoin en inter-tenant.
Sous FORCE et sans GUC, elles verraient zéro ligne et casseraient en silence : sans
effet en production tant que tout se connecte en `neondb_owner` (`BYPASSRLS`), fatal en
**self-host**.

**Ce qui reste à faire pour que la ceinture serve.** En production (26/09/2026), la
console Vercel et le scheduler se connectent en `neondb_owner`, propriétaire et
`BYPASSRLS` : les policies sont **inertes**, v47 est une défense en profondeur, pas un
remplacement du `WHERE app_id =`. La décision en vigueur est
[ADR-0003](architecture/adr/0003-roles-et-tenancy.md) — elle **écarte** la bascule de la
console sur `console_ro` envisagée ici à l'origine (il lit 80 tables sur 81 et n'écrit
pas là où la console écrit ; il reste l'outil des tests d'isolation). À la place, un rôle
par surface, créé en SQL :
1. `mip_api` (migration-v89) pour le service `api`, en lecture seule ;
2. `mip_console` et `mip_identity` (migration-v93) pour `console-api`
   ([ADR-0012](architecture/adr/0012-roles-de-la-console.md)).

Ces migrations sont dans le dépôt, **pas encore appliquées en production** (appliquée
jusqu'à v86), et les services qui s'en serviront ne sont pas encore créés. Même alors, les
policies de `mip_api` sont `using (true)` : le cloisonnement reste le `WHERE app_id` de
chaque requête, tant que les lectures ne posent pas `app.current_app_id` par
`withTenant(appIds, …)` (`apps/console/lib/db.ts`, `set_config(…, true)` dans une
transaction — aucun appelant aujourd'hui).

**Les policies visent `TO console_ro`, pas PUBLIC.** À l'écriture de v47 (base Supabase),
`anon` et `authenticated` — les rôles de l'API PostgREST, exposée publiquement — portaient
des droits DML sur 18 tables ; s'ils ne lisaient rien, c'est parce qu'**aucune policy ne
les visait** (RLS actif + aucune policy applicable = zéro ligne). Une policy sans clause
`TO` s'applique à PUBLIC et aurait remplacé ce « jamais autorisé » par un « autorisé si la
GUC est posée ». Sur Neon, ces rôles hérités de l'ère Supabase ne sont traités par les
migrations que s'ils existent (`if exists … pg_roles`) ; la règle reste la bonne pour tout
rôle futur. Le test vérifie le cas hostile : portée **posée**, et pourtant zéro ligne.

**`console_ro` n'écrit plus partout (migration-v48).** Le rôle s'appelle « read only »
et détenait `INSERT/UPDATE/DELETE` sur les 45 tables. Sans effet tant que la console
se connecte en propriétaire — mais à la bascule, elle aurait hérité d'un droit
d'écriture sur toute la télémétrie de tous les tenants. v48 retire l'écriture sur
tout le schéma puis la rend sur les **18 tables où la console écrit réellement** :
la configuration qu'elle administre, plus `rum_session`/`rum_span` qu'elle écrit
pour son propre dogfooding. `SELECT` n'est jamais touché. Ajouter une écriture
console sur une nouvelle table impose de l'ajouter à cette liste ; le symptôme
sinon est un `permission denied` explicite, pas une corruption silencieuse.

**Preuve** : `pnpm test:isolation` (`scripts/verify-tenant-isolation.mjs`, joué en CI sur
une base dédiée) — 27 assertions, toutes les requêtes de lecture écrites **sans** `WHERE app_id =`,
dont la symétrie A↔B, le fail-closed sans GUC, et le maintien de la portée inter-tenant
des fonctions `security definer`.

## Métering (consommation — base de facturation)

- **`tenant_usage_daily(app_id, day, events, sessions, errors)`** : agrégat **durable**
  (sans FK → **survit à la purge** de télémétrie, donc l'historique de facturation reste).
- **`meter_tenant_usage(day)`** : calcule la consommation d'un jour clos. Idempotent. Lancé par
  le service `scheduler` à son passage **quotidien de 03:17 UTC**, juste après
  `purge_rum_tenants(30)` (`packages/backend/jobs/planifie.mjs`) : la purge ne touche que des
  données de plus de 30 jours, la veille qu'il compte est intacte.
- **Unité facturée `events`** : un **signal source stocké** — une ligne de pageviews, metrics,
  erreurs, ressources, longtasks, breadcrumbs, events ou spans. Les logs (`rum_log`) et les
  projections (`rum_event_index`, `rum_action`) n'y entrent pas.
- **Exceptions dérivées (P5.3, migration-v70)** : une exception lue dans un événement de span ou
  dans un log (`rum_error.origin_signal` = `span_event` ou `log`) **n'est pas un événement de
  plus** — le span qui la porte est déjà compté, le log ne l'est pas. Elle est exclue de `events`
  et comptée dans **`errors`**, la somme des occurrences d'erreur. Une app qui n'envoie que des
  logs d'exception apparaît donc avec `events = 0` et ses `errors`.
- **`v_tenant_usage_month`** : usage mensuel agrégé. Vue console : **`/admin/usage`** (admin, limité à ses applications).
- Prouvé sur Postgres réel : `scripts/verify-tenant.mjs`.

## Quotas

- **`app_registry.monthly_quota`** (events/mois ; `NULL` = illimité).
- **`tenant_quota_status(app_id)`** → `{ used, quota, over }` sur le mois courant. **Fail-open** :
  pas de quota ⇒ jamais `over`.
- **Affichage** : `/admin/usage` montre la barre de consommation et signale les **dépassements**.

### Enforcement (opt-in, hook documenté)
Par défaut le quota est **observé** (visibilité + base d'alerte), pas bloquant — éviter la
**perte de données** par rejet. Pour appliquer un plafond dur, l'ingestion peut consulter
`tenant_quota_status(app_id)` (cache court) et **délester** au-delà (réponse 429-like +
compteur), de façon **fail-open** (cohérent avec le rate-limit). C'est une **décision
commerciale** (plan/quota) ; le statut est prêt, le branchement hot-path reste à activer.

## Suivi

- **Rôles par surface** (ADR-0003) : appliquer v89 et v93 en production, créer `api` et
  `console-api`, puis poser la portée (`withTenant()`) dans les lectures — c'est l'étape qui
  rendrait les policies actives (aujourd'hui posées mais inertes). La révocation de l'accès
  direct de la console passe par la rotation du mot de passe de `neondb_owner` (C12).
- Enforcement dur des quotas à l'ingestion (opt-in par app).
- Export de facturation (CSV/API) depuis `v_tenant_usage_month`.
