# Multi-tenant — isolation, métering & quotas (P0 #5)

> Comment MIP RUM sépare les clients (tenants = `app_id`), mesure leur consommation
> (facturation) et applique des quotas.

## Modèle d'isolation

| Couche | Mécanisme |
|---|---|
| **Identité tenant** | `app_id` sur toute ligne de télémétrie (résolu à l'ingestion via `mip.app_id` resource ; ligne sans `app_id` **rejetée**). |
| **Lecture console** | Toute requête filtre par `app_id`. **RBAC** : un `viewer` est scopé à une liste d'apps (`console_user.apps`) ; le middleware + la couche données rabattent toute app hors scope (jamais « toutes »). SSO : scope piloté par l'IdP (`OIDC_APPS_CLAIM`). |
| **Ingestion** | Clé d'API par app (hashée) ; rate-limit durable **par app** (`rate_check`). |
| **Repos / secrets** | RLS activé (API PostgREST fermée) ; secrets hashés / en coffre. |
| **Effacement** | `erase_app_data(app_id)` isole et supprime tout un tenant (cf. `CONFORMITE.md`). |

**Renforcement futur (noté)** : RLS **par tenant** au niveau base (policy sur un GUC
`app.current_app_id`) — nécessite de passer la console d'un rôle propriétaire à un rôle
**restreint**. Défense en profondeur au-delà du scoping applicatif actuel ; non bloquant
pour le MVP (le scoping + RBAC sont testés), à planifier avec la bascule ClickHouse.

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

- RLS par tenant (rôle restreint) — défense en profondeur base.
- Enforcement dur des quotas à l'ingestion (opt-in par app).
- Export de facturation (CSV/API) depuis `v_tenant_usage_month`.
