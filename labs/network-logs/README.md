# POC — logs réseau souverains (OTel → ClickHouse **vs** OpenSearch)

But : **se faire la main** sur une chaîne d'ingestion de logs réseau, avec des
**données 100 % synthétiques** (aucune donnée client), et **comparer ClickHouse et
OpenSearch** sur les mêmes logs (coût disque, compression, latence de requête).

C'est la brique « logs » qui étend le backbone **OpenTelemetry souverain** de MIP :
les logs sont le 3ᵉ signal OTel, à côté des traces/métriques déjà ingérées.

```
loadgen (syslog RFC5424) ─┐
OTLP externe (cloud/app) ─┤→  otel-collector  ─┬→  ClickHouse   →  Grafana (:3001)
                          │   (passerelle)      └→  OpenSearch   →  OS Dashboards (:5601)
```

> ⚠️ **Non exécuté en CI** (pas de Docker dans l'environnement de dev). Versions
> **épinglées**. Les deux points « version-sensibles » sont les exporters du
> collecteur (`clickhouse`, `opensearch`) — voir §« Si ça coince ».

---

## Prérequis
- Docker + Docker Compose v2, ~4 Go de RAM libre (OpenSearch réserve 512 Mo de heap).
- Linux/macOS. `curl` pour les vérifs.

## Démarrer
```bash
cd labs/network-logs
docker compose up -d
# ~30-60 s le temps qu'OpenSearch et ClickHouse soient "healthy"
docker compose ps
```
Le `loadgen` envoie ~50 logs/s par défaut. Interfaces :
- **Grafana** (ClickHouse) : http://localhost:3001 (anonyme, admin)
- **OpenSearch Dashboards** : http://localhost:5601

## Régler le débit (test de sizing)
```bash
# 500 logs/s (relance juste le générateur)
RATE=500 docker compose up -d loadgen
docker compose logs -f loadgen   # doit afficher "loadgen: 500 msg/s ..."
```

## Vérifier que les logs arrivent
```bash
# ClickHouse
docker compose exec clickhouse clickhouse-client -q "SELECT count() FROM otel.otel_logs"

# OpenSearch — trouver l'index créé par l'exporter (nom exact selon version)
curl -s 'http://localhost:9200/_cat/indices?v' | grep -Ei 'ss4o|logs'
```

---

## Comparer ClickHouse vs OpenSearch (le cœur du POC)

Laisse tourner quelques minutes au même débit, puis mesure sur **le même volume**.

### 1. Volume disque & compression
```bash
# ClickHouse : disque réel vs brut + taux de compression
docker compose exec clickhouse clickhouse-client -q "
  SELECT table,
         formatReadableSize(sum(bytes_on_disk))            AS disque,
         formatReadableSize(sum(data_uncompressed_bytes))  AS brut,
         round(sum(data_uncompressed_bytes)/sum(bytes_on_disk),1) AS ratio,
         sum(rows) AS lignes
  FROM system.parts WHERE active AND database='otel'
  GROUP BY table FORMAT PrettyCompact"

# OpenSearch : force un merge pour une mesure juste, puis lit la taille stockée
IDX=$(curl -s 'http://localhost:9200/_cat/indices?h=index' | grep -Ei 'ss4o|logs' | head -1)
curl -s -XPOST "http://localhost:9200/${IDX}/_forcemerge?max_num_segments=1" >/dev/null
curl -s "http://localhost:9200/_cat/indices/${IDX}?v&bytes=b&h=index,docs.count,pri.store.size,store.size"
```
→ normalise en **octets par log** de chaque côté (`store.size / docs.count` vs
`disque_CH / lignes`). C'est le chiffre qui, multiplié par **ton volume Go/jour ×
rétention**, donne le coût de stockage. ClickHouse gagne en général par un facteur
3–10× sur le disque grâce à la compression colonnaire.

### 2. Latence de requête (agrégation « top hosts » — **même dimension** des 2 côtés)
> Pour du syslog, le hostname atterrit dans les **attributs du log**, pas dans
> `service.name`/`resource`. On agrège donc sur `hostname` **des deux côtés** — sinon
> ClickHouse `ServiceName` est vide (1 seul groupe) et OpenSearch renvoie 0 bucket
> (latence ~0 ms trompeuse) : la comparaison serait faussée.
```bash
# ClickHouse — hostname dans la map LogAttributes
docker compose exec clickhouse clickhouse-client --time -q "
  SELECT LogAttributes['hostname'] AS host, count() c FROM otel.otel_logs
  GROUP BY host ORDER BY c DESC LIMIT 10"

# OpenSearch — MÊME dimension : sous-champ .keyword de attributes.hostname
time curl -s "http://localhost:9200/${IDX}/_search" -H 'content-type: application/json' -d '{
  "size":0,"aggs":{"top":{"terms":{"field":"attributes.hostname.keyword","size":10}}}}' >/dev/null
```
> Vérifie les chemins exacts si besoin : `DESCRIBE otel.otel_logs` puis
> `SELECT LogAttributes FROM otel.otel_logs LIMIT 1` (ClickHouse) et
> `GET ${IDX}/_mapping` (OpenSearch). Champ de date SS4O (si filtre temporel) = `@timestamp`.

### 3. Extrapoler le coût
`coût_stockage ≈ (octets/log) × (logs/jour) × rétention_jours`. Ajoute le CPU
d'ingestion (négligeable ici, à re-mesurer à fort débit). Reporte les deux dans un
tableau — c'est le livrable pour l'arbitrage (et l'AO Carrefour).

---

## Ce que ça dit pour la prod MIP
- **Passerelle unique = OTel Collector** : un seul point d'entrée pour syslog +
  OTLP + (bridge Splunk/ES/OpenSearch existant). Format ouvert, zéro proprio.
- **Souveraineté** : tout self-hosté (ici Docker ; en prod **OVH** = hors Cloud
  Act). Pas de SaaS US (Splunk/Datadog/Elastic Cloud).
- **Store** : ClickHouse pour le coût/volume à grande échelle (tiering TTL + stockage
  objet froid) ; OpenSearch reste pertinent si l'exploitation le connaît déjà. Ce
  POC sert à trancher **avec vos chiffres**.
- **Volumes** : monte `RATE` jusqu'à ton débit crête cible pour valider avant l'AO.

## Si ça coince (points version-sensibles)
- **Exporter `clickhouse`** : selon la version du collecteur, les clés (`ttl`,
  `create_schema`, `logs_table_name`) peuvent bouger →
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/clickhouseexporter
- **Exporter `opensearch`** : nom d'index / schéma (SS4O) variables → découvre
  l'index via `_cat/indices` ; doc :
  https://github.com/open-telemetry/opentelemetry-collector-contrib/tree/main/exporter/opensearchexporter
- **Plugin ClickHouse de Grafana** : épinglé à `4.4.0` (compatible Grafana 11.2.0 —
  les versions récentes exigent Grafana ≥ 11.6). Grafana n'est là que pour explorer
  la branche ClickHouse : **la comparaison coût/perf se fait en CLI** (`clickhouse-client`
  + `curl`), donc un souci Grafana ne bloque pas le POC. Si la datasource ne se
  connecte pas, vérifie `protocol: native` + port `9000` (ou bascule `http`/`8123`).
- Logs du collecteur : `docker compose logs -f otel-collector` (l'exporter `debug`
  y écrit un échantillon).

## Nettoyer
```bash
docker compose down -v   # -v supprime aussi les volumes (données du POC)
```
