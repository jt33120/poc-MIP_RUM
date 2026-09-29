// Étape 3 de l'assistant d'intégration : brancher le serveur du client.
//
// Décision du 29/09/2026 : côté serveur, plus aucun capteur maison. Le client
// installe l'agent OpenTelemetry OFFICIEL de son langage, réglé par un socle
// commun de variables `OTEL_*` ; la collecte MIP reçoit l'OTLP standard. Le
// middleware FastAPI, le middleware Express et l'agent Node de MIP sont archivés :
// une recette qui y renverrait ferait installer au client un code que plus
// personne ne maintient (`tests/unit/recettes-agents-otel.test.tsx` l'interdit).
//
// Module pur, sans base : le socle est prérempli avec l'identifiant de
// l'application et les adresses réelles de collecte ; la clé d'API reste un
// repère que le mécanisme du secret remis (`CodeAvecSecret`) remplace quand la clé
// vient d'être affichée, et que le client remplace sinon.

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
  /** Précision affichée à côté du titre. */
  precision: string;
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
  /** Langages renvoyés à la documentation OpenTelemetry, avec le même socle. */
  autres: { langage: string; documentation: string }[];
  /** Option : faire passer les agents par un Collector OpenTelemetry. */
  collecteur: string;
}

/**
 * Le socle commun des variables `OTEL_*`, identique pour tous les agents officiels.
 *
 * - un point d'arrivée PAR SIGNAL, en URL complète : avec la variable générique
 *   (`OTEL_EXPORTER_OTLP_ENDPOINT`), l'agent ajouterait `/v1/traces` à l'adresse ;
 * - `http/protobuf` : le protocole par défaut de la plupart des agents, que la
 *   collecte accepte, compressé en gzip ;
 * - pas de métriques : la collecte ne les reçoit pas, et un export refusé à
 *   chaque intervalle ne ferait que du bruit ;
 * - l'identité MIP voyage en attributs de ressource, comme pour le navigateur.
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
    `export OTEL_EXPORTER_OTLP_COMPRESSION="gzip"`,
    `export OTEL_EXPORTER_OTLP_TRACES_ENDPOINT="${adresses.traces}"`,
    `export OTEL_EXPORTER_OTLP_LOGS_ENDPOINT="${adresses.logs}"`,
    `export OTEL_TRACES_EXPORTER="otlp"`,
    `export OTEL_LOGS_EXPORTER="otlp"`,
    `export OTEL_METRICS_EXPORTER="none"`,
    `export OTEL_PROPAGATORS="tracecontext,baggage"`,
  ].join("\n");
}

const DOC = "https://opentelemetry.io/docs/zero-code";

/** Les recettes de l'étape 3, préremplies pour une application. */
export function recettesAgentsOtel({
  appId,
  adresses,
}: {
  appId: string;
  adresses: AdressesCollecte;
}): RecettesAgents {
  const socle = socleOtel({ appId, adresses, service: `${appId}-api` });
  const recette = (...lignes: string[]) => [
    "# 1. Le socle commun (variables d'environnement du serveur)",
    socle,
    "",
    ...lignes,
  ].join("\n");

  const agents: RecetteAgent[] = [
    {
      id: "python",
      titre: "Python (FastAPI, Django, Flask…)",
      precision: "agent officiel opentelemetry-python",
      code: recette(
        "# Les journaux Python ne partent que sur demande explicite",
        `export OTEL_PYTHON_LOGGING_AUTO_INSTRUMENTATION_ENABLED="true"`,
        "",
        "# 2. Installer l'agent, puis les instrumentations des bibliothèques présentes",
        "pip install opentelemetry-distro opentelemetry-exporter-otlp",
        "opentelemetry-bootstrap -a install",
        "",
        "# 3. Lancer l'application sous l'agent (ici FastAPI avec uvicorn)",
        "opentelemetry-instrument uvicorn main:app --host 0.0.0.0 --port 8000",
      ),
      pieges: [
        "Pas de --reload sous l'agent : le processus relancé par uvicorn n'est plus instrumenté.",
        "Avec gunicorn et plusieurs workers, l'agent doit être initialisé dans chaque worker (crochet post_fork, voir la documentation Python).",
        "opentelemetry-bootstrap s'exécute après l'installation des dépendances de l'application : il n'instrumente que ce qu'il trouve.",
      ],
      documentation: `${DOC}/python/`,
    },
    {
      id: "node",
      titre: "Node.js (Express, Fastify, NestJS…)",
      precision: "agent officiel @opentelemetry/auto-instrumentations-node",
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
      ],
      documentation: `${DOC}/js/`,
    },
    {
      id: "java",
      titre: "Java (Spring Boot, Quarkus, Tomcat…)",
      precision: "agent officiel opentelemetry-javaagent",
      code: recette(
        "# 2. Télécharger l'agent (un seul fichier .jar)",
        "curl -sSfLO https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar",
        "",
        "# 3. Lancer l'application sous l'agent",
        "java -javaagent:opentelemetry-javaagent.jar -jar app.jar",
      ),
      pieges: [
        "L'option -javaagent se place avant -jar ; dans un serveur d'applications, elle va dans les options de la JVM (JAVA_OPTS, CATALINA_OPTS…).",
      ],
      documentation: `${DOC}/java/agent/`,
    },
    {
      id: "dotnet",
      titre: ".NET (ASP.NET Core)",
      precision: "instrumentation automatique officielle opentelemetry-dotnet-instrumentation",
      code: recette(
        "# 2. Installer l'instrumentation automatique (Linux, macOS)",
        "curl -sSfLO https://github.com/open-telemetry/opentelemetry-dotnet-instrumentation/releases/latest/download/otel-dotnet-auto-install.sh",
        "sh ./otel-dotnet-auto-install.sh",
        'chmod +x "$HOME/.otel-dotnet-auto/instrument.sh"',
        "",
        "# 3. Activer l'instrumentation dans le shell, puis lancer l'application",
        '. "$HOME/.otel-dotnet-auto/instrument.sh"',
        "dotnet MonApplication.dll",
      ),
      pieges: [
        "instrument.sh se source (le point en tête) dans le shell qui lance l'application : exécuté à part, il ne règle rien.",
        "Sous Windows et IIS, l'installation passe par le module PowerShell décrit dans la documentation .NET.",
      ],
      documentation: `${DOC}/dotnet/`,
    },
  ];

  const autres = [
    { langage: "Go", documentation: "https://opentelemetry.io/docs/languages/go/" },
    { langage: "PHP", documentation: `${DOC}/php/` },
    { langage: "Ruby", documentation: "https://opentelemetry.io/docs/languages/ruby/" },
  ];

  // Le Collector (open source) reste une option : il sert quand le serveur ne
  // peut pas sortir vers Internet, ou quand on veut filtrer avant l'envoi. Les
  // agents visent alors le Collector local ; c'est lui qui porte l'identité MIP.
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
