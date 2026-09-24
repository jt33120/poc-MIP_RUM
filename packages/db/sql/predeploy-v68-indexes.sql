-- Pré-déploiement en ligne de migration-v68.sql.
-- À exécuter hors transaction sur une base vivante avant le migrateur :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/predeploy-v68-indexes.sql

create index concurrently if not exists idx_rum_event_explorer_v68
  on rum_event (app_id, name, ts desc, id desc);
create index concurrently if not exists idx_rum_event_props_v68
  on rum_event using gin (props jsonb_path_ops);
create index concurrently if not exists idx_rum_event_index_app_session_v68
  on rum_event_index (app_id, session_id, ts desc, id desc);
