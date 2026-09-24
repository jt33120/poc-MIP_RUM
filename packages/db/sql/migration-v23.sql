-- migration-v23.sql — Lot 2 : détection de bots à l'ingestion.
--
-- Objectif « Real User » : le trafic NON humain qui exécute quand même du JS
-- (headless CI/audits, moniteurs synthétiques, crawlers JS) émet des spans et
-- polluait les agrégats. On le FLAGue (rum_session.is_bot) à l'ingestion —
-- PAS de drop : la donnée reste auditable, mais la console l'exclut par défaut.
-- Classification côté ingest : _shared/bots.mjs (regex UA + signal webdriver).

alter table rum_session add column if not exists is_bot boolean not null default false;

-- Index partiel : les requêtes filtrent `not is_bot`, donc on n'indexe QUE les
-- bots (minorité) — utile aux futures vues d'inspection du trafic non humain,
-- sans grossir l'index pour le cas courant.
create index if not exists idx_session_is_bot on rum_session (app_id) where is_bot;

-- upsert_rum_session : nouveau paramètre p_is_bot. On DROP l'ancienne signature
-- (9 args) d'abord pour éviter une surcharge ambiguë. search_path figé (parité
-- avec le durcissement migration-v11, qui s'applique aux fonctions existant
-- à SON exécution — cette recréation est postérieure).
drop function if exists upsert_rum_session(
  text, text, text, text, text, text, text, timestamptz, int
);

create or replace function upsert_rum_session(
  p_session_id text, p_app_id text, p_client_id text, p_user_hash text,
  p_user_agent text, p_device_type text, p_geo_country text,
  p_last_seen_at timestamptz, p_page_count_inc int, p_is_bot boolean default false
) returns void language sql
  set search_path = public, pg_temp
as $$
  insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, geo_country, is_bot, started_at, last_seen_at, page_count)
  values (p_session_id, p_app_id, p_client_id, p_user_hash, p_user_agent, p_device_type, p_geo_country, p_is_bot, p_last_seen_at, p_last_seen_at, 0)
  on conflict (session_id) do update
    set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
        user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
        geo_country  = coalesce(rum_session.geo_country, excluded.geo_country),
        -- sticky : une session repérée bot le reste (jamais rétrogradée)
        is_bot       = rum_session.is_bot or excluded.is_bot;
$$;

-- Re-grant service_role si présent (le drop a retiré les grants de l'ancienne
-- fonction ; sur local/CI le rôle n'existe pas -> saut silencieux).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function upsert_rum_session('
      || 'text, text, text, text, text, text, text, timestamptz, int, boolean'
      || ') to service_role';
  end if;
end $$;
