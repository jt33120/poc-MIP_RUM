# Corps OTLP des agents Go, PHP, Ruby, Java, .NET et Python

Ce que les exportateurs OpenTelemetry officiels de Go, de PHP et de Ruby ont **réellement
envoyé** le 01/10/2026, octet pour octet (protobuf compressé en gzip), avec les en-têtes de
la requête. `tests/integration/otlp-agents-go-php-ruby-sql.test.ts` les rejoue contre le
collector et une vraie base ; `manifeste.json` donne, pour chaque corps, son type, son
encodage, son `user-agent`, sa taille et son empreinte SHA-256 (vérifiées par le test), et
les versions de chaque langage.

## Comment ils ont été produits

- **Où** : trois conteneurs Docker jetables (`golang:alpine`, `php:8.4-cli` avec
  l'extension par `pecl`, `ruby:3.4`), sur un poste de développement. Le code des trois
  applications d'essai est versionné tel qu'il a tourné, dans `applications/`
  (`go/main.go`, `php/index.php`, `ruby/config.ru`), **sans** `go.mod`, `composer.lock` ni
  `Gemfile.lock` : ce seraient des dépendances du dépôt. Les versions des paquets sont dans
  `manifeste.json`.
- **Configuration** : le seul socle de `docs/capteurs-serveur.md` § 1 (`OTEL_SERVICE_NAME`,
  `OTEL_RESOURCE_ATTRIBUTES` avec `mip.app_id` et `mip.api_key`, protocole `http/protobuf`,
  compression `gzip`, un endpoint par signal, `OTEL_METRICS_EXPORTER=none`), plus ce que le
  tableau du § 2 demande par langage.
- **Applications** :
  - Go : `net/http`, `otelhttp.NewHandler` et `otelhttp.NewTransport`, propagateur W3C ;
    `GET /factures/{id}` appelle `GET /stock/{id}` ; l'échec est enregistré par
    `span.RecordError(err, trace.WithStackTrace(true))`, d'où la pile du corps capturé
    (`docs/capteurs-serveur.md` § 3, Go).
  - PHP : Slim 4 sous `php -S`, `OTEL_PHP_AUTOLOAD_ENABLED=true`, auto-instrumentations
    Slim, PDO et PSR-3 (`OTEL_PHP_PSR3_MODE=export`) ; `GET /factures/{id}` lit une base
    SQLite et écrit un journal Monolog ; l'échec écrit un journal ERROR puis lève
    l'exception. Aucune ligne OpenTelemetry dans le code.
  - Ruby : Sinatra 4 sous rackup et WEBrick, l'initialiseur de la doc officielle
    (`OpenTelemetry::SDK.configure { |c| c.use_all }`) et
    `at_exit { OpenTelemetry.tracer_provider.shutdown }` ; `GET /factures/:id` appelle
    `GET /stock/:id` par `Net::HTTP` ; l'échec lève une exception.
- **Appels** : depuis l'espace réseau du conteneur (adresse cliente `127.0.0.1`, rien du
  poste), comme un navigateur porteur du SDK web : `traceparent` et
  `tracestate: mip=s:r11-<langage>-session`. Trois requêtes : `GET /factures/42` (200),
  `POST /factures/42/payer` (500), `GET /inconnue` (404) ; identifiants de trace dans le
  manifeste.
- **Capture** : un relais local recevait chaque requête de l'agent, en gardait le corps
  et la transmettait au collecteur de développement (`services/collector/dev-server.mjs`,
  `REQUIRE_API_KEY=true`, base Postgres locale migrée). Les sept corps ont reçu 200, et
  les lignes écrites étaient celles que le test vérifie.

## Ce qu'ils contiennent

Aucune donnée personnelle ni secret : applications, clés (`r11-<langage>-cle`) et
sessions de test ; adresses `127.0.0.1` ; un nom de conteneur (`host.name`, PHP).

## Java, .NET et Python : capturés par la CI

Les corps `java-*`, `dotnet-*` et `python-*` ne viennent pas d'une capture à la main :
`capturer.mjs` les produit, en CI (`.github/workflows/agents-otlp.yml`, à chaque PR qui
touche ce dossier, le script, le test de rejeu, les recettes ou la collecte) comme sur un
poste qui a Docker. `tests/integration/otlp-agents-java-dotnet-python-sql.test.ts` les
rejoue ensuite dans `test:sql`, comme ceux de Go, de PHP et de Ruby.

- **Applications** : `applications/java` (Spring Boot 4 sous
  `java -javaagent:opentelemetry-javaagent.jar -jar app.jar`), `applications/dotnet`
  (ASP.NET Core, API minimale, sous `instrument.sh` de l'instrumentation automatique),
  `applications/python` (Flask sous `opentelemetry-instrument flask --app app run`). Aucune
  ligne OpenTelemetry dans leur code. Chacune a son `Dockerfile`, qui fige la version de
  l'agent et vérifie l'empreinte SHA-256 publiée par GitHub (Java, .NET) ; `pom.xml` et
  `Factures.csproj` ne servent qu'à construire l'image, aucun service du dépôt ne les lit.
- **Configuration** : le socle de la page Installer, tel que l'écrit `socleOtel`
  (`apps/console/lib/recettes-agents-otel.ts`), la clé factice `r11-<langage>-cle` à la
  place du repère, comme le ferait le client ; pour .NET, en plus,
  `OTEL_DOTNET_AUTO_LOG_DIRECTORY`, que la recette pose aussi.
- **Appels, relais, collecte** : les mêmes qu'au 01/10/2026 (`traceparent`, `tracestate`,
  trois requêtes, collecteur de développement à clé exigée) ; identifiants de trace de
  rang 4 (Java), 5 (.NET), 6 (Python) dans le manifeste. Le script attend que les trois
  traces soient exportées, puis un délai d'export de plus, avant d'arrêter l'application.
- **Provenance** : `langages.<langage>.capture` du manifeste (date, run du workflow),
  `versions` (arguments du Dockerfile ; pour Python, ce que pip a résolu) et `ressource`
  (ce que l'agent dit de lui-même). L'artefact `capture-agents-otlp` de chaque run garde
  aussi les journaux des applications.

Refaire la capture (Docker requis, base locale migrée) :

```sh
DATABASE_URL=postgres://postgres:postgres@localhost:5433/mip_rum \
  node tests/fixtures/otlp-agents/capturer.mjs java dotnet python
```

Le script réécrit les corps des langages demandés et leurs entrées du manifeste, sans
toucher aux autres. Une montée de version d'agent se fait dans le `Dockerfile`, puis par
une nouvelle capture, versionnée telle que le workflow l'a produite.

## Les refaire (Go, PHP, Ruby)

Reprendre le code de `applications/` dans les mêmes images, installer les paquets aux
versions de `manifeste.json` (`go get`, `composer require`, `Gemfile`), relancer les trois
applications sous le même socle, capturer les corps de la même façon, puis réécrire
`manifeste.json` (tailles et empreintes). Le test échoue tant que le manifeste et les
fichiers ne concordent pas.
