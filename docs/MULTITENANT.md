# Multi-tenant — isolation, métering & quotas (P0 #5)

> Comment MIP RUM sépare les clients (tenants = `app_id`), mesure leur consommation
> (facturation) et applique des quotas.

## Modèle d'isolation

| Couche | Mécanisme |
|---|---|
| **Identité tenant** | `app_id` sur toute ligne de télémétrie (résolu à l'ingestion via `mip.app_id` resource ; ligne sans `app_id` **rejetée**). |
| **Lecture console** | Toute requête filtre par `app_id`. **RBAC** : un `viewer` est scopé à une liste d'apps (`console_user.apps`) ; le middleware + la couche données rabattent toute app hors scope (jamais « toutes »). SSO : scope piloté par l'IdP (`OIDC_APPS_CLAIM`). |
| **Ingestion** | Clé d'API par app (hashée) ; rate-limit durable **par app** (`rate_check`). |
| **Repos / secrets** | RLS activé, policies **scopées par tenant** (migration-v47) ; secrets hashés / en coffre. |
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
effet en prod Supabase (rôle `BYPASSRLS`), fatal en **self-host**.

**Ce qui reste à faire pour que la ceinture serve (bascule d'exploitation).** Tant que
la console se connecte avec un rôle `BYPASSRLS`, les policies sont **inertes** : v47 est
une défense en profondeur, pas un remplacement du `WHERE app_id =`. Boucler exige :
1. un identifiant `console_ro` dédié dans `DATABASE_URL` (rôle déjà présent, `LOGIN`,
   sans `BYPASSRLS`) ;
2. router les lectures scopées par `withTenant(appIds, …)` (`apps/console/lib/db.ts`),
   qui pose la GUC en `set_local` — donc **dans une transaction**, faute de quoi le pool
   `pg` ferait fuir la portée d'un tenant vers la requête suivante ;
3. rejouer la non-régression complète de la console (certaines vues admin sont
   volontairement inter-tenant et devront passer par le rôle d'exploitation).

**Preuve** : `pnpm test:isolation` (`scripts/verify-tenant-isolation.mjs`, joué en CI sur
une base dédiée) — 19 assertions, toutes les requêtes écrites **sans** `WHERE app_id =`,
dont la symétrie A↔B, le fail-closed sans GUC, et le maintien de la portée inter-tenant
des fonctions `security definer`.

## Métering (consommation — base de facturation)

- **`tenant_usage_daily(app_id, day, events, sessions, errors)`** : agrégat **durable**
  (sans FK → **survit à la purge** de télémétrie, donc l'historique de facturation reste).
- **`meter_tenant_usage(day)`** : calcule la consommation d'un jour clos (events = total des
  lignes ingérées : pageviews + metrics + erreurs + ressources + longtasks + breadcrumbs +
  events + spans). Idempotent. Planifié **quotidiennement à 3 h 05** (avant la purge de 3 h 17).
- **`v_tenant_usage_month`** : usage mensuel agrégé. Vue console : **`/admin/usage`** (admin).
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

- **Bascule** de la console sur le rôle restreint `console_ro` + `withTenant()` — c'est
  l'étape qui rend les policies de v47 actives (aujourd'hui posées mais inertes).
- Enforcement dur des quotas à l'ingestion (opt-in par app).
- Export de facturation (CSV/API) depuis `v_tenant_usage_month`.
