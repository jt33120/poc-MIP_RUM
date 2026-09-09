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
//      de lib/legal.ts (les mêmes chaînes que /legal/mentions), l'adresse du
//      serveur MCP de lib/mcp-public.ts, les mesures non couvertes de
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
import { HOSTS } from "./legal";
import { MCP_ORIGINE } from "./mcp-public";

export type Statut = "atteint" | "partiel" | "manque" | "non-mesure";

// ══════════════════════════ Onglet 1 — infrastructure ══════════════════════════

/** Poids gzip du bundle cœur publié (apps/console/public/mip-rum.js). Mesuré. */
export const SDK_GZIP_KO = 12.4;
/** Budget que le build refuse de dépasser (packages/rum-sdk/build.mjs). */
export const SDK_BUDGET_KO = 35;
/** Bundle rejeu, chargé À LA DEMANDE et seulement si le rejeu est activé. */
export const REPLAY_GZIP_KO = 56.9;
/** Widget d'avis, chargé à la demande lui aussi. */
export const FEEDBACK_GZIP_KO = 7.6;

/** Version de l'extension, telle qu'elle est dans apps/extension/manifest.json. */
export const EXT_VERSION = "0.4.3";
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
    sous: "Les mêmes chaînes que les mentions légales — elles ne peuvent pas diverger.",
    lignes: [
      // Importées de lib/legal.ts : ce sont littéralement les valeurs servies sur
      // /legal/mentions et /legal/dpa. Les retaper ici aurait recréé la
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
    titre: "Backend — trois services autonomes",
    sous: `Projet Railway ${RAILWAY.projet}, environnement production. Ni framework, ni serverless : du Node et du PostgreSQL, dans des images construites depuis ce dépôt.`,
    lignes: [
      {
        k: "ingest",
        v: "Réception OTLP (traces, logs, rejeu). Healthcheck /health, redémarrage sur échec. Porte la commande pre-deploy des migrations : le schéma ne peut plus être en retard sur le code.",
        s: "atteint",
        preuve: "services/ingest/server.mjs",
      },
      {
        k: "scheduler",
        v: "Travaux planifiés : évaluation des alertes, SLO, sondes uptime, purge de rétention, comptage du volume. Bail d'exclusion en base (scheduler_lease) pour qu'une seule instance travaille à la fois.",
        s: "atteint",
        preuve: "services/scheduler/worker.mjs",
      },
      {
        k: "mcp",
        v: `Serveur Model Context Protocol, lecture seule, ouvert sur ${MCP_ORIGINE}. Image SÉPARÉE, volontairement sans « pg » ni DATABASE_URL : c'est le seul service pilotable par un modèle de langage, il ne doit pas pouvoir atteindre la base.`,
        s: "atteint",
        preuve: "services/mcp/http.mjs",
      },
      {
        k: "Images",
        v: "Deux Dockerfiles : un pour ingest et scheduler (même noyau, seule la commande change), un pour mcp. Un test de CI vérifie que « pg » est bien absent de la seconde.",
        s: "atteint",
        preuve: "infra/docker/Dockerfile.mcp",
      },
      {
        k: "Déploiement",
        v: `Branche ${RAILWAY.branche}, région ${RAILWAY.region} (Amsterdam), un replica par service — relevé le ${RAILWAY.releve} dans la console Railway.`,
        s: "atteint",
      },
    ],
  },
  {
    titre: "Capteurs posés chez le client",
    sous: "Deux façons de mesurer : une balise dans la page, ou une extension sur le poste. Même SDK, même pipeline.",
    lignes: [
      {
        k: "Snippet SDK",
        v: `${SDK_GZIP_KO.toString().replace(".", ",")} ko gzip pour le cœur — mesuré sur le bundle publié, contre un budget de ${SDK_BUDGET_KO} ko que le build refuse de dépasser.`,
        s: "atteint",
        preuve: "apps/console/public/mip-rum.js",
      },
      {
        k: "Modules à la demande",
        v: `Le rejeu (${REPLAY_GZIP_KO.toString().replace(".", ",")} ko gzip, rrweb) et le widget d'avis (${FEEDBACK_GZIP_KO.toString().replace(".", ",")} ko gzip) sont des bundles SÉPARÉS, chargés seulement si l'app les active. Le cœur ne les porte pas.`,
        s: "atteint",
        preuve: "apps/console/public/mip-rum-replay.js",
      },
      {
        k: "Extension navigateur",
        v: `Manifest V3, version ${EXT_VERSION}, Chrome et Edge. Quatre permissions (${EXT_PERMISSIONS.join(", ")}) et JAMAIS <all_urls> : le capteur ne s'active que sur les domaines d'un registre déclaré côté MIP.`,
        s: "atteint",
        preuve: "apps/extension/manifest.json",
      },
      {
        k: "Compte développeur Chrome",
        // Le point que l'utilisateur voulait voir écrit noir sur blanc : le kit
        // est prêt, la marche restante n'est pas technique.
        v: "Inexistant. Le kit de soumission est prêt (paquet, visuels, textes, justification de chaque permission, page de confidentialité publique), mais aucun compte n'est ouvert et les 5 $ d'inscription ne sont pas payés. L'extension ne s'installe donc qu'en sideload ou par politique d'entreprise — pas pour le grand public.",
        s: "manque",
        preuve: "docs/CHROME_WEB_STORE.md",
      },
      {
        k: "Mobile",
        v: "React Native seulement, paquet privé en v0.1. Pas de SDK iOS ni Android natif.",
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
        v: "Next.js 15 / React 19, rendu serveur. Sur la vitrine publique, la bascule clair/sombre est le seul îlot client : cette page, onglets de cette section compris, ne coûte pas une ligne de JavaScript applicatif.",
        s: "atteint",
        preuve: "apps/console/app/presentation/page.tsx",
      },
      {
        k: "Conteneurisation",
        v: "Le backend a ses images, pas la console. L'argument « souverain, déployable chez vous » n'est donc pas livrable de bout en bout.",
        s: "manque",
      },
      {
        k: "Migrations",
        v: "Registre schema_migration à empreintes, chaque fichier dans sa propre transaction, adoption d'une base existante sans rejeu. Rejouées en CI contre un PostgreSQL vierge.",
        s: "atteint",
        preuve: "apps/ingest/migrate.mjs",
      },
      {
        k: "API et MCP",
        v: "API v1 de lecture, jeton porteur scopé par application, spécification OpenAPI dont la liste des endpoints est DÉRIVÉE (l'annonce ne peut plus décrire une route qui n'existe pas).",
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
      "Redirection, DNS, TCP, TLS, requête, réponse. C'est la CAUSE d'un TTFB lent, pas seulement son symptôme : trois problèmes opposés produisent le même TTFB. Sans note de qualité — Google ne publie pas de seuil par phase.",
  },
  {
    quoi: "Pages vues et routes",
    otlp: "pageview",
    table: "rum_pageview",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "Route normalisée (les identifiants deviennent :id, sinon chaque page produirait sa propre statistique), navigations SPA comprises — pushState, replaceState et retour arrière.",
  },
  {
    quoi: "Sessions anonymes",
    otlp: "mip.session_id",
    table: "rum_session",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "Type d'appareil, navigateur déduit du user-agent, pays DÉDUIT DU FUSEAU HORAIRE — aucune adresse IP n'est stockée, ni même résolue. Nouveau ou revenant, source de collecte (balise ou extension), version déployée, qualité du lien.",
  },
  {
    quoi: "Erreurs JavaScript",
    otlp: "exception",
    table: "rum_error",
    module: "packages/rum-sdk/src/errors.ts",
    detail:
      "Erreurs non capturées et promesses rejetées, groupées par empreinte (type, message, première frame) pour qu'un même bug ne compte qu'une fois. Message et pile nettoyés de la PII à l'émission ET à l'ingestion.",
  },
  {
    quoi: "Ressources lentes",
    otlp: "resource",
    table: "rum_resource",
    module: "packages/rum-sdk/src/resources.ts",
    detail:
      "Au-delà de 300 ms par défaut : type, taille transférée, blocage du rendu. De quoi désigner le script tiers ou l'image qui retarde la page.",
  },
  {
    quoi: "Tâches longues",
    otlp: "longtask",
    table: "rum_longtask",
    module: "packages/rum-sdk/src/longtasks.ts",
    detail:
      "Les blocages du fil principal de plus de 50 ms. L'API est absente de Safari : sur ce navigateur la mesure n'existe pas, et le SDK collecte le reste sans elle.",
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
    quoi: "Appels réseau et tracing distribué",
    otlp: "http.client",
    table: "rum_span",
    module: "packages/rum-sdk/src/apispans.ts",
    detail:
      "fetch et XHR : méthode, URL nettoyée, statut, durée, avec un traceparent W3C propagé vers le même domaine et les origines déclarées. Un seul saut : front → back, pas back → back.",
  },
  {
    quoi: "Traces serveur",
    otlp: "http.server",
    table: "rum_span",
    module: "packages/agent-node/src/core.ts",
    detail:
      "L'agent Node referme la corrélation côté serveur : il patche node:http, donc sans changement de code dans l'application, et rattache à la trace de la page vue un span par requête plus un span enfant par requête SQL. Côté Python, un middleware FastAPI/Starlette d'un seul fichier fait la même chose.",
  },
  {
    quoi: "Logs applicatifs",
    otlp: "resourceLogs",
    table: "rum_log",
    module: "packages/agent-node/src/core.ts",
    detail:
      "Le troisième signal OpenTelemetry, qu'aucun de nos capteurs n'émettait : les logs serveur au-dessus d'un niveau plancher, porteurs du trace_id, donc lisibles à côté de la trace qui les a produits.",
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
      "Ordre des champs, temps passé sur chacun, abandon. JAMAIS les valeurs saisies : identifiants et durées seulement, et un champ mot de passe est réduit au libellé « [password] ».",
  },
  {
    quoi: "Événements métier et avis utilisateur",
    otlp: "track.",
    table: "rum_event",
    module: "packages/rum-sdk/src/index.ts",
    detail:
      "MIPRum.track() pour ce que l'app veut compter, et la note de 1 à 5 du widget d'avis. Les propriétés passent au même filtre PII que le reste.",
  },
  {
    quoi: "Rejeu de session",
    otlp: null, // canal séparé : POST /v1/replay, pas OTLP
    table: "replay_chunk",
    module: "packages/rum-sdk/src/replay.ts",
    detail:
      "rrweb, activé application par application, sur un canal séparé. Saisies masquées et blocs marqués exclus ; plafonné à 2 minutes et 1 Mo par session. Le texte et les médias ne sont PAS encore masqués.",
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
  /** [fichier ou dossier à fouiller, fragment qui ne doit PAS s'y trouver] */
  marqueur: [string, string];
}

export const ANGLES_MORTS: AngleMort[] = [
  {
    label: "Long Animation Frames (LoAF)",
    raison:
      "Le successeur des Long Tasks, et la seule façon d'attribuer un INP mauvais à la fonction qui l'a causé. L'API est disponible sur Chromium ; rien ne la lit ici. C'est l'écart le plus net avec un RUM du marché.",
    marqueur: ["packages/rum-sdk/src", "long-animation-frame"],
  },
  {
    label: "Spans OTLP plats",
    raison:
      "Le SDK navigateur sérialise ses spans sans parentSpanId, sans kind et sans status : la parenté voyage dans un attribut mip.parent_span_id que seul notre backend sait relire. Un collecteur OpenTelemetry tiers accepterait le flux, mais reconstruirait mal le waterfall. « Backend remplaçable » n'est donc vrai qu'à moitié.",
    marqueur: ["packages/rum-sdk/src/otlp-encode.ts", "parentSpanId"],
  },
  {
    label: "Supervision d'un serveur vocal (SVI)",
    raison:
      "La chaîne d'ingestion, le schéma et les écrans existent ; aucun capteur de ce dépôt n'émet cette télémétrie. Elle doit venir de la plateforme vocale du client — rien ne se mesure tout seul aujourd'hui.",
    marqueur: ["packages", "svi."],
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
