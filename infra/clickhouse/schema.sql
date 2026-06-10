-- Schéma ClickHouse MIP RUM — sous-ensemble des tables Postgres suffisant
-- pour les agrégats console (p75 par route, séries horaires, top routes/sessions).
-- Colonnes alignées sur apps/ingest/sql/schema.sql (mêmes noms, types CH).
-- Appliqué par writer.mjs / bench.mjs via l'interface HTTP (multi-statements interdits :
-- une requête par statement, séparateur ';' géré côté client).

CREATE TABLE IF NOT EXISTS rum_metric_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  name        LowCardinality(String),   -- LCP|INP|CLS|FCP|TTFB
  value       Float64,
  rating      LowCardinality(String),   -- good|needs-improvement|poor
  session_id  String,
  ts          DateTime64(3, 'UTC')
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, name, route, ts);

CREATE TABLE IF NOT EXISTS rum_pageview_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  url         String,
  nav_type    LowCardinality(String),   -- navigate|reload|back_forward|spa
  session_id  String,
  ts          DateTime64(3, 'UTC')
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, route, ts);

CREATE TABLE IF NOT EXISTS rum_error_ch (
  app_id      LowCardinality(String),
  route       LowCardinality(String),
  kind        LowCardinality(String),   -- error|unhandledrejection
  message     String,
  error_type  LowCardinality(String),
  fingerprint String,                   -- groupement d'erreurs (même algo que l'ingestion PG)
  session_id  String,
  ts          DateTime64(3, 'UTC')
) ENGINE = MergeTree
PARTITION BY toDate(ts)
ORDER BY (app_id, fingerprint, ts);
