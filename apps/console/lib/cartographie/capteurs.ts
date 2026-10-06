// Le haut de la carte : chez le client (son serveur, le navigateur de ses visiteurs),
// les capteurs, et les mesures qu'ils envoient. Relevé du 30/09/2026 dans le code des
// capteurs (packages/rum-sdk, apps/extension, packages/rum-mobile) et des recettes
// serveur (apps/console/lib/recettes-agents-otel.ts).
import { TEXTE_SEUIL_COLLECTE_RESSOURCE } from "../resources";
import type { Element, Lien } from "./types";

const SDK = "packages/rum-sdk";
const EXT = "apps/extension";
const RECETTES = "apps/console/lib/recettes-agents-otel.ts";

/** La rangée des mesures : de gauche à droite, du serveur au navigateur. */
const Y_MESURES = 900;
const mesure = (rang: number) => ({ x: 150 + rang * 300, y: Y_MESURES });

export const ELEMENTS_CLIENT: readonly Element[] = [
  {
    id: "serveur-client",
    famille: "client",
    zone: "client",
    titre: "Serveur du client",
    sousTitre: "l'API ou le back-office observé",
    resume:
      "Le serveur de l'application suivie : il répond aux appels du navigateur. Avec l'agent OpenTelemetry de son langage, il dit combien de temps il a mis, et pour quel appel.",
    etiquettes: ["Python", "Node.js", "Java", ".NET"],
    faits: [
      {
        texte: "Aucun code MIP à installer : l'agent officiel, réglé par des variables OTEL_*.",
        sources: [`${RECETTES}:78-88`],
      },
      {
        texte: "S'il ne sort pas sur Internet, un Collector OpenTelemetry local peut relayer.",
        sources: ["apps/console/public/integrations/otel-collector.yaml"],
      },
    ],
    x: 700,
    y: 120,
    largeur: 300,
  },
  {
    id: "navigateur",
    famille: "client",
    zone: "client",
    titre: "Navigateur du visiteur",
    sousTitre: "là où l'expérience se vit",
    resume:
      "Chaque page vue, chaque clic, chaque lenteur et chaque erreur se mesure ici, dans le navigateur du visiteur : par le SDK posé dans le site, ou par l'extension installée sur le poste.",
    etiquettes: ["Chrome", "Edge", "Firefox", "Safari"],
    faits: [
      {
        texte: "DNT et GPC sont respectés par défaut : un navigateur qui refuse n'envoie rien.",
        sources: [`${SDK}/src/index.ts:183-193`, `${SDK}/src/privacy.ts:27-30`],
      },
      {
        texte: "Les frames d'animation longues (LoAF) ne se mesurent que sur Chromium.",
        sources: [`${SDK}/src/loaf.ts:3-5`],
      },
    ],
    x: 2400,
    y: 120,
    largeur: 300,
  },
];

export const ELEMENTS_CAPTEURS: readonly Element[] = [
  {
    id: "agents-otel",
    famille: "capteur",
    zone: "capteurs",
    titre: "Agents OpenTelemetry",
    sousTitre: "les agents officiels, open source",
    resume:
      "Côté serveur, MIP ne fournit plus de code : le client lance son service sous l'agent OpenTelemetry officiel de son langage, qui envoie traces et journaux.",
    faits: [
      {
        texte: "OTLP/HTTP en protobuf, compressé en gzip ; traces et journaux, pas de métriques.",
        sources: [`${RECETTES}:78-88`],
      },
      {
        texte: "Go, PHP et Ruby : éprouvés en local le 01/10/2026, pas en production ; même socle, renvoyés à la documentation de l'agent.",
        sources: [`${RECETTES}:220-246`],
      },
      {
        texte: "Java, .NET et Python (Flask) : leur agent, à version figée, tourne en CI sous le socle de la recette, et ce qu'il envoie est vérifié en base.",
        sources: [".github/workflows/agents-otlp.yml", "tests/integration/otlp-agents-java-dotnet-python-sql.test.ts:1-30"],
      },
      {
        texte: "Les capteurs serveur maison (FastAPI, agent Node, Express) sont archivés depuis le 29/09/2026.",
        sources: ["packages/backend/shared/otlp.mjs:884-891"],
      },
    ],
    liste: {
      titre: "Recettes éprouvées",
      entrees: [
        { nom: "Python", role: "opentelemetry-instrument" },
        { nom: "Node.js", role: "@opentelemetry/auto-instrumentations-node" },
        { nom: "Java", role: "opentelemetry-javaagent.jar" },
        { nom: ".NET", role: "instrumentation automatique" },
      ],
    },
    x: 380,
    y: 520,
    largeur: 300,
    hauteur: 180,
  },
  {
    id: "collector-otel-client",
    famille: "capteur",
    zone: "capteurs",
    titre: "Collector OpenTelemetry",
    sousTitre: "facultatif, chez le client",
    resume:
      "Un relais open source que le client pose devant MIP quand son serveur ne sort pas sur Internet : il ne garde que les requêtes entrantes et ajoute l'identité MIP.",
    statut: "option",
    etiquettes: ["OTLP HTTP et gRPC", "spans SERVER seuls"],
    faits: [
      {
        texte: "Reçoit en OTLP HTTP et gRPC, filtre les spans SERVER, exporte en OTLP/HTTP JSON.",
        sources: ["apps/console/public/integrations/otel-collector.yaml:23-54"],
      },
    ],
    x: 740,
    y: 520,
  },
  {
    id: "s-sdk-vie-privee",
    famille: "securite",
    zone: "capteurs",
    titre: "Vie privée dans le SDK",
    sousTitre: "refus, consentement, masquage",
    resume:
      "Avant tout envoi : les refus du navigateur respectés, le consentement sur option, les URL sans requête ni fragment, un filtre par événement, et un rejeu masqué par défaut.",
    etiquettes: ["DNT · GPC", "consentement", "beforeSend"],
    faits: [
      { texte: "DNT et GPC respectés par défaut : rien n'est collecté.", sources: [`${SDK}/src/index.ts:183-193`] },
      { texte: "Consentement sur option : 200 événements gardés en mémoire, rejoués à l'accord, purgés au refus.", sources: [`${SDK}/src/consent.ts:5`] },
      {
        texte: "Avant l'accord, rien n'est lu ni écrit dans le stockage local ; un refus efface session, visiteur, échantillonnage et file de rejeu.",
        sources: [`${SDK}/src/consent.ts:10-51`, `${SDK}/src/index.ts:206`],
      },
      {
        texte: "Un refus arrête aussi le rejeu en cours : ce qui n'en est pas encore parti est jeté.",
        sources: [`${SDK}/src/index.ts:719-720`, `${SDK}/src/replay.ts:332-338`],
      },
      { texte: "Une page prérendue ne collecte rien tant qu'elle n'est pas affichée.", sources: [`${SDK}/src/index.ts:196-202`] },
      { texte: "Requêtes et fragments retirés de toutes les URL.", sources: [`${SDK}/src/context.ts:22-24`] },
      { texte: "Rejeu : texte masqué, médias bloqués, saisies masquées par défaut.", sources: [`${SDK}/src/replay.ts:137-146`] },
      {
        texte: "La page « Installer » écrit le fichier de configuration du client : le pont vers Axeptio, Didomi ou tarteaucitron, et un beforeSend qui retire e-mails et longs numéros.",
        sources: ["apps/console/lib/kit-installation.ts:117-135", "apps/console/lib/kit-installation.ts:136-192", "apps/console/lib/kit-installation.ts:194-235"],
      },
    ],
    x: 1180,
    y: 520,
  },
  {
    id: "sdk-web",
    famille: "capteur",
    zone: "capteurs",
    titre: "SDK web",
    sousTitre: "mip-rum.js · 27,1 Ko gzip",
    resume:
      "Un seul fichier JavaScript posé dans le <head> : il mesure les Web Vitals, les erreurs, les sessions, les clics et les appels réseau, et les envoie par lots au format OpenTelemetry.",
    etiquettes: ["OTLP/HTTP JSON", "0 dépendance", "lots de 64"],
    faits: [
      { texte: "27,1 Ko gzip, sous un budget de 35 Ko que chaque build fait respecter.", sources: [`${SDK}/build.mjs:52-62`, "apps/console/lib/sdk-poids.ts:17-27"] },
      {
        texte: "Envoi par lots de 64 spans toutes les 3 s, en fetch keepalive ; vidage quand la page passe en arrière-plan.",
        sources: [`${SDK}/src/otel.ts:27`, `${SDK}/src/otel.ts:146-154`, `${SDK}/src/otel.ts:246-263`],
      },
      {
        texte: "Hors ligne, une file bornée (100 spans, 50 Ko) rejoue les envois refusés pour surcharge.",
        sources: [`${SDK}/src/retry.ts:27`, `${SDK}/src/retry.ts:87-90`],
      },
      {
        texte: "Requêtes et fragments retirés des URL ; beforeSend filtre ou jette chaque span.",
        sources: [`${SDK}/src/context.ts:22-24`, "packages/rum-core/src/before-send.ts:21-30"],
      },
      { texte: "Consentement sur option : tant qu'il manque, rien ne part ni ne s'écrit dans le navigateur (200 événements gardés en mémoire).", sources: [`${SDK}/src/consent.ts:5`, `${SDK}/src/consent.ts:99-114`, `${SDK}/src/index.ts:206`] },
    ],
    x: 1500,
    y: 520,
    largeur: 280,
  },
  {
    id: "rejeu",
    famille: "capteur",
    zone: "capteurs",
    titre: "Rejeu de session",
    sousTitre: "mip-rum-replay.js · rrweb · 56,7 Ko gzip",
    resume:
      "Un second fichier, chargé seulement si le site l'active : il enregistre le DOM de la page (pas une vidéo), masqué, et l'envoie par morceaux compressés.",
    statut: "option",
    etiquettes: ["texte masqué", "médias bloqués", "2 min max"],
    faits: [
      {
        texte: "Par défaut, tout le texte est masqué, les médias bloqués et les saisies masquées.",
        sources: [`${SDK}/src/replay.ts:137-146`],
      },
      { texte: "Arrêt après 2 minutes ou 1 Mo compressé ; un morceau part toutes les 10 s.", sources: [`${SDK}/src/replay.ts:9-11`] },
      {
        texte: "Il démarre dès l'initialisation si le site n'exige pas le consentement.",
        sources: [`${SDK}/src/index.ts:630-634`, `${SDK}/src/index.ts:679-682`],
      },
      {
        texte: "Avant de l'activer, le gestionnaire de l'application en atteste la base légale sur la page « Installer » ; l'attestation est inscrite au journal, à son nom.",
        sources: ["apps/console/lib/commandes/applications.ts:159-188", "apps/console/lib/queries-attestation-rejeu.ts:1-17"],
      },
    ],
    x: 1840,
    y: 520,
    largeur: 280,
  },
  {
    id: "avis",
    famille: "capteur",
    zone: "capteurs",
    titre: "Widget d'avis",
    sousTitre: "mip-rum-feedback.js · 8,3 Ko gzip",
    resume: "Un bouton « Votre avis ? » : une note de 1 à 5 et un commentaire, envoyés comme un événement métier.",
    statut: "option",
    etiquettes: ["note 1 à 5", "silence 60 jours"],
    faits: [
      { texte: "Commentaire tronqué à 500 caractères, envoyé par MIPRum.track(\"feedback\").", sources: ["apps/console/public/mip-rum-feedback.js:196-203"] },
      { texte: "Après un envoi, 60 jours de silence par application.", sources: ["apps/console/public/mip-rum-feedback.js:100-108"] },
    ],
    x: 2160,
    y: 520,
  },
  {
    id: "extension",
    famille: "capteur",
    zone: "capteurs",
    titre: "Extension navigateur",
    sousTitre: "Chrome · Edge · Manifest V3 · 94 Ko",
    resume:
      "Installée sur les postes gérés par la DSI, elle injecte le même SDK sur les domaines enregistrés, sans toucher au site et sans clé.",
    statut: "pilote",
    etiquettes: ["sans clé", "0 ligne du site", "GPO · Intune"],
    faits: [
      {
        texte: "Injecte vendor/mip-rum.js dans la page, puis MIPRum.init avec la source « extension ».",
        sources: [`${EXT}/src/background.ts:82-90`],
      },
      { texte: "Permissions : scripting, webNavigation, storage, activeTab ; les hôtes sur accord seulement.", sources: [`${EXT}/manifest.json:7-15`] },
      {
        texte: "Sans clé : la collecte s'ouvre si l'origine est un domaine enregistré pour l'application.",
        sources: ["packages/backend/lib/pg-ingest.mjs:985-989", "packages/backend/lib/pg-ingest.mjs:1092-1094"],
      },
      {
        texte: "À chaque page, elle demande à la console si le domaine est suivi : le nom d'hôte part, même hors périmètre.",
        sources: [`${EXT}/src/background.ts:98-107`],
      },
      {
        texte: "Déployée de force par stratégie de parc, domaines accordés d'avance, postes nommés sur option.",
        sources: ["apps/console/lib/extension-deploiement.ts:30-53"],
      },
    ],
    x: 2480,
    y: 520,
  },
  {
    id: "sdk-mobile",
    famille: "capteur",
    zone: "capteurs",
    titre: "SDK React Native",
    sousTitre: "@mip/rum-mobile · JavaScript pur",
    resume:
      "Un SDK pour React Native qui envoie le même format que le web : écrans, erreurs JavaScript, appels réseau, événements. Il n'a encore jamais tourné dans une vraie application.",
    statut: "prevu",
    etiquettes: ["même format que le web", "jamais exécuté"],
    faits: [
      { texte: "Aucune version réelle de React Native n'a été exécutée.", sources: ["packages/rum-mobile/MATRICE-RUNTIME.md:3-4"] },
      { texte: "Crashes natifs, ANR et démarrage natif : déclarés indisponibles.", sources: ["packages/rum-mobile/src/capacites.ts:59-60"] },
    ],
    x: 2800,
    y: 520,
  },
];

export const ELEMENTS_MESURES: readonly Element[] = [
  {
    id: "m-traces-serveur",
    famille: "mesure",
    zone: "capteurs",
    titre: "Traces serveur",
    sousTitre: "span SERVER · SQL · appels sortants",
    resume:
      "La part serveur de chaque appel : sa durée, ses requêtes SQL et ses appels sortants, rattachée à la session du navigateur par l'en-tête traceparent.",
    etiquettes: ["/v1/traces", "protobuf ou JSON"],
    faits: [
      { texte: "Un span SERVER se rattache à la session par l'en-tête tracestate que pose le SDK.", sources: [`${SDK}/src/apispans.ts:168`, `${SDK}/src/apispans.ts:214`, "packages/backend/shared/otlp.mjs"] },
      { texte: "2 Mo et 20 000 spans au plus par requête.", sources: ["packages/backend/shared/limits.mjs:10-13"] },
    ],
    ...mesure(0),
  },
  {
    id: "m-journaux",
    famille: "mesure",
    zone: "capteurs",
    titre: "Journaux",
    sousTitre: "logRecords · /v1/logs",
    resume: "Les journaux du serveur, au format OpenTelemetry ; un journal ERROR qui porte une exception devient une erreur.",
    etiquettes: ["/v1/logs", "serveur seulement"],
    faits: [
      { texte: "Un journal ERROR qui porte une exception devient une erreur.", sources: ["packages/backend/shared/otlp.mjs"] },
      { texte: "Journaux et erreurs qu'ils portent s'écrivent dans une seule transaction.", sources: ["packages/backend/lib/pg-ingest.mjs:829-863"] },
    ],
    ...mesure(1),
  },
  {
    id: "m-pages",
    famille: "mesure",
    zone: "capteurs",
    titre: "Pages vues et sessions",
    sousTitre: "pageview · rum.view",
    resume: "Chaque page vue, y compris dans une application monopage, rattachée à une session et à un visiteur tirés au hasard.",
    etiquettes: ["session : 30 min, 4 h au plus", "visiteur aléatoire"],
    faits: [
      {
        texte: "Une session se ferme après 30 minutes d'inactivité, ou 4 heures après son début même active.",
        sources: [`${SDK}/src/session.ts:5`, `${SDK}/src/session.ts:10`],
      },
      { texte: "Le visiteur est un UUID aléatoire, sans empreinte du poste.", sources: [`${SDK}/src/session.ts:143-162`] },
      {
        texte: "Un retour arrière servi par le cache du navigateur compte une page vue ; une page prérendue, seulement si elle s'affiche.",
        sources: [`${SDK}/src/context.ts:50-54`, `${SDK}/src/index.ts:196-202`],
      },
      { texte: "Les nombres et identifiants des routes deviennent :id.", sources: [`${SDK}/src/context.ts:4-15`] },
    ],
    ...mesure(2),
  },
  {
    id: "m-vitals",
    famille: "mesure",
    zone: "capteurs",
    titre: "Web Vitals",
    sousTitre: "LCP · INP · CLS · FCP · TTFB",
    resume: "Les cinq indicateurs de performance perçue, avec leur attribution, plus le découpage du temps réseau de la page.",
    etiquettes: ["web-vitals 5.3", "DNS · TCP · TLS"],
    faits: [
      { texte: "Mesurés par la bibliothèque web-vitals, avec attribution.", sources: [`${SDK}/src/vitals.ts:1-8`, `${SDK}/src/vitals.ts:53-57`] },
      { texte: "Les phases réseau (redirection, DNS, TCP, TLS, requête, réponse) sur le même canal.", sources: [`${SDK}/src/navtiming.ts:18-25`] },
      { texte: "Par vue, en cumul : temps passé visible, défilement le plus profond, nombre et poids des ressources.", sources: [`${SDK}/src/engagement.ts:104-119`] },
      { texte: "Changement d'écran SPA : jusqu'à la dernière mutation ou requête suivie de 100 ms de calme, 10 s au plus.", sources: [`${SDK}/src/spa-load.ts:7-10`, `${SDK}/src/spa-load.ts:44-59`] },
    ],
    ...mesure(3),
  },
  {
    id: "m-erreurs",
    famille: "mesure",
    zone: "capteurs",
    titre: "Erreurs",
    sousTitre: "exception · jusqu'à 5 voies",
    resume:
      "Les plantages JavaScript toujours ; sur option, la console, les ressources en échec, les violations de CSP et les appels réseau en erreur.",
    etiquettes: ["plafonnées par page", "pile : 4 000 car."],
    faits: [
      { texte: "error et unhandledrejection, toujours captées.", sources: [`${SDK}/src/errors.ts:211-240`] },
      { texte: "Quatre voies de plus sur option, deux actives par défaut : workers et WebSockets (captureErrors).", sources: [`${SDK}/src/types.ts:112-128`, `${SDK}/src/index.ts:545-546`] },
      { texte: "Une WebSocket en erreur n'est nommée que par son hôte et son chemin, jamais sa requête.", sources: [`${SDK}/src/error-capture.ts:360-370`] },
      { texte: "Plafonds par page : 50 erreurs non interceptées, 20 console, ressources et réseau, 10 CSP, workers et WebSockets.", sources: [`${SDK}/src/errors.ts:22-30`] },
    ],
    ...mesure(4),
  },
  {
    id: "m-reseau",
    famille: "mesure",
    zone: "capteurs",
    titre: "Appels réseau",
    sousTitre: "http.client · traceparent",
    resume:
      "Chaque appel fetch ou XHR de la page vers son domaine, chronométré, et marqué d'un identifiant de trace que le serveur reprend.",
    etiquettes: ["fetch · XHR", "100 par page"],
    faits: [
      { texte: "fetch et XMLHttpRequest instrumentés : méthode, adresse sans requête, statut, durée.", sources: [`${SDK}/src/apispans.ts:125-141`] },
      {
        texte: "traceparent ajouté vers la même origine et les domaines déclarés, jamais vers la collecte.",
        sources: [`${SDK}/src/apispans.ts:69-87`],
      },
    ],
    ...mesure(5),
  },
  {
    id: "m-rejeu",
    famille: "mesure",
    zone: "capteurs",
    titre: "Morceaux de rejeu",
    sousTitre: "rrweb compressé · /v1/replay",
    resume: "Les enregistrements du DOM, compressés, envoyés par morceaux numérotés.",
    etiquettes: ["/v1/replay", "2 Mio max"],
    faits: [
      { texte: "2 Mio au plus par morceau, 32 Mio une fois décompressé.", sources: ["packages/backend/shared/limits.mjs:29-36"] },
      { texte: "Session, application, numéro et clé voyagent en en-têtes x-mip-*.", sources: [`${SDK}/src/replay.ts:353-361`] },
    ],
    ...mesure(6),
  },
  {
    id: "m-ressources",
    famille: "mesure",
    zone: "capteurs",
    titre: "Ressources et blocages",
    sousTitre: "resource · LoAF · tâches longues",
    resume: "Les fichiers lents ou qui bloquent l'affichage, et les blocages du navigateur, avec le script responsable quand on le sait.",
    etiquettes: [`≥ ${TEXTE_SEUIL_COLLECTE_RESSOURCE}`, "LoAF d'abord"],
    faits: [
      { texte: `Une ressource compte si elle dure ${TEXTE_SEUIL_COLLECTE_RESSOURCE} ou plus, ou bloque le rendu.`, sources: [`${SDK}/src/resources.ts:10`, `${SDK}/src/resources.ts:33-35`] },
      { texte: "Avec resources: \"all\", toutes partent, 150 par page ; le résumé par vue part toujours.", sources: [`${SDK}/src/resources.ts:9`, `${SDK}/src/resources.ts:24`] },
      { texte: "LoAF quand le navigateur le permet, les tâches longues sinon, jamais les deux.", sources: [`${SDK}/src/index.ts:450`] },
    ],
    ...mesure(7),
  },
  {
    id: "m-actions",
    famille: "mesure",
    zone: "capteurs",
    titre: "Actions et frustration",
    sousTitre: "clics · fil d'Ariane · formulaires",
    resume:
      "Chaque clic ouvre une action à laquelle se rattachent les appels et erreurs qui suivent ; les clics rageurs ou sans effet, et l'abandon des formulaires.",
    etiquettes: ["rage · dead", "saisie jamais lue"],
    faits: [
      { texte: "Une action rattache ce qui se passe dans les 5 secondes.", sources: [`${SDK}/src/actions.ts:6`] },
      { texte: "Clic rageur : 3 clics en 1 s ; clic mort : aucune réaction en 1,5 s.", sources: [`${SDK}/src/frustration.ts:9-11`] },
      { texte: "Formulaires : temps par champ et abandon, jamais la valeur saisie.", sources: [`${SDK}/src/forms.ts:88-97`] },
    ],
    ...mesure(8),
  },
  {
    id: "m-metier",
    famille: "mesure",
    zone: "capteurs",
    titre: "Événements métier",
    sousTitre: "track · timings · drapeaux · avis",
    resume: "Ce que l'application déclare elle-même : événements, vues, temps, drapeaux de fonctionnalité, identité et avis.",
    etiquettes: ["MIPRum.track", "identité hachée"],
    faits: [
      { texte: "track(nom, props) émet un événement track.<nom>.", sources: [`${SDK}/src/index.ts:738-757`] },
      { texte: "performance.mark et performance.measure deviennent des timings, sans les repères des outils, 30 par vue.", sources: [`${SDK}/src/user-timings.ts:7-16`] },
      { texte: "L'identifiant d'utilisateur est remplacé par un HMAC-SHA256 à la collecte.", sources: ["packages/db/sql/migration-v66.sql:64", "packages/backend/lib/identity-hash.mjs"] },
    ],
    ...mesure(9),
  },
  {
    id: "m-parc",
    famille: "mesure",
    zone: "capteurs",
    titre: "Battements du parc",
    sousTitre: "résolution · heartbeat",
    resume: "L'extension demande si un domaine est suivi, et chaque poste se déclare toutes les 6 heures : sa version, les applications qu'il alimente.",
    etiquettes: ["toutes les 6 h", "UUID du poste"],
    faits: [
      { texte: "Un battement toutes les 6 h, immédiat pour une application nouvelle.", sources: [`${EXT}/lib/install.ts:36`, `${EXT}/lib/install.ts:76-94`] },
      { texte: "La réponse de résolution se garde 60 s par domaine.", sources: [`${EXT}/src/background.ts:28`] },
    ],
    ...mesure(10),
  },
];

export const LIENS_CAPTEURS: readonly Lien[] = [
  { de: "navigateur", vers: "serveur-client", nature: "appel", libelle: "appels de l'application, avec traceparent" },
  { de: "serveur-client", vers: "agents-otel", nature: "embarque", libelle: "lancé sous l'agent" },
  { de: "serveur-client", vers: "collector-otel-client", nature: "embarque", libelle: "facultatif" },
  { de: "navigateur", vers: "sdk-web", nature: "embarque", libelle: "charge mip-rum.js" },
  { de: "navigateur", vers: "extension", nature: "embarque", libelle: "installée sur le poste" },
  { de: "extension", vers: "sdk-web", nature: "embarque", libelle: "injecte le même SDK" },
  { de: "sdk-web", vers: "rejeu", nature: "embarque", libelle: "le charge sur option" },
  { de: "sdk-web", vers: "avis", nature: "embarque", libelle: "le charge sur option" },
  { de: "agents-otel", vers: "collector-otel-client", nature: "mesure", libelle: "si le serveur ne sort pas" },
  { de: "agents-otel", vers: "m-traces-serveur", nature: "mesure" },
  { de: "agents-otel", vers: "m-journaux", nature: "mesure" },
  { de: "collector-otel-client", vers: "m-traces-serveur", nature: "mesure", libelle: "spans SERVER" },
  { de: "sdk-web", vers: "m-pages", nature: "mesure" },
  { de: "sdk-web", vers: "m-vitals", nature: "mesure" },
  { de: "sdk-web", vers: "m-erreurs", nature: "mesure" },
  { de: "sdk-web", vers: "m-reseau", nature: "mesure" },
  { de: "sdk-web", vers: "m-ressources", nature: "mesure" },
  { de: "sdk-web", vers: "m-actions", nature: "mesure" },
  { de: "sdk-web", vers: "m-metier", nature: "mesure" },
  { de: "rejeu", vers: "m-rejeu", nature: "mesure" },
  { de: "avis", vers: "m-metier", nature: "mesure", libelle: "track.feedback" },
  { de: "extension", vers: "m-parc", nature: "mesure" },
  { de: "sdk-mobile", vers: "m-pages", nature: "mesure", libelle: "écrans" },
  { de: "sdk-mobile", vers: "m-erreurs", nature: "mesure" },
  { de: "sdk-mobile", vers: "m-reseau", nature: "mesure" },
  { de: "sdk-mobile", vers: "m-metier", nature: "mesure" },
  { de: "s-sdk-vie-privee", vers: "sdk-web", nature: "protege" },
  { de: "s-sdk-vie-privee", vers: "rejeu", nature: "protege" },
];
