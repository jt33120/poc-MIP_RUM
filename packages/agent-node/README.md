# @mip/agent-node — agent MIP RUM (backends Node.js)

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
| `MIP_RUM_MAX_QUEUE` | — | `1000` | plafond de chaque file mémoire (spans, logs) |
| `MIP_RUM_SHUTDOWN_MS` | — | `2000` | budget d'un flush d'arrêt (SIGTERM, `shutdown()`) |

Sans `MIP_RUM_ENDPOINT` **et** `MIP_RUM_APP_ID`, l'agent est **inactif** (aucun
patch, aucun surcoût).

Une variable **absente ou vide** garde le défaut ; `0` ne vaut que s'il est
réellement écrit (`MIP_RUM_FLUSH_MS=0` supprime le timer périodique).

## API publique

L'agent s'utilise sans écrire une ligne (préchargement). Quand l'application
veut déclarer ce que l'instrumentation ne peut pas deviner — un événement
métier, une exception rattrapée, l'utilisateur d'une requête —, elle importe
l'API :

```js
import { init, track, captureException, withContext, flush } from "@mip/agent-node";
```

Elle **n'instrumente rien de plus** : `init()` installe le même runtime que le
préchargement, et les deux se rejoignent sur un symbole global. Précharger
l'agent **et** importer l'API ne pose donc pas deux patches de `console`/`http`/
`pg`, ni deux contextes de requête, ni deux files d'envoi.

| Fonction | Rôle |
| --- | --- |
| `init(options?)` | configuration initiale (mêmes clés que l'environnement) et installation ; appelable plusieurs fois |
| `track(name, props?)` | événement métier → `rum_event` (`false` si rien n'est parti) |
| `captureException(error, context?)` | exception rattrapée, au contrat P5.3, avec sa stack |
| `withContext(context, fn)` | scope de requête isolé, `fn` synchrone ou `async` |
| `getContext()` | contexte de la requête courante, ou `null` |
| `setGlobalContext(attrs)` / `clearGlobalContext()` | attributs de **service** stables |
| `flush({ timeoutMs })` | vide les files sous un budget ; `true` si tout est parti |
| `shutdown({ timeoutMs })` | coupe le timer, retire les crochets MIP, vide les files |
| `getDiagnostics()` | files, pertes, échecs d'envoi |

Aucune ne lève dans l'application hôte : elles renvoient `false` quand rien n'a
été émis.

```js
app.post("/commandes", async (req, res) => {
  await withContext({ userId: req.user.id, attributes: { canal: "web" } }, async () => {
    try {
      const commande = await creer(req.body);
      track("commande_validee", { montant: commande.montant });
      res.json(commande);
    } catch (erreur) {
      captureException(erreur, { moyen: req.body.moyen });
      res.status(402).end();
    }
  });
});
```

### Contexte de requête (`AsyncLocalStorage`)

`withContext` ouvre un scope isolé : deux requêtes concurrentes ne partagent
jamais leur contexte, et le scope précédent est restauré même quand `fn` lève ou
que sa promesse est rejetée. Un scope imbriqué **hérite** du parent ; ce qu'il
déclare remonte à la requête, parce que c'est le span de la requête qui le
portera.

Valeurs reconnues : `traceparent` (validé — un en-tête malformé ne rattache
rien), `traceId`/`parentSpanId`, `sessionId`, `route`, `userId`, `accountId` et
`attributes` (contexte métier libre : chaînes, nombres, booléens et `null`, qui
reste « inconnu » et ne devient jamais `0`).

`setGlobalContext` décrit le **service**, pas une requête : il **refuse en bloc**
toute clé qui varie d'un appel à l'autre (`user*`, `account*`, `client*`,
`session*`, `order*`, `email`, `ip`…). Un identifiant posé là serait attribué à
toutes les requêtes suivantes, y compris celles d'autres personnes.

Les identités métier partent **brutes** (`mip.identity.user_id`) : leur HMAC
app-scopé est calculé au port d'ingestion. Aucun secret de hachage ne vit dans
l'agent.

### Ce que `track` écrit — et ce qu'il ne revendique pas

Un événement backend devient une ligne `rum_event` avec **`session_id` NULL** :
le front reste seul maître de `rum_session`, exactement comme pour le span
`http.server`. Le lien vers la session d'un utilisateur passe par la **trace**
du span parent, qui la porte — pas par une session revendiquée depuis le
serveur. Un émetteur backend qui en revendiquerait une écrirait une ligne de
session incomplète, et ferait échouer tout le lot si elle n'existait pas encore.

### Déduplication des exceptions

`mip.exception_id` est attaché à l'objet `Error` lui-même. La même `Error`
capturée à la main, journalisée par `console.error`, puis relancée, garde le même
identifiant : l'ingestion n'écrit **qu'une** erreur. Deux `Error` distinctes qui
décrivent le même incident n'ont, elles, aucun identifiant commun — elles restent
deux erreurs, à dessein : on ne devine pas une égalité.

Une exception **capturée puis traitée** (`handled: true`) ne fait pas échouer la
requête : la réponse est partie normalement, le span garde son statut, et
l'erreur est tout de même remontée par son événement.

Hors requête, `captureException` passe par le **log d'exception** — la seule
route ouverte pour une erreur sans span porteur. Le plancher
`MIP_RUM_LOG_LEVEL` ne s'y applique pas (il règle la verbosité de `console.*`,
pas le suivi d'erreurs), mais couper le pont avec `MIP_RUM_LOGS=false` ferme
cette route : l'appel renvoie alors `false`.

### Arrêt et files

Les deux files (spans, logs) sont **bornées** (`MIP_RUM_MAX_QUEUE`) : au
plafond, le plus ancien part et se compte dans `getDiagnostics().droppedSpans`.
Un collecteur injoignable ne fait donc pas grossir la mémoire de l'application.

Chaque envoi porte un `AbortSignal` : il n'existe **aucune attente indéfinie**.
Le timer périodique est `unref` — il ne retient jamais le processus.

Sur `SIGTERM`, l'agent vide ses files sous `MIP_RUM_SHUTDOWN_MS` puis **rend la
terminaison par défaut** de Node, qu'un écouteur de signal supprime. Si
l'application gère elle-même `SIGTERM`, l'agent se contente de vider ses files :
c'est elle qui décide de la fin du processus.

### Attributs de logs

Le pont de journalisation joint à chaque log le contexte de sa requête
(`trace_id`, `span_id`, session, route) et, depuis P7.4, les attributs du scope
(`mip.context`) et l'identité métier brute. L'ingestion les scrube puis les
conserve dans `rum_log.attributes`.

**Limite assumée** : la page `/logs` de la console filtre par sévérité et
n'expose ni recherche plein texte ni facette d'attribut. Les attributs sont donc
*collectés et interrogeables en SQL*, pas *exploitables à l'écran*. Ouvrir cette
surface est une décision produit (cf. `docs/context/produit-logs.md`), pas un
effet de bord d'un SDK.

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
  ERROR, `error.type`) ; hors requête, un log d'exception, tant que le pont de journalisation
  est actif (`MIP_RUM_LOGS`) et que `MIP_RUM_LOG_LEVEL` le laisse passer. La même `Error`
  journalisée puis relancée garde le même `mip.exception_id` : l'ingestion n'en écrit qu'une
  occurrence. Un `console.error("texte")` reste un simple log.

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
