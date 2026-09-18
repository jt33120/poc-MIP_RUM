-- Pré-déploiement en ligne de migration-v80.sql (P6.6 — agrégats et performance).
-- À exécuter hors transaction sur une base vivante AVANT le migrateur :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/ingest/sql/predeploy-v80-indexes.sql
-- Puis vérifier `indisvalid` et `indisready` : un index invalide laissé par un
-- échec n'est pas réparé par `if not exists`, il faut le supprimer et relancer.
--
--   select indexrelid::regclass, indisvalid, indisready
--     from pg_index where indexrelid::regclass::text like '%\_v80';
--
-- Les trois index portent sur rum_event, la table la plus chaude du produit :
-- construits dans la transaction du migrateur, ils bloqueraient l'ingestion
-- pendant toute leur construction. CONCURRENTLY ne le fait pas.

create index concurrently if not exists idx_rum_event_app_ts_v80
  on rum_event (app_id, ts);
create index concurrently if not exists idx_rum_event_app_release_ts_v80
  on rum_event (app_id, release, ts);
create index concurrently if not exists idx_rum_event_app_env_ts_v80
  on rum_event (app_id, env, ts);
