-- Pré-déploiement en ligne de migration-v111.sql (logs idempotents).
-- Le migrateur (`packages/db/migrate.mjs`) le passe lui-même, hors transaction,
-- juste avant migration-v111 quand elle est en attente. À la main :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/predeploy-v111-indexes.sql
-- Puis vérifier `indisvalid` et `indisready` : un index invalide laissé par un
-- échec n'est pas réparé par `if not exists`, il faut le supprimer et relancer.
--
--   select indexrelid::regclass, indisvalid, indisready
--     from pg_index where indexrelid::regclass::text like '%\_v111';
--
-- ORDRE. La colonne doit exister avant l'index : `add column if not exists` d'une
-- colonne NULLABLE sans défaut ne réécrit pas la table (verrou bref du catalogue).

alter table rum_log add column if not exists log_uid text;

create unique index concurrently if not exists rum_log_app_uid_v111
  on rum_log (app_id, log_uid) where log_uid is not null;
