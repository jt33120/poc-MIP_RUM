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

L'instrumentation `pg` se branche via un hook `require` (agent **sans dépendance** :
il n'importe jamais `pg`). Aucune donnée de corps, ni query string, ni en-tête, ni
valeur SQL n'est collectée. Prochaine étape : `mysql`/`mysql2`, puis `http.client`
sortant.

## Garanties

- **Zéro dépendance** runtime (uniquement `node:*` + `fetch`, Node ≥ 18).
- **Best-effort** : l'émission est asynchrone et hors chemin critique ; une erreur
  réseau ne casse jamais l'application instrumentée.
- **Souverain** : même format OTLP/HTTP JSON que le reste de MIP, backend
  remplaçable, aucune donnée hors UE.
