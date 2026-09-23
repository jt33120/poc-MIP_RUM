-- migration-v64 — P0 : vérité des occurrences et détection des erreurs tardives.
--
-- `ts` est l'horloge de l'émetteur ; il ne peut pas servir de watermark pour
-- une alerte d'ingestion. Un navigateur hors-ligne peut déposer aujourd'hui une
-- erreur d'hier. Cette migration sépare donc l'heure métier de l'heure d'arrivée
-- et rend le curseur atomique/idempotent.

alter table rum_error add column if not exists ingested_at timestamptz not null default clock_timestamp();
-- `now()` est figé au début d'une transaction : un import long pouvait donc
-- écrire après un scheduler avec une heure déjà derrière son watermark. La
-- valeur par défaut doit être l'heure effective de chaque INSERT.
alter table rum_error alter column ingested_at set default clock_timestamp();
create index if not exists idx_error_ingested_at_id on rum_error (ingested_at, id);

comment on column rum_error.ingested_at is
  'Heure d''écriture côté MIP RUM. Distincte de ts (horloge émetteur) : sert au watermark '
  'de détection des nouvelles signatures afin qu''une erreur arrivée tardivement ne soit pas perdue.';

-- Un seul curseur, verrouillé par `for update` dans check_new_errors(). Le
-- baseline est positionné à l'installation : l'historique déjà connu ne doit
-- pas déclencher une vague d'alertes lors du déploiement de la migration.
create table if not exists rum_new_error_watermark (
  singleton boolean primary key default true check (singleton),
  last_ingested_at timestamptz not null,
  last_error_id bigint not null
);

insert into rum_new_error_watermark (singleton, last_ingested_at, last_error_id)
select true,
       coalesce((select ingested_at from rum_error order by ingested_at desc, id desc limit 1), now()),
       coalesce((select id from rum_error order by ingested_at desc, id desc limit 1), 0)
on conflict (singleton) do nothing;

create or replace function check_new_errors() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare
  cursor_row record;
  upper_bound record;
  a record;
  fired int := 0;
  ev_id bigint;
  msg text;
  stable text;
begin
  select last_ingested_at, last_error_id
    into cursor_row
    from rum_new_error_watermark
   where singleton = true
   for update;

  -- Capture la borne HAUTE sous le même verrou que le watermark. Les lignes
  -- arrivées pendant le scan restent au-delà de cette borne et seront prises au
  -- passage suivant : aucun scheduler ne peut les sauter en avançant le curseur
  -- jusqu'à une ligne qu'il n'a pas agrégée.
  select e.ingested_at, e.id into upper_bound
    from rum_error e
   where (e.ingested_at, e.id) > (cursor_row.last_ingested_at, cursor_row.last_error_id)
   order by e.ingested_at desc, e.id desc
   limit 1;

  if not found then
    return 0;
  end if;

  -- Une signature est nouvelle si aucune de ses lignes n'était déjà derrière
  -- le curseur. Le filtre porte sur (ingested_at,id), pas ts : une erreur datée
  -- dans le passé mais arrivée depuis le dernier passage est donc traitée.
  for a in
    select e.app_id, e.fingerprint,
           max(e.error_type) as error_type,
           max(e.message) as sample,
           min(e.ts) as first_seen,
           coalesce(sum(e.occurrences), 0)::bigint as occurrences
      from rum_error e
     where e.fingerprint is not null
       and (e.ingested_at, e.id) > (cursor_row.last_ingested_at, cursor_row.last_error_id)
       and (e.ingested_at, e.id) <= (upper_bound.ingested_at, upper_bound.id)
       and not exists (
         select 1
           from rum_error seen
          where seen.app_id = e.app_id
            and seen.fingerprint = e.fingerprint
            and (seen.ingested_at, seen.id) <= (cursor_row.last_ingested_at, cursor_row.last_error_id)
       )
     group by e.app_id, e.fingerprint
  loop
    stable := format('nouvelle erreur %s / app %s', a.fingerprint, a.app_id);
    msg := format('%s — %s « %s » (%s occurrence(s) depuis %s)',
      stable, coalesce(a.error_type, 'Error'), left(coalesce(a.sample, ''), 120), a.occurrences,
      to_char(a.first_seen, 'HH24:MI'));

    -- Défense en profondeur : le curseur rend le second scheduler inerte ; la
    -- dédup de livraison historique évite aussi un doublon lors d'un rollback.
    if not exists (
      select 1 from alert_event ae
       where ae.rule_id is null and ae.slo_id is null
         and ae.message like '%' || stable || '%'
         and ae.fired_at > now() - interval '24 hours'
    ) then
      insert into alert_event (rule_id, slo_id, value, message, severity)
      values (null, null, a.occurrences, msg, 'warning')
      returning id into ev_id;
      fired := fired + 1;
      perform route_alert(ev_id, a.app_id, 'warning', '[MIP RUM] ' || msg,
        jsonb_build_object('source', 'mip-rum', 'kind', 'new_error', 'app_id', a.app_id,
          'fingerprint', a.fingerprint, 'error_type', a.error_type,
          'occurrences', a.occurrences, 'text', msg));
    end if;
  end loop;

  update rum_new_error_watermark
     set last_ingested_at = upper_bound.ingested_at,
         last_error_id = upper_bound.id
   where singleton = true;
  return fired;
end $function$;

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
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  elsif p_metric = 'ai_cost' then
    return query
    with span as (
      select generate_series(lo, hi - interval '1 hour', interval '1 hour') as h
    ), raw as (
      select date_trunc('hour', ts) h, sum(cost_usd)::float c from rum_ai
      where app_id = p_app_id and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select span.h, coalesce(raw.c, 0) as val from span left join raw using (h)
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  elsif p_metric = 'log_errors' then
    return query
    with span as (
      select generate_series(lo, hi - interval '1 hour', interval '1 hour') as h
    ), raw as (
      select date_trunc('hour', ts) h, count(*)::float c from rum_log
      where app_id = p_app_id and severity_num >= 17 and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), hourly as (
      select span.h, coalesce(raw.c, 0) as val from span left join raw using (h)
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  else
    return query
    with hourly as (
      select date_trunc('hour', ts) h, percentile_cont(0.75) within group (order by value) as val
      from rum_metric
      where app_id = p_app_id and name = p_metric and (p_route is null or route = p_route) and ts >= lo and ts < hi
      group by 1
    ), seasonal as (
      select val from hourly where extract(dow from h) = extract(dow from now()) and extract(hour from h) = extract(hour from now())
    ), m as (select percentile_cont(0.5) within group (order by val) v from seasonal)
    select (select v from m),
           percentile_cont(0.5) within group (order by abs(val - (select v from m))),
           count(*)::int
    from seasonal;
  end if;
end $function$;

-- Le rollup est la source de trafic quand RUM_USE_ROLLUPS=1 : compter les lignes
-- y sous-estimerait chaque répétition que le SDK a volontairement compactée.
create or replace function refresh_rum_rollups(p_hours int default 26)
returns int language plpgsql as $function$
declare n int;
begin
  with lo as (
    select date_trunc('hour', now()) - make_interval(hours => greatest(p_hours, 1)) as t
  ),
  agg as (
    select m.app_id, coalesce(s.device_type, '') as device_type, date_trunc('hour', m.ts) as hour,
           sum(case when m.rating = 'good' then (case when m.name = 'LCP' then 2 else 1 end) else 0 end)::float as good_w,
           sum(case when m.name = 'LCP' then 2 else 1 end)::float as total_w,
           0::bigint as pageviews, 0::bigint as errors
      from rum_metric m left join rum_session s using (session_id), lo
     where m.ts >= lo.t and m.name = any(mip_core_vitals()) group by 1, 2, 3
    union all
    select p.app_id, coalesce(s.device_type, ''), date_trunc('hour', p.started_at),
           0::float, 0::float, count(*)::bigint, 0::bigint
      from rum_pageview p left join rum_session s using (session_id), lo
     where p.started_at >= lo.t group by 1, 2, 3
    union all
    select e.app_id, coalesce(s.device_type, ''), date_trunc('hour', e.ts),
           0::float, 0::float, 0::bigint, coalesce(sum(e.occurrences), 0)::bigint
      from rum_error e left join rum_session s using (session_id), lo
     -- Une erreur hors-ligne peut conserver un `ts` ancien tout en venant
     -- d'être écrite. La fenêtre normale doit donc reconstruire aussi son
     -- bucket historique quand `ingested_at` est récent. Pas de backfill global
     -- ici : les rollups plus anciens non touchés restent tels quels.
     where e.ts >= lo.t or e.ingested_at >= lo.t group by 1, 2, 3
  ),
  merged as (
    select app_id, device_type, hour, sum(good_w) as good_w, sum(total_w) as total_w,
           sum(pageviews) as pageviews, sum(errors) as errors
      from agg group by 1, 2, 3
  ),
  up as (
    insert into rum_rollup_hourly (app_id, device_type, hour, good_w, total_w, pageviews, errors)
    select app_id, device_type, hour, good_w, total_w, pageviews, errors from merged
    on conflict (app_id, device_type, hour) do update
      set good_w = excluded.good_w, total_w = excluded.total_w,
          pageviews = excluded.pageviews, errors = excluded.errors
    returning 1
  )
  select count(*) into n from up;
  return n;
end $function$;

-- Une ligne rum_error peut représenter un lot SDK (`occurrences`). Les fonctions
-- opérationnelles comptent donc les occurrences ; le quota `events` reste, lui,
-- explicitement exprimé en lignes ingérées.
create or replace function slo_status(p_app_id text default null)
returns table(slo_id bigint, app_id text, name text, metric text, route text,
              objective double precision, window_days int,
              attainment double precision, budget double precision,
              burned_pct double precision, fast_burn boolean)
language sql stable security definer
set search_path = public, pg_temp as $$
  select s.id, s.app_id, s.name, s.metric, s.route, s.objective, s.window_days,
         att.attainment,
         (1 - s.objective) as budget,
         case when (1 - s.objective) > 0 and att.attainment is not null
              then least(greatest((1 - att.attainment) / (1 - s.objective), 0) * 100, 999) end as burned_pct,
         (1 - att1h.attainment) >= 14.4 * (1 - s.objective) as fast_burn
  from slo s
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select coalesce(sum(e.occurrences), 0)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - make_interval(days => s.window_days))
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - make_interval(days => s.window_days)), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - make_interval(days => s.window_days))
    end as attainment
  ) att
  cross join lateral (
    select case
      when s.metric = 'error_rate' then
        1 - (select coalesce(sum(e.occurrences), 0)::float from rum_error e
              where e.app_id = s.app_id and (s.route is null or e.route = s.route)
                and e.ts > now() - interval '1 hour')
            / nullif((select count(*) from rum_pageview p
              where p.app_id = s.app_id and (s.route is null or p.route = s.route)
                and p.started_at > now() - interval '1 hour'), 0)
      else
        (select count(*) filter (where m.rating = 'good')::float / nullif(count(*), 0)
           from rum_metric m
          where m.app_id = s.app_id and m.name = s.metric and (s.route is null or m.route = s.route)
            and m.ts > now() - interval '1 hour')
    end as attainment
  ) att1h
  where s.active and (p_app_id is null or s.app_id = p_app_id)
  order by burned_pct desc nulls last;
$$;

-- Le quota reste volontairement par LIGNE d'événement; seul le champ d'erreurs
-- affiché doit refléter les occurrences compactées par le SDK.
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

create or replace function check_alerts() returns integer
  language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
        b record; breached boolean; msg text; lo double precision; hi double precision;
begin
  for r in select * from alert_rule where active loop
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
    else
      select percentile_cont(0.75) within group (order by m.value) into v from rum_metric m
       where m.app_id = r.app_id and m.name = r.metric
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    end if;

    breached := false; msg := null;
    if v is not null then
      if r.mode = 'baseline' then
        select * into b from metric_baseline(r.app_id, r.metric, r.route, r.baseline_weeks);
        if b.n >= 4 and b.mad is not null and b.mad > 0 then
          hi := b.med + r.sensitivity * b.mad;
          lo := b.med - r.sensitivity * b.mad;
          breached := (r.comparator = '>' and v > hi) or (r.comparator = '<' and v < lo);
          if breached then
            msg := format('%s %s %s anormal (normal≈%s, écart %sσ_MAD, fenêtre %s min, app %s%s)',
              r.metric, r.comparator, round(v::numeric,1), round(b.med::numeric,1),
              round((abs(v - b.med)/b.mad)::numeric,1), r.window_minutes, r.app_id,
              coalesce(', route ' || r.route, ''));
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
