# ADR-0015 — Schémas par domaine : la cible, pas encore appliquée

- **Statut** : acceptée comme cible ; **non appliquée**
- **Date** : 2026-09-29
- **Portée** : Neon, tous les services qui se connectent à la base, les rôles (ADR-0003, ADR-0012)

## Contexte

Toutes les tables vivent dans le schéma `public` : 64 tables après le nettoyage du 29/09/2026 (retrait du SVI, de `openrouter_balance` et des tickets), 10 vues, une cinquantaine de fonctions. Rangées par familles de noms (`rum_*`, `alert_*`, `error_issue_*`), elles restent lisibles, mais rien dans la base ne dit quelle table relève de la collecte, du plan de contrôle, des secrets d'accès ou de l'exploitation.

Une étude (29/09/2026, dépôt et base locale en lecture seule) a mesuré ce que coûterait le rangement :

- **Des pannes silencieuses.** 48 lignes dans 28 fichiers exécutés en production testent la présence d'un objet par `to_regclass('public.x')` ou `information_schema … table_schema = 'public'` : c'est la tolérance « code déployé avant sa migration » (ADR-0004). Une table déplacée y serait déclarée absente, et le code se dégraderait au lieu d'échouer : la barrière d'effacement RGPD laisserait passer les lots (`packages/backend/lib/privacy-barriere.mjs`), l'effacement sauterait `rum_event_index` et `rum_action` (`apps/console/lib/queries-dsar.ts`), l'ingestion cesserait d'alimenter `rum_event_index` (`packages/backend/lib/pg-ingest.mjs`).
- **Des pannes visibles.** 26 fonctions ont un `search_path` figé sur `public, pg_temp` ; `USAGE` n'est accordé que sur `public` (v89, v93) ; `scripts/ci/verify-db-roles.mjs` ne regarde que `public`.
- **Un piège du migrateur.** `create table if not exists schema_migration` (`packages/db/migrate.mjs`) et `scheduler_lease` (`packages/backend/jobs/bail.mjs`) ne sont pas qualifiés : déplacées, ces tables renaîtraient vides.
- **Le pooler Neon** (PgBouncer en mode transaction) ne garde pas un `SET search_path` de session ; `ALTER DATABASE … SET` ne vaut que pour les nouvelles connexions.

Effort estimé : 25 à 34 heures, deux déploiements coordonnés (Vercel, cinq services Railway, calcul Neon).

## Décision

**La cible est cinq schémas par domaine**, selon une règle : ce que la collecte écrit va dans `rum`, ce qu'un humain décide va dans `console`.

| Schéma | Contenu | Qui écrit |
|---|---|---|
| `rum` | télémétrie brute (`rum_*`, `replay_chunk`, `sourcemap`, `deploy_marker`…), `rum_event_index`, agrégats (`rum_rollup_hourly`, `metric_histogram_*`), chemin d'ingestion (`ingest_raw`, `rate_counter`, `route_*`), erreurs déduites (`error_issue`, `error_issue_alias`) | `collector`, `scheduler` |
| `console` | applications (`app_registry`), tableaux, vues, objectifs, alertes, SLO, sondes de disponibilité, triage des erreurs, extension | `console-api` |
| `identite` | `console_user`, `console_session`, `auth_throttle`, `read_tokens`, `sourcemap_upload_token` | `console-api` (rôle `mip_identity`) |
| `ops` | `scheduler_lease`, `platform_flag`, `backfill_run`, `tenant_usage_daily`, `audit_log` (`schema_migration` en dernier, ou jamais) | `scheduler` |
| `rgpd` | `privacy_erasure_request`, `privacy_erasure_barrier` | `console-api` ; le `collector` lit les barrières |

Les fonctions restent dans `public`, avec un `search_path` explicite.

**Elle n'est pas appliquée avant la présentation du 02/10/2026**, ni pendant la campagne de trafic simulé sur UTI. Elle le sera en trois temps, à partir du 05/10/2026 et après répétition sur la branche `repetition-p0` :

1. une migration qui crée les schémas, accorde `USAGE`, déplace chaque table (`ALTER TABLE … SET SCHEMA`) et laisse dans `public` une **vue de compatibilité** (`security_invoker`) aux droits recopiés : aucun `search_path` à changer, aucune fonction à re-épingler, aucun test de présence ne change de réponse ;
2. le code rendu indépendant du schéma (tests de présence, créations qualifiées, vérificateurs de rôles multi-schémas), déployé seul ;
3. `ALTER DATABASE … SET search_path`, recyclage des connexions, puis une migration qui re-épingle les fonctions et retire les vues.

## Conséquences

- Le gain attendu est la **lisibilité** et une barrière grossière de plus (`USAGE` par schéma). Il ne supprime pas les listes blanches par table et par colonne : `mip_console` a besoin de colonnes de `identite` (ADR-0012), `mip_api` de `console_user.id` et de `read_tokens` (ADR-0003).
- Il ouvre la voie à un rôle de collecte limité à `INSERT` sur `rum`, là où le `collector` se connecte aujourd'hui en propriétaire.
- Toute nouvelle table se range dès maintenant dans le domaine de la cible, dans sa description (commentaire de migration), pour que le déplacement ne demande pas de nouvelle décision.

## Écarté

- **Migrer avant le 02/10/2026** : pour un gain de lisibilité, le risque touchait l'ingestion et l'effacement RGPD, en silence, pendant que le trafic simulé sert de preuve des chiffres.
- **Partitionner `rum_span` et `rum_event_index` par jour** : sans objet au volume actuel (environ 52 Mo utiles après le retrait du bruit de scanner). Il imposerait des clés uniques incluant `ts`, donc une idempotence de l'ingestion affaiblie quand l'horodatage retombe sur l'heure de réception, et une purge par partition seulement à la rétention maximale. Seuil à surveiller : une purge quotidienne de plus de 1 à 5 millions de lignes, ou de plus de 10 minutes, ou ces tables au-delà d'environ 10 Go.
- **Un schéma par application cliente** : le cloisonnement passe par `app_id` et la RLS (ADR-0003) ; un schéma par client multiplierait les migrations.
