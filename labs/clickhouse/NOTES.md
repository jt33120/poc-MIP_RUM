# ClickHouse — chemin prod prouvé en local (B4, v0.3)

> POC/v0.2 = Postgres (Supabase). Prod grand compte = ClickHouse (décision rapport v1, option E).
> v0.3 : le chemin est **prouvé en local** — schéma MergeTree appliqué, 100 000 metrics réalistes
> insérées dans les deux stores, mêmes p75 au millième près, chiffres ci-dessous mesurés pour de vrai.

## Bench réel (11/06/2026, local)

- **Setup** : ClickHouse 26.3.12.3 LTS (`clickhouse/clickhouse-server:26.3-alpine`, HTTP :8123, volume tmpfs)
  vs Postgres 15.18 (conteneur `mip-rum-db` :5433, table unlogged + 2 indexes alignés prod). Même machine (Mac, Docker).
- **Dataset** : 100 000 `rum_metric` déterministes (seed fixe) — 4 routes pondérées (dont `/login` lente ×1,4,
  cf. POC G-IT), 5 vitals (LCP/INP/CLS/FCP/TTFB), valeurs log-normales, 6 674 sessions, 20 000 pageviews
  répartis sur 7 jours. Reproductible : `node labs/clickhouse/bench.mjs`.
- **Protocole** : 1 warm-up + 3 runs par requête, **médiane** retenue. Égalité des résultats vérifiée
  ligne à ligne (tolérance 1 ms sur les p75, stricte sur les comptages).

| Requête (console)             | Lignes | PG médian | CH médian | CH/PG     | Égalité p75      |
| ----------------------------- | ------ | --------- | --------- | --------- | ---------------- |
| p75 LCP par route (24 h)      | 4      | 2,1 ms    | 6,8 ms    | ×3,2      | **Δ = 0** (exact) |
| Série horaire p75 LCP (7 j)   | 168    | 30,7 ms   | 13,9 ms   | **×0,45** | **Δ = 0** (exact) |
| Top routes par sessions (7 j) | 4      | 138,3 ms  | 11,4 ms   | **×0,08** | strict OK        |

- **Insert** (100 k lignes, 1 connexion) : PG 993 ms (batchs 1 000) | CH 1 139 ms (JSONEachRow, batchs 10 000)
  → ~88 000 lignes/s côté CH sans le moindre tuning.
- **Disque** : PG **17,8 MB** (table + indexes) | CH **1,2 MB** compressé (3,7 MB bruts, compression ×3,1)
  → **×15** plus compact à données identiques.
- 2ᵉ run de contrôle : mêmes ratios (2,3/7,4 — 31,8/14,2 — 138,0/11,8 ms), variance < 10 %.

### Lecture honnête des chiffres

- Sur la **petite requête point** (p75 24 h, ~14 k lignes scannées), PG gagne : l'aller-retour HTTP de CH
  (~5 ms incompressibles) domine. À cette volumétrie, n'importe quel store convient.
- Dès que la requête **scanne large** (série horaire 7 j : ×2,2 ; `count(distinct session_id)` : **×12**),
  CH l'emporte nettement — et c'est exactement le profil des requêtes console. L'écart croît avec le volume :
  les percentiles PG (`percentile_cont`) trient en mémoire, CH streame en colonnes.
- **L'égalité p75 est exacte (Δ = 0)**, pas seulement « dans la tolérance » : `quantileExactInclusive`
  implémente la même interpolation que `percentile_cont`. La console peut migrer sans renuméroter ses graphes.

## Schéma appliqué (labs/clickhouse/schema.sql)

Sous-ensemble des colonnes Postgres suffisant pour tous les agrégats console :

```sql
CREATE TABLE rum_metric_ch (
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
-- + rum_pageview_ch (url, nav_type), rum_error_ch (kind, message, error_type, fingerprint)
```

> **Schéma PRODUCTION** : `labs/clickhouse/schema.prod.sql` (jeu de tables complet,
> `device_type` dénormalisé, **TTL 30 j** RGPD, codecs colonne, **MV AggregatingMergeTree
> `quantileTDigestState` horaire** pour le multi-milliards). `schema.sql` ci-dessus reste
> le schéma **minimal du bench** (repro Δ=0). Runbook de bascule complet (topologie,
> dialecte console, conformité, hébergement) : `labs/clickhouse/DEPLOY.md`.

Écriture : `labs/clickhouse/writer.mjs` — interface HTTP native (`fetch` node 26, JSONEachRow,
batchs 10 000), **zéro dépendance**. Prêt à brancher derrière `STORE=clickhouse|both` dans le dev-server.

## Chemin de migration (1 cran à la fois, rien ne change côté client)

1. Déployer **OTel Collector + ClickHouse** (cf. `infra/otel-collector.example.yaml`) — on-prem ou cloud
   souverain (argument CSPN/souveraineté MIP ; CH est Apache-2.0, auto-hébergeable).
2. Pointer le snippet sur le Collector (`endpoint:` dans `MIPRum.init`) — **seul** changement côté client.
3. Transposer le parser : la logique `flattenOtlp` (attributs `mip.*`/`webvital.*` → colonnes) vit dans un
   processor Collector ou en vues CH sur `otel_traces`. Le fingerprint d'erreurs garde le même algo.
4. Brancher la console sur CH (HTTP + `FORMAT JSON`, pattern de `writer.mjs`) — voir dialecte ci-dessous.
5. Décommissionner la fonction serverless. Le SDK et la sémantique `mip.*` ne bougent pas (« OTLP fidèle sur le fil »).

## Volumétrie grand compte (1 M pages vues/jour)

| Table        | Ratio/pageview     | Lignes/jour | Disque/jour (mesuré : ~12 B/ligne compressé) |
| ------------ | ------------------ | ----------- | -------------------------------------------- |
| rum_metric   | ×5 vitals (max)    | 5,0 M       | ~60 MB                                       |
| rum_pageview | ×1                 | 1,0 M       | ~15 MB (URL plus longue)                     |
| rum_session  | ~1 / 3 pageviews   | 0,33 M      | ~5 MB                                        |
| rum_error    | ~2 % des pageviews | 0,02 M      | <1 MB                                        |
| **Total**    |                    | **~6,4 M events/jour** | **~80 MB/jour → ~2,4 GB / 30 j de rétention** |

- Débit moyen ~74 events/s, pics ×10 ≈ 750/s : couvert **×100** par les 88 k lignes/s mesurées sur une
  seule connexion HTTP non tunée. Un nœud CH modeste absorbe plusieurs clients de cette taille.
- Le même volume en PG (178 B/ligne mesurés avec indexes) ≈ 34 GB/30 j **par client**, avec des
  `percentile_cont` qui passent de 138 ms (100 k lignes) à plusieurs secondes au milliard — c'est la
  requête sessions/routes qui casse en premier.
- Le replay (chunks rrweb gzip) reste hors CH : object storage ou PG bytea, volumétrie indépendante.

## Ce que ça change pour la console

Mêmes requêtes logiques, dialecte à adapter (équivalences prouvées par le bench, Δ = 0) :

| Postgres                                            | ClickHouse                          |
| --------------------------------------------------- | ----------------------------------- |
| `percentile_cont(0.75) within group (order by v)`   | `quantileExactInclusive(0.75)(v)` (exact) ou `quantileTDigest(0.75)(v)` (approx, multi-milliards) |
| `date_trunc('hour', ts)`                            | `toStartOfHour(ts)`                 |
| `count(distinct session_id)`                        | `uniqExact(session_id)` (ou `uniq` approx) |
| driver `pg` / Supabase client                       | HTTP `fetch` + `FORMAT JSON` (zéro dépendance, cf. `writer.mjs`) |

Pas de changement de modèle : mêmes noms de colonnes, mêmes fenêtres temporelles, mêmes filtres app/route.
Une couche « dialecte » de ~50 lignes dans la console suffit pour basculer store par store.

## Reproduire le bench

```bash
docker compose -f labs/clickhouse/docker-compose.clickhouse.yml up -d   # CH :8123, volume éphémère
node labs/clickhouse/bench.mjs                                          # exit 0 = égalité vérifiée
docker compose -f labs/clickhouse/docker-compose.clickhouse.yml down    # rien ne persiste (tmpfs)
```

Piège rencontré : dans le conteneur alpine, `localhost` résout en `::1` alors que CH écoute en IPv4 →
healthcheck sur `http://127.0.0.1:8123/ping` explicitement.

## Bench de charge / preuve de capacité (B2) — `scripts/load-bench.mjs`

Outil opérateur (pas de run automatique, pas de chiffres ici tant qu'il n'a pas
tourné contre une vraie base **type-prod, PAS le free tier**). Étend
`scripts/load-light.mjs` (sanity ~1 000 events) en bench paramétrable :

1. **Charge** : POST OTLP à concurrence cible jusqu'à `TARGET_EVENTS` →
   **débit soutenu (events/s)** + latences POST **p50/p95/p99**.
2. **Requêtes** : à volume, chronométre les requêtes console lourdes
   (`vitals_p75_24h`, `top_routes_sessions_7d`, `hourly_health_grid_14d`,
   `daily_lcp_p75_14d`) → **p50/p95** par requête.

Le générateur produit des sessions réalistes (pageview + 5 vitals + ressource +
longtask + ~`ERROR_RATE` erreur), routes pondérées dont une lente (`/login`
×1,4) — **même profil que le bench ClickHouse ci-dessus**, donc chiffres
comparables. Le générateur est testé contre le vrai parser d'ingestion
(`flattenOtlp`, `tests/unit/load-bench.test.ts`) : 0 rejet.

```bash
# auto-test du générateur (aucun réseau/base, aucun chiffre) :
node scripts/load-bench.mjs --dry-run

# bench réel contre une base dédiée type-prod :
ENDPOINT=https://<ingest>/v1/traces \
DATABASE_URL=postgres://user:pwd@host:5432/db \
TARGET_EVENTS=1000000 CONCURRENCY=32 \
node scripts/load-bench.mjs        # KEEP=1 pour conserver les données injectées

# phase requêtes ciblant ClickHouse (dialecte CH : quantileTDigest/toStartOfHour/uniqExact) :
ENDPOINT=https://<collector>/v1/traces \
STORE=clickhouse CLICKHOUSE_URL=https://<ch-host>:8123 CLICKHOUSE_DB=mip_rum \
TARGET_EVENTS=1000000 CONCURRENCY=32 \
node scripts/load-bench.mjs
```

**Validation B2** (à remplir après un run type-prod) : reporter ici le débit
soutenu (events/s), les p95 d'ingestion et de requêtes console, et la
volumétrie — à comparer aux ~88 k lignes/s ClickHouse et au profil
`1 M pages vues/jour` ci-dessus. Ne PAS valider sur le free tier (throttling).
