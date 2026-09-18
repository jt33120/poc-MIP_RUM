-- Pré-déploiement en ligne de migration-v81.sql (P8.1 — effacement sérialisé).
-- À exécuter hors transaction sur une base vivante AVANT le migrateur :
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/ingest/sql/predeploy-v81-indexes.sql
-- Puis vérifier `indisvalid` ET `indisready` : un index invalide laissé par un
-- échec n'est PAS réparé par `if not exists`, il faut le supprimer et relancer.
--
--   select indexrelid::regclass, indisvalid, indisready
--     from pg_index where indexrelid::regclass::text like '%\_v81';
--   -- puis, si l'un des deux est faux :
--   drop index concurrently idx_ingest_raw_app_a_faire_v81;
--
-- UN SEUL INDEX EST CONCERNÉ, ET SEULEMENT DANS UNE CONFIGURATION.
-- `idx_privacy_erasure_barrier_app_v81` porte sur une table CRÉÉE par v81 : elle
-- est vide, sa construction est instantanée, et la faire ici n'aurait aucun
-- sens. `idx_ingest_raw_app_a_faire_v81`, lui, porte sur la file de
-- débarquement : vide quand `INGEST_DEFERRED` est éteint — le défaut —, mais
-- potentiellement chaude et volumineuse quand il est allumé. v81 refuse alors
-- de s'appliquer tant que cet index n'existe pas, plutôt que de le construire
-- sous un verrou qui bloquerait l'ingestion.
--
-- Le prédicat partiel reprend celui de `idx_ingest_raw_a_faire` (v63) :
-- MAX_TENTATIVES vaut 5 des deux côtés, et une valeur littérale est exigée par
-- PostgreSQL dans un index partiel.

create index concurrently if not exists idx_ingest_raw_app_a_faire_v81
  on ingest_raw (app_id, reprendre_a, id) where tentatives < 5;
