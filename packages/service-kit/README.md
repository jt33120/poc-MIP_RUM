# @mip/service-kit

**Rôle.** Ce que chaque service Railway de MIP RUM doit faire de la même façon (configuration, journal, sondes, délais, arrêt propre, pool Postgres, métriques, boucle de travail), écrit une fois, pour que `services/<x>/` ne contienne plus que du câblage.

Du `.mjs` avec JSDoc. **Zéro dépendance** : `pg` est passé en paramètre, le reste vient de Node. Des fonctions, pas un framework : pas de routeur, pas de conteneur d'injection, pas de cycle de vie caché. Un service appelle ce dont il a besoin, dans l'ordre qu'il choisit, et la lecture de son point d'entrée suffit à savoir ce qu'il fait.

Le kit met en œuvre les points 2 à 7 du **contrat de service** (plan backend, section « Contrat de service »).

## Modules

| Module | Exporte | Ce qu'il garantit |
|---|---|---|
| `config.mjs` | `defineConfig`, `parseConfig`, `envExample`, `redactConfig`, `COMMON_ENV` | Échec immédiat (code 2) qui liste **toutes** les erreurs en une ligne. Variable vide = absente. Journal de démarrage expurgé : un secret n'apparaît ni dans le journal, ni dans un message d'erreur. `--print-env-example` écrit le gabarit `.env` tiré du schéma. |
| `log.mjs` | `createLogger`, `LOG_LEVELS`, `setLogContextProvider` | Une ligne JSON par événement, avec `service`, `version`, `replica`, `request_id` / `run_id` et la pile complète des erreurs. Jamais de secret, d'adresse IP ni d'e-mail. Sans import `node:` : la console Next l'importe. |
| `context.mjs` | `withContext`, `currentContext` | AsyncLocalStorage branché sur le journal : une ligne émise au fond du noyau porte l'identifiant de la requête ou du tour en cours. |
| `http.mjs` | `startService`, `readBody`, `DEFAULT_TIMEOUTS`, `DEFAULT_MAX_BODY_BYTES` | `/health`, `/ready`, `/metrics` ; délais serveur ; plafond de corps (413) ; journal d'accès sans IP ; `X-Request-Id`. |
| `lifecycle.mjs` | `installLifecycle` | SIGTERM → `/ready` à 503 → drainage → fermeture (`pool.end()`) → sortie ; sortie forcée avant SIGKILL ; gardes `unhandledRejection` / `uncaughtException`. Synchrone : à installer avant tout `await`. |
| `pg.mjs` | `createPool`, `ping`, `optionsSsl`, `describeTarget` | `pool.on('error')` et un écouteur `error` sur chaque client **emprunté** (pg-pool retire le sien au prêt), `connectionTimeoutMillis`, `idleTimeoutMillis`, `query_timeout`, `application_name`, keepalive TCP. **Aucun `SET` de session.** TLS vérifié hors réseau privé. |
| `metrics.mjs` | `createMetrics`, `registerProcessMetrics` | Compteurs et jauges au format texte Prometheus, jauges calculées au rendu, plafond de séries par métrique. |
| `loop.mjs` | `startLoop` | Boucle à intervalle, jitter ±10 %, ou cadence alignée sur l'horloge (`nextDelay`, le scheduler) ; **jamais deux tours en parallèle**, un échec ne l'arrête pas, `stop()` attend le tour en cours. |
| `web.mjs` | `toNodeHandler`, `createWebRequest`, `writeWebResponse`, `sendJson`, `BodyTooLargeError` | Adaptateur `node:http` ↔ `Request`/`Response`, plafond de corps appliqué au flux même sans `Content-Length`. |

## Routes que `startService` pose

| Route | Exposition | Sens | Réponse |
|---|---|---|---|
| `GET /health` | publique | processus vivant **et** base joignable (`select 1`, borné à 2 s). **C'est la sonde Railway.** Sans pool : processus vivant. | `200 {"status":"ok"}` ou `503 {"status":"unavailable"}` ; jamais de détail sur la panne (ni hôte, ni message). Option `details` : champs **statiques** ajoutés au corps (le collector y met `service`, `edge_protocol`, `id_fp`) — jamais un secret. |
| `GET /ready` | jeton | 503 dès SIGTERM (drainage) ; sinon le verdict de `ready()` : fraîcheur, backlog. **Supervision seulement**, jamais sonde Railway : une sonde de fraîcheur bloquerait le déploiement du scheduler, dont le bail est tenu par l'ancienne instance. | `200 {"status":"ready",…}` ou `503 {"status":"draining"\|"not_ready",…}` |
| `GET /metrics` | jeton | texte Prometheus : requêtes, pool, boucles, mémoire. | `text/plain; version=0.0.4` |

**Jeton.** `/ready` et `/metrics` exigent `Authorization: Bearer <METRICS_TOKEN>`. Sans jeton configuré, sans en-tête ou avec un mauvais jeton, les deux répondent **404**, pas 401 : un 401 confirmerait que la route existe. Comparaison à temps constant. Le jeton en paramètre d'URL est refusé : il finirait dans les journaux des proxys.

Toute autre route va au `handler` (style `node:http`) ou au `fetch` (style Web) du service. Sans l'un ni l'autre (le scheduler), elle reçoit un 404.

**Signature.** Option `responseHeaders` (`{ nom: valeur }`, validée au démarrage) : posée sur **chaque** réponse du service — routes, sondes, 404, 413, 500, et jusqu'aux 400/408/431 que Node rend seul (requête illisible, en-têtes trop gros, délais). Le collector y met `x-mip-collector: 1`, pour que son relais distingue ses réponses de celles du routeur Railway. Les en-têtes de la route s'y ajoutent, ils ne la remplacent pas.

## Variables d'environnement lues par le kit

| Variable | Lue par | Défaut | Rôle |
|---|---|---|---|
| `PORT` | le service, via `COMMON_ENV` | 8080 | port d'écoute, imposé par Railway |
| `LOG_LEVEL` | `log.mjs` | `info` | seuil du journal |
| `METRICS_TOKEN` | le service, via `COMMON_ENV` (secret, ≥ 32 caractères) | aucun | jeton de `/ready` et `/metrics` ; absent : 404 |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `lifecycle.mjs` | 10 hors Railway | budget entre SIGTERM et SIGKILL. **Défaut Railway : 0**, soit SIGKILL immédiat ; le kit prévient au démarrage s'il n'est pas posé sur Railway. À poser explicitement : 15 à 30. |
| `RAILWAY_REPLICA_ID` | `log.mjs` | aucun | champ `replica` de chaque ligne |
| `SERVICE_VERSION`, sinon `RAILWAY_GIT_COMMIT_SHA` (12 premiers caractères) | `log.mjs` | aucun | champ `version` de chaque ligne |
| `RAILWAY_DEPLOYMENT_ID` | `lifecycle.mjs` | aucun | « on est sur Railway » : active l'avertissement de drainage |
| `PGSSLMODE` | `pg.mjs` | aucun | fait autorité sur la décision TLS si l'URL n'a pas de `sslmode` |

`node services/<x>/<entrée>.mjs --print-env-example` écrit la table complète du service (celles du kit comprises, s'il étale `COMMON_ENV`), tirée de son schéma.

## Rôle BDD et taille de pool

Le kit n'a pas de rôle : il ouvre le pool avec la chaîne que le service lui donne. `createPool` exige `connectionString` (**pas de repli** sur un Postgres local : c'est ce repli qui transformait un `DATABASE_URL` oublié en service « vivant » écrivant dans le vide) et `applicationName`, lisible dans `pg_stat_activity`.

| Réglage | Défaut | Pourquoi |
|---|---|---|
| `max` | 5 | Neon plafonne à `max_connections` = 112, partagé par tous les services ; chaque service fixe le sien. |
| `connectionTimeoutMillis` | 5 s | sinon `pool.connect()` attend indéfiniment une base qui ne répond pas |
| `idleTimeoutMillis` | 30 s | rend au pooler les connexions qui ne servent plus |
| `query_timeout` | 30 s | borne côté client, qui vaut aussi quand le réseau avale la réponse |
| `keepAlive` | vrai | une connexion morte derrière un NAT est détectée par le noyau |

**Aucun `SET` de session.** La production passe par le pooler Neon en mode transaction : un `SET` est perdu au backend suivant, ou laissé à la requête d'un autre. Un délai par étape se pose **dans** la transaction : `select set_config('statement_timeout', '30s', true)`.

## Arrêt propre

```
SIGTERM
  → /ready à 503 ; les réponses portent `Connection: close`
  → retrait (unreadyDelayMs, 0 par défaut : sur Railway, le trafic a déjà basculé)
  → DRAIN, en parallèle : le serveur cesse d'écouter et finit ses requêtes,
    les boucles finissent leur tour ; borné par drainTimeoutMs (budget − 3 s)
  → CLOSE, dans l'ordre inverse d'enregistrement : pool.end()
  → sortie 0
sortie forcée en 1 à forceExitMs (budget − 1 s), avant le SIGKILL de Railway
```

`startService`, `startLoop` et `createPool` s'enregistrent eux-mêmes quand on leur passe `lifecycle`. Une ressource créée **après** le début de l'arrêt (un pool ouvert pendant un `await` de démarrage) est fermée aussitôt.

`unhandledRejection` et `uncaughtException` : pile au journal, puis le même arrêt propre, en code 1. Railway (redémarrage `ALWAYS`) relance un processus sain.

## Sûreté multi-réplique

Le kit garantit l'exclusion **dans un processus** : `startLoop` n'arme la minuterie suivante qu'après la fin du tour, et `runNow()` pendant un tour rend ce tour-là. **Entre répliques**, rien ne se garantit ici : c'est au travail lui-même de tenir un bail (scheduler) ou de prendre ses lignes en `for update skip locked` (outbox), et de rester idempotent (contrat de service, point 7). Le jitter désynchronise deux répliques démarrées ensemble.

## Modes de panne

| Situation | Ce que fait le kit | Ce qu'on voit |
|---|---|---|
| configuration invalide | refus de démarrer, code 2 | une ligne `configuration invalide` qui liste tout |
| base injoignable | `/health` à 503 au plus tard 2,5 s après la sonde ; le processus vit | `santé dégradée`, une fois, puis `santé rétablie` |
| client inactif coupé (pooler, `pg_terminate_backend`) | le pool le remplace à la demande | `pg : connexion inactive perdue`, `pg_pool_errors_total` |
| client **emprunté** coupé (transaction en cours, attente réseau) | la requête en cours échoue, le client est écarté à sa restitution ; le processus vit | `pg : connexion empruntée coupée`, `pg_pool_errors_total` |
| en-têtes trop lents (slowloris) | 408 et fermeture à `headersTimeout` (10 s) | rien au journal d'accès : la requête n'a jamais existé |
| corps qui n'arrive pas | 408 et fermeture à `requestTimeout` (30 s) | idem |
| corps trop gros | 413 et `Connection: close`, avant d'appeler le gestionnaire si `Content-Length` le dit, au premier octet de trop sinon | `status: 413` au journal d'accès |
| gestionnaire qui lève | 500 `{error, request_id}` au client, pile au journal | `requête en échec` avec `request_id` |
| tour de boucle qui lève | tour suivant à l'heure | `tour de boucle en échec`, `loop_runs_total{result="error"}` |
| drainage plus long que prévu | abandon au délai, connexions coupées, fermeture quand même | `drainage incomplet` |
| fermeture qui pend | sortie forcée en 1 | `sortie forcée` |

## Câblage type

```js
// services/<x>/server.mjs — câblage seul
import pg from "pg";
import { COMMON_ENV, defineConfig } from "@mip/service-kit/config.mjs";
import { createLogger } from "@mip/service-kit/log.mjs";
import { installLifecycle } from "@mip/service-kit/lifecycle.mjs";
import { createPool } from "@mip/service-kit/pg.mjs";
import { createMetrics } from "@mip/service-kit/metrics.mjs";
import { startService } from "@mip/service-kit/http.mjs";
import { startLoop } from "@mip/service-kit/loop.mjs";

const log = createLogger("collector");
const lifecycle = installLifecycle({ log }); // AVANT tout await
const config = defineConfig(
  { ...COMMON_ENV, DATABASE_URL: { type: "url", required: true, secret: true, protocols: ["postgres:", "postgresql:"] } },
  { service: "collector", log },
);
const metrics = createMetrics();
const pool = createPool(pg, { connectionString: config.DATABASE_URL, applicationName: "mip-collector", max: 8, log, metrics, lifecycle });

startLoop({ name: "drain", intervalMs: 250, keepAlive: false, log, metrics, lifecycle, run: () => drainer(pool) });
startService({
  name: "collector", port: config.PORT, log, pool, metrics, metricsToken: config.METRICS_TOKEN, lifecycle,
  maxBodyBytes: (req) => (req.url?.startsWith("/v1/sourcemaps") ? 16 * 1024 * 1024 : 1024 * 1024),
  handler, // ou `fetch: (request) => Response`
});
```

## Qui l'utilise

- `@mip/backend/shared/log.mjs` **réexporte** `createLogger` et `LOG_LEVELS` du kit : tous les services, le noyau, le migrateur et la console écrivent déjà avec ce journal. Rien n'a changé pour eux, sinon ce qu'il ajoute (version, réplique, contexte, pile complète) et ce qu'il retire (adresses IP, e-mails).
- `@mip/backend/lib/serveur.mjs` **réexporte** `optionsSsl` : une seule décision TLS pour tout le dépôt.
- `services/scheduler/worker.mjs` est le premier service câblé de bout en bout : `installLifecycle` (avant tout le reste), `defineConfig`, `createPool`, trois `startLoop` sur la grille de l'horloge (`nextDelay`) et `startService` sans route, `/ready` rendant la fraîcheur des cadences (P1, « scheduler sur le kit »). `run-once.mjs` prend son pool au kit. Les autres services suivent.

## Tests

```bash
pnpm exec vitest run tests/unit/service-kit-*.test.ts
```

Huit fichiers, un par module : `config` (toutes les erreurs listées, expurgation, gabarit), `log` (identité, pile, expurgation, contexte, relais du noyau), `http` (sondes, 404 sans jeton, 413, délais serveur sur socket brute, journal d'accès sans IP, SIGTERM de bout en bout), `lifecycle` (ordre des étapes, délai de drainage, sortie forcée, gardes), `pg` (`on('error')`, options, aucun SET, `ping` borné), `loop` (pas de chevauchement, arrêt, jitter), `web` (aller-retour, plafond sans `Content-Length`, abandon client) et `metrics`.
