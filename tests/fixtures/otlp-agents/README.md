# Corps OTLP des agents Go, PHP et Ruby

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

## Les refaire

Reprendre le code de `applications/` dans les mêmes images, installer les paquets aux
versions de `manifeste.json` (`go get`, `composer require`, `Gemfile`), relancer les trois
applications sous le même socle, capturer les corps de la même façon, puis réécrire
`manifeste.json` (tailles et empreintes). Le test échoue tant que le manifeste et les
fichiers ne concordent pas.
