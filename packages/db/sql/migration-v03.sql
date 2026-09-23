-- Migration v0.3 — contrat du sprint nuit 2 (ROADMAP_V03.md). Idempotente.
-- pg_net (webhooks) = cloud uniquement, ajouté au déploiement.

-- Session replay : chunks rrweb compressés (gzip) par session
create table if not exists replay_chunk (
  id           bigserial primary key,
  session_id   text not null references rum_session(session_id),
  app_id       text not null,
  seq          int not null,
  events_count int,
  body         bytea not null,          -- JSON rrweb gzippé
  created_at   timestamptz not null default now(),
  unique (session_id, seq)
);
create index if not exists idx_replay_session on replay_chunk (session_id, seq);

-- RBAC console
create table if not exists console_user (
  id            bigserial primary key,
  email         text unique not null,
  password_hash text not null,           -- bcrypt
  role          text not null default 'viewer' check (role in ('admin','viewer')),
  apps          text[],                  -- null = toutes les apps
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists audit_log (
  id         bigserial primary key,
  user_email text,
  action     text not null,              -- login|user_create|user_update|rule_create|...
  detail     text,
  ts         timestamptz not null default now()
);

-- Traçabilité des notifications d'alerte
create table if not exists alert_delivery (
  id             bigserial primary key,
  alert_event_id bigint references alert_event(id) on delete cascade,
  target         text not null,          -- URL webhook
  status         text not null default 'queued',  -- queued|sent|failed
  response       text,
  attempted_at   timestamptz not null default now()
);

-- Replay opt-in par app
alter table app_registry add column if not exists replay_sample_rate double precision not null default 0;

-- Rate limit durable partagé entre isolats
create table if not exists rate_counter (
  app_id text not null,
  minute timestamptz not null,
  hits   int not null default 0,
  primary key (app_id, minute)
);
create or replace function rate_check(p_app_id text, p_limit int) returns boolean
language plpgsql security definer as $$
declare h int;
begin
  insert into rate_counter (app_id, minute, hits)
  values (p_app_id, date_trunc('minute', now()), 1)
  on conflict (app_id, minute) do update set hits = rate_counter.hits + 1
  returning hits into h;
  delete from rate_counter where minute < now() - interval '5 minutes';
  return h <= p_limit;  -- false = limité
end $$;

-- Anomalies : z-score du LCP p75 horaire vs 7 j glissants (|z| > 3 = anomalie)
create or replace view v_anomaly as
with hourly as (
  select app_id, route, date_trunc('hour', ts) as bucket,
         percentile_cont(0.75) within group (order by value) as p75
  from rum_metric where name = 'LCP' and ts > now() - interval '8 days'
  group by 1, 2, 3
),
stats as (
  select app_id, route, avg(p75) as mean, stddev_samp(p75) as sd
  from hourly where bucket < date_trunc('hour', now())
  group by 1, 2 having count(*) >= 5 and stddev_samp(p75) > 0
)
select h.app_id, h.route, h.bucket, round(h.p75::numeric) as p75,
       round(s.mean::numeric) as mean_7d,
       round(((h.p75 - s.mean) / s.sd)::numeric, 1) as z_score
from hourly h join stats s using (app_id, route)
where abs((h.p75 - s.mean) / s.sd) > 3;

-- check_alerts v2 : déclenche + planifie la notification webhook (pg_net si dispo)
create or replace function check_alerts() returns int language plpgsql security definer as $$
declare r record; v double precision; fired int := 0; ev_id bigint; req_id bigint;
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
                r.window_minutes, r.app_id, coalesce(', route ' || r.route, '')))
        returning id into ev_id;
        fired := fired + 1;
        if r.webhook_url is not null then
          insert into alert_delivery (alert_event_id, target) values (ev_id, r.webhook_url);
          -- pg_net (cloud) : envoi asynchrone ; absent en local -> delivery reste 'queued'
          begin
            select net.http_post(
              url := r.webhook_url,
              body := jsonb_build_object(
                'source', 'mip-rum',
                'app_id', r.app_id,
                'metric', r.metric,
                'route', r.route,
                'value', round(v::numeric, 1),
                'threshold', r.threshold,
                'window_minutes', r.window_minutes,
                'text', format('[MIP RUM] %s %s %s (seuil %s) — app %s%s', r.metric, r.comparator,
                               round(v::numeric, 1), r.threshold, r.app_id,
                               coalesce(', route ' || r.route, ''))
              )
            ) into req_id;
            update alert_delivery set status = 'sent', response = 'pg_net request ' || req_id
             where alert_event_id = ev_id;
          exception when others then
            null; -- pas de pg_net (local) : dispatch via apps/ingest/dispatch-alerts.mjs
          end;
        end if;
      end if;
    end if;
  end loop;
  return fired;
end $$;
