# Capteurs serveur : les agents OpenTelemetry officiels

Au 29/09/2026. Côté serveur, MIP ne fournit **aucun capteur maison** : le client lance
son service sous l'agent OpenTelemetry **officiel** de son langage (projet open source
de la CNCF), et MIP reçoit le flux OTLP. Les anciens capteurs maison (agent Node,
middlewares FastAPI et Express) sont archivés (`docs/archive/capteurs-serveur-maison.md`).
Le même contenu, en tableau : [`capteurs-serveur.csv`](capteurs-serveur.csv).

Ce que ça apporte : chaque requête du serveur devient un span rattaché à l'appel du
navigateur qui l'a déclenchée (le SDK web envoie `traceparent` et
`tracestate: mip=s:<session>`, que les agents officiels propagent), les appels SQL et
HTTP sortants deviennent des spans enfants, les exceptions deviennent des erreurs.
Sans agent serveur, la mesure côté navigateur marche seule ; il manque seulement la
partie serveur de chaque appel.

## 1. Le socle commun (tous langages)

Des variables d'environnement standard, rien dans le code :

```sh
OTEL_SERVICE_NAME=commandes-api                    # le « service » affiché par la console
OTEL_RESOURCE_ATTRIBUTES="mip.app_id=<app_id>,deployment.environment.name=prod"
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_COMPRESSION=gzip
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://mip-rum-console.vercel.app/api/ingest/v1/traces
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=https://mip-rum-console.vercel.app/api/ingest/v1/logs
OTEL_METRICS_EXPORTER=none
```

- **`mip.app_id`** est obligatoire : un lot sans lui est rejeté. C'est l'identifiant de
  l'application créée dans la console (`docs/INTEGRATION.md` § 1). La clé du projet
  s'ajoute à la même variable, sous l'attribut `mip.api_key` ; tant que la collecte
  n'exige pas de clé (`REQUIRE_API_KEY=false` en production au 29/09/2026), on peut
  l'omettre.
- **`deployment.environment.name`** (ou l'ancien `deployment.environment`) devient
  l'environnement affiché ; **`service.name`** devient le service.
- **Un endpoint par signal**, pas `OTEL_EXPORTER_OTLP_ENDPOINT` : MIP n'a pas de route
  `/v1/metrics`, d'où aussi `OTEL_METRICS_EXPORTER=none`.
- **Formats acceptés** : OTLP/HTTP en protobuf (`application/x-protobuf`) ou en JSON,
  compressé en gzip (ou deflate) ou non. Pas de gRPC. Autre type de contenu : 415.
- **Limites** : 2 Mo par requête (413 au-delà, compressé ou non) ; 600 requêtes par
  minute et par application (429 avec `retry-after: 60`) ; une application désactivée
  ou suspendue est refusée en 403.
- **Propagation** : W3C `tracecontext`, le défaut de tous les agents officiels. Si
  l'API est sur une autre origine que la page, déclarer cette origine dans l'option
  `trace` du SDK web et autoriser les en-têtes `traceparent` et `tracestate` dans le
  CORS de l'API.

## 2. Par langage

| Langage | État chez MIP | Agent officiel | Installer | Lancer | Doc officielle |
|---|---|---|---|---|---|
| Python (Flask) | éprouvé en production le 28/09/2026 | `opentelemetry-instrument` (distro 0.66b0, SDK 1.45.0 éprouvés) | `pip install opentelemetry-distro opentelemetry-exporter-otlp-proto-http` puis `opentelemetry-bootstrap -a install` | `opentelemetry-instrument flask --app app run` | https://opentelemetry.io/docs/zero-code/python/ |
| Python (FastAPI) | <!-- preuve-fastapi --> à éprouver | `opentelemetry-instrument` | idem (le `bootstrap` ajoute l'instrumentation FastAPI) | `opentelemetry-instrument uvicorn main:app` | https://opentelemetry.io/docs/zero-code/python/ |
| Node | éprouvé en test automatique seulement | `@opentelemetry/auto-instrumentations-node` | `npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node` | `node --require @opentelemetry/auto-instrumentations-node/register app.js` | https://opentelemetry.io/docs/zero-code/js/ |
| Java | éprouvé en production le 28/09/2026 | `opentelemetry-javaagent` (2.31.1 éprouvé) | télécharger `opentelemetry-javaagent.jar` (versions publiées sur GitHub) | `java -javaagent:opentelemetry-javaagent.jar -jar app.jar` | https://opentelemetry.io/docs/zero-code/java/agent/ |
| .NET | éprouvé en production le 28/09/2026 | instrumentation automatique .NET (1.17.0 éprouvée) | script `otel-dotnet-auto-install.sh` (versions publiées sur GitHub) | `. $HOME/.otel-dotnet-auto/instrument.sh` puis `dotnet app.dll` | https://opentelemetry.io/docs/zero-code/dotnet/ |
| Go | non éprouvé | SDK Go + bibliothèques d'instrumentation (pas d'agent à greffer) | `go get go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` | dans le code : un `TracerProvider` et `otelhttp.NewHandler` | https://opentelemetry.io/docs/languages/go/ |
| PHP | non éprouvé | extension `opentelemetry` + paquets Composer | `pecl install opentelemetry` ; `composer require open-telemetry/sdk open-telemetry/exporter-otlp` + le paquet `open-telemetry/opentelemetry-auto-<framework>` | `OTEL_PHP_AUTOLOAD_ENABLED=true` et le socle ; PHP 8.0 au moins | https://opentelemetry.io/docs/zero-code/php/ |
| Ruby | non éprouvé | gems OpenTelemetry (pas d'agent sans code) | `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, `opentelemetry-instrumentation-all` dans le `Gemfile` | un initialiseur : `OpenTelemetry::SDK.configure { \|c\| c.use_all }` | https://opentelemetry.io/docs/languages/ruby/getting-started/ |

« Éprouvé en production le 28/09/2026 » (PR #342) : un vrai serveur, configuré par le
seul socle ci-dessus, a envoyé traces, journaux et erreurs à la collecte de production,
et la console les a montrés (routes serveur dans le tracing, groupes d'erreurs, cascade
serveur → SQL ou sous-appel HTTP, session retrouvée par le `tracestate`). « En test
automatique » : les exportateurs officiels Node vers le collector et une vraie base
(`tests/integration/otlp-protobuf-agent-sql.test.ts`), pas un service en production.

## 3. Pièges connus, par langage

- **Python.** Le protocole par défaut est gRPC : `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
  est obligatoire, et `opentelemetry-exporter-otlp-proto-http` suffit (pas besoin du
  paquet gRPC). Les journaux sont partis sans autre variable en 1.45.0. Sous
  `opentelemetry-instrument`, un échec d'export ne s'affiche **pas** tant que
  l'application n'a pas de gestionnaire `logging` (par exemple `logging.basicConfig()`).
- **Java.** L'agent ne démarre pas sous le lanceur de fichier source (`java Serveur.java`) :
  compiler, puis lancer la classe ou le `.jar` avec `-javaagent`. Vérifier l'empreinte
  SHA-256 du `.jar` avec celle que publie GitHub.
- **.NET.** Le script d'installation 1.17.0 exige la CLI `gh` pour vérifier la version
  (sinon `SKIP_RELEASE_VERIFICATION=true`). Poser `OTEL_DOTNET_AUTO_LOG_DIRECTORY` vers
  un dossier accessible en écriture : sans lui, le service s'arrête au démarrage hors de
  `/var/log` (constaté sous macOS, où il faut aussi `greadlink`, des coreutils). Un
  envoi réussi se lit dans le journal de l'agent : `Export succeeded for …/v1/traces`.
- **Node.** Pas d'agent maison : l'ancien `packages/agent-node` est archivé. Seuls les
  exportateurs officiels ont été éprouvés, en local.
- **Go.** Pas d'agent qui se greffe au processus comme en Java ou .NET : l'instrumentation
  s'écrit dans le code. Le protocole se choisit par le paquet importé (`otlptracehttp`),
  jamais gRPC. L'instrumentation Go sans code (eBPF, compilation) est un projet en cours,
  non éprouvé ici.
- **PHP, Ruby.** Non éprouvés : suivre la doc officielle avec le socle ci-dessus.

## 4. Ce que la console en fait

- **Routes.** La route vient de `http.route` et se ramène à la forme `:nom` quel que soit
  le framework : `<int:commande_id>` (Flask, Django) et `{id:int}` (ASP.NET Core)
  deviennent `:commande_id` et `:id`. Un serveur sans modèle de route
  (`com.sun.net.httpserver` en Java) ne donne que son contexte. Un 404 ou un 405 sans
  route résolue prend la route fixe `(non trouvée)`, jamais le chemin brut.
- **Exceptions.** Une exception publiée à la fois par le span et par un journal ne compte
  qu'une fois. Deux cas comptent encore double : un span enfant et son parent envoyés
  dans deux lots, un journal émis dans un span enfant pour l'exception de son parent.
- **Session.** Une exception serveur n'invente pas de session : elle se rattache à celle
  du navigateur par le `tracestate`, ou reste sans session.

## 5. Vérifier

1. Lancer le service sous l'agent, puis appeler une de ses routes depuis une page qui
   porte le SDK web (ou avec `curl`).
2. Console → **Tracing** : la route du service apparaît, avec son `service.name`.
3. Une exception volontaire → **Erreurs** : un groupe avec le service et l'environnement.
4. Rien n'arrive : lire le journal de l'agent (échec d'export, statut HTTP) et le
   dépannage de `docs/INTEGRATION.md` § 5.
