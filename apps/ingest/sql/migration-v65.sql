-- migration-v65 — index de lecture unifié des signaux RUM.
--
-- Cette table est une PROJECTION append-only des collections RUM déjà
-- normalisées. Elle ne reçoit jamais le payload OTLP brut, les props, messages,
-- stacks, user_hash, visitor_id, user-agent, URL complète ou logs. Son unique
-- identité est le span source, et sa rétention/son effacement suivent les
-- sources dans les fonctions redéfinies plus bas.

create table if not exists rum_event_index (
  id             bigserial primary key,
  app_id         text not null,
  session_id     text,
  ts             timestamptz not null,
  route          text check (
    route is null or route = '(other)' or
    (route like '/%' and route not like '//%' and char_length(route) <= 512)
  ),
  kind           text not null check (kind in (
    'pageview', 'vital', 'error', 'resource', 'longtask', 'breadcrumb', 'event', 'span'
  )),
  -- Taxonomie fermée : aucun nom de track, ressource, span ou texte client
  -- libre ne peut devenir un identifiant exposé par l'API.
  source_name    text check (source_name is null or source_name = any (array[
    'LCP', 'INP', 'CLS', 'FCP', 'TTFB',
    'document', 'stylesheet', 'script', 'image', 'font', 'xhr', 'fetch', 'beacon', 'media', 'worker', 'other',
    'longtask', 'loaf', 'click', 'nav', 'error', 'custom', 'track', 'frustration.rage', 'frustration.dead',
    'client', 'server', 'db', 'internal'
  ])),
  -- L'identité publiée est exclusivement le span OTLP 64 bits normalisé en
  -- minuscules. Une chaîne hostile ne passe donc ni dans l'index ni dans l'API.
  source_span_id text not null check (source_span_id ~ '^[0-9a-f]{16}$'),
  -- Un rejeu immédiat ou différé doit rester inerte pour la même identité
  -- native. `kind` distingue volontairement les familles de projection.
  constraint rum_event_index_source_uq unique (app_id, kind, source_span_id)
);

comment on table rum_event_index is
  'Projection minimale et append-only des signaux RUM normalisés. Hors métering : une ligne indexe un signal source, elle ne le facture pas.';
comment on column rum_event_index.source_name is
  'Taxonomie facultative et fermée. Ni message, ni stack, ni props JSON, ni nom libre venu du client.';

-- Pas de backfill historique automatique : son périmètre/charge/consentement
-- doivent être décidés explicitement. La projection commence avec v65.
create index if not exists idx_rum_event_index_app_kind_ts_id
  on rum_event_index (app_id, kind, ts desc, id desc);
create index if not exists idx_rum_event_index_app_ts_id
  on rum_event_index (app_id, ts desc, id desc);
create index if not exists idx_rum_event_index_session
  on rum_event_index (session_id) where session_id is not null;

-- Même route que les sources : le trigger v62 applique d'abord les règles
-- route_pattern, puis le plafond app_registry/route_cardinality. L'index ne
-- stocke donc jamais une copie brute antérieure à cette normalisation.
drop trigger if exists trg_route_rum_event_index on rum_event_index;
create trigger trg_route_rum_event_index before insert on rum_event_index
  for each row when (new.route is not null) execute function mip_trigger_route();

-- RLS explicite : v47 ne peut pas découvrir une table créée après son passage.
-- Sans GUC app.current_app_id, current_app_ids() renvoie {}, donc zéro ligne.
alter table rum_event_index enable row level security;
drop policy if exists tenant_scope on rum_event_index;
create policy tenant_scope on rum_event_index
  for select to console_ro using (app_id = any (current_app_ids()));
grant select on rum_event_index to console_ro;

-- Rétention : l'index suit sa source. On le supprime avant les sources afin
-- qu'une session devenue vide puisse être purgée dans la même exécution.
create or replace function purge_rum_app(p_app_id text, p_cutoff timestamptz)
returns jsonb language plpgsql as $$
declare result jsonb := '{}'::jsonb; n bigint;
begin
  delete from rum_event_index where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_metric     where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log        where app_id = p_app_id and ts < p_cutoff;          get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id and created_at < p_cutoff;  get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_rollup_hourly where app_id = p_app_id and hour < p_cutoff;     get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id and hour < p_cutoff; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);

  delete from rum_pageview p
   where p.app_id = p_app_id and p.started_at < p_cutoff
     and not exists (select 1 from rum_metric m where m.pageview_id = p.id)
     and not exists (select 1 from rum_error  e where e.pageview_id = p.id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);

  delete from rum_session s
   where s.app_id = p_app_id and s.last_seen_at < p_cutoff
     and not exists (select 1 from rum_pageview   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_metric     x where x.session_id = s.session_id)
     and not exists (select 1 from rum_error      x where x.session_id = s.session_id)
     and not exists (select 1 from rum_resource   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_longtask   x where x.session_id = s.session_id)
     and not exists (select 1 from rum_breadcrumb x where x.session_id = s.session_id)
    and not exists (select 1 from rum_event      x where x.session_id = s.session_id)
    and not exists (select 1 from rum_span       x where x.session_id = s.session_id)
    and not exists (select 1 from rum_event_index x where x.session_id = s.session_id)
    and not exists (select 1 from replay_chunk   x where x.session_id = s.session_id);
  get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- Art. 17 app : la file est vidée avant les sources (v63), puis la projection
-- dans la même transaction/fonction pour qu'aucune ligne index ne survive.
create or replace function erase_app_data(p_app_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('app_id', p_app_id); n bigint;
begin
  delete from ingest_raw     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_metric     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log        where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  delete from rum_rollup_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_rollup_hourly', n);
  delete from metric_histogram_hourly where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('metric_histogram_hourly', n);
  delete from route_pattern     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_pattern', n);
  delete from route_registry    where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_registry', n);
  delete from route_cardinality where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('route_cardinality', n);
  delete from sourcemap      where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('sourcemap', n);
  delete from syn_snapshot   where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('syn_snapshot', n);
  delete from alert_event    where rule_id in (select id from alert_rule where app_id = p_app_id);
  delete from alert_rule     where app_id = p_app_id; get diagnostics n = row_count; result := result || jsonb_build_object('alert_rule', n);
  return result;
end $$;

-- Effacement d'une session / DSAR : la projection suit la même ancre session_id.
create or replace function erase_session(p_session_id text)
returns jsonb language plpgsql as $$
declare result jsonb := jsonb_build_object('session_id', p_session_id); n bigint;
begin
  -- Le verrou de la file est pris par le worker avant writeRows : supprimer les
  -- lots contenant cette session sérialise l'effacement avec le drain. Ainsi un
  -- lot en attente ne peut jamais recréer une session art. 17 effacée.
  delete from ingest_raw
   where lot @> jsonb_build_object('sessions', jsonb_build_array(jsonb_build_object('session_id', p_session_id)));
  get diagnostics n = row_count; result := result || jsonb_build_object('ingest_raw', n);
  delete from rum_event_index where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event_index', n);
  delete from rum_metric     where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_metric', n);
  delete from rum_error      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_error', n);
  delete from rum_resource   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_resource', n);
  delete from rum_longtask   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_longtask', n);
  delete from rum_breadcrumb where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_breadcrumb', n);
  delete from rum_event      where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_event', n);
  delete from rum_span       where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_span', n);
  delete from rum_log        where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_log', n);
  delete from replay_chunk   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('replay_chunk', n);
  delete from rum_pageview   where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_pageview', n);
  delete from rum_session    where session_id = p_session_id; get diagnostics n = row_count; result := result || jsonb_build_object('rum_session', n);
  return result;
end $$;

-- Le quota demeure un comptage des tables SOURCES. rum_event_index est absent
-- explicitement : indexer un signal ne doit jamais l'augmenter ni le facturer.
create or replace function meter_tenant_usage(p_day date default (current_date - 1))
returns jsonb language plpgsql as $$
declare lo timestamptz := p_day::timestamptz; hi timestamptz := (p_day + 1)::timestamptz; n int;
begin
  with ev as (
    select app_id, count(*) as c from (
      select app_id from rum_metric     where ts >= lo and ts < hi
      union all select app_id from rum_error      where ts >= lo and ts < hi
      union all select app_id from rum_resource   where ts >= lo and ts < hi
      union all select app_id from rum_longtask   where ts >= lo and ts < hi
      union all select app_id from rum_breadcrumb where ts >= lo and ts < hi
      union all select app_id from rum_event      where ts >= lo and ts < hi
      union all select app_id from rum_span       where ts >= lo and ts < hi
      union all select app_id from rum_pageview   where started_at >= lo and started_at < hi
    ) x group by app_id
  ),
  se as (select app_id, count(distinct session_id) as c from rum_pageview where started_at >= lo and started_at < hi group by app_id),
  er as (select app_id, coalesce(sum(occurrences), 0)::bigint as c from rum_error where ts >= lo and ts < hi group by app_id),
  up as (
    insert into tenant_usage_daily (app_id, day, events, sessions, errors, metered_at)
    select ev.app_id, p_day, ev.c, coalesce(se.c, 0), coalesce(er.c, 0), clock_timestamp()
    from ev left join se using (app_id) left join er using (app_id)
    on conflict (app_id, day) do update
      set events = excluded.events, sessions = excluded.sessions,
          errors = excluded.errors, metered_at = clock_timestamp()
    returning 1
  )
  select count(*) into n from up;
  return jsonb_build_object('day', p_day, 'apps_metered', n);
end $$;
