# `scheduler`

**Rôle.** Déclenche les travaux planifiés sous bail — alertes, SLO, sondes uptime, livraisons, rollups, purge de rétention, comptage — et, seul de tous les services, applique les migrations au pré-déploiement.

| | |
|---|---|
| Groupe du canevas | 3 · Traitements |
| Point d'entrée | `node services/scheduler/worker.mjs` (câblage seul, sur `@mip/service-kit`) |
| Pré-déploiement | `node services/scheduler/migrate.mjs` (câble `main()` de `@mip/db/migrate.mjs`) |
| Passage manuel | `node services/scheduler/run-once.mjs tick\|hourly\|daily` — même bail que le worker |
| Exposition | privée : aucun domaine généré, joignable par le réseau privé du projet |
| Rôle BDD | propriétaire (`DATABASE_URL`) ; pool de 4 (`PGPOOL_MAX`), `application_name = mip-scheduler` |
| Réplicas | 1 (deux seraient sûrs : voir « Sûreté multi-réplique ») |
| Redémarrage | `ALWAYS` |

## Cadences

| Cadence | Quand (UTC) | Étapes | Bail |
|---|---|---|---|
| `tick` | :00, :05, :10… (+ un passage au démarrage) | `check_alerts`, `route_error_issue_notifications`, `check_slo_burn`, uptime, `dispatch_alerts`, `dispatch_tickets`, `reconcile_deliveries` | 600 s |
| `horaire` | HH:05 | `refresh_rum_rollups(26)`, `refresh_metric_histogram(26)`, `check_new_errors`, `check_ai_op_anomalies`, notes historiques | 900 s |
| `quotidien` | 03:17 | `purge_rum_tenants(30)`, `meter_tenant_usage` | 3 600 s |

Chaque étape SQL est bornée par un `statement_timeout` posé **dans sa transaction** (`set_config(…, true)`, jamais en `SET` de session : le pooler Neon le perdrait) — 60 s par défaut, 5 min pour les pré-agrégats et le comptage, **30 min pour la purge** (`DELAIS_ETAPES_MS`, `packages/backend/jobs/planifie.mjs`). La somme des délais d'une cadence reste sous la durée de son bail. Une étape en échec n'annule pas les suivantes ; elle part au journal en `error` **avec sa pile complète**.

## Routes et sondes

| Route | Exposition | Sens |
|---|---|---|
| `GET /health` | réseau privé | processus vivant **et** base joignable (`select 1`, 2 s). **C'est la sonde Railway.** « Jamais exécuté » et « bail tenu ailleurs » y sont **sains** : pendant un redéploiement, l'instance sortante tient encore le bail, et une sonde de fraîcheur ferait échouer le déploiement qui doit la remplacer. |
| `GET /ready` | jeton `METRICS_TOKEN` (sinon 404) | 503 dès SIGTERM ; sinon **fraîcheur** de chaque cadence (battement en base, tolérances : tick 15 min, horaire 2 h, quotidien 26 h, comptées depuis le démarrage pour une cadence jamais exécutée) et **arriéré** de livraisons (`queued` plus vieilles que 15 min = bloquées). Supervision seulement. |
| `GET /metrics` | jeton `METRICS_TOKEN` (sinon 404) | Prometheus : `scheduler_job_runs_total{job,result}`, `scheduler_step_failures_total{job,step}`, `scheduler_heartbeat_age_seconds{job}`, `scheduler_backlog_deliveries`, `scheduler_job_last_duration_seconds{job}`, pool, mémoire. |

Toute autre route : 404. (`/status`, sans jeton, a disparu : son contenu est dans `/ready`.)

**Le battement.** `scheduler_lease.expires_at` d'un bail rendu est l'heure du dernier passage **abouti** : la vitrine le lit (`dernierTickScheduler`), `/ready` aussi. Il n'est écrit que sur **succès** ; un passage en échec libère le bail en remettant l'ancien battement.

**Le dead-man's switch.** Si `DEADMAN_URL` est posée, un `GET` part (par `safeFetch`, 5 s, jamais bloquant) après chaque **tick abouti**. Le service externe sonne quand les signaux cessent : scheduler arrêté, bloqué, en échec à chaque passage — ce qu'aucune sonde interne ne voit. Régler la période sur 5 min et la marge sur 10 à 15 min.

## Configuration

`node services/scheduler/worker.mjs --print-env-example` écrit le gabarit à jour. Une variable obligatoire absente, ou une valeur invalide, fait refuser le démarrage (code 2) avec **toutes** les erreurs sur une ligne.

| Variable | Obligatoire | Défaut | Rôle |
|---|---|---|---|
| `DATABASE_URL` | **oui** (secret) | — | Postgres. Pas de repli sur un Postgres local. |
| `PGPOOL_MAX` | non | 4 | taille du pool (2 à 20) |
| `PORT` | non | 8080 | imposé par Railway |
| `LOG_LEVEL` | non | `info` | |
| `METRICS_TOKEN` | non (secret, ≥ 32 car.) | — | jeton de `/ready` et `/metrics` ; absent : 404 |
| `DEADMAN_URL` | non (secret, `https:`) | — | dead-man's switch ; absent : aucun signal |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | non, **à poser** | 10 hors Railway, **0 sur Railway** | délai SIGTERM → SIGKILL ; 15 à 30 |
| `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_REPLICA_ID` | fournies par Railway | — | titulaire du bail : `${RAILWAY_DEPLOYMENT_ID}:${RAILWAY_REPLICA_ID}` |
| `MIGRATION_DATABASE_URL` | non | — | pré-déploiement seulement (connexion directe pour les `predeploy-vNN`) |

## Sûreté multi-réplique

Un **bail par cadence** (`scheduler_lease`, une ligne à expiration) : il traverse le pooler en mode transaction, là où un verrou consultatif de session se perdait. Le titulaire est unique par processus (`déploiement:réplique`) ; un passage manuel prend `manuel:<déploiement>:<uuid>` — jamais le nom du worker, sinon il pourrait rendre son bail. Dans un processus, la boucle du kit ne lance jamais deux passages de front. Les étapes restent idempotentes : le bail n'est pas une exclusion stricte (un travail plus long que son bail laisserait passer un second), d'où des durées très au-dessus du temps observé et des délais par étape dont la somme reste en dessous.

## Modes de panne

| Situation | Ce qui se passe | Ce qu'on voit |
|---|---|---|
| base injoignable au passage | passage compté `erreur`, suivant à l'heure ; `/health` à 503 | `travail en échec — passage suivant à l'heure` (pile), `santé dégradée` |
| étape en échec (dont délai atteint, 57014) | étapes suivantes exécutées ; pas de battement ; bail libéré | `étape planifiée en échec` (pile, `delai_ms`), `travail terminé` en `error`, `scheduler_step_failures_total` ; plus de signal au dead-man's switch |
| bail tenu ailleurs | passage sauté, **sain** | `bail tenu ailleurs — passage sauté`, `result="bail_ailleurs"` |
| `pg_terminate_backend` sur une connexion | la requête en cours échoue, le pool remplace la connexion ; le processus vit | `pg : connexion inactive perdue` ou `connexion empruntée coupée` |
| SIGTERM pendant un passage | `/ready` à 503 ; le passage en cours finit ; puis `pool.end()`, sortie 0 | `arrêt demandé`, `ressource fermée`, `arrêt terminé` |
| passage plus long que le drainage | sortie forcée en 1 ; le bail expire de lui-même (≤ 10 min pour le tick) | `drainage incomplet`, `sortie forcée` |
| dead-man's switch injoignable | le tick n'échoue pas | `dead-man's switch injoignable` (sans l'URL) |

## Lancement local

```bash
docker run -d --rm --name mip-pg -e POSTGRES_PASSWORD=postgres -p 5433:5432 postgres:17
export DATABASE_URL=postgres://postgres:postgres@localhost:5433/postgres
export METRICS_TOKEN=$(openssl rand -hex 24)
node services/scheduler/migrate.mjs
PORT=4320 node services/scheduler/worker.mjs &
curl -s localhost:4320/health
curl -s -H "authorization: Bearer $METRICS_TOKEN" localhost:4320/ready
node services/scheduler/run-once.mjs tick     # 3 si le worker tient le bail
```
