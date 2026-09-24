-- P3 — actions navigateur causales.
-- Additif et sans FK vers rum_action : code v67 + schéma v66 reste une fenêtre
-- de déploiement supportée, et l'ordre réseau/retry peut livrer un enfant avant
-- sa projection racine.

create table if not exists rum_action (
  action_id  text primary key check (
    action_id ~ '^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$'
  ),
  span_id    text not null unique check (span_id ~ '^[0-9a-f]{16}$'),
  session_id text not null,
  app_id     text not null,
  type       text not null check (type in ('click', 'manual')),
  name       text not null check (char_length(name) between 1 and 100),
  route      text check (
    route is null or route = '(other)' or
    (route like '/%' and route not like '//%' and char_length(route) <= 512)
  ),
  context    jsonb not null default '{}'::jsonb check (
    jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768
  ),
  ts         timestamptz not null
);

comment on table rum_action is
  'Projection scrubbed des racines d action. Non facturée : le signal source reste rum_event.';

-- v62 ne pouvait pas inclure une table qui n'existait pas encore. Les actions
-- suivent exactement la même normalisation et le même plafond cardinalité que
-- toutes les autres télémétries portant une route.
drop trigger if exists trg_route_rum_action on rum_action;
create trigger trg_route_rum_action before insert on rum_action
  for each row when (new.route is not null) execute function mip_trigger_route();

create or replace function mip_apercu_backfill(p_app_id text)
returns table (route_avant text, route_apres text, lignes bigint)
language sql stable as $$
  select route, mip_normaliser_route(p_app_id, route), count(*)
    from (select route from rum_metric where app_id = p_app_id and route is not null
          union all
          select route from rum_pageview where app_id = p_app_id and route is not null
          union all
          select route from rum_action where app_id = p_app_id and route is not null) x
   group by 1, 2
  having route is distinct from mip_normaliser_route(p_app_id, route)
   order by 3 desc;
$$;

create or replace function backfill_route_patterns(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); t text; n bigint; v_distinctes int;
begin
  foreach t in array array['rum_metric', 'rum_pageview', 'rum_error', 'rum_longtask',
                           'rum_resource', 'rum_event', 'rum_span', 'rum_log', 'rum_ai',
                           'rum_action'] loop
    execute format(
      'update %1$I set route = mip_normaliser_route(app_id, route)
        where app_id = $1 and route is not null
          and route is distinct from mip_normaliser_route(app_id, route)', t)
      using p_app_id;
    get diagnostics n = row_count;
    result := result || jsonb_build_object(t, n);
  end loop;

  delete from route_registry where app_id = p_app_id;
  insert into route_registry (app_id, route, first_seen_at)
  select app_id, route, min(ts) from rum_metric where app_id = p_app_id and route is not null group by 1, 2
  on conflict do nothing;
  insert into route_registry (app_id, route, first_seen_at)
  select app_id, route, min(started_at) from rum_pageview where app_id = p_app_id and route is not null group by 1, 2
  on conflict do nothing;
  insert into route_registry (app_id, route, first_seen_at)
  select app_id, route, min(ts) from rum_action where app_id = p_app_id and route is not null group by 1, 2
  on conflict do nothing;
  insert into route_cardinality (app_id, n)
  select p_app_id, count(*)::int from route_registry where app_id = p_app_id
  on conflict (app_id) do update set n = excluded.n;

  select rc.n into v_distinctes from route_cardinality rc where rc.app_id = p_app_id;
  return result || jsonb_build_object('routes_distinctes', v_distinctes);
end $$;

alter table rum_error      add column if not exists action_id text;
alter table rum_resource   add column if not exists action_id text;
alter table rum_breadcrumb add column if not exists action_id text;
alter table rum_breadcrumb add column if not exists route text;
alter table rum_span       add column if not exists action_id text;

create index if not exists idx_rum_action_app_ts on rum_action (app_id, ts desc, action_id desc);
create index if not exists idx_rum_action_app_name_ts on rum_action (app_id, name, ts desc);
create index if not exists idx_rum_action_session on rum_action (session_id, ts);
create index if not exists idx_rum_error_action on rum_error (action_id) where action_id is not null;
create index if not exists idx_rum_resource_action on rum_resource (action_id) where action_id is not null;
create index if not exists idx_rum_breadcrumb_action on rum_breadcrumb (action_id) where action_id is not null;
create index if not exists idx_rum_span_action on rum_span (action_id) where action_id is not null;

-- v65 fermait la taxonomie avant l'existence des error clicks.
alter table rum_event_index drop constraint if exists rum_event_index_source_name_check;
alter table rum_event_index drop constraint if exists rum_event_index_source_name_v67;
alter table rum_event_index add constraint rum_event_index_source_name_v67 check (
  source_name is null or source_name = any (array[
    'LCP', 'INP', 'CLS', 'FCP', 'TTFB',
    'document', 'stylesheet', 'script', 'image', 'font', 'xhr', 'fetch', 'beacon', 'media', 'worker', 'other',
    'longtask', 'loaf', 'click', 'nav', 'error', 'custom', 'track',
    'frustration.rage', 'frustration.dead', 'frustration.error',
    'client', 'server', 'db', 'internal'
  ])
);

-- Table créée après v47 : policy explicite, fail-closed sans GUC tenant.
alter table rum_action enable row level security;
drop policy if exists tenant_scope on rum_action;
create policy tenant_scope on rum_action
  for select to console_ro using (app_id = any (current_app_ids()));
grant select on rum_action to console_ro;

-- Rétention par application. La projection est supprimée avant les sources et
-- participe au test « session vide » sans être ajoutée au métering.
create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_event_index where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action a
   where a.app_id = p_app_id and a.ts < p_cutoff
     and not exists (select 1 from rum_error x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_resource x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_breadcrumb x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_span x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff)
     and not exists (select 1 from rum_event x where x.app_id = a.app_id and x.action_id = a.action_id and x.ts >= p_cutoff);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;      get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event x where x.session_id = s.session_id)
     and not exists (select 1 from rum_span x where x.session_id = s.session_id)
     and not exists (select 1 from rum_action x where x.session_id = s.session_id)
     and not exists (select 1 from rum_event_index x where x.session_id = s.session_id)
     and not exists (select 1 from replay_chunk x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from ingest_raw      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from route_pattern where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

create or replace function erase_session(p_session_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('session_id', p_session_id); n bigint;
begin
  delete from ingest_raw
   where lot @> jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('session_id', p_session_id)));
  get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_action      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_action', n);
  delete from rum_metric      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb  where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span        where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log         where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session     where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- meter_tenant_usage n'est volontairement pas redéfini : il compte toujours
-- les tables sources, dont rum_event porte déjà la racine. rum_action est une
-- projection de lecture et son ajout au métering compterait chaque action deux fois.
