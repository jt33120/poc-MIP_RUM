// Brancher le serveur du client : l'étape 3 de la fiche d'une application et la
// section « Brancher le serveur » de /select/new.
//
// Décision du 29/09/2026 : côté serveur, plus aucun capteur maison. Le client
// installe l'agent OpenTelemetry OFFICIEL de son langage, réglé par un socle
// commun de variables `OTEL_*` ; la collecte MIP reçoit l'OTLP standard (protobuf
// ou JSON). Le middleware FastAPI, le middleware Express et l'agent Node de MIP
// sont archivés : une recette qui y renverrait ferait installer au client un code
// que plus personne ne maintient (`tests/unit/recettes-agents-otel.test.tsx`
// l'interdit).
//
// Le socle et les pièges suivent le guide d'intégration § 10, où sont dits l'état
// de chaque langage et ce qui a été éprouvé en production.
//
// Module pur, sans base : le socle est prérempli avec l'identifiant de
// l'application et les adresses réelles de collecte ; la clé d'API reste un
// repère, nu dans la valeur, que le secret remis (`CodeAvecSecret`, `guillemets`
// à `false`) remplace quand la clé vient d'être affichée, et le client sinon.

/** Repère de la clé d'API, le même que celui du code de suivi du navigateur. */
export const REPERE_CLE_API = "COLLE_ICI_LA_CLE_API";

/** Adresses de collecte, URL complètes : les agents n'y ajoutent rien quand la variable est propre au signal. */
export interface AdressesCollecte {
  traces: string;
  logs: string;
}

export interface RecetteAgent {
  id: "python" | "node" | "java" | "dotnet";
  /** Titre du bloc dépliable. */
  titre: string;
  /** L'agent officiel, nommé. */
  precision: string;
  /** Éprouvé en production ou non (le guide d'intégration § 10, « Par langage »). */
  etat: string;
  /** Le socle, l'installation de l'agent, puis la commande de lancement : un seul bloc à copier. */
  code: string;
  /** Les pièges propres au langage, une phrase chacun. */
  pieges: string[];
  /** Page de l'agent officiel sur opentelemetry.io. */
  documentation: string;
}

export interface RecettesAgents {
  /** Le socle commun seul, pour les langages sans recette dédiée. */
  socle: string;
  agents: RecetteAgent[];
  /**
   * Langages renvoyés à la documentation OpenTelemetry, avec le même socle : éprouvés
   * en local le 01/10/2026, pas en production (la fiche des capteurs serveur § 2), d'où
   * pas de recette dédiée. `piege` : celui qui casse la trace ou la perd (§ 3).
   */
  autres: { langage: string; documentation: string; etat: string; piege: string }[];
  /** Option : faire passer les agents par un Collector OpenTelemetry. */
  collecteur: string;
}

/**
 * Le socle commun des variables `OTEL_*`, identique pour tous les agents officiels.
 *
 * - une adresse PAR SIGNAL, en URL complète : la variable générique
 *   (`OTEL_EXPORTER_OTLP_ENDPOINT`) recevrait `/v1/traces` en suffixe ;
 * - `http/protobuf`, jamais `grpc` : l'ingestion est en HTTP seulement, et c'est
 *   le défaut de Python ; compressé en gzip ;
 * - pas de métriques : aucune route `/v1/metrics`, l'agent journaliserait ses échecs ;
 * - l'identité MIP voyage en attributs de ressource : sans `mip.app_id`, le lot est ignoré.
 */
export function socleOtel({
  appId,
  adresses,
  service,
}: {
  appId: string;
  adresses: AdressesCollecte;
  service: string;
}): string {
  return [
    `export OTEL_SERVICE_NAME="${service}"`,
    `export OTEL_RESOURCE_ATTRIBUTES="mip.app_id=${appId},mip.api_key=${REPERE_CLE_API},deployment.environment.name=prod"`,
    `export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"`,
    `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${adresses.traces}"`,
    `export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${adresses.logs}"`,
    `export OTEL_EXPORTER_OTLP_COMPRESSION="gzip"`,
    `export OTEL_TRACES_EXPORTER="otlp"`,
    `export OTEL_LOGS_EXPORTER="otlp"      # « none » pour n'envoyer que les traces`,
    `export OTEL_METRICS_EXPORTER="none"`,
  ].join("\n");
}

/**
 * Le nom de service prérempli (`OTEL_SERVICE_NAME`). Exporté pour `/installer`, qui
 * le range parmi ce qui est propre à l'application : le dire ailleurs autrement
 * ferait lire au client un nom que sa recette ne porte pas.
 */
export const nomDeService = (appId: string) => `${appId}-api`;

const DOC = "https://opentelemetry.io/docs/zero-code";
// Depuis le 06/10/2026, Java, .NET et Python (Flask) ont aussi leur preuve en CI : l'agent,
// à la version figée ci-dessous, tourne sous ce socle même (`socleOtel`) et ce qu'il envoie
// passe par la collecte et une vraie base (.github/workflows/agents-otlp.yml,
// tests/integration/otlp-agents-java-dotnet-python-sql.test.ts).
const EN_CI = "prouvé en CI";
const EPROUVE = `éprouvé en production le 28/09/2026, ${EN_CI}`;
/** Les versions que la CI fait tourner (Dockerfile de tests/fixtures/otlp-agents/applications/). */
export const VERSIONS_EPROUVEES = { javaagent: "2.31.1", dotnetAuto: "1.17.0", pythonDistro: "0.66b0", pythonSdk: "1.45.0" } as const;
const V = VERSIONS_EPROUVEES;
// Preuves du 29/09/2026 (même protocole que #342) : FastAPI sous opentelemetry-instrument,
// et Node sous auto-instrumentations-node — les traces seulement, faute de journaux (piège ci-dessous).
const EPROUVE_PYTHON = `éprouvé en production (Flask le 28/09/2026, FastAPI le 29/09/2026), Flask ${EN_CI}`;
const EPROUVE_NODE = "éprouvé en production le 29/09/2026 (traces)";

/** Les recettes serveur, préremplies pour une application. */
export function recettesAgentsOtel({
  appId,
  adresses,
}: {
  appId: string;
  adresses: AdressesCollecte;
}): RecettesAgents {
  const socle = socleOtel({ appId, adresses, service: nomDeService(appId) });
  const recette = (...lignes: string[]) =>
    ["# 1. Le socle commun, dans l'environnement du processus", socle, "", ...lignes].join("\n");

  const agents: RecetteAgent[] = [
    {
      id: "python",
      titre: "Python (FastAPI, Django, Flask…)",
      precision: "opentelemetry-instrument",
      etat: EPROUVE_PYTHON,
      code: recette(
        "# 2. Installer l'agent, puis les instrumentations des bibliothèques présentes",
        `pip install "opentelemetry-distro==${V.pythonDistro}" "opentelemetry-exporter-otlp-proto-http==${V.pythonSdk}"`,
        "opentelemetry-bootstrap -a install",
        "",
        "# 3. Lancer l'application sous l'agent (FastAPI avec uvicorn ;",
        "#    Flask : opentelemetry-instrument flask --app app run ; gunicorn : même préfixe)",
        "opentelemetry-instrument uvicorn main:app",
      ),
      pieges: [
        "Le protocole par défaut de l'agent Python est grpc : la ligne http/protobuf du socle est obligatoire ici.",
        "opentelemetry-bootstrap s'exécute après l'installation des dépendances de l'application : il n'instrumente que ce qu'il trouve.",
        "Avant OpenTelemetry Python 1.40, les journaux du module logging ne partent qu'avec OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED=true.",
        "Un export refusé ne s'affiche que si l'application pose son propre gestionnaire sur le journal « opentelemetry ».",
        "Les journaux INFO de l'application ne partent que si le journal racine est au niveau INFO (logging.getLogger().setLevel(logging.INFO)) : par défaut, seuls WARNING et au-delà partent.",
        "Une exception non rattrapée (Flask) compte une fois dans Erreurs, par le journal ERROR du framework ; elle reprend la session et la route du span serveur (500) de sa requête.",
      ],
      documentation: `${DOC}/python/`,
    },
    {
      id: "node",
      titre: "Node.js (Express, Fastify, NestJS…)",
      precision: "@opentelemetry/auto-instrumentations-node",
      etat: EPROUVE_NODE,
      code: recette(
        "# 2. Installer l'agent dans le projet",
        "npm install --save @opentelemetry/api @opentelemetry/auto-instrumentations-node",
        "",
        "# 3. Lancer l'application sous l'agent",
        "node --require @opentelemetry/auto-instrumentations-node/register app.js",
      ),
      pieges: [
        "L'agent doit se charger avant tout autre module : --require sur la ligne de commande (ou NODE_OPTIONS), jamais un import au milieu du code.",
        "Une application en modules ES (import) demande en plus le crochet de chargement décrit dans la documentation Node.",
        "Sans bibliothèque de journalisation instrumentée (pino, winston, bunyan), l'agent n'envoie aucun journal : seules les traces partent.",
        "Sous --require …/register, un SIGTERM vide les spans mais n'arrête pas le processus : en conteneur, prévoir l'arrêt forcé après le délai de grâce.",
      ],
      documentation: `${DOC}/js/`,
    },
    {
      id: "java",
      titre: "Java (Spring Boot, Quarkus, Tomcat…)",
      precision: "opentelemetry-javaagent.jar",
      etat: EPROUVE,
      code: recette(
        "# 2. Télécharger l'agent (un seul fichier .jar)",
        `curl -sSfLO https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${V.javaagent}/opentelemetry-javaagent.jar`,
        "",
        "# 3. Lancer l'application sous l'agent",
        "java -javaagent:opentelemetry-javaagent.jar -jar app.jar",
      ),
      pieges: [
        "L'option -javaagent se place avant -jar ; dans un serveur d'applications, elle va dans les options de la JVM (JAVA_OPTS, CATALINA_OPTS…).",
        "Lancer un jar ou une classe compilée : sous le lanceur de fichier source (java Serveur.java), l'agent ne démarre pas.",
        "GitHub publie l'empreinte SHA-256 du jar avec la release : la comparer à celle du fichier téléchargé (shasum -a 256).",
        "Spring Boot range une 404 sous la route /** (son gestionnaire de fichiers statiques) : le Tracing la montre sous /**, pas sous « (non trouvée) ».",
        "Une exception sortie d'un contrôleur compte une fois dans Erreurs, par le journal ERROR de Tomcat ; elle reprend la session et la route du span serveur (500) de sa requête.",
        "Les journaux de démarrage de Spring Boot (Logback) partent aussi : quelques lignes par démarrage dans Journaux.",
      ],
      documentation: `${DOC}/java/agent/`,
    },
    {
      id: "dotnet",
      titre: ".NET (ASP.NET Core)",
      precision: "instrumentation automatique OpenTelemetry .NET",
      etat: EPROUVE,
      code: recette(
        "# Un dossier de journaux accessible en écriture (défaut : /var/log/opentelemetry)",
        `export OTEL_DOTNET_AUTO_LOG_DIRECTORY="/var/tmp/otel-dotnet"`,
        "",
        "# 2. Installer l'instrumentation automatique (Linux, macOS)",
        `curl -sSfLO https://github.com/open-telemetry/opentelemetry-dotnet-instrumentation/releases/download/v${V.dotnetAuto}/otel-dotnet-auto-install.sh`,
        "sh ./otel-dotnet-auto-install.sh",
        "",
        "# 3. Dans le shell qui lance l'application",
        '. "$HOME/.otel-dotnet-auto/instrument.sh"',
        "dotnet MonApplication.dll",
      ),
      pieges: [
        "Le script d'installation vérifie la release avec la CLI GitHub (gh) : sans elle, il s'arrête, sauf SKIP_RELEASE_VERIFICATION=true. Dans une image sans gh : vérifier soi-même l'archive par l'empreinte SHA-256 que publie GitHub, puis la remettre au script (LOCAL_PATH=… SKIP_RELEASE_VERIFICATION=true).",
        "instrument.sh se source (le point en tête) dans le shell qui lance l'application : exécuté à part, il ne règle rien. Sous macOS, il demande greadlink (paquet coreutils).",
        "Sans dossier de journaux accessible en écriture, le processus s'arrête au démarrage (Permission denied).",
        "L'exception non rattrapée n'est pas enregistrée sur le span : elle compte une fois dans Erreurs, par le journal ERROR de Kestrel, et reprend la session et la route du span serveur (500).",
        "Sous Windows, le module PowerShell du même projet : Register-OpenTelemetryForCurrentSession, après les mêmes variables en $env:….",
      ],
      documentation: `${DOC}/dotnet/`,
    },
  ];

  // Éprouvés en local le 01/10/2026 : conteneurs jetables, collecteur de développement,
  // corps rejoués par tests/integration/otlp-agents-go-php-ruby-sql.test.ts. Les pièges
  // sont ceux que l'essai a constatés (la fiche des capteurs serveur § 3).
  const EN_LOCAL = "éprouvé en local le 01/10/2026, pas en production";
  const autres = [
    {
      langage: "Go",
      documentation: "https://opentelemetry.io/docs/languages/go/",
      etat: EN_LOCAL,
      piege:
        "Go : poser otel.SetTextMapPropagator(propagation.TraceContext{}) — sans lui, otelhttp ignore traceparent et la trace ne rejoint pas la session.",
    },
    {
      langage: "PHP",
      documentation: `${DOC}/php/`,
      etat: EN_LOCAL,
      piege:
        "PHP : l'exportateur veut un client HTTP PSR-18 (autoriser le greffon Composer php-http/discovery) ; les journaux Monolog passent par open-telemetry/opentelemetry-auto-psr3 et OTEL_PHP_PSR3_MODE=export.",
    },
    {
      langage: "Ruby",
      documentation: "https://opentelemetry.io/docs/languages/ruby/",
      etat: EN_LOCAL,
      piege:
        "Ruby : ajouter at_exit { OpenTelemetry.tracer_provider.shutdown } — sans lui, un arrêt par SIGTERM perd les derniers spans.",
    },
  ];

  // Le Collector (open source) reste une option : il sert quand le serveur ne
  // peut pas sortir vers Internet, ou pour regrouper les lots d'un parc de
  // processus. Les agents visent alors le Collector local ; lui porte l'identité MIP.
  const collecteur = [
    "# 1. Remplir les repères de otel-collector.yaml :",
    `#    <APP_ID>         ${appId}`,
    `#    <API_KEY>        ${REPERE_CLE_API}`,
    `#    <ADRESSE_TRACES> ${adresses.traces}`,
    `#    <ADRESSE_LOGS>   ${adresses.logs}`,
    "#    puis lancer le Collector :",
    "docker run -p 4318:4318 -p 4317:4317 \\",
    "  -v $(pwd)/otel-collector.yaml:/etc/otelcol-contrib/config.yaml \\",
    "  otel/opentelemetry-collector-contrib:latest",
    "",
    "# 2. Retirer du socle les deux adresses par signal (elles priment sur celle-ci),",
    "#    puis pointer l'agent vers le Collector local :",
    `export OTEL_EXPORTER_OTLP_ENDPOINT="http://127.0.0.1:4318"`,
  ].join("\n");

  return { socle, agents, autres, collecteur };
}
