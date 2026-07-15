-- migration-v33.sql — Justesse RUM : device_type dérivé du user-agent, et apps
-- internes (dogfooding) exclues de la vue « toutes apps ».
--
-- Constat (audit d'un tableau « farfelu ») : ~78 % des sessions de la console
-- portaient device_type = null ALORS que ce sont de vrais navigateurs (user_agent
-- Chrome/Windows présent, vitals LCP/CLS émis). Deux causes :
--   1. le SDK ne met pas toujours mip.device_type sur la 1re span qui crée la session,
--   2. l'upsert figeait device_type à la création et ne le back-fillait jamais.
-- Effet : ces sessions null (les plus lentes) étaient invisibles au filtre
-- Desktop/Mobile ET gonflaient le p75 de la vue « Tous ». Ici on répare la donnée.
-- Idempotente.

-- 1) Helper : device_type déduit du user-agent (repli serveur, défense en profondeur ;
--    le SDK reste la source primaire quand il l'envoie).
create or replace function mip_device_from_ua(p_ua text) returns text
  language sql immutable
  set search_path = public, pg_temp
as $$
  select case
    when p_ua is null then null
    when p_ua ~* 'mobile|tablet|iphone|ipad|android|silk|kindle' then 'mobile'
    else 'desktop'
  end
$$;

-- 2) upsert_rum_session : repli UA à l'insert + back-fill device_type au rejeu.
--    On DROP la signature v27 (11 args) d'abord pour éviter une surcharge ambiguë.
drop function if exists upsert_rum_session(
  text, text, text, text, text, text, text, timestamptz, int, boolean, text
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
  values (p_session_id, p_app_id, p_client_id, p_user_hash, p_user_agent,
          coalesce(p_device_type, mip_device_from_ua(p_user_agent)),
          p_geo_country, p_is_bot, coalesce(p_collection_source, 'sdk'), p_last_seen_at, p_last_seen_at, 0)
  on conflict (session_id) do update
    set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
        user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
        geo_country  = coalesce(rum_session.geo_country, excluded.geo_country),
        -- back-fill device_type s'il est resté null (repli UA) ; ne rétrograde
        -- jamais une valeur déjà connue.
        device_type  = coalesce(rum_session.device_type, excluded.device_type),
        -- sticky : une session repérée bot le reste (jamais rétrogradée)
        is_bot       = rum_session.is_bot or excluded.is_bot;
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

-- 3) Back-fill des sessions existantes : device_type déduit du user_agent stocké.
update rum_session
   set device_type = mip_device_from_ua(user_agent)
 where device_type is null and user_agent is not null;

-- 4) Apps internes : marque les apps de dogfooding pour les exclure de la vue
--    « toutes apps » (elles restent consultables en sélectionnant l'app).
alter table app_registry add column if not exists internal boolean not null default false;

-- La console qui se mesure elle-même ne doit pas noyer les agrégats client.
insert into app_registry (app_id, name, internal, active)
values ('mip-rum-console', 'Console MIP (interne)', true, true)
on conflict (app_id) do update set internal = true;
