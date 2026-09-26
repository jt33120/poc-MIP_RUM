# Auto-observabilité — `/metrics` Prometheus + santé interne (P1)

> Opérer MIP RUM comme un produit **supervisé** : exposer sa propre santé (ingestion,
> alertes, métering) pour la scraper et l'alerter. Lecture seule, aucune migration de
> données. Console : `/admin/health` (admin). Endpoint : `GET /api/metrics`.

## Endpoint `/api/metrics`

- **Format Prometheus** (`text/plain; version=0.0.4`), `cache-control: no-store`.
- **Auth par token** : header `Authorization: Bearer $METRICS_TOKEN`. **Fail-closed** :
  si `METRICS_TOKEN` n'est pas défini, l'endpoint répond **404** (désactivé) — pas
  d'exposition involontaire. Bypass du middleware de session (scrape sans cookie).
- **Aucune PII** : uniquement des compteurs agrégés.

### Métriques exposées (gauges)

| Métrique | Sens |
|---|---|
| `miprum_ingest_events_5m{kind="metric\|pageview\|error"}` | Événements ingérés (5 min glissantes) |
| `miprum_ingest_sessions_5m` | Sessions distinctes (5 min) |
| `miprum_apps_active` | Tenants actifs au registre |
| `miprum_alerts_unacked` | Événements d'alerte non acquittés |
| `miprum_alert_deliveries{status="queued\|failed\|dead"}` | Livraisons d'alerte par statut |
| `miprum_metering_lag_hours` | Ancienneté du dernier métering (détecte un cron mort) |
| `miprum_apps_route_capped` | Applications au plafond de cardinalité de route (migration-v62) |
| `miprum_routes_max` | Plus grand nombre de routes distinctes retenues pour une application |
| `miprum_ingest_backlog` | Lots débarqués en attente de drain (ingestion différée, migration-v63) |
| `miprum_ingest_backlog_blocked` | Lots abandonnés après cinq échecs d'écriture |
| `miprum_ingest_backlog_age_seconds` | Âge du plus vieux lot en attente de drain |

Lecture en échec : l'endpoint répond **503** (`retry-after: 30`), jamais un instantané
de zéros — le scrape échoue et Prometheus le voit (`up == 0`). Sans jeton valide : **401**.

## Console `/admin/health`

Même snapshot (`internalHealth()`), en cartes : ingestion 5 min, alertes & livraison,
tenants & retard de métering (seuils de couleur : > 26 h ambre, > 30 h rouge — le
métering, `meter_tenant_usage()`, tourne au passage quotidien du scheduler, 03:17 UTC,
`packages/backend/jobs/cadence.mjs`). Réservé à l'administrateur de la plateforme
(`chargerSante`, `apps/console/lib/chargeurs/administration.ts`). Lecture en échec :
« Lecture en échec », pas de tuiles à zéro.

## Architecture

- `lib/queries-health.ts` : `internalHealth()` — **un seul** aller-retour SQL. Une lecture
  en échec **lève** (F02) : elle rendait autrefois un instantané à zéros, le tableau d'un
  système en parfaite santé affiché précisément quand la base ne répond plus.
- `lib/metrics-format.ts` (**pur, testé**) : `HealthSnapshot` → `Metric[]` (`healthToMetrics`)
  → texte (`toPrometheus` : HELP/TYPE une fois par nom, labels échappés, échantillons
  null/non-finis omis).
- Lecture seule via `console_ro` (toutes les tables couvertes par v16 + `app_registry`
  par **v19**, cf. ci-dessous). Pas de nouvelle table.

## Parité console_ro corrigée en passant (migration-v19)

En prouvant `/metrics`, on a constaté que `console_ro` n'avait **pas** de `SELECT` sur
`app_registry` dans le repo (v05 n'accordait qu'INSERT/UPDATE ; le SELECT + la policy
`cro_sel_app_registry` n'existaient qu'en prod, posés à la main). Sans ça, le **sélecteur
d'app de toute la console** et `/metrics` renverraient 0 sous `console_ro` sur un
déploiement propre. `migration-v19` codifie ce SELECT (idempotent, nom identique au live
→ no-op sur la prod). Même famille que le finding #1 / v16.

## Les services Railway

Les services bâtis sur `packages/service-kit` (collector, api, console-api, scheduler,
notifier — seul le scheduler est déployé en production au 26/09/2026) exposent leurs
propres sondes : `/health`, `/live`, et, derrière un `METRICS_TOKEN` posé sur le
service (404 sans jeton valide), `/ready` et `/metrics`. Détail :
`packages/service-kit/README.md`. Le serveur MCP (`services/mcp/http.mjs`) n'est pas
bâti sur le kit : il n'expose que `/health`. Ce document ne décrit que `/api/metrics`
de la console.

## Configuration

```bash
# Vercel (ou env d'exécution console) — active /api/metrics :
vercel env add METRICS_TOKEN production   # openssl rand -hex 32
# Prometheus scrape_config :
#   authorization: { type: Bearer, credentials: <METRICS_TOKEN> }
#   metrics_path: /api/metrics
```

## Preuves

- `scripts/verify-health.mjs` (PG réel) : comptages ingestion/alertes/livraisons + retard
  métering, et exécution sous `console_ro` (== propriétaire).
- `tests/unit/metrics-format.test.ts` : `toPrometheus` (HELP/TYPE unique, labels échappés,
  null/Infinity omis).

## Suivi (non bloquant)

- SLO **interne** formel (réutiliser le moteur SLO de l'alerting mature, une fois #27 mergé).
- Histogrammes de latence d'ingestion (nécessite d'instrumenter le temps de traitement de la route d'ingestion).
