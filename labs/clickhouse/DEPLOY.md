# Déploiement ClickHouse production — MIP RUM (C2 / P0 « scale grand compte »)

> **Expérience, jamais déployée** (état au 26/09/2026) : ce runbook décrit une bascule vers ClickHouse qui n'a pas eu lieu ; la production stocke dans Postgres (Neon).
> **But d'origine** : passer du stockage POC (Postgres, alors sur Supabase, plafond ~10⁶–10⁷ events) au stockage analytique **ClickHouse** (milliards d'events, auto-hébergeable).
> Le chemin n'est **éprouvé qu'en local**, le 11/06/2026 (`bench.mjs`, Δ=0 sur les p75, ×15 plus compact,
> ~88 k lignes/s sans tuning — cf. [`NOTES.md`](NOTES.md)). Ce document est le **runbook
> de bascule**. Tout n'est pas prêt côté code : la couche dialecte de la console, l'aplatissement dans le Collector et le mode `both` restent à écrire (voir plus bas) ;
> un hébergement financé reste le préalable.

## Ce qui est prêt (autonome, dans le repo)

| Artefact | Rôle |
|---|---|
| `schema.prod.sql` | schéma **prod-grade** : tables complètes, `device_type` dénormalisé, **TTL 30 j** (RGPD), codecs colonne, **MV AggregatingMergeTree** `quantileTDigestState` horaire (multi-milliards) |
| `schema.sql` | schéma minimal du **bench** (repro Δ=0) — ne pas confondre |
| `writer.mjs` | client HTTP CH (JSONEachRow, `FORMAT JSON`, **binding serveur `{name:Type}`**), zéro dépendance |
| `bench.mjs` | preuve d'équivalence PG↔CH (Δ=0) sur 100 k metrics |
| `scripts/load-bench.mjs` `STORE=clickhouse` | preuve de **capacité** (débit + p95 requêtes) à rejouer contre l'instance cible |
| `otel-collector.example.yaml` | exemple de topologie Collector → CH |

## Topologie cible

```
SDK navigateur ─OTLP/HTTP JSON─▶ OTel Collector (on-prem / cloud souverain)
                                      │  (filtre, ajoute mip.app_id/api_key, batch)
                                      ▼
                                 ClickHouse  ◀── console (lecture HTTP + FORMAT JSON, couche dialecte)
```

Seul changement **côté client** : `endpoint:` du snippet pointe sur le Collector. Le
SDK et la sémantique `mip.*` ne bougent pas (« OTLP fidèle sur le fil »). Le **replay**
(chunks rrweb) reste hors CH : object storage (S3 souverain) ou PG `bytea`.

## Étapes de bascule (1 cran à la fois, réversible)

1. **Provisionner** CH + Collector (cf. hébergement ci-dessous). Appliquer `schema.prod.sql`
   (`writer.mjs` → `applySchemaFile`, ou `clickhouse-client < schema.prod.sql`).
2. **Aplatir** `flattenOtlp` en *processor* Collector **ou** en vues CH sur `otel_traces`
   (mêmes attributs `mip.*`/`webvital.*` → colonnes ; le fingerprint d'erreurs garde l'algo).
   Brancher en `both` (PG **et** CH) le temps de la recette.
3. **Recette de parité** : rejouer `bench.mjs` (Δ=0) puis `load-bench STORE=clickhouse`
   (débit + p95) contre l'instance ; comparer aux chiffres locaux.
4. **Brancher la console en lecture** via la **couche dialecte** (ci-dessous), **store par
   store** (Overview, puis Pages, Erreurs…), avec bascule par feature-flag `DB_DIALECT`.
5. **Décommissionner** l'écriture Postgres et la fonction serverless une fois la parité
   validée en prod.

## Couche « dialecte » console (~50 lignes, à câbler le jour J)

La console lit aujourd'hui Postgres (`apps/console/lib/queries*.ts`). Les seules
différences SQL sont **3 idiomes** (équivalences prouvées Δ=0) :

| Postgres | ClickHouse |
|---|---|
| `percentile_cont(0.75) within group (order by v)` | `quantileExactInclusive(0.75)(v)` (exact) ou `quantileTDigest(0.75)(v)` (approx, multi-milliards) |
| `date_trunc('hour', ts)` | `toStartOfHour(ts)` |
| `count(distinct session_id)` | `uniqExact(session_id)` (ou `uniq`, approx) |
| param positionnel `$1` | binding nommé `{app:String}` (cf. `writer.chSearchParams`) |
| filtre device via **JOIN** `rum_session` | colonne **`device_type` dénormalisée** (pas de JOIN) |

> **Plan recommandé** : un module `apps/console/lib/dialect.ts` exposant `p75(col)`,
> `hourBucket(col)`, `dayBucket(col)`, `countDistinct(col)` + un driver `q()` CH (HTTP,
> `FORMAT JSON`), sélectionné par `DB_DIALECT=postgres|clickhouse`. À implémenter **et
> valider contre l'instance live** (ne pas livrer du SQL CH non exécuté). Pour le
> multi-milliards, les vues p75/heatmap lisent la **MV** `rum_metric_p75_hourly_ch`
> (`quantileTDigestMerge` / `countMerge` / `sumMerge`), pas les lignes brutes.

## Conformité & exploitation

- **RGPD** : TTL 30 j sur les tables brutes (la MV garde la tendance 400 j, **sans PII** :
  agrégats par app/route/device/heure). Zéro IP stockée (pays estimé par fuseau horaire ; la résolution
  GeoIP embarquée dans l'image backend ne résout aucun pays en production, `docs/TOPOLOGIE_BACKEND.md`).
- **Durcissement** : CH derrière le réseau privé ; HTTP auth (user/mot de passe ou mTLS) ;
  `readonly` pour le user console ; quotas par user ; pas d'accès public au port 8123/9000.
- **Sauvegardes** : `BACKUP`/`RESTORE` (disque ou S3 souverain) ; tester la restauration.
  Rétention/versionnage du `schema.prod.sql` (migrations CH versionnées comme les SQL PG).
- **Supervision** : `system.parts`, `system.query_log`, taux d'erreur d'insertion du
  Collector ; brancher sur l'auto-observabilité plateforme (cf. P1 `/metrics`).
- **HA** (si exigée) : `ReplicatedMergeTree` + ZooKeeper/Keeper multi-nœuds — hors MVP 1 nœud.

## Options d'hébergement (décision à prendre — voir checkpoint)

| Option | Souveraineté | Effort ops | Coût indicatif | Note |
|---|---|---|---|---|
| **ClickHouse Cloud (région UE)** | UE (mais éditeur US) | faible (managé) | abonnement à l'usage | rapide, mais argument souveraineté/CSPN plus faible |
| **CH auto-géré — Scaleway / OVHcloud / Clever Cloud** | **FR/UE** | moyen (1 nœud durci) | VM + disque | meilleur argument souverain ; ops à notre charge |
| **CH on-prem MIP** | **totale** | élevé | infra MIP | si MIP a déjà du datacenter |

Drivers de coût : nœud(s) CH (CPU/disque), Collector, astreinte. Pour `1 M pages
vues/jour` ≈ **~2,4 Go / 30 j** (cf. notes) — un nœud modeste couvre plusieurs clients.

> **Risque principal = exploitation** (sauvegarde, montée de version, supervision), **pas
> la faisabilité technique** (déjà démontrée). C'est ce qu'il faut arbitrer au checkpoint.
