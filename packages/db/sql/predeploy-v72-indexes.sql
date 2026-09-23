-- Pré-déploiement en ligne de migration-v72.sql.
-- À exécuter hors transaction sur une base vivante avant le migrateur :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/predeploy-v72-indexes.sql
-- Puis vérifier `indisvalid` et `indisready` : un index invalide laissé par un
-- échec n'est pas réparé par `if not exists`, il faut le supprimer et relancer.

create index concurrently if not exists idx_rum_error_fingerprint_ts_v72
  on rum_error (app_id, fingerprint, ts);
