# ClickHouse — cible de stockage prod (notes de migration)

> POC = Postgres (Supabase). Prod = ClickHouse (décision rapport v1, option E).
> Le POC étant **OTLP-natif sur le fil**, la migration ne touche ni le SDK ni le site :
> on remplace le receiver (fonction serverless → OTel Collector) et le store (Postgres → ClickHouse).

## Pourquoi ClickHouse (rappel)

- Store de facto de l'observabilité moderne : SigNoz, Uptrace, ClickStack/HyperDX (racheté par ClickHouse Inc.), Highlight.io. Licence Apache-2.0, déployable **on-prem** (argument CSPN/souveraineté MIP).
- Colonne + compression : des milliards d'events RUM, agrégats p75/p95 en ms via `quantileTDigest`.
- Postgres tient très bien l'échelle POC (mesuré au build : ~4 000 events/s ingérés via le dev-server local, 1 000 events en 0,3 s) mais ne tiendra pas des dizaines de Mevents/jour multi-clients avec des percentiles à la volée.

## Schéma cible (équivalent des tables POC)

```sql
CREATE TABLE rum_metric (
  app_id        LowCardinality(String),
  client_id     LowCardinality(String),
  session_id    String,
  route         LowCardinality(String),
  name          LowCardinality(String),   -- LCP|INP|CLS|FCP|TTFB
  value         Float64,
  rating        LowCardinality(String),
  device_type   LowCardinality(String),
  geo_country   LowCardinality(String),
  attribution   String,                    -- JSON
  ts            DateTime64(3)
) ENGINE = MergeTree
ORDER BY (app_id, route, name, ts)
TTL toDateTime(ts) + INTERVAL 30 DAY;      -- rétention RGPD

-- p75 horaire pré-agrégé (la requête qui fait vivre la console)
CREATE MATERIALIZED VIEW rum_metric_hourly
ENGINE = AggregatingMergeTree
ORDER BY (app_id, route, name, bucket) AS
SELECT app_id, route, name,
       toStartOfHour(ts)                  AS bucket,
       quantileTDigestState(0.75)(value)  AS p75_state,
       count()                            AS n
FROM rum_metric
GROUP BY app_id, route, name, bucket;
-- lecture : quantileTDigestMerge(0.75)(p75_state)
```

Idem `rum_error`, `rum_pageview`, `rum_session` (ReplacingMergeTree sur session_id),
`syn_snapshot` ; `v_correlation` devient une requête de jointure sur les agrégats horaires.

## Étapes de migration (1 cran à la fois)

1. Déployer Collector + ClickHouse (cf. `otel-collector.example.yaml`) — on-prem ou cloud souverain.
2. Pointer le snippet sur le Collector (`endpoint:` dans `MIPRum.init`) — seul changement côté client.
3. Rejouer le parser : la logique `flattenOtlp` (attributs `mip.*`/`webvital.*` → colonnes) se transpose dans le pipeline Collector (processor) ou en vues ClickHouse sur `otel_traces`.
4. Brancher la console sur ClickHouse (driver HTTP, mêmes requêtes p75 via quantiles).
5. Décommissionner la fonction serverless.

## Ce qui ne change PAS

- Le SDK (`mip-rum.js`) et son API `MIPRum.init` — c'est tout l'intérêt du choix « OTLP fidèle sur le fil ».
- Le snippet sur les sites clients (hors URL d'endpoint).
- La sémantique des attributs `mip.*` / `webvital.*` (conventions internes documentées, l'OTel n'ayant pas encore figé les conventions RUM upstream).
