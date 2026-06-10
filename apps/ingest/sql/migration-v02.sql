-- Migration v0.2 — contrat de données du sprint nuit (ROADMAP_V02.md). Idempotente.
-- pg_cron / pg_net (rétention, planification check_alerts, webhooks) = cloud uniquement,
-- appliqués au déploiement (Phase C), pas ici.

create table if not exists app_registry (
  app_id       text primary key,
  name         text not null,
  client_id    text,
  api_key_hash text,           -- sha256 hex de la clé ; null = app legacy sans clé
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table if not exists rum_resource (
  id              bigserial primary key,
  span_id         text unique,
  session_id      text references rum_session(session_id),
  app_id          text not null,
  route           text,
  url             text,
  type            text,        -- script|link|img|fetch|xmlhttprequest|...
  duration_ms     double precision,
  transfer_size   bigint,
  render_blocking boolean,
  ts              timestamptz not null default now()
);

create table if not exists rum_longtask (
  id          bigserial primary key,
  span_id     text unique,
  session_id  text references rum_session(session_id),
  app_id      text not null,
  route       text,
  duration_ms double precision not null,
  ts          timestamptz not null default now()
);

create table if not exists rum_breadcrumb (
  id         bigserial primary key,
  span_id    text unique,
  session_id text references rum_session(session_id),
  app_id     text not null,
  type       text not null,    -- click|nav|error|custom
  label      text,
  seq        int,
  ts         timestamptz not null default now()
);

create table if not exists rum_event (
  id         bigserial primary key,
  span_id    text unique,
  session_id text references rum_session(session_id),
  app_id     text not null,
  route      text,
  name       text not null,
  props      jsonb,
  ts         timestamptz not null default now()
);

alter table rum_error add column if not exists fingerprint text;

create table if not exists alert_rule (
  id             bigserial primary key,
  app_id         text not null,
  metric         text not null,                 -- LCP|INP|CLS|FCP|TTFB|error_rate
  route          text,                          -- null = toutes routes
  comparator     text not null default '>',
  threshold      double precision not null,
  window_minutes int not null default 15,
  webhook_url    text,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

create table if not exists alert_event (
  id           bigserial primary key,
  rule_id      bigint references alert_rule(id) on delete cascade,
  fired_at     timestamptz not null default now(),
  value        double precision,
  message      text,
  acknowledged boolean not null default false
);

create or replace view v_error_group as
select app_id, fingerprint,
       max(error_type)             as error_type,
       max(message)                as sample_message,
       count(*)                    as occurrences,
       count(distinct session_id)  as sessions,
       min(ts)                     as first_seen,
       max(ts)                     as last_seen
from rum_error
where fingerprint is not null
group by app_id, fingerprint;

-- « angles morts » : le robot dit ok, les utilisateurs réels sont en poor
create or replace view v_blind_spot as
select c.app_id, c.route, c.bucket, c.rum_lcp_p75, c.syn_latency_avg, c.syn_state,
       round((c.rum_lcp_p75 - c.syn_latency_avg)::numeric) as gap_ms
from v_correlation c
where c.syn_state = 'ok' and c.rum_lcp_p75 > 2500 and c.syn_latency_avg is not null;

-- Évalue les règles actives sur fenêtre glissante ; anti-spam : pas de re-déclenchement
-- tant qu'un événement non acquitté existe dans la fenêtre.
create or replace function check_alerts() returns int language plpgsql as $$
declare r record; v double precision; fired int := 0;
begin
  for r in select * from alert_rule where active loop
    if r.metric = 'error_rate' then
      select count(*)::float / greatest((select count(*) from rum_pageview p
               where p.app_id = r.app_id
                 and p.started_at > now() - (r.window_minutes || ' minutes')::interval), 1)
        into v
        from rum_error e
       where e.app_id = r.app_id
         and e.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or e.route = r.route);
    else
      select percentile_cont(0.75) within group (order by m.value) into v
        from rum_metric m
       where m.app_id = r.app_id and m.name = r.metric
         and m.ts > now() - (r.window_minutes || ' minutes')::interval
         and (r.route is null or m.route = r.route);
    end if;
    if v is not null and ((r.comparator = '>' and v > r.threshold)
                       or (r.comparator = '<' and v < r.threshold)) then
      if not exists (select 1 from alert_event ae
                      where ae.rule_id = r.id and not ae.acknowledged
                        and ae.fired_at > now() - (r.window_minutes || ' minutes')::interval) then
        insert into alert_event (rule_id, value, message)
        values (r.id, v, format('%s %s %s (seuil %s, fenêtre %s min, app %s%s)',
                r.metric, r.comparator, round(v::numeric, 1), r.threshold,
                r.window_minutes, r.app_id, coalesce(', route ' || r.route, '')));
        fired := fired + 1;
      end if;
    end if;
  end loop;
  return fired;
end $$;

create index if not exists idx_resource_app_route   on rum_resource (app_id, route, ts);
create index if not exists idx_longtask_app         on rum_longtask (app_id, ts);
create index if not exists idx_breadcrumb_session   on rum_breadcrumb (session_id, seq);
create index if not exists idx_event_app_name       on rum_event (app_id, name, ts);
create index if not exists idx_error_fingerprint    on rum_error (app_id, fingerprint);

insert into app_registry (app_id, name, client_id) values
  ('demo-app',        'Mini-site de démo',            'mip-demo'),
  ('gip-plateforme',  'G-IT Plateforme Partenaires',  'groupement-it'),
  ('mip-rum-console', 'Console MIP RUM (dogfooding)', 'mip')
on conflict (app_id) do nothing;
