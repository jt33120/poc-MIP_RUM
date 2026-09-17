# @mip/agent-node — agent MIP RUM zéro-config (backends Node.js)

Auto-instrumente les requêtes HTTP **serveur** d'une application Node.js **sans
changement de code** : un span `http.server` par requête est émis en OTLP vers
MIP, corrélé au span front du navigateur (W3C `traceparent`). Il alimente
directement le waterfall « cause backend » de la console.

C'est le premier étage de l'**agent** (Pilier 1) : zéro ligne à écrire, on
précharge le module au démarrage.

## Installation

```bash
node -r @mip/agent-node/register app.js
# ou, sans toucher à la ligne de commande :
NODE_OPTIONS="-r @mip/agent-node/register" node app.js
```

Fonctionne tel quel avec Express, Fastify, Koa, Next (serveur custom), ou tout
serveur bâti sur `http`/`https` — l'agent patche `http.Server`, pas le framework.

## Configuration (variables d'environnement)

| Variable | Requis | Défaut | Rôle |
| --- | --- | --- | --- |
| `MIP_RUM_ENDPOINT` | ✅ | — | endpoint OTLP, ex. `https://<ingest>/v1/traces` |
| `MIP_RUM_APP_ID` | ✅ | — | identifiant d'application |
| `MIP_RUM_API_KEY` | — | — | clé d'API (attribut resource `mip.api_key`) |
| `MIP_RUM_ENV` | — | `prod` | environnement (`deployment.environment.name`) |
| `MIP_RUM_SERVICE` | — | `backend` | `service.name` |
| `MIP_RUM_FLUSH_MS` | — | `3000` | intervalle d'envoi par lot |
| `MIP_RUM_DEBUG` | — | — | log si l'agent est désactivé (config absente) |
| `MIP_RUM_LOGS` | — | `true` | pont de journalisation ; `false` pour le couper |
| `MIP_RUM_LOG_LEVEL` | — | `warn` | plancher émis : `trace`/`debug`/`info`/`warn`/`error`/`fatal` |
| `MIP_RUM_LOGS_ENDPOINT` | — | dérivé | forcer l'endpoint logs (sinon `v1-traces` → `v1-logs`) |

Sans `MIP_RUM_ENDPOINT` **et** `MIP_RUM_APP_ID`, l'agent est **inactif** (aucun
patch, aucun surcoût).

## Ce qu'il capte (v0.1)

- **`http.server`** : méthode, route templatée (`/users/:id`), statut, durée,
  propagation `traceparent` (corrélation front → back) et session via `tracestate`.
- **Requêtes DB `pg`** (node-postgres) : un span **enfant** par requête SQL,
  rattaché au `http.server` de la requête courante (contexte `AsyncLocalStorage`)
  — pour un waterfall **front → serveur → requête DB**. `db.statement` est
  **normalisé** (littéraux chaîne/nombres → `?`) : cardinalité bornée et **aucune
  valeur (PII) exfiltrée**. Couvre aussi `Pool` (qui délègue à un `Client`).

- **Journaux applicatifs** (signal LOGS) : `console.*` est capté et exporté en
  OTLP vers `/v1/logs`, **avec le contexte de la requête courante injecté** —
  `trace_id`, `span_id`, session et route. C'est là tout l'intérêt de faire le
  pont dans l'agent : ce contexte est déjà dans l'`AsyncLocalStorage`, donc la
  corrélation **log → trace → session** est automatique et l'application ne
  change pas une ligne.

- **Exceptions** (P5.3) : une exception levée par un gestionnaire de requête, une exception
  non interceptée du processus, ou une `Error` passée à `console.error` part **avec sa stack**.
  Celle d'une requête devient un événement `exception` de son span `http.server` (statut OTLP
  ERROR, `error.type`) ; hors requête, un log d'exception. La même `Error` journalisée puis
  relancée garde le même `mip.exception_id` : l'ingestion n'en écrit qu'une occurrence. Un
  `console.error("texte")` reste un simple log.

L'instrumentation `pg` se branche via un hook `require` (agent **sans dépendance** :
il n'importe jamais `pg`). Aucune donnée de corps, ni query string, ni en-tête, ni
valeur SQL n'est collectée. Prochaine étape : `mysql`/`mysql2`, puis `http.client`
sortant.

### Le pont de journalisation en pratique

```
GET /api/checkout  ──►  span http.server  ─┬─►  span DB (pg)
                                            └─►  console.error("paiement refusé")
                                                 └─► rum_log, MÊME trace_id
```

Depuis une session ralentie dans la console, on descend donc jusqu'à la ligne de
journal exacte de la requête fautive — sans chercher dans un agrégateur tiers.

**Plancher `warn` par défaut**, délibérément : un agent de supervision ne doit pas
doubler le volume de journaux d'une application sans qu'on l'ait demandé. Passer à
`MIP_RUM_LOG_LEVEL=info` élargit ; `MIP_RUM_LOGS=false` coupe net.

Trois garanties de non-régression : la `console` d'origine est **toujours appelée
en premier** (si le pont casse, les logs sortent quand même) ; une garde de
ré-entrance empêche nos propres écritures de s'auto-alimenter ; l'envoi est
asynchrone et par lots, hors chemin critique.

### Exceptions : ce que l'agent ne change pas

L'agent **observe** sans rien décider. Il n'installe **aucun** handler `uncaughtException` ni
`unhandledRejection` — en poser un transformerait un crash en processus survivant — et lit les
exceptions fatales par `uncaughtExceptionMonitor`. L'exception d'un gestionnaire de requête
n'est ni rattrapée ni relancée : le processus se termine avec le **même code de sortie** et le
**même message** que sans l'agent (prouvé en sous-processus, `tests/unit/agent-node-process.test.ts`).

**Best-effort assumé** : une fermeture fatale ne laisse pas le temps d'un dernier envoi réseau.
Le lot est tenté, rien ne garantit qu'il parte ; un tampon durable relève d'un lot ultérieur.
Une exception rattrapée par un handler applicatif part avec le span de sa requête dès que la
connexion se ferme, sans statut HTTP inventé si aucune réponse n'est partie.

## Garanties

- **Zéro dépendance** runtime (uniquement `node:*` + `fetch`, Node ≥ 18).
- **Best-effort** : l'émission est asynchrone et hors chemin critique ; une erreur
  réseau ne casse jamais l'application instrumentée.
- **Souverain** : même format OTLP/HTTP JSON que le reste de MIP, backend
  remplaçable, aucune donnée hors UE.
