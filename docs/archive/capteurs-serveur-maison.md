# Capteurs serveur maison — archivés le 29/09/2026

Jusqu'au 29/09/2026, le dépôt livrait deux capteurs **côté serveur** écrits par
MIP. Ils en sont retirés ; ils restent lisibles dans l'historique git, sous le
tag `archive/capteurs-serveur-maison` (posé sur `448d92b8`, le dernier commit de
`master` qui les contient).

## Ce qu'ils étaient

| Capteur | Chemin au tag | Ce qu'il faisait |
| --- | --- | --- |
| Middleware FastAPI | `examples/integrations/fastapi/` (`mip_rum_middleware.py`, `test_mip_rum_middleware.py`, `README.md`) | Un fichier Python à copier dans le backend (bibliothèque standard seule), posé par `app.add_middleware(MIPRumMiddleware)` : un span `http.server` par requête (route template, méthode, statut, durée, `traceparent` / `tracestate: mip=s:<session>` du SDK web), les exceptions non gérées en événement `exception` du span, et une API de contexte (`rum_context`, `capture_exception`, `current_context`). Testé en CI par `unittest`. |
| Agent Node | `packages/agent-node/` (`@mip/agent-node` 0.2.0, privé, jamais publié) | Préchargé par `node -r @mip/agent-node/register` : span `http.server` sur `http.Server`, span enfant par requête `pg`, pont de journalisation `console.*` vers les logs OTLP, exceptions avec leur stack ; plus une API publique (`init`, `track`, `captureException`, `withContext`, `flush`, `shutdown`, `getDiagnostics`). Sans dépendance. |

Les deux émettaient de l'OTLP/HTTP JSON avec des attributs `mip.*` (`mip.route`,
`mip.context`, `mip.exception_id`, `mip.event_name`…). Le middleware FastAPI a
connu plusieurs versions : la 0.6.0 ajoutait la capture d'exceptions et le
contexte, la 0.7.0 la route fixe `(non trouvée)` pour un 404/405 qu'aucune route
n'a servi.

## Pourquoi ils sont archivés

Décision du propriétaire du produit, le 29/09/2026 : **côté serveur, plus aucun
capteur maison.** Le client installe l'agent OpenTelemetry **officiel** de son
langage ; MIP accueille le flux OTLP qu'il émet. Les agents officiels couvrent
plus de frameworks et de bibliothèques que ces deux capteurs n'en couvraient, ils
sont maintenus par la communauté OpenTelemetry, et l'ingestion les accepte déjà :
les agents officiels Python, Java et .NET ont écrit en production le 28/09/2026
(`docs/RUM_PARITY_STATUS.md`, ligne A4). Garder deux capteurs de plus, c'était
maintenir, tester et documenter une seconde façon de faire la même chose.

Remplaçants :

- **Node** : `@opentelemetry/auto-instrumentations-node`, préchargé par
  `node --require @opentelemetry/auto-instrumentations-node/register app.js`.
- **Python / FastAPI** : `opentelemetry-instrument` (paquet
  `opentelemetry-distro`, avec l'instrumentation FastAPI), exportateur
  `http/protobuf`.

La configuration commune (endpoint, `OTEL_RESOURCE_ATTRIBUTES` avec
`mip.app_id`) est dans `docs/INTEGRATION.md`, § 10 « Backends : les agents
OpenTelemetry officiels ».

Ce que faisaient les API maison se fait par l'API OpenTelemetry standard : une
exception rattrapée s'enregistre sur le span courant (`recordException` en
JavaScript, `record_exception` en Python) ; un événement métier est un span qui
porte `mip.event_type = "custom"`, `mip.event_name` et `mip.props` (JSON), les
attributs que posait `track` — l'ingestion en fait une ligne `rum_event` sans
session inventée (`tests/integration/evenement-metier-backend-sql.test.ts`).

## Ce que l'archivage ne change pas

L'**ingestion** continue d'accepter ce que ces capteurs émettent : des copies
déployées peuvent encore tourner. `packages/backend/shared/otlp.mjs` reconnaît
toujours le scope `@mip/agent-node` (source d'erreur `node`) et les attributs du
middleware FastAPI (`mip.route`, `http.status_code`…) ; la règle `(non trouvée)`
s'applique aussi aux versions du middleware antérieures à la 0.7.0
(`tests/unit/route-non-trouvee.test.ts`).

## Ce qui reste à faire

**UTI** tourne encore une copie **0.4.0** du middleware FastAPI, et son module
`mip_rum_ai.py` importe ce middleware. Cette version précède la capture
d'exceptions (0.6.0) et la route `(non trouvée)` (0.7.0 ; l'ingestion compense
la seconde). À migrer vers l'agent OpenTelemetry officiel pour Python : retirer
`app.add_middleware(MIPRumMiddleware)`, lancer l'application sous
`opentelemetry-instrument`, et remplacer ce que `mip_rum_ai.py` importe du
middleware par l'API OpenTelemetry (voir plus haut). Jusque-là, ses spans
continuent d'arriver.

## Les retrouver

Le tag n'existe que si on l'a récupéré :

```sh
git fetch origin tag archive/capteurs-serveur-maison
```

Lister, lire, ou reconstituer l'arbre complet :

```sh
git ls-tree -r --name-only archive/capteurs-serveur-maison -- examples/integrations/fastapi packages/agent-node
git show archive/capteurs-serveur-maison:examples/integrations/fastapi/mip_rum_middleware.py
git show archive/capteurs-serveur-maison:packages/agent-node/README.md
git show archive/capteurs-serveur-maison:packages/agent-node/src/core.ts
git worktree add ../mip-rum-archive archive/capteurs-serveur-maison   # l'arbre du 29/09/2026, tests compris
```

Les tests partis avec eux sont au même tag :

| Test | Ce qu'il prouvait |
| --- | --- |
| `examples/integrations/fastapi/test_mip_rum_middleware.py` | Le middleware : passthrough sans configuration, isolation du contexte sur requêtes concurrentes, exceptions, route `(non trouvée)` |
| `tests/unit/agent-node.test.ts` | Les constructeurs de spans de l'agent Node (`core.ts`) |
| `tests/unit/agent-node-api.test.ts` | L'API publique de l'agent contre de vraies requêtes HTTP (contexte, `pg`, déduplication des exceptions) |
| `tests/unit/agent-node-process.test.ts` | L'agent dans de vrais processus : un crash reste un crash, même code de sortie |
| `tests/unit/agent-log-bridge.test.ts` | Le pont de journalisation `console.*` de l'agent |
| `tests/unit/integrations-publiques.test.ts` | La copie du middleware servie par la console égale celle que la CI testait |

Le test SQL de l'événement métier backend, lui, n'est pas parti : il s'appelait
`tests/integration/agent-node-backend-events-sql.test.ts` et produisait son lot
avec l'agent maison ; il s'appelle désormais
`tests/integration/evenement-metier-backend-sql.test.ts` et le produit avec le
SDK OpenTelemetry officiel.
