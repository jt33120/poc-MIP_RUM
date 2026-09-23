-- migration-v68 — Explorer d'événements custom, facettes et alertes event:<nom>.
-- Aucun backfill et aucune nouvelle table : rum_event reste la source scrubbed,
-- rum_event_index la projection de pagination stable.
--
-- GARDE DE DÉPLOIEMENT. Sur une base déjà volumineuse, précréer les trois index
-- avec `psql -f apps/ingest/sql/predeploy-v68-indexes.sql` : le runner applique
-- chaque migration dans une transaction, donc ne peut pas employer CONCURRENTLY.
-- On refuse ici un build bloquant au-delà de 32 MiB au lieu de figer l'ingestion.
do $$
begin
  if to_regclass('public.idx_rum_event_explorer_v68') is null
     and pg_total_relation_size('public.rum_event') > 33554432 then
    raise exception 'v68: précréer idx_rum_event_explorer_v68 avec predeploy-v68-indexes.sql';
  end if;
  if to_regclass('public.idx_rum_event_props_v68') is null
     and pg_total_relation_size('public.rum_event') > 33554432 then
    raise exception 'v68: précréer idx_rum_event_props_v68 avec predeploy-v68-indexes.sql';
  end if;
  if to_regclass('public.idx_rum_event_index_app_session_v68') is null
     and pg_total_relation_size('public.rum_event_index') > 33554432 then
    raise exception 'v68: précréer idx_rum_event_index_app_session_v68 avec predeploy-v68-indexes.sql';
  end if;
end $$;

create index if not exists idx_rum_event_explorer_v68
  on rum_event (app_id, name, ts desc, id desc);
create index if not exists idx_rum_event_props_v68
  on rum_event using gin (props jsonb_path_ops);
create index if not exists idx_rum_event_index_app_session_v68
  on rum_event_index (app_id, session_id, ts desc, id desc);

-- Défense en profondeur : le parseur borne déjà ces objets avant écriture. La
-- contrainte garantit qu'une autre voie d'écriture ne peut pas créer une
-- facette incontrôlée. NULL historique reste accepté pour props.
alter table rum_event drop constraint if exists rum_event_payload_v68;
alter table rum_event add constraint rum_event_payload_v68 check (
  (props is null or (jsonb_typeof(props) = 'object' and octet_length(props::text) <= 16384)) and
  jsonb_typeof(context) = 'object' and octet_length(context::text) <= 32768
) not valid;

-- event:<nom> est une famille fermée par préfixe et taille. Le nom reste une
-- valeur, jamais du SQL dynamique ; les contrôles sont rejetés.
alter table alert_rule drop constraint if exists alert_rule_event_metric_v68;
alter table alert_rule add constraint alert_rule_event_metric_v68 check (
  metric not like 'event:%' or (
    char_length(substring(metric from 7)) between 1 and 100 and
    substring(metric from 7) !~ '[[:cntrl:]]'
  )
);

create or replace function metric_baseline(p_app_id text, p_metric text, p_route text, p_weeks integer)
  returns table(med double precision, mad double precision, n integer)
  language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare lo timestamptz := date_trunc('hour', now()) - make_interval(days => greatest(p_weeks,1) * 7);
        hi timestamptz := date_trunc('hour', now());
begin
  if p_metric = 'error_rate' then
    return query
    with pv as (
      select date_trunc('hour', started_at) h, count(*) n from rum_pageview
      where app_id = p_app_id and (p_route is null or route = p_route) and started_at >= lo and started_at < hi
      group by 1
    ), er as (
      select date_trunc('hour', ts) h, coalesce(sum(occurrences), 0)::float n from rum_error
      where app_id = p_app_id and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select pv.h, coalesce(er.n,0)::float / greatest(pv.n,1) as val from pv left join er using (h)
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m), percentile_cont(0.5) within group (order by abs(val - (select v from m))), count(*)::int
    from seasonal;
  elsif p_metric = 'ai_cost' then
    return query
    with span as (select generate_series(lo, hi - interval '1 hour', interval '1 hour') h),
    raw as (
      select date_trunc('hour', ts) h, sum(cost_usd)::float c from rum_ai
      where app_id = p_app_id and (p_route is null or route = p_route) and ts >= lo and ts < hi group by 1
    ), hourly as (select span.h, coalesce(raw.c, 0) val from span left join raw using (h)),
    seasonal as (select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())),
    m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m), percentile_cont(0.5) within group (order by abs(val - (select v from m))), count(*)::int from seasonal;
  elsif p_metric = 'log_errors' then
    return query
    with span as (select generate_series(lo, hi - interval '1 hour', interval '1 hour') h),
    raw as (
      select date_trunc('hour', ts) h, count(*)::float c from rum_log
      where app_id = p_app_id and severity_num >= 17 and (p_route is null or route = p_route) and ts >= lo and ts < hi group by 1
    ), hourly as (select span.h, coalesce(raw.c, 0) val from span left join raw using (h)),
    seasonal as (select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())),
    m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m), percentile_cont(0.5) within group (order by abs(val - (select v from m))), count(*)::int from seasonal;
  elsif p_metric like 'event:%' then
    -- Les heures inactives valent zéro. Sans generate_series, une baseline de
    -- comptage n'observerait que les heures actives et serait biaisée à la hausse.
    return query
    with span as (select generate_series(lo, hi - interval '1 hour', interval '1 hour') h),
    raw as (
      select date_trunc('hour', ts) h, count(*)::float c from rum_event
      where app_id = p_app_id and name = substring(p_metric from 7)
        and coalesce(event_type, 'custom') = 'custom'
        and (p_route is null or route = p_route) and ts >= lo and ts < hi group by 1
    ), hourly as (select span.h, coalesce(raw.c, 0) val from span left join raw using (h)),
    seasonal as (select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())),
    m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m), percentile_cont(0.5) within group (order by abs(val - (select v from m))), count(*)::int from seasonal;
  else
    return query
    with hourly as (
      select date_trunc('hour', ts) h, percentile_cont(0.75) within group (order by value) val
      from rum_metric
      where app_id = p_app_id and name = p_metric and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m), percentile_cont(0.5) within group (order by abs(val - (select v from m))), count(*)::int from seasonal;
  end if;
end $function$;

-- Une baseline de comptage doit comparer la même largeur de fenêtre que la
-- règle courante. On échantillonne donc la fenêtre se terminant à la même heure
-- lors de chacune des semaines précédentes, zéros compris.
create or replace function event_metric_baseline(
  p_app_id text, p_metric text, p_route text, p_weeks integer, p_window_minutes integer
)
  returns table(med double precision, mad double precision, n integer)
  language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  with anchors as (
    select now() - make_interval(weeks => g) as hi
      from generate_series(1, greatest(p_weeks, 1)) g
  ), samples as (
    select (
      select count(*)::double precision
        from rum_event_index i
        join rum_event e
          on i.kind = 'event' and e.app_id = i.app_id and e.span_id = i.source_span_id
       where i.app_id = p_app_id
         and e.name = substring(p_metric from 7)
         and coalesce(e.event_type, 'custom') = 'custom'
         and (p_route is null or i.route = p_route)
         and i.ts > a.hi - make_interval(mins => greatest(p_window_minutes, 1))
         and i.ts <= a.hi
    ) as val from anchors a
  ), m as (
    select percentile_cont(0.5) within group (order by val) v from samples
  )
  select (select v from m),
         percentile_cont(0.5) within group (order by abs(val - (select v from m))),
         count(*)::int
    from samples
$function$;

revoke execute on function event_metric_baseline(text,text,text,integer,integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function event_metric_baseline(text,text,text,integer,integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function event_metric_baseline(text,text,text,integer,integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function event_metric_baseline(text,text,text,integer,integer) to service_role;
  end if;
  if exists (select 1 from pg_roles where rolname = 'console_ro') then
    grant execute on function event_metric_baseline(text,text,text,integer,integer) to console_ro;
  end if;
end $$;

create or replace function check_alerts() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
        b record; breached boolean; msg text; lo double precision; hi double precision;
        event_sample_rate double precision;
begin
  for r in select * from alert_rule where active order by id loop
    -- Sérialise deux schedulers concurrents règle par règle. L'ordre par id
    -- empêche aussi un interblocage quand plusieurs règles sont actives.
    perform pg_advisory_xact_lock(r.id);
    event_sample_rate := null;
    if r.metric = 'error_rate' then
      select coalesce(sum(e.occurrences), 0)::float / greatest((select count(*) from rum_pageview p
               where p.app_id = r.app_id and (r.route is null or p.route = r.route)
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval), 1)
        into v from rum_error e
       where e.app_id = r.app_id and e.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or e.route = r.route);
    elsif r.metric = 'ai_cost' then
      select coalesce(sum(a.cost_usd), 0)::float into v from rum_ai a
       where a.app_id = r.app_id and a.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or a.route = r.route);
    elsif r.metric = 'log_errors' then
      select count(*)::float into v from rum_log l
       where l.app_id = r.app_id and l.severity_num >= 17
         and l.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or l.route = r.route);
    elsif r.metric like 'event:%' then
      select count(*)::float, min(coalesce(s.sample_rate, 1))::double precision
        into v, event_sample_rate
        from rum_event_index i
        join rum_event e
          on i.kind = 'event' and e.app_id = i.app_id and e.span_id = i.source_span_id
        left join rum_session s
          on s.app_id = i.app_id and s.session_id = i.session_id
       where i.app_id = r.app_id and e.name = substring(r.metric from 7)
         and coalesce(e.event_type, 'custom') = 'custom'
         and i.ts > now() - (r.window_minutes || ' minutes')::interval
         and i.ts <= now()
         and (r.route is null or i.route = r.route);
    else
      select percentile_cont(0.75) within group (order by m.value) into v from rum_metric m
       where m.app_id = r.app_id and m.name = r.metric
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    end if;

    breached := false; msg := null;
    if v is not null then
      if r.mode = 'baseline' then
        if r.metric like 'event:%' then
          select * into b from event_metric_baseline(
            r.app_id, r.metric, r.route, r.baseline_weeks, r.window_minutes
          );
        else
          select * into b from metric_baseline(r.app_id, r.metric, r.route, r.baseline_weeks);
        end if;
        if b.n >= 4 and b.mad is not null then
          hi := b.med + r.sensitivity * b.mad;
          lo := b.med - r.sensitivity * b.mad;
          -- Une série parfaitement stable (souvent zéro pour un événement rare)
          -- a MAD=0 : le moindre écart dans le sens demandé est alors anormal.
          breached := (r.comparator = '>' and v > hi) or (r.comparator = '<' and v < lo);
          if breached then
            msg := case when b.mad > 0 then
              format('%s %s %s anormal (normal≈%s, écart %sσ_MAD, fenêtre %s min, app %s%s)',
                r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
                round((abs(v - b.med)/b.mad)::numeric,1), r.window_minutes, r.app_id,
                coalesce(', route ' || r.route, ''))
            else
              format('%s %s %s anormal (normal stable≈%s, MAD=0, fenêtre %s min, app %s%s)',
                r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
                r.window_minutes, r.app_id, coalesce(', route ' || r.route, ''))
            end;
          end if;
        end if;
      else
        breached := (r.comparator = '>' and v > r.threshold) or (r.comparator = '<' and v < r.threshold);
        if breached then
          msg := format('%s %s %s (seuil %s, fenêtre %s min, app %s%s)',
            r.metric, r.comparator, round(v::numeric,1), r.threshold, r.window_minutes, r.app_id,
            coalesce(', route ' || r.route, ''));
        end if;
      end if;
    end if;

    if breached and r.metric like 'event:%' and event_sample_rate > 0 and event_sample_rate < 1 then
      msg := msg || format(
        ' — comptes observés sur un échantillon (taux minimal %s%%), sans extrapolation',
        round((event_sample_rate * 100)::numeric, 1)
      );
    end if;

    if breached and not exists (select 1 from alert_event ae
                      where ae.rule_id = r.id and not ae.acknowledged
                        and ae.fired_at > now() - (r.window_minutes || ' minutes')::interval) then
      insert into alert_event (rule_id, value, message, severity)
      values (r.id, v, msg, r.severity) returning id into ev_id;
      fired := fired + 1;
      if r.webhook_url is not null then
        insert into alert_delivery (alert_event_id, target) values (ev_id, r.webhook_url);
        begin
          select net.http_post(url := r.webhook_url,
            body := jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
              'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg))
            into req_id;
          update alert_delivery set status='sent', response='pg_net request '||req_id
            where alert_event_id = ev_id and target = r.webhook_url;
        exception when others then null; end;
      end if;
      perform route_alert(ev_id, r.app_id, r.severity, '[MIP RUM] ' || msg,
        jsonb_build_object('source','mip-rum','app_id',r.app_id,'metric',r.metric,
          'route',r.route,'value',round(v::numeric,1),'severity',r.severity,'text',msg));
    end if;
  end loop;
  return fired;
end $function$;
