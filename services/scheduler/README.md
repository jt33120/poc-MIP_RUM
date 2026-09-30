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
| Réplicas, redémarrage | 1 (deux seraient sûrs : voir « Sûreté multi-réplique ») ; `ALWAYS`, drainage 20 s |
| État au 26/09/2026 | **déployé** sur Railway. Le déploiement en service date du 23/09/2026 (P0, #279) ; les suivants échouent au pré-déploiement tant que le calcul Neon est suspendu (jusqu'au 01/10/2026). Variables posées : `DATABASE_URL`, `PGPOOL_MAX`, `PORT`, `NODE_ENV`, `LOG_LEVEL` seulement (relevé de l'API Railway) — donc ni `METRICS_TOKEN` (`/ready` et `/metrics` en 404), ni `SCHEDULER_TICK_MIN`, ni `SCHEDULER_DELIVERY` (le tick livre) |

## Cadences

| Cadence | Quand (UTC) | Étapes | Bail |
|---|---|---|---|
| `tick` | :00, :05, :10… — ou :00, :15, :30, :45 avec `SCHEDULER_TICK_MIN=15` (+ un passage au démarrage) | `canari_emettre`, `check_alerts`, `route_error_issue_notifications`, `check_slo_burn`, uptime, `canari_verifier` (journal, registre, alerte d'absence), `dispatch_alerts`, `reconcile_deliveries` — avec `SCHEDULER_DELIVERY=off` : sans les deux étapes de livraison ; avec `CANARI=off` : sans les deux étapes du canari | 600 s |
| `horaire` | HH:05 | `refresh_rum_rollups(26)`, `refresh_metric_histogram(26)`, `check_new_errors`, `check_ai_op_anomalies`, notes historiques, `detections_horaires` (v101 : `refresh_vital_horaire(3)` puis plage habituelle et épisodes) | 900 s |
| `quotidien` | 03:17 | `purge_rum_tenants(30)`, `meter_tenant_usage`, `purge_console_sessions`, `purge_detections(8)` (v101) | 3 600 s |

**Les détections horaires (v101).** `detections_horaires` recalcule les p75 des trois dernières heures fermées dans `vital_horaire` (SQL, upsert idempotent, délai de 60 s), puis, en JS sur ces agrégats (`packages/backend/jobs/detections.mjs`), compare chacune des quatre dernières heures fermées à sa **plage habituelle** (médiane et écart absolu médian du même créneau des semaines passées, repli quotidien puis 48 h ; A2 § 7.1) et ouvre ou ferme les épisodes dans `signal_detecte`. Aucun réveil de la base en plus : l'étape est greffée sur le passage horaire. Une app sans ingestion depuis plus de 15 min est **suspendue** pour le passage (aucun constat ouvert, fermé ni mis à jour) : une panne de collecte ne doit pas passer pour une amélioration. Sur une base sans v101, l'étape rend « migration-v101 non appliquée » au lieu d'échouer.

**La livraison part au notifier (P5).** Webhooks et e-mails sont l'affaire du service [`notifier`](../notifier/README.md), toutes les 15 s par défaut, seul détenteur des secrets sortants — pas encore créé sur Railway : en production, le tick livre. Tant que `SCHEDULER_DELIVERY` vaut `on`, le tick livre aussi, comme avant ; `off` le réduit à **décider** — les livraisons restent `queued` pour le notifier. Le scheduler n'a pas de clé Resend : une livraison e-mail qu'il prend est soldée `skipped`, d'où `off` posé au plus tard quand le notifier démarre.

Chaque étape SQL est bornée par un `statement_timeout` posé **dans sa transaction** (`set_config(…, true)`, jamais en `SET` de session : le pooler Neon le perdrait) — 60 s par défaut, 5 min pour les pré-agrégats et le comptage, **30 min pour la purge** (`DELAIS_ETAPES_MS`, `packages/backend/jobs/planifie.mjs`). La somme des délais d'une cadence reste sous la durée de son bail. Une étape en échec n'annule pas les suivantes ; elle part au journal en `error` **avec sa pile complète**.

## Le canari et le journal des sondes

**Pourquoi.** Les trous du 24 au 27/09/2026 ne se sont vus qu'en regardant des graphiques vides. Chaque tick prouve désormais que la porte des clients écrit (`packages/backend/jobs/sondes.mjs`, migration-v103) :

1. **`canari_emettre`, en tête du tick.** Un lot OTLP/HTTP JSON de quelques centaines d'octets — une page vue (`/canari`, URL en `.invalid`), un vital (LCP fixe, 1 000 ms), un span serveur, application `mip-canari` — part en `POST` sur l'URL **publique** des capteurs (`CANARI_CONSOLE_URL`, par défaut `https://mip-rum-console.vercel.app/api/ingest/v1/traces`) : console Vercel → relais → collector → base, le chemin des clients. Verdict : `ok` ≤ 2 s, `lent` jusqu'à 8 s, `echec` au-delà, sur un statut non 2xx ou sans réponse. Aucune donnée personnelle, jamais d'erreur, aucun destinataire nouveau.
2. **`canari_verifier`, avant la livraison.** Relecture par clé unique des lignes du passage (`rum_session`, `rum_pageview`, `rum_metric`, `rum_span`, `rum_event_index`) ; une ligne par étage dans `sonde_passage` (`ingest_console`, `ecriture`), en un seul `insert` ; état de la chaîne (`interrompue` si rien n'est écrit, `degradee` si lent ou si une projection manque) ; registre `collecte_fenetre` (portée `*`, étage `chaine`) : la fenêtre ouverte se ferme, se prolonge ou est remplacée. Un silence du journal plus long que `2 × cadence + 5 min` (coupure de la base) est **reconstitué** en fenêtre `interrompue`, `source = 'reconstitution'`.
3. **Alertes, une par épisode**, par le chemin des autres (`alert_event` puis `route_alert`, la fenêtre garde l'identifiant de son alerte) : le canari en échec **deux passages de suite** (`critical`, app `mip-canari` : canaux globaux)  ; une application en **silence anormal** (`warning`, fenêtre `silence` par application, close au retour de la donnée). Quand la chaîne elle-même est coupée, l'alerte d'absence des applications se tait : la fenêtre de la plateforme le dit une fois.

**Le silence anormal.** Muette ne suffit pas : une application au trafic de jour (les robots de `gip-plateforme` tournent de 10 h à 17 h, plus un filet de 0 h à 6 h) se tait chaque soir, et une alerte quotidienne à 18 h ruinerait la confiance dans toutes les autres. Une application alerte quand elle est muette depuis `SILENCE_APP_MIN` minutes (60 par défaut) **et** que chaque heure d'horloge de ces dernières minutes est une de ses **heures habituelles** : une heure où elle a reçu des données au moins 4 des 7 derniers jours (jour en cours exclu), au fuseau de l'application (`app_registry.timezone`, Europe/Paris par défaut). Les faits viennent de la base en une requête (`sonde_etat_silence`) : la dernière donnée par l'index de `rum_event_index`, les heures habituelles dans `rum_rollup_hourly` (jamais le brut) ; la décision est prise dans le scheduler (`decisionSilence`). On regarde la **fin** du silence, pas tout le silence : une panne qui commence lundi à 17 h traverse la nuit, et exiger que toutes ses heures soient habituelles ne la signalerait jamais ; ainsi elle alerte mardi vers 11 h, quand l'application aurait dû parler. Limite : une application qui n'émet que des spans serveur n'a pas de rollup, donc pas d'heure habituelle, donc pas d'alerte — son battement se déclarera dans `sonde_attendue` (à faire).

**La clé.** La collecte exige une clé (`REQUIRE_API_KEY=true` depuis le 29/09/2026). Aucune n'est dans le dépôt ni dans une variable : le scheduler en **tire une à son démarrage**, n'écrit que son empreinte (`sha256`) dans `app_registry.api_key_hash` de `mip-canari`, et garde le clair en mémoire. L'ingestion met le registre des clés en cache 60 s : le premier canari après une clé réécrite (démarrage, clé régénérée depuis la console) peut être refusé en 403 — journalisé `saute`, sans toucher au registre ni compter comme un échec.

**Hors des statistiques clients.** `mip-canari` est interne **et** sonde (`app_registry.sonde`) : exclue du périmètre des écrans même quand on inclut les apps internes, du comptage d'usage (déclencheur sur `tenant_usage_daily`) et de l'alerte d'absence ; rétention 7 jours. Le journal est purgé à 90 jours, le registre à 400 (fenêtres closes), par `purge_rum_tenants`.

**Coût.** Une transaction d'ingestion, une lecture par clé unique, un `insert` de deux lignes et une lecture d'index par application, dans la fenêtre où le tick a déjà réveillé la base : aucun réveil de plus.

## Base gratuite : la cadence ralentie

**Décision du 24/09/2026 : la base reste sur l'offre gratuite de Neon, en mode dégradé.** Cette offre donne 100 heures de calcul (CU-h) par mois, et Neon n'endort le calcul qu'après 5 minutes sans requête. Un tick toutes les 5 minutes le gardait donc éveillé en permanence : 110 CU-h consommées au 24/09, calcul suspendu jusqu'au 1er du mois suivant, production à l'arrêt.

| Tick | Base éveillée | Calcul par mois (0,25 CU) | Latence d'alerte |
|---|---|---|---|
| 5 min (visé) | en permanence | ~180 CU-h — **au-delà du quota** | ≤ 5 min |
| **15 min (base gratuite)** | ~5,5 min par passage, soit ~37 % du temps | **~65 CU-h**, le reste pour la collecte et la console | ≤ 15 min |

`SCHEDULER_TICK_MIN=15`, et le notifier sur la même grille (`NOTIFIER_INTERVAL_MS=900000`, 45 s après le tick) : un seul réveil de la base pour les deux services. Le passage horaire (HH:05) et le quotidien (03:17) tombent dans la fenêtre où le tick de :00 ou de :15 l'a déjà réveillée. Le scheduler **publie** sa cadence (`platform_flag.scheduler_tick_min`) : la vitrine affiche « 15 minutes » et dit pourquoi, au lieu de la cible.

L'offre gratuite a une seconde limite, que la cadence ne règle pas : **0,5 Go de stockage**. Relevé par l'API Neon le 24/09/2026 : 307 Mio occupés sur 512 (60 %). La purge de rétention (30 jours, quotidienne) borne la télémétrie ; le rejeu des sessions, stocké en base (ADR-0009), est ce qui la remplirait le premier.

Ce que ça coûte, à dire : une alerte part jusqu'à 15 minutes après sa cause ; une règle dont la fenêtre est plus courte que le tick n'évalue qu'une partie du temps ; les sondes uptime passent toutes les 15 minutes. Et la collecte d'un vrai site, qui réveille la base dès qu'un visiteur arrive, suffit à épuiser le quota. **Pour un vrai produit RUM : offre payante** (Neon Launch, ~0,11 $ par CU-h sans minimum, 20 à 40 $ par mois avec tous les services), `SCHEDULER_TICK_MIN=5`, `NOTIFIER_INTERVAL_MS=15000` — deux variables, aucun code.

## Routes et sondes

| Route | Exposition | Sens |
|---|---|---|
| `GET /health` | réseau privé | processus vivant **et** base joignable (`select 1`, 2 s). **C'est la sonde Railway.** « Jamais exécuté » et « bail tenu ailleurs » y sont **sains** : pendant un redéploiement, l'instance sortante tient encore le bail, et une sonde de fraîcheur ferait échouer le déploiement qui doit la remplacer. |
| `GET /live` | réseau privé | processus vivant, sans toucher la base (kit) : la sonde d'une supervision externe, qui ne réveille pas Neon. |
| `GET /ready` | jeton `METRICS_TOKEN` (sinon 404) | 503 dès SIGTERM ; sinon **fraîcheur** de chaque cadence (battement en base, tolérances : tick trois passages — 15 min, 45 à 15 min de cadence —, horaire 2 h, quotidien 26 h, comptées depuis le démarrage pour une cadence jamais exécutée) et **arriéré** de livraisons (`queued` plus vieilles que 15 min = bloquées). Supervision seulement. |
| `GET /metrics` | jeton `METRICS_TOKEN` (sinon 404) | Prometheus : `scheduler_job_runs_total{job,result}`, `scheduler_step_failures_total{job,step}`, `scheduler_heartbeat_age_seconds{job}`, `scheduler_backlog_deliveries`, `scheduler_job_last_duration_seconds{job}`, pool, mémoire. |

Toute autre route : 404. (`/status`, sans jeton, a disparu : son contenu est dans `/ready`.)

**Le battement.** `scheduler_lease.expires_at` d'un bail rendu est l'heure du dernier passage **abouti** : la vitrine le lit (`dernierTickScheduler`), `/ready` aussi. Il n'est écrit que sur **succès** ; un passage en échec libère le bail en remettant l'ancien battement.

**Le dead-man's switch.** Si `DEADMAN_URL` est posée, un `GET` part (par `safeFetch`, 5 s, jamais bloquant) après chaque **tick abouti**. Le service externe sonne quand les signaux cessent : scheduler arrêté, bloqué, en échec à chaque passage — ce qu'aucune sonde interne ne voit. Régler la période sur la cadence du tick (15 min par défaut, 5 sur une offre payante) et la marge sur 10 à 15 min.

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
| `SCHEDULER_DELIVERY` | non | `on` | `off` : le tick ne livre plus (notifier). Retour arrière : `on` |
| `CANARI` | non | `on` | `off` : ni canari, ni journal des sondes, ni alerte d'absence. Retour arrière : `on` |
| `CANARI_CONSOLE_URL` | non (`https:`) | l'ingestion publique de la console | porte que le canari traverse |
| `SILENCE_APP_MIN` | non | `60` | alerte d'absence : minutes sans donnée, à des heures habituelles de l'application (5 à 10 080) |
| `SCHEDULER_TICK_MIN` | non | `15` | cadence du tick : 5, 10, 15, 20 ou 30. Le défaut suit la base gratuite (voir plus haut) ; **un vrai produit pose 5** |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | non, **à poser** | 10 pour le kit (qui avertit sur Railway) ; Railway, lui, draine **0 s** par défaut | délai SIGTERM → SIGKILL ; 15 à 30 (le drainage du service Railway est réglé à 20 s) |
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
