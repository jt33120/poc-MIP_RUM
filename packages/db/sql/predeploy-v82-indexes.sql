-- Pré-déploiement en ligne de migration-v82.sql (P7.5 — runtime et capacités mobiles).
-- À exécuter hors transaction sur une base vivante AVANT le migrateur :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f packages/db/sql/predeploy-v82-indexes.sql
-- Puis vérifier `indisvalid` et `indisready` : un index invalide laissé par un
-- échec n'est pas réparé par `if not exists`, il faut le supprimer et relancer.
--
--   select indexrelid::regclass, indisvalid, indisready
--     from pg_index where indexrelid::regclass::text like '%\_v82';
--
-- `rum_session` est écrite à CHAQUE lot d'ingestion : construit dans la
-- transaction du migrateur, cet index bloquerait l'ingestion pendant toute sa
-- construction. CONCURRENTLY ne le fait pas.
--
-- ORDRE. La colonne `runtime` doit exister avant l'index. Si elle manque encore,
-- l'ajouter d'abord — l'instruction est la même que celle de migration-v82, et
-- `add column if not exists` d'une colonne NULLABLE sans défaut ne réécrit pas la
-- table : elle ne prend qu'un verrou bref sur le catalogue.

alter table rum_session add column if not exists runtime text;

create index concurrently if not exists idx_session_app_runtime_v82
  on rum_session (app_id, runtime, started_at);
