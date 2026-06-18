-- Schéma ClickHouse PRODUCTION — MIP RUM (C2, P0 « scale grand compte »).
-- Différences vs infra/clickhouse/schema.sql (qui reste le schéma du bench local,
-- volontairement minimal pour la repro Δ=0) :
--   • jeu de tables COMPLET (metric/pageview/error/resource/longtask/session)
--     couvrant tous les agrégats de la console ;
--   • device_type DÉNORMALISÉ sur metric/pageview/error → le filtre device de la
--     console ne fait plus de JOIN (idiomatique CH : on scanne des colonnes, on ne
--     joint pas) ;
--   • TTL 30 jours (rétention RGPD) sur les tables brutes ;
--   • codecs colonne (DoubleDelta/Gorilla + ZSTD) → compression maximale ;
--   • Materialized View AggregatingMergeTree (quantileTDigestState horaire) pour
--     tenir le MULTI-MILLIARDS : les p75/heatmap se lisent sur la MV pré-agrégée,
--     plus sur les lignes brutes.
-- Appliqué via writer.mjs (HTTP, 1 statement/requête). Suffixe _ch conservé pour
-- rester cohérent avec le bench ; en base CH dédiée, le suffixe peut tomber.
-- ⚠️ SQL validé à l'application contre l'instance live (pas de runtime CH en CI).

-- =====================================================================
-- Tables brutes (TTL 30 j, partition par jour, codecs colonne)
-- =====================================================================

CREATE TABLE IF NOT EXISTS rum_metric_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  name        LowCardinality(String),              -- LCP|INP|CLS|FCP|TTFB
  value       Float64       CODEC(Gorilla, ZSTD(1)),
  rating      LowCardinality(String),              -- good|needs-improvement|poor
  device_type LowCardinality(String),              -- mobile|desktop|tablet (dénormalisé)
  session_id  String,
  ts          DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, name, route, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS rum_pageview_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  url         String,
  nav_type    LowCardinality(String),              -- navigate|reload|back_forward|spa
  device_type LowCardinality(String),
  session_id  String,
  ts          DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, route, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS rum_error_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  kind        LowCardinality(String),              -- error|unhandledrejection
  message     String,
  error_type  LowCardinality(String),
  fingerprint String,                              -- même algo de groupage que l'ingestion PG
  device_type LowCardinality(String),
  session_id  String,
  ts          DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, fingerprint, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS rum_resource_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  url         String,
  type        LowCardinality(String),              -- script|css|img|fetch|…
  duration_ms Float64       CODEC(Gorilla, ZSTD(1)),
  session_id  String,
  ts          DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, route, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS rum_longtask_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  duration_ms Float64       CODEC(Gorilla, ZSTD(1)),
  session_id  String,
  ts          DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, route, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;

CREATE TABLE IF NOT EXISTS rum_session_ch (
  session_id   String,
  app_id       LowCardinality(String),
  client_id    LowCardinality(String),
  device_type  LowCardinality(String),
  geo_country  LowCardinality(String),             -- granularité pays (par timezone), zéro IP
  started_at   DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1)),
  last_seen_at DateTime64(3, 'UTC') CODEC(DoubleDelta, ZSTD(1))
) ENGINE = ReplacingMergeTree(last_seen_at)            -- dernière version par session
PARTITION BY toDate(started_at)
ORDER BY (app_id, session_id)
TTL toDateTime(last_seen_at) + INTERVAL 30 DAY;

-- =====================================================================
-- Pré-agrégation horaire des vitals (multi-milliards)
-- AggregatingMergeTree + quantileTDigestState : la console lit le p75/heatmap
-- sur ~1 ligne / (app,name,route,device,heure) au lieu de scanner les brutes.
-- TTL plus long (400 j) : on garde la tendance même après purge des lignes fines.
-- =====================================================================

CREATE TABLE IF NOT EXISTS rum_metric_p75_hourly_ch (
  app_id      LowCardinality(String),
  name        LowCardinality(String),
  route       LowCardinality(String),
  device_type LowCardinality(String),
  hour        DateTime('UTC'),
  p75_state   AggregateFunction(quantileTDigest(0.75), Float64),
  n_state     AggregateFunction(count),
  good_state  AggregateFunction(sum, UInt64)         -- nb de mesures rating='good'
) ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (app_id, name, route, device_type, hour)
TTL hour + INTERVAL 400 DAY;

CREATE MATERIALIZED VIEW IF NOT EXISTS rum_metric_p75_hourly_mv
TO rum_metric_p75_hourly_ch AS
SELECT
  app_id, name, route, device_type,
  toStartOfHour(ts)                          AS hour,
  quantileTDigestState(0.75)(value)          AS p75_state,
  countState()                               AS n_state,
  sumState(toUInt64(rating = 'good'))        AS good_state
FROM rum_metric_ch
GROUP BY app_id, name, route, device_type, hour;

-- Lecture (exemples ; la couche dialecte console les générera) :
--   p75 par vital (fenêtre) :
--     SELECT name, quantileTDigestMerge(0.75)(p75_state) AS p75, countMerge(n_state) AS n
--     FROM rum_metric_p75_hourly_ch
--     WHERE app_id = {app:String} AND hour > now() - INTERVAL 24 HOUR
--     GROUP BY name;
--   heatmap santé (part 'good' par heure) :
--     SELECT hour, sumMerge(good_state) / countMerge(n_state) AS good_ratio
--     FROM rum_metric_p75_hourly_ch
--     WHERE app_id = {app:String} AND hour > now() - INTERVAL 14 DAY
--     GROUP BY hour ORDER BY hour;
