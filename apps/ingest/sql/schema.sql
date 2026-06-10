-- Schéma POC MIP RUM (PLAN §5, complété au build)
-- Écarts vs extrait directeur du plan :
--   + app_id/route dénormalisés sur rum_metric/rum_error (requis par v_correlation et les agrégats par route)
--   + span_id unique sur pageview/metric/error : idempotence légère (PLAN §7.2)

-- Session = un utilisateur réel, une visite
create table if not exists rum_session (
  session_id    text primary key,
  app_id        text not null,          -- ex: 'gip-plateforme'
  client_id     text,                   -- ex: 'groupement-it'
  user_hash     text,                   -- fingerprint ANONYMISÉ (pas de PII)
  user_agent    text,
  device_type   text,                   -- mobile/desktop/tablet
  geo_country   text,
  started_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  page_count    int not null default 0
);

create table if not exists rum_pageview (
  id          bigserial primary key,
  span_id     text unique,
  session_id  text references rum_session(session_id),
  app_id      text not null,
  route       text not null,            -- normalisé: '/partners/:id'
  url         text,
  referrer    text,
  nav_type    text,                     -- navigate/reload/back_forward/spa
  started_at  timestamptz not null default now()
);

create table if not exists rum_metric (
  id           bigserial primary key,
  span_id      text unique,
  session_id   text references rum_session(session_id),
  pageview_id  bigint references rum_pageview(id),
  app_id       text not null,
  route        text,
  name         text not null,           -- LCP|INP|CLS|FCP|TTFB
  value        double precision not null,
  rating       text,                    -- good|needs-improvement|poor (seuils 2026, calculé à l'ingestion)
  attribution  jsonb,                   -- web-vitals attribution (debug)
  ts           timestamptz not null default now()
);

create table if not exists rum_error (
  id           bigserial primary key,
  span_id      text unique,
  session_id   text references rum_session(session_id),
  pageview_id  bigint references rum_pageview(id),
  app_id       text not null,
  route        text,
  kind         text,                    -- error|unhandledrejection
  message      text,
  error_type   text,
  stack        text,
  source       text,
  lineno       int,
  colno        int,
  ts           timestamptz not null default now()
);

-- Snapshot synthétique (robot DEM MIP via mippoc, ou seed)
create table if not exists syn_snapshot (
  id            bigserial primary key,
  app_id        text not null,          -- même clé que rum_session.app_id
  site          text,
  measure_id    text,
  measure_name  text,                   -- ex: 'Login scenario'
  route_hint    text,                   -- mapping vers route RUM si possible
  score         double precision,       -- score MIP
  state         text,                   -- ok/warn/incident
  latency_ms    double precision,
  captured_at   timestamptz not null
);

-- Upsert session avec incrément de page_count (utilisé par l'edge function via RPC ;
-- le dev-server local fait l'équivalent en SQL direct)
create or replace function upsert_rum_session(
  p_session_id text, p_app_id text, p_client_id text, p_user_hash text,
  p_user_agent text, p_device_type text, p_geo_country text,
  p_last_seen_at timestamptz, p_page_count_inc int
) returns void language sql as $$
  insert into rum_session (session_id, app_id, client_id, user_hash, user_agent, device_type, geo_country, started_at, last_seen_at, page_count)
  values (p_session_id, p_app_id, p_client_id, p_user_hash, p_user_agent, p_device_type, p_geo_country, p_last_seen_at, p_last_seen_at, p_page_count_inc)
  on conflict (session_id) do update
    set last_seen_at = greatest(rum_session.last_seen_at, excluded.last_seen_at),
        page_count   = rum_session.page_count + p_page_count_inc,
        user_agent   = coalesce(rum_session.user_agent, excluded.user_agent),
        geo_country  = coalesce(rum_session.geo_country, excluded.geo_country);
$$;

create index if not exists idx_metric_app_route on rum_metric (app_id, route);
create index if not exists idx_metric_name_ts   on rum_metric (name, ts);
create index if not exists idx_metric_session   on rum_metric (session_id);
create index if not exists idx_error_ts         on rum_error (ts);
create index if not exists idx_pageview_session on rum_pageview (session_id);
create index if not exists idx_syn_app_captured on syn_snapshot (app_id, captured_at);
