// Les SPÉCIFICATIONS du POC : ce qui tourne, ce qu'on mesure, et ce qu'on ne
// mesure pas. Source unique de la section « Specs / Capacité technique » de la
// vitrine (components/presentation/Specs.tsx).
//
// ─────────────────────────── LA RÈGLE DE CE FICHIER ───────────────────────────
//
// Chaque ligne porte de quoi la CONTREDIRE. Une affirmation de vitrine qui ne
// peut pas devenir fausse en CI est une affirmation que personne ne relira : le
// dépôt a déjà servi « purge jamais exécutée » des semaines après sa reprise, et
// « Supabase / Paris » douze jours après la migration vers Neon / Francfort.
//
// D'où trois dispositifs, tous vérifiés par tests/unit/specs.test.ts :
//
//   1. Ce qui existe ailleurs est IMPORTÉ, jamais recopié — l'hébergement vient
//      de lib/legal.ts (les mêmes chaînes que /legal/confidentialite), les mesures non couvertes de
//      lib/dashboard-blocs.ts (celles-là mêmes que montre la roue des blocs).
//   2. Ce qui décrit le dépôt porte le CHEMIN qui le prouve (`preuve`,
//      `module`) : le test ouvre le fichier. Un service renommé, un module
//      supprimé, et la vitrine cesse de compiler vert.
//   3. Ce qu'on annonce ABSENT porte son marqueur d'absence (`marqueur`) : le
//      test échoue le jour où le code apparaît. « Pas encore implémenté » cesse
//      alors d'être vrai, et on le sait sans relire la vitrine.
//
// Les chiffres (poids gzip, version d'extension) sont comparés au fichier réel.
// Les faits d'hébergeur relevés à la main portent leur date de relevé.
import { CATALOGUES, type Indisponible } from "./dashboard-blocs";
import {
  FEEDBACK_GZIP_KO,
  REPLAY_GZIP_KO,
  SDK_BUDGET_KO,
  SDK_GZIP_KO,
  koTexte,
} from "./sdk-poids";
import { HOSTS } from "./legal";
import { MIGRATIONS_CONSTATEES, TOPOLOGIE_RELEVEE } from "./presentation-topologie";
import { RN_VERSION } from "./versions";

export type Statut = "atteint" | "partiel" | "manque" | "non-mesure";

// ══════════════════════════ Onglet 1 — infrastructure ══════════════════════════

// Les poids vivent dans un module FEUILLE (sans import), parce que des
// composants client les citent aussi : les définir ici tirerait tout le graphe
// des specs dans le bundle du navigateur. Réexportés pour que lib/specs reste le
// point d'entrée unique de la section.
export {
  FEEDBACK_GZIP_KO,
  REPLAY_GZIP_KO,
  SDK_BUDGET_KO,
  SDK_GZIP_KO,
  SDK_POIDS_TEXTE,
  koTexte,
} from "./sdk-poids";

/** Version de l'extension, telle qu'elle est dans apps/extension/manifest.json. */
export const EXT_VERSION = "0.6.0";
/** Ses permissions, dans l'ordre du manifeste. */
export const EXT_PERMISSIONS = ["scripting", "webNavigation", "storage", "activeTab"] as const;

/**
 * Faits Railway relevés dans la console de l'hébergeur — pas dans le dépôt.
 * Ils portent donc leur date : rien ici ne les revérifie tout seul.
 */
export const RAILWAY = {
  projet: "mip-rum-backend",
  region: "europe-west4-drams3a",
  branche: "master",
  releve: "09/09/2026",
} as const;

export interface LigneInfra {
  k: string;
  v: string;
  s: Statut;
  /** Chemin d'un fichier du dépôt qui PROUVE la ligne ; le test l'ouvre. */
  preuve?: string;
}

export interface GroupeInfra {
  titre: string;
  sous: string;
  lignes: LigneInfra[];
}

export const INFRA: GroupeInfra[] = [
  {
    titre: "Hébergement",
    // PAS AFFICHÉ DANS LES SPÉCIFICATIONS (recette du 26/09/2026) : l'hébergement se lit
    // une seule fois, dans le tableau « Où sont les données, et sous quel droit » de la
    // présentation (components/presentation/Hebergement.tsx) ; l'onglet y renvoie. Le
    // groupe reste ici parce qu'il porte la ligne « Souveraineté », que lisent
    // lib/presentation-topologie.ts et ses tests.
    sous: "Les mêmes chaînes que la politique de confidentialité — elles ne peuvent pas diverger.",
    lignes: [
      // Importées de lib/legal.ts, qui alimente aussi /legal/confidentialite : une
      // seule rédaction de l'hébergement. Les retaper ici aurait recréé la
      // divergence que l'invariant AD-7 existe pour empêcher.
      { k: "Base de données", v: HOSTS.data, s: "partiel" },
      { k: "Console", v: HOSTS.app, s: "partiel" },
      { k: "Backend", v: HOSTS.backend, s: "partiel" },
      {
        k: "Souveraineté",
        v: "Non. Neon, Vercel et Railway sont trois sociétés de droit américain. La donnée et le calcul sont en UE ; l'hébergeur, lui, relève d'un droit tiers — ce n'est pas la même chose, et c'est le point bloquant assumé.",
        s: "manque",
      },
    ],
  },
  {
    titre: "Services — six services à part de la console, en trois groupes",
    // La date est celle du dernier relevé que porte le relevé de topologie (« Relevé
    // du 28/09/2026 », API Railway), lue dans la même constante que la légende du chemin
    // de la mesure : tests/unit/presentation-topologie.test.ts vérifie qu'elle s'y lit.
    // Les six services de `.railway/railway.ts` (groupes 1 · Collecte, 2 · Restitution,
    // 3 · Traitements) tournent depuis l'apply du 27/09/2026 (PR #332). État du
    // 07/10/2026 : relais de l'API v1 à 100 depuis le 28/09, collecte directe et
    // bascule vers console-api à 100 depuis le 06/10/2026 ; le mode strict manque.
    sous: `Les capteurs envoient au collecteur, en direct. Six services tournent à part en production, en trois groupes — collecte, restitution, traitements (relevé le ${TOPOLOGIE_RELEVEE.railway}). Ni framework, ni fonction à la demande : du Node et du PostgreSQL, dans des images construites depuis le code source.`,
    lignes: [
      {
        k: "Collecteur",
        // Le receveur autonome (l'ancien `ingest`, supprimé faute de domaine public, voir
        // le relevé de topologie) revenu comme service `collector`. Depuis le 06/10/2026, le
        // code de suivi proposé le vise en direct (lib/ingest-endpoint.ts) ; la console ne
        // fait plus que relayer l'ancienne adresse, sans écrire (#397, lib/ingest-relay.ts),
        // et un lot s'écrit en un aller-retour (#400, migration-v109, drapeau à 100).
        // La SEULE place où le dossier raconte ce service (contre-recette du 26/09/2026 :
        // quatre fois) ; « Le chemin de la mesure » y renvoie.
        v: "Un receveur OpenTelemetry autonome, seul à écrire les mesures depuis le 06/10/2026 : les sites lui envoient en direct, et la console ne fait plus que relayer ceux restés sur son adresse. Il exige la clé de l'application, déduit le pays de l'adresse IP sans la garder, pseudonymise l'identité et écrit chaque lot en un seul aller-retour vers la base.",
        s: "atteint",
        preuve: "services/collector/server.mjs",
      },
      {
        k: "API de lecture",
        // Service `api` : le serveur MCP l'appelle sur le réseau privé (MIP_API_HOST,
        // .railway/railway.ts). Le relais des lectures au jeton de la console vers lui
        // (`api_relay_pct`, lib/api-relay.ts) est à 100 depuis le 28/09/2026.
        v: "L'API de lecture v1, servie sous un rôle de base en lecture seule. En service depuis le 27/09/2026 pour le serveur MCP, et depuis le 28/09/2026 pour tous les porteurs de jeton : la console lui relaie leurs lectures.",
        s: "atteint",
        preuve: "services/api/server.mjs",
      },
      {
        k: "Backend de la console",
        // Service `console-api` : Vercel y est branché depuis le 27/09/2026 (CONSOLE_API_URL,
        // lib/backend.ts) ; la connexion l'emprunte. Écrans et écritures : drapeaux à 100
        // depuis le 06/10/2026 ; sans mode strict, la console garde le repli sur la base.
        v: "Comptes, sessions, écrans et écritures de la console, hors de Vercel. La connexion passe par lui depuis le 27/09/2026, les écrans et les écritures depuis le 06/10/2026 ; la console garde encore son accès à la base, en repli.",
        s: "partiel",
        preuve: "services/console-api/server.mjs",
      },
      {
        k: "Notification",
        // Service `notifier` : seul détenteur des secrets sortants ; le scheduler ne livre
        // plus (SCHEDULER_DELIVERY « off », passes à 15 min : .railway/railway.ts).
        v: "Livre ce que la plateforme a décidé de dire — webhooks signés, e-mails — et détient seul les secrets de ces envois. Il passe toutes les 15 minutes, juste après les travaux planifiés.",
        s: "atteint",
        preuve: "services/notifier/worker.mjs",
      },
      {
        k: "Travaux planifiés",
        v: `Seul service qui modifie le schéma : il applique les migrations avant chaque déploiement — vérifié le ${MIGRATIONS_CONSTATEES.le} sur un vrai déploiement. Puis les travaux planifiés : évaluation des alertes et des objectifs de service, sondes de disponibilité, purge de rétention, comptage du volume. Un verrou en base garantit qu'une seule instance travaille à la fois.`,
        s: "atteint",
        preuve: "services/scheduler/worker.mjs",
      },
      {
        k: "Serveur MCP",
        // Sans son adresse (recette du 26/09/2026) : une URL d'infrastructure sur une page
        // publique dessine la carte de la plateforme. Les clients la trouvent dans
        // « API et MCP », derrière la connexion.
        v: "Serveur Model Context Protocol en lecture seule, pour interroger la console depuis un assistant d'IA. Son image n'a volontairement aucun accès à la base : c'est le seul service qu'un modèle de langage pilote.",
        s: "atteint",
        preuve: "services/mcp/http.mjs",
      },
      {
        k: "Images",
        // Six Dockerfiles (services/*/Dockerfile) ; .github/workflows/docker-smoke.yml
        // les construit et les démarre tous, et vérifie l'uid et l'absence de `pg`
        // dans l'image mcp.
        v: "Une image conteneur par service, chacune avec sa commande de démarrage explicite, sur une version de Node figée et sans droits d'administration. L'intégration continue construit et démarre chaque image, et vérifie que celle du serveur MCP ne sait pas joindre la base. Les six tournent en production depuis le 27/09/2026.",
        s: "atteint",
        preuve: "services/mcp/Dockerfile",
      },
      {
        k: "Déploiement",
        // La région n'est pas redite ici : elle est dans le tableau d'hébergement de la
        // présentation, la seule place où l'hébergement s'écrit.
        v: `Déploiement automatique depuis la branche principale — relevé le ${RAILWAY.releve} chez l'hébergeur.`,
        s: "atteint",
      },
    ],
  },
  {
    titre: "Capteurs posés chez le client",
    sous: "Deux façons de mesurer : une balise dans la page, ou une extension sur le poste. Même SDK, même chaîne de traitement.",
    lignes: [
      {
        k: "SDK web",
        v: `${koTexte(SDK_GZIP_KO)} ko gzip pour le cœur — mesuré sur le bundle publié, contre un budget de ${SDK_BUDGET_KO} ko que le build refuse de dépasser.`,
        s: "atteint",
        preuve: "apps/console/public/mip-rum.js",
      },
      {
        k: "Modules à la demande",
        v: `Le rejeu (${koTexte(REPLAY_GZIP_KO)} ko gzip) et le widget d'avis (${koTexte(FEEDBACK_GZIP_KO)} ko gzip) sont des modules séparés, chargés seulement si l'application les active. Le cœur ne les porte pas.`,
        s: "atteint",
        preuve: "apps/console/public/mip-rum-replay.js",
      },
      {
        k: "Extension navigateur",
        v: `Manifest V3, version ${EXT_VERSION}, Chrome et Edge. Quatre permissions (${EXT_PERMISSIONS.join(", ")}), jamais l'accès à tous les sites : le capteur ne s'active que sur les domaines déclarés dans un registre tenu par MIP.`,
        s: "atteint",
        preuve: "apps/extension/manifest.json",
      },
      {
        k: "Compte développeur Chrome",
        // Le point que l'utilisateur voulait voir écrit noir sur blanc : le kit
        // est prêt, la marche restante n'est pas technique.
        v: "Pas encore ouvert. Le dossier de soumission au Chrome Web Store est prêt (paquet, visuels, textes, justification de chaque permission, page de confidentialité publique), mais l'extension n'y est pas publiée : elle s'installe par politique d'entreprise ou manuellement, pas pour le grand public.",
        s: "manque",
        preuve: "apps/extension/pack.mjs",
      },
      {
        k: "Mobile",
        v: `React Native seulement, paquet privé en v${RN_VERSION}, jamais exécuté sur un appareil. Pas de SDK iOS ni Android natif.`,
        s: "partiel",
        preuve: "packages/rum-mobile/src/core.ts",
      },
    ],
  },
  {
    titre: "Console et livraison",
    sous: "Ce qui sert les écrans, et comment le code arrive en production.",
    lignes: [
      {
        k: "Console",
        // « aucun JavaScript » aurait été faux : la bascule clair/sombre est un
        // îlot client. Elle est le SEUL de la vitrine — les onglets de cette
        // section eux-mêmes sont en CSS pur. On dit donc l'exception plutôt que
        // de l'omettre.
        // « seul îlot client » n'est plus vrai depuis la recette du 26/09/2026 : les
        // tableaux larges défilent dans un cadre qui mesure son débordement. On dit donc
        // ce qui s'exécute, pas une absence.
        v: "Next.js 15 / React 19, rendu côté serveur. Les pages publiques n'envoient au navigateur que de petits îlots interactifs — la bascule clair/sombre, le défilement des tableaux larges — ; les onglets de ces spécifications sont en CSS, sans script.",
        s: "atteint",
        preuve: "apps/console/app/presentation/page.tsx",
      },
      {
        k: "Conteneurisation",
        // Lot C12b (le cadrage de console-api) : l'image de la console
        // vient après le retrait de son accès à la base (C12), qui n'est pas fait.
        v: "Le backend a ses images, pas la console. L'argument « déployable chez vous » n'est donc pas livrable de bout en bout. Une image de la console suppose d'abord de lui retirer son accès direct à la base : ni l'un ni l'autre n'est fait.",
        s: "manque",
      },
      {
        k: "Migrations",
        v: "Registre des migrations à empreintes, chaque fichier dans sa propre transaction, adoption d'une base existante sans rejeu. Rejouées à chaque intégration continue contre une base vierge.",
        s: "atteint",
        preuve: "packages/db/migrate.mjs",
      },
      {
        k: "API et MCP",
        // Une écriture : POST /api/v1/deploys (app/api/v1/deploys/route.ts). Un jeton
        // de CONSOLE_API_TOKENS vaut toutes les applications, ou celles qu'il nomme
        // après « @ » (lib/api/auth.ts, parseTokenConfig).
        v: "API v1 de lecture — sa seule écriture est le marqueur de déploiement qu'envoie une chaîne d'intégration continue —, jeton limitable à certaines applications, description OpenAPI dérivée des routes elles-mêmes (elle ne peut pas décrire une route qui n'existe pas).",
        s: "atteint",
        preuve: "apps/console/lib/api/openapi.ts",
      },
    ],
  },
];

// ═════════════════════════════ Onglet 2 — mesures ═════════════════════════════

export interface Mesure {
  /** Ce qu'on capte, en français. */
  quoi: string;
  /**
   * Ce qui voyage sur le fil : nom de span OTLP, ou attribut de ressource. C'est
   * la CLÉ de l'aiguillage à l'ingestion — le test la cherche dans le parseur.
   * `null` = canal séparé (le rejeu ne passe pas par OTLP).
   */
  otlp: string | null;
  /** Table d'arrivée en base. Le test la cherche dans le schéma. */
  table: string;
  /** Module qui l'émet. Le test ouvre le fichier. */
  module: string;
  /** Ce qu'on en fait, et la limite s'il y en a une. */
  detail: string;
}

export const MESURES: Mesure[] = [
  {
    quoi: "Core Web Vitals",
    otlp: "webvital.",
    table: "rum_metric",
    module: "packages/rum-sdk/src/vitals.ts",
    detail:
      "LCP, INP, CLS, FCP, TTFB au p75 par route et par appareil, notés au barème Google, avec l'attribution : quel élément a mis le plus de temps, quelle interaction a été lente, quel bloc a décalé la page.",
  },
  {
    quoi: "Décomposition réseau de la navigation",
    otlp: "webvital.",
    table: "rum_metric",
    module: "packages/rum-sdk/src/navtiming.ts",
    detail:
      "Redirection, DNS, TCP, TLS, requête, réponse. C'est la cause d'un TTFB lent, pas seulement son symptôme : trois problèmes opposés produisent le même TTFB. Sans note de qualité — Google ne publie pas de seuil par phase.",
  },
  // SDK web 0.6.0 (04/10/2026) : trois mesures de vue sur le canal des vitals, un
  // même identifiant par vue et des valeurs cumulées (l'ingestion garde la plus grande).
  {
    quoi: "Temps passé sur une vue",
    otlp: "webvital.",
    table: "rum_metric",
    module: "packages/rum-sdk/src/engagement.ts",
    detail:
      "Le temps où la vue était réellement affichée — un onglet en arrière-plan ne compte pas —, envoyé en cumul au passage en arrière-plan, au départ de la page et à la vue suivante. Médianes et p75 par route : où les utilisateurs restent, où ils ne font que passer.",
  },
  {
    quoi: "Profondeur de défilement",
    otlp: "webvital.",
    table: "rum_metric",
    module: "packages/rum-sdk/src/engagement.ts",
    detail:
      "Le point le plus bas atteint sur la vue, en pourcentage de sa hauteur : la fenêtre, ou le plus grand conteneur qui défile quand l'application fait défiler un panneau plutôt que la page. Une page qui ne défile pas compte comme vue jusqu'en bas. Jamais ce qui est affiché, seulement des positions.",
  },
  {
    quoi: "Poids de chaque vue",
    otlp: "webvital.",
    table: "rum_metric",
    module: "packages/rum-sdk/src/engagement.ts",
    detail:
      "Le nombre de ressources chargées pendant la vue et les octets transférés, exports de MIP exclus. Une ressource servie par le cache, ou par un tiers qui ne publie pas ses temps, compte sans octets.",
  },
  {
    quoi: "Chargement d'un changement d'écran SPA",
    otlp: "webvital.SPA_LOAD",
    table: "rum_metric",
    module: "packages/rum-sdk/src/spa-load.ts",
    detail:
      "Du pushState à la dernière mutation de la page ou requête suivie de 100 ms de calme, la méthode des outils RUM du marché. La page vue d'une navigation SPA est instantanée : sans cette mesure, un écran qui met 4 s à se remplir passe pour immédiat. Un clic ou une touche avant la fin l'annule ; au-delà de 10 s, rien n'est envoyé.",
  },
  {
    quoi: "Pages vues et routes",
    otlp: "pageview",
    table: "rum_pageview",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "Route normalisée (les identifiants deviennent :id, sinon chaque page produirait sa propre statistique), navigations SPA comprises — pushState, replaceState et retour arrière. Depuis le SDK 0.5.0, un retour arrière servi par le cache du navigateur (bfcache) compte une page vue, avec sa propre trace, et une page prérendue n'est mesurée que si elle s'affiche : les pages vues montent un peu, d'autant que les visiteurs reviennent en arrière. La normalisation du SDK ne couvre que les entiers, les UUID et les hexadécimaux longs : depuis le 10/09/2026 chaque application peut ajouter ses propres règles, appliquées en base — donc quel que soit le chemin d'arrivée des mesures — et rejouables sur l'historique pour que la série d'une route ne se coupe pas en deux le jour où la règle est écrite. Au-delà de 2 000 routes distinctes par application, les routes inédites sont regroupées sous « (other) » et l'écran de santé interne le signale : la dimension cesse de croître, et la perte de détail est visible.",
  },
  {
    quoi: "Sessions pseudonymes",
    otlp: "mip.session_id",
    table: "rum_session",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "Type d'appareil, navigateur déduit du user-agent, pays déduit du fuseau horaire — et à défaut de l'en-tête pays que pose le CDN, quand il y en a un devant. Pour les mesures envoyées directement au collecteur (celles de la console seule, depuis le 28/09/2026), le pays vient de l'adresse IP, lue dans une base IP→pays embarquée. Aucune adresse IP n'est stockée côté MIP ; « ni même résolue » serait faux, puisque c'est bien une résolution IP→pays que fait le CDN dans ce second cas. Le visiteur porte un identifiant tiré au hasard par le SDK, gardé dans le stockage local du navigateur : ni cookie, ni dérivation du terminal, effaçable par le visiteur. Depuis le SDK 0.5.0 : quand le site exige le consentement, rien n'est écrit dans ce stockage avant l'accord, et un refus l'efface ; une session se ferme après 30 minutes d'inactivité, ou 4 heures après son début même active — un écran resté ouvert toute la journée compte plusieurs sessions. Les sessions antérieures au 09/09/2026, identifiées par une empreinte du terminal partagée par tout un parc homogène, restent marquées comme telles et sortent des comptes de personnes. Source de collecte (balise ou extension), version déployée, qualité du lien.",
  },
  {
    quoi: "Erreurs JavaScript",
    otlp: "exception",
    table: "rum_error",
    module: "packages/rum-sdk/src/errors.ts",
    detail:
      "Erreurs non capturées et promesses rejetées, groupées par empreinte (type, message, première frame) pour qu'un même bug ne compte qu'une fois. Message et pile nettoyés des données personnelles à l'émission ET à l'ingestion.",
  },
  {
    quoi: "Erreurs navigateur sur option",
    otlp: "exception",
    table: "rum_error",
    module: "packages/rum-sdk/src/error-capture.ts",
    detail:
      "Activées voie par voie, jamais par défaut : console.error, ressources qui échouent à charger, violations CSP, appels fetch/XHR en échec, en délai dépassé ou en 5xx — les 4xx et les abandons volontaires seulement sur demande. Chaque voie a son plafond par page, et ses pertes sont comptées dans le navigateur, pas encore à l'ingestion. Ni query string, ni corps, ni en-tête de requête ; ni l'extrait inline d'une violation CSP ; aucun statut HTTP deviné pour une ressource.",
  },
  {
    quoi: "Erreurs des Web Workers et des WebSockets",
    otlp: "exception",
    table: "rum_error",
    module: "packages/rum-sdk/src/error-capture.ts",
    detail:
      "Actives par défaut depuis le SDK 0.6.0, coupables une à une : l'erreur non interceptée d'un worker, qui n'atteint jamais le gestionnaire global de la page, et la WebSocket qui échoue ou se ferme anormalement. Dix par page et par voie. Une WebSocket n'est nommée que par son hôte et son chemin, jamais par sa requête, où passent souvent les jetons.",
  },
  {
    quoi: "Ressources lentes",
    otlp: "resource",
    table: "rum_resource",
    module: "packages/rum-sdk/src/resources.ts",
    detail:
      "Au-delà de 300 ms par défaut : type, taille transférée, blocage du rendu. De quoi désigner le script tiers ou l'image qui retarde la page. Sur option, tout ce que la page charge, 150 par page.",
  },
  {
    quoi: "Blocage du fil principal, attribué",
    otlp: "loaf",
    table: "rum_longtask",
    module: "packages/rum-sdk/src/loaf.ts",
    detail:
      "Long Animation Frames : non seulement que le fil a bloqué, mais quel script le tenait — URL, nom de fonction, et ce qui l'a invoqué (un clic, un minuteur). C'est le chaînon qui manquait entre « INP à 900 ms » et un correctif. API Chromium ; ailleurs le SDK retombe sur les Long Tasks, qui disent la durée sans la cause.",
  },
  {
    quoi: "Tâches longues (repli)",
    otlp: "longtask",
    table: "rum_longtask",
    module: "packages/rum-sdk/src/longtasks.ts",
    detail:
      "Les blocages de plus de 50 ms, sans attribution. Utilisé uniquement là où Long Animation Frames n'existe pas : les deux ensemble compteraient deux fois le même blocage. L'API est elle-même absente de Safari.",
  },
  {
    quoi: "Fil d'Ariane",
    otlp: "breadcrumb",
    table: "rum_breadcrumb",
    module: "packages/rum-sdk/src/breadcrumbs.ts",
    detail:
      "Les clics et navigations qui précèdent une erreur, dans l'ordre — ce qui manquait pour reproduire un bug. Des libellés, jamais des valeurs saisies.",
  },
  {
    quoi: "Appels réseau et traces distribuées",
    otlp: "http.client",
    table: "rum_span",
    module: "packages/rum-sdk/src/apispans.ts",
    detail:
      "fetch et XHR : méthode, URL nettoyée, statut, durée, avec un traceparent W3C propagé vers le même domaine et les origines déclarées. Le span descend de la page vue et le span serveur descend de lui : la trace est un arbre enraciné. Chaque appel y a sa durée réelle — son span s'ouvre au départ de la requête et se ferme à la réponse : ses en-têtes pour fetch (un corps long ou en flux n'est pas compté), sa fin pour XHR — et les attributs HTTP stables d'OpenTelemetry (http.request.method, url.full, http.response.status_code, error.type d'un appel en échec) à côté des anciens. La page vue racine reste un instant. Un seul saut : du navigateur au serveur, pas d'un serveur à l'autre.",
  },
  // Côté serveur, aucun capteur maison depuis le 29/09/2026 : l'émetteur est
  // l'agent OpenTelemetry officiel du langage du client, hors de ce dépôt. Le
  // module cité est donc l'aiguillage qui reçoit le signal, le seul code de MIP
  // qui le nomme.
  {
    quoi: "Traces serveur",
    otlp: "http.server",
    table: "rum_span",
    module: "packages/backend/shared/otlp.mjs",
    detail:
      "Côté serveur, rien de propre à MIP : l'agent OpenTelemetry officiel du langage (Python, Node, Java, .NET…) lit l'en-tête traceparent posé par le navigateur et rattache ses spans à la trace de la page vue, sans changement de code dans l'application. La collecte reçoit l'OTLP standard, réglé par un socle commun de variables OTEL_*.",
  },
  {
    quoi: "Logs applicatifs",
    otlp: "resourceLogs",
    table: "rum_log",
    module: "packages/backend/shared/otlp.mjs",
    detail:
      "Le troisième signal OpenTelemetry : les journaux du serveur, exportés par le même agent officiel, porteurs de l'identifiant de trace, donc lisibles à côté de la trace qui les a produits.",
  },
  {
    quoi: "Signaux de frustration",
    otlp: "frustration",
    table: "rum_event",
    module: "packages/rum-sdk/src/frustration.ts",
    detail:
      "Clics de rage et clics morts : l'utilisateur insiste, ou clique sur ce qui ne réagit pas. Un symptôme que ni le LCP ni le taux d'erreur ne montrent.",
  },
  {
    quoi: "Formulaires",
    otlp: "track.form.",
    table: "rum_event",
    module: "packages/rum-sdk/src/forms.ts",
    detail:
      "Ordre des champs, temps passé sur chacun, abandon. jamais les valeurs saisies : identifiants et durées seulement, et un champ mot de passe est réduit au libellé « [password] ».",
  },
  {
    quoi: "Événements métier et avis utilisateur",
    otlp: "track.",
    table: "rum_event",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "MIPRum.track() pour ce que l'app veut compter, et la note de 1 à 5 du widget d'avis. Les propriétés passent au même filtre des données personnelles que le reste.",
  },
  {
    quoi: "Repères du développeur",
    otlp: "rum.timing",
    table: "rum_event",
    module: "packages/rum-sdk/src/user-timings.ts",
    detail:
      "Les performance.mark et performance.measure que l'application pose déjà, relevés sans ligne de code de plus : l'instant d'un repère depuis le début de la vue, la durée d'une mesure. Ceux des outils (React, Next.js, webpack…) sont écartés ; 30 par vue.",
  },
  {
    quoi: "Rejeu de session",
    otlp: null, // canal séparé : POST /v1/replay, pas OTLP
    table: "replay_chunk",
    module: "packages/rum-sdk/src/replay.ts",
    detail:
      "rrweb, activé application par application, sur un canal séparé. Masqué par défaut : saisies, texte de la page et médias (images, vidéos, canvas, SVG). L'app peut démasquer une zone choisie (classe mip-rum-unmask ou option replayUnmask) : son texte et ses médias passent en clair ; ses champs natifs et contenteditable restent masqués. Les blocs marqués par l'app ne sont jamais capturés. Plafonné à 2 minutes et 1 Mo par session.",
  },
];

/**
 * Ce qui n'est pas mesuré alors que ça devrait l'être — et qui ne figure nulle
 * part ailleurs, contrairement aux lignes venues de dashboard-blocs.
 *
 * `marqueur` est le fragment de code dont l'APPARITION rendrait la ligne fausse.
 * Le test échoue si on le trouve : le jour où quelqu'un implémente LoAF, la
 * vitrine ne peut plus prétendre qu'il manque.
 */
export interface AngleMort {
  label: string;
  raison: string;
  /** [fichier(s) ou dossier(s) à fouiller, fragment qui ne doit PAS s'y trouver] */
  marqueur: [string | string[], string];
}

export const ANGLES_MORTS: AngleMort[] = [
  {
    label: "Conventions sémantiques OpenTelemetry du SDK React Native",
    // Ce qui reste de l'ancienne ligne « Spans OTLP plats », puis de la ligne
    // « Conventions sémantiques OpenTelemetry » : le SDK WEB a rejoint le
    // vocabulaire standard le 01/10/2026 — attributs HTTP stables, erreur portée
    // en événement « exception » (packages/rum-sdk/src/otel.ts), et des appels
    // qui durent (realEmit, packages/rum-sdk/src/index.ts). Le SDK React Native
    // n'a pas suivi : c'est lui que le marqueur surveille désormais.
    raison:
      "Le SDK web suit les conventions HTTP stables (http.request.method, url.full, http.response.status_code) et porte chaque erreur dans un événement « exception ». Le SDK React Native n'a pas suivi : ses appels réseau gardent l'ancienne convention http.method / http.url, et ses erreurs ne portent que leur statut d'erreur — un backend tiers les compte, sans en lire le type ni le message à l'endroit standard.",
    marqueur: ["packages/rum-mobile/src", "http.request.method"],
  },
];

/**
 * La couverture par navigateur, dite une fois pour toutes.
 *
 * Ce n'est PAS une fonctionnalité manquante — c'est une limite du navigateur,
 * qu'aucun capteur du marché ne franchit. La taire donnerait à croire que les
 * chiffres valent pour tout le trafic ; ils valent pour l'échantillon qui sait
 * les produire.
 */
export const NOTE_NAVIGATEURS =
  "Deux mesures dépendent d'API que seul Chromium expose : les tâches longues (absentes de Safari) et la qualité du lien réseau (absente de Safari et de Firefox). Le SDK les lit défensivement et collecte le reste sans elles — mais sur ces deux points, l'échantillon penche vers Chrome. Aucun capteur du marché ne fait autrement.";

/**
 * Les mesures non couvertes, telles que la console les déclare DÉJÀ dans la roue
 * des blocs de chaque tableau de bord. Reprises telles quelles, avec leur motif.
 *
 * Deux catalogues peuvent nommer la même absence ; on garde la première
 * occurrence, pour ne pas afficher deux fois la même ligne.
 */
export function mesuresNonCouvertes(): (Indisponible & { ecran: string })[] {
  const vues = new Set<string>();
  const out: (Indisponible & { ecran: string })[] = [];
  for (const cat of CATALOGUES) {
    for (const i of cat.indisponibles) {
      if (vues.has(i.label)) continue;
      vues.add(i.label);
      out.push({ ...i, ecran: cat.titre });
    }
  }
  return out;
}
