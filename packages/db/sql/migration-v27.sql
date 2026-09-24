-- migration-v27.sql — Ext-A : 2ᵉ mode RUM (extension navigateur).
--
-- Deux ajouts, tous deux non destructifs :
--   1. rum_session.collection_source : d'où vient la collecte — 'sdk' (script posé
--      par le dev, défaut) ou 'extension' (SDK injecté par l'extension navigateur).
--      Attribut TECHNIQUE, pas une PII. Tout l'existant reste 'sdk' (défaut).
--   2. extension_scope : registre domaine -> app_id. L'extension n'observe QUE les
--      domaines enregistrés ici (jamais <all_urls>). Géré côté admin console.
-- Cf. docs/CADRAGE_EXTENSION.md.

-- 1. Tag de source sur la session (hérité par jointure pour les tables filles) ---
alter table rum_session add column if not exists collection_source text not null default 'sdk';

-- Index partiel : l'extension est (au départ) minoritaire ; on n'indexe QUE les
-- lignes non-'sdk', pour segmenter/filtrer par source sans grossir l'index du cas
-- courant (même logique que idx_session_is_bot en v23).
create index if not exists idx_session_source on rum_session (app_id)
  where collection_source <> 'sdk';

-- upsert_rum_session : nouveau paramètre p_collection_source (11ᵉ arg). On DROP la
-- signature v23 (10 args) d'abord pour éviter une surcharge ambiguë. search_path
-- figé (parité durcissement v11).
drop function if exists upsert_rum_session(
  text, text, text, text, text, text, text, timestamptz, int, boolean
);

create or replace function upsert_rum_session(
  p_session_id text, p_app_id text, p_client_id text, p_user_hash text,
  p_user_agent text, p_device_type text, p_geo_country text,
  p_last_seen_at timestamptz, p_page_count_inc int, p_is_bot boolean default false,
  p_collection_source text default 'sdk'
) returns void language sql
  set search_path = public, pg_temp
as $$
  insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, geo_country, is_bot, collection_source, started_at, last_seen_at, page_count)
  values (p_session_id, p_app_id, p_client_id, p_user_hash, p_user_agent, p_device_type, p_geo_country, p_is_bot, coalesce(p_collection_source, 'sdk'), p_last_seen_at, p_last_seen_at, 0)
  on conflict (session_id) do update
    set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
        user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
        geo_country  = coalesce(rum_session.geo_country, excluded.geo_country),
        -- sticky : une session repérée bot le reste (jamais rétrogradée)
        is_bot       = rum_session.is_bot or excluded.is_bot;
        -- collection_source : figé à la création (la 1re source observée fait foi ;
        -- pas de mutation au rejeu, comme device_type/client_id).
$$;

-- Re-grant service_role si présent (le drop a retiré les grants ; local/CI sans
-- ce rôle -> saut silencieux).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function upsert_rum_session('
      || 'text, text, text, text, text, text, text, timestamptz, int, boolean, text'
      || ') to service_role';
  end if;
end $$;

-- 2. Registre domaine -> app_id pour l'extension --------------------------------
create table if not exists extension_scope (
  id          bigserial primary key,
  domain      text not null unique,      -- hostname exact (sans port), ex. "app.client.fr"
  app_id      text not null,             -- app_id MIP cible pour ce domaine
  endpoint    text,                      -- override d'endpoint d'ingestion (null = défaut prod)
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Résolution par hostname sur les entrées actives (chemin chaud de l'extension).
create index if not exists idx_extension_scope_domain on extension_scope (domain) where active;

-- Accès console (lecture runtime + gestion admin ; pas de delete — désactivation
-- par active=false, cohérent avec read_tokens/goal).
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant select, insert, update on extension_scope to console_ro;
    grant usage, select on sequence extension_scope_id_seq to console_ro;
  end if;
end $$;
