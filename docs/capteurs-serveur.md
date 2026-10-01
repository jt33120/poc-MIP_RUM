# Capteurs serveur : les agents OpenTelemetry officiels

Au 01/10/2026. Côté serveur, MIP ne fournit **aucun capteur maison** : le client lance
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

- **`mip.app_id`** est obligatoire : un lot sans lui est accepté (200) puis ignoré. C'est
  l'identifiant de l'application créée dans la console (`docs/INTEGRATION.md` § 1). La clé
  du projet s'ajoute sous l'attribut `mip.api_key` : elle est **exigée** depuis le
  29/09/2026 (`REQUIRE_API_KEY: "true"`, `.railway/railway.ts`) ; un lot sans clé ou avec
  une clé fausse est refusé en 403. Les preuves en production du § 2, antérieures, s'en sont passées.
- **`deployment.environment.name`** (ou l'ancien `deployment.environment`) devient
  l'environnement affiché ; **`service.name`** devient le service.
- **Un endpoint par signal** (URL complète, prise telle quelle). MIP n'a pas de route
  `/v1/metrics` : `OTEL_METRICS_EXPORTER=none`, sinon l'agent journalise des échecs.
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
| Python (FastAPI) | éprouvé en production le 29/09/2026 | `opentelemetry-instrument` (distro 0.66b0, SDK 1.45.0, `opentelemetry-instrumentation-fastapi` 0.66b0 ; FastAPI 0.141.1, uvicorn 0.54.0, Python 3.13) | idem (le `bootstrap` ajoute l'instrumentation FastAPI) | `opentelemetry-instrument uvicorn main:app` | https://opentelemetry.io/docs/zero-code/python/ |
| Node | éprouvé en production (traces) le 29/09/2026 | `@opentelemetry/auto-instrumentations-node` (0.80.0 éprouvé, sous Express 5.2.1) | `npm install @opentelemetry/api @opentelemetry/auto-instrumentations-node` | `node --require @opentelemetry/auto-instrumentations-node/register app.js` | https://opentelemetry.io/docs/zero-code/js/ |
| Java | éprouvé en production le 28/09/2026 | `opentelemetry-javaagent` (2.31.1 éprouvé) | télécharger `opentelemetry-javaagent.jar` (versions publiées sur GitHub) | `java -javaagent:opentelemetry-javaagent.jar -jar app.jar` | https://opentelemetry.io/docs/zero-code/java/agent/ |
| .NET | éprouvé en production le 28/09/2026 | instrumentation automatique .NET (1.17.0 éprouvée) | script `otel-dotnet-auto-install.sh` (versions publiées sur GitHub) | `. $HOME/.otel-dotnet-auto/instrument.sh` puis `dotnet app.dll` | https://opentelemetry.io/docs/zero-code/dotnet/ |
| Go | éprouvé en local le 01/10/2026 | SDK Go + bibliothèques d'instrumentation, pas d'agent à greffer (SDK et `otlptracehttp` 1.46.0, `otelhttp` 0.71.0, Go 1.27.1 éprouvés) | `go get go.opentelemetry.io/otel/sdk go.opentelemetry.io/otel/exporters/otlp/otlptrace/otlptracehttp go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp` | dans le code : un `TracerProvider`, le propagateur `propagation.TraceContext{}` et `otelhttp.NewHandler` | https://opentelemetry.io/docs/languages/go/ |
| PHP | éprouvé en local le 01/10/2026 | extension `opentelemetry` + paquets Composer (extension 1.4.2, `open-telemetry/sdk` 1.15.0, `exporter-otlp` 1.4.0, `opentelemetry-auto-slim` 1.5.0, `opentelemetry-auto-pdo` 0.5.0 ; Slim 4.15.3, PHP 8.4.26 éprouvés) | `pecl install opentelemetry` ; `composer require open-telemetry/sdk open-telemetry/exporter-otlp` + le paquet `open-telemetry/opentelemetry-auto-<framework>` | `OTEL_PHP_AUTOLOAD_ENABLED=true` et le socle ; PHP 8.0 au moins | https://opentelemetry.io/docs/zero-code/php/ |
| Ruby | éprouvé en local le 01/10/2026 | gems OpenTelemetry, pas d'agent sans code (`opentelemetry-sdk` 1.13.1, `opentelemetry-exporter-otlp` 0.37.0, `opentelemetry-instrumentation-all` 0.97.0 ; Sinatra 4.2.1, Ruby 3.4.11 éprouvés) | `opentelemetry-sdk`, `opentelemetry-exporter-otlp`, `opentelemetry-instrumentation-all` dans le `Gemfile` | un initialiseur : `OpenTelemetry::SDK.configure { \|c\| c.use_all }` et `at_exit { OpenTelemetry.tracer_provider.shutdown }` | https://opentelemetry.io/docs/languages/ruby/getting-started/ |

« Éprouvé en production » : un vrai serveur, configuré par le seul socle ci-dessus, sans
`mip.api_key`, a envoyé à la collecte de production, et la console l'a montré.
Le 28/09/2026 (PR #342), Flask, Java et .NET : traces, journaux et erreurs (routes
serveur dans le tracing, groupes d'erreurs, cascade serveur → SQL ou sous-appel HTTP,
session retrouvée par le `tracestate`). Le 29/09/2026, FastAPI (route
`/commandes/:commande_id`, session par le `tracestate`, exception comptée une fois, 404
→ `(non trouvée)`) et Node sous Express, pour les traces. En CI, le site cobaye de l'E2E
tourne sous l'agent Python (`tests/e2e/site-cobaye/requirements.txt`,
`tests/e2e/tracing.spec.ts`) ; les exportateurs Node officiels sont testés contre le
collector et une vraie base (`tests/integration/otlp-protobuf-agent-sql.test.ts`).

« Éprouvé en local » : une petite application, configurée par le socle ci-dessus
(`mip.api_key` comprise) et, en Go et en Ruby, par les lignes de code du tableau (en Go,
de plus, l'option `trace.WithStackTrace(true)` à l'enregistrement de l'exception, § 3),
a tourné le 01/10/2026 dans un conteneur Docker jetable et envoyé au collecteur de
développement (`services/collector/dev-server.mjs`, clé exigée) et à une base locale : Go (`net/http`), PHP (Slim sous `php -S`, PDO SQLite, Monolog),
Ruby (Sinatra sous WEBrick). Appelées avec le `traceparent` et le `tracestate` du SDK
web, les trois ont donné : spans serveur aux routes `:nom`, sous-appel HTTP (Go, Ruby)
ou requêtes SQL (PHP) en spans de détail, exception comptée une fois, 404 →
`(non trouvée)`, session retrouvée par le `tracestate`. Les corps réellement émis sont
figés dans `tests/fixtures/otlp-agents/` (provenance, versions) et rejoués contre le
collector et une vraie base (`tests/integration/otlp-agents-go-php-ruby-sql.test.ts`) ;
le code des trois applications est dans `tests/fixtures/otlp-agents/applications/`.
Ce n'est pas la production : aucun agent Go, PHP ou Ruby n'a encore envoyé à la collecte
réelle.

**Traces : rien d'autre à faire. Journaux : seulement ceux d'une bibliothèque de
journalisation que l'agent relie** (`logging` en Python, pino, winston ou bunyan en Node,
`java.util.logging` en Java, `ILogger` en .NET, Monolog en PHP par le paquet
`open-telemetry/opentelemetry-auto-psr3` et `OTEL_PHP_PSR3_MODE=export`). Sans elle,
l'agent n'envoie que des traces : c'est le cas de Go et de Ruby avec les seuls paquets du
tableau. Un journal d'agent ne porte pas la session : il se relie à elle par sa trace.

## 3. Pièges connus, par langage

- **Python.** Le protocole par défaut est gRPC : `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
  est obligatoire, et `opentelemetry-exporter-otlp-proto-http` suffit (pas besoin du
  paquet gRPC). Les journaux sont partis sans autre variable en 1.45.0 sous Flask ; sous
  FastAPI, aucun : ceux d'uvicorn ne remontent pas au logger racine. Sous
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
- **Node.** `http/protobuf` est le protocole par défaut de la version 0.80.0 ; le socle
  suffit (`OTEL_TRACES_EXPORTER` et `OTEL_LOGS_EXPORTER` sont inutiles). **Aucun journal
  sans pino, winston ou bunyan** : `console.log` ne part pas. Express 5 donne 4 spans par
  requête, dont 3 portent l'exception (comptée une fois, § 4). Sous `register`, SIGTERM
  vide les spans mais n'arrête pas le processus : en conteneur, il est tué (SIGKILL) à la
  fin du délai de grâce. La détection de ressources envoie `host.name`, le nom de la machine.
- **Go.** Pas d'agent qui se greffe au processus comme en Java ou .NET : l'instrumentation
  s'écrit dans le code. Le protocole se choisit par le paquet importé (`otlptracehttp`),
  jamais gRPC ; l'adresse et la compression, elles, viennent du socle. **Le propagateur
  global est vide par défaut** : sans
  `otel.SetTextMapPropagator(propagation.TraceContext{})`, `otelhttp` ignore `traceparent`
  et `tracestate` — chaque requête ouvre une nouvelle trace, sans session, et le
  sous-appel part dans une trace à lui (constaté avec `otelhttp` 0.71.0). `otelhttp`
  0.71.0 n'écrit pas `http.route` : la route vient du nom du span (`GET /factures/{id}`,
  motifs du `ServeMux` de Go 1.22 et plus), **sauf en 404 et en 405** : la console n'y
  croit que `http.route` (§ 4). Un 404 ou un 405 renvoyé par un gestionnaire Go perd donc
  sa route et compte en `(non trouvée)`, même sur une route que le `ServeMux` a résolue
  (une facture absente sous `/factures/{id}`). À l'essai, l'exception s'enregistrait dans
  le gestionnaire, `span.RecordError` puis `span.SetStatus(codes.Error, …)`, avec
  l'option `trace.WithStackTrace(true)` : le corps capturé porte une pile, que le SDK Go
  n'écrit qu'avec elle. **Cette pile se lit mal** : seules ses frames inlinées (sans
  suffixe `+0x…`) sont reconnues, la première est celle du SDK OpenTelemetry
  (`…/sdk@v1.46.0/trace/span.go`), et la clé de regroupement v2 se calcule sur ce
  chemin. Une montée de version du SDK change donc la clé de chaque erreur Go, et deux
  gestionnaires qui lèvent la même erreur (même type, même message) partagent une clé.
  Sans l'option, pas de pile : la clé ne tient qu'au type et au message.
  L'instrumentation Go sans code (eBPF, compilation) est un projet en cours, non éprouvé
  ici.
- **PHP.** `pecl install opentelemetry` compile l'extension : il faut les outils de
  compilation (présents dans l'image `php:8.4-cli`). L'exportateur a besoin d'un client
  HTTP PSR-18 : autoriser le greffon Composer `php-http/discovery`, qui en installe un
  (`symfony/http-client` à l'essai). Sous `php -S`, chaque requête part dans ses propres
  lots, journaux avant spans. Avec l'`ErrorMiddleware` de Slim, l'exception est portée
  par le span interne du gestionnaire de route, et le span serveur (500) lui donne sa
  route : comptée une fois. Un journal Monolog qui porte l'exception en contexte
  (`['exception' => $e]`) ne la recompte pas : il n'a pas les attributs `exception.*`.
  La détection de ressources envoie `host.name` (ici le nom du conteneur),
  `process.owner` et la version du noyau.
- **Ruby.** Ajouter `at_exit { OpenTelemetry.tracer_provider.shutdown }` après
  `OpenTelemetry::SDK.configure` : sans lui, un arrêt par SIGTERM (constaté sous rackup
  et WEBrick) perd les spans pas encore exportés. `google-protobuf` tire `bigdecimal`, à
  compiler : `bundle install` échoue dans l'image `ruby:3.4-slim`, passe dans `ruby:3.4`.
  L'exception levée dans une route Sinatra est portée par le span serveur de Rack (500).
  `opentelemetry-instrumentation-all` n'a pas de pont pour `Logger` : aucun journal. La
  ressource porte `process.command` et `process.pid`.

## 4. Ce que la console en fait

- **Routes.** La route vient de `http.route` et se ramène à la forme `:nom` quel que soit
  le framework : `<int:commande_id>` (Flask, Django) et `{id:int}` (ASP.NET Core)
  deviennent `:commande_id` et `:id`. Sans `http.route` (`otelhttp` en Go), la route
  vient du nom du span : `GET /factures/{id}` devient `/factures/:id`. Un serveur sans
  modèle de route (`com.sun.net.httpserver` en Java) ne donne que son contexte. Un 404 ou
  un 405 sans `http.route` prend la route fixe `(non trouvée)`, jamais le chemin brut ni
  le nom du span : en Go, tout 404 ou 405 y tombe, route résolue ou non (§ 3). Un 5xx
  sans `http.route` ni motif dans son nom garde, lui, le chemin brut.
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
