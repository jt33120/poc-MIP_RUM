-- Migration v0.4 — tracing distribué front→back (ROADMAP v0.4 T2).
-- Un appel API = 1 span 'front' (SDK web, http.client) + 0..1 span 'back'
-- (middleware serveur, http.server), corrélés par trace_id (W3C traceparent).
-- session_id nullable : un span back sans tracestate mip reste exploitable.

create table if not exists rum_span (
  id bigint generated always as identity primary key,
  span_id text not null unique,
  trace_id text not null,
  parent_span_id text,
  tier text not null check (tier in ('front', 'back')),
  session_id text,
  app_id text not null,
  route text,
  url text,
  method text,
  status_code int,
  duration_ms double precision not null,
  ts timestamptz not null default now()
);

create index if not exists rum_span_trace_idx on rum_span (trace_id);
create index if not exists rum_span_app_tier_ts_idx on rum_span (app_id, tier, ts desc);
create index if not exists rum_span_session_idx on rum_span (session_id) where session_id is not null;
create index if not exists rum_span_back_route_idx on rum_span (app_id, route, ts desc) where tier = 'back';

-- Vue de corrélation : chaque appel API front avec son éventuel jumeau backend.
-- network_ms = part hors serveur (réseau + proxy + TLS) ; >= 0 par construction.
create or replace view v_trace as
select f.trace_id,
       f.app_id,
       f.session_id,
       f.route        as page_route,
       f.url,
       f.method,
       f.status_code  as front_status,
       f.duration_ms  as front_ms,
       b.route        as back_route,
       b.status_code  as back_status,
       b.duration_ms  as back_ms,
       case when b.duration_ms is not null
            then greatest(f.duration_ms - b.duration_ms, 0) end as network_ms,
       f.ts
from rum_span f
left join rum_span b on b.trace_id = f.trace_id and b.tier = 'back'
where f.tier = 'front';
