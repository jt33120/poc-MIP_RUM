// La page « À faire » (/presentation/a-faire, 30/09/2026), première moitié : les
// HYPOTHÈSES RÉDUCTRICES du POC — ce qu'on a choisi petit, lent ou provisoire parce
// qu'un POC le permet, et ce qu'une mise en service changerait. La seconde moitié,
// les chantiers, reprend « Ce qui reste » (lib/presentation-reste.ts) et y ajoute
// ceux que les documents d'exploitation tiennent (CHANTIERS, plus bas).
//
// Relevé du 30/09/2026. Chaque entrée cite ses sources (`sources`, fichier:ligne) :
// elles ne s'affichent pas — la page s'adresse à une DSI, pas à qui lit le code —
// mais une affirmation se vérifie avant d'être écrite, et se re-vérifie en les
// suivant. Une hypothèse levée sort de la liste, avec son commit.
//
// Relevé du 02/10/2026, après la nuit du 01/10 : H8 (escalade par niveaux, pas
// d'astreinte) et H9 (veille du scheduler par le notifier) réécrites par leurs lots ;
// les citations des fichiers que la nuit a modifiés (README du scheduler) recalées.
//
// Relevé du 05/10/2026, veille de la réunion : H14 (l'émetteur OTLP du SDK, ADR-0016,
// proposé à la validation de l'équipe), H15 (où le SDK est servi) et X9 (le backend
// d'UTI, encore sur l'ancien capteur maison), X10 (case de consentement du rejeu).

export interface Hypothese {
  id: string;
  titre: string;
  /** Ce qui est vrai aujourd'hui, chiffres compris. */
  aujourdhui: string;
  /** Pourquoi c'est tenable pour un POC. */
  pourquoi: string;
  /** Ce qu'une mise en service demanderait. */
  production: string;
  sources: readonly string[];
}

export const RELEVE_HYPOTHESES = "05/10/2026";

export const HYPOTHESES: readonly Hypothese[] = [
  {
    id: "H1",
    titre: "Neon comme base de données",
    aujourdhui:
      "Postgres chez Neon, à Francfort, sur une offre payée à l'usage depuis le 27/09/2026, calcul plafonné à 0,25 unité et mise en veille dès que personne ne s'en sert.",
    pourquoi: "Peu de trafic : une base qui dort entre deux passages ne coûte presque rien.",
    production: "La base que retiendra la DSI de MIP, dimensionnée pour un vrai trafic.",
    sources: ["docs/architecture/adr/0014-base-gratuite.md:40-54", "docs/architecture/overview.md:16", "AGENTS.md:129-131"],
  },
  {
    id: "H2",
    titre: "Les travaux planifiés passent toutes les 15 minutes",
    aujourdhui:
      "Alertes, objectifs de service, sondes de disponibilité et envoi des notifications tournent au quart d'heure. Une alerte peut donc partir jusqu'à 15 minutes après sa cause.",
    pourquoi: "Chaque passage réveille la base, et chaque réveil se paie : au quart d'heure, elle dort environ 63 % du temps.",
    production:
      "Un passage toutes les 5 minutes et des notifications toutes les 15 secondes : deux réglages, sans changement de code.",
    sources: [".railway/railway.ts:366-372", ".railway/railway.ts:406-409", "packages/backend/jobs/cadence.mjs:27-38", "services/scheduler/README.md:20,63"],
  },
  {
    id: "H3",
    titre: "Une seule région d'hébergement",
    aujourdhui:
      "Tous les services du backend sont à Amsterdam, en deux exemplaires pour la collecte et les API, en un seul pour l'assistant IA, les travaux planifiés et les notifications.",
    pourquoi: "Un second exemplaire des notifications n'apporterait rien au volume d'un POC.",
    production: "Une reprise après sinistre dans une autre région, et plus d'exemplaires pour les travaux de fond.",
    sources: [".railway/railway.ts:65", ".railway/railway.ts:205,271,303,334,359,394"],
  },
  {
    id: "H4",
    titre: "Une collecte dimensionnée pour quelques visiteurs à la fois",
    aujourdhui:
      "Environ 0,58 lot de mesures par seconde et par application au plus, soit quelques visiteurs actifs en même temps, et 600 requêtes par application et par minute.",
    pourquoi: "L'objectif de trafic du POC, 500 événements par jour, en est très loin.",
    production:
      "Une écriture en un seul aller-retour vers la base, obligatoire avant qu'un client dépasse quelques visiteurs simultanés, et des plafonds réglés par client.",
    sources: ["docs/architecture/overview.md:130", "docs/operations/banc-collecteur-2026-09-24.md:17-34", "services/collector/server.mjs:42"],
  },
  {
    id: "H5",
    titre: "Les rejeux de session rangés dans la base",
    aujourdhui: "Les enregistrements de session et les source maps sont stockés dans Postgres, avec les mesures.",
    pourquoi: "Une seule sauvegarde, une seule purge, un seul effacement à la demande d'un visiteur.",
    production: "Un stockage objet en Union européenne, au-delà de 5 Go ou de la moitié du stockage.",
    sources: ["docs/architecture/adr/0009-blobs-en-postgres.md:9-15"],
  },
  {
    id: "H6",
    titre: "Trente jours de rétention pour tous",
    aujourdhui: "Les mesures sont purgées chaque nuit au-delà de 30 jours, sauf réglage propre à une application.",
    pourquoi: "Assez pour comparer des semaines, peu de stockage à payer.",
    production: "Une durée de conservation fixée au contrat de chaque client.",
    sources: ["services/scheduler/README.md:22,61", "packages/db/sql/migration-v14.sql:9-11,52-59"],
  },
  {
    id: "H7",
    titre: "Une restauration sur 24 heures, sans préproduction",
    aujourdhui:
      "La base se restaure à n'importe quel instant des 24 dernières heures. La procédure a été répétée sur une copie, pas sur la base de production ; il n'y a pas d'environnement de préproduction.",
    pourquoi: "Pas de donnée client irremplaçable pendant le POC.",
    production: "Une fenêtre de restauration plus longue, un exercice sur la production, et une préproduction.",
    sources: ["docs/operations/runbook.md:115,119,212", "docs/operations/presentation-dsi.md:16-18", ".railway/railway.ts:23"],
  },
  {
    id: "H8",
    titre: "Des alertes par webhook, Slack ou e-mail d'essai",
    aujourdhui:
      "Les alertes partent vers un webhook ou Slack ; l'e-mail passe par un domaine d'envoi d'essai, qui ne sert que des destinataires déclarés. Les étapes d'escalade réglées sur l'écran Alertes renvoient un incident non acquitté (règle, SLO ou issue) par niveaux et relancent au passage des travaux planifiés, jusqu'au plafond de chaque étape et 7 jours au plus ; sans étape créée, rien ne s'escalade. Pas de SMS, pas de rotation ni d'outil d'astreinte.",
    pourquoi: "Une seule équipe reçoit les alertes pendant le POC.",
    production: "Un domaine d'envoi vérifié, une signature propre à chaque canal, et le branchement sur l'astreinte de MIP.",
    sources: [
      ".railway/railway.ts:399-405",
      "services/notifier/README.md:34,61",
      "docs/ALERTING.md:60-74",
      "packages/db/sql/migration-v108.sql:34,109,197",
    ],
  },
  {
    id: "H9",
    titre: "Une supervision de la supervision minimale",
    aujourdhui:
      "Une sonde externe vérifie toutes les 15 minutes que le service répond, et prévient par e-mail les personnes qui suivent le dépôt. Le service des notifications alerte quand les travaux planifiés se taisent, au troisième passage manqué (vers 46 minutes), vers les seuls canaux communs à toutes les applications : sans un tel canal, l'alerte ne se lit que dans l'écran Alertes. Lui-même n'est suivi que par son battement, affiché dans la console.",
    pourquoi: "Une panne de quelques heures ne prive aucun client pendant le POC.",
    production: "Une supervision reliée à l'astreinte, qui surveille aussi le service des notifications.",
    sources: [
      ".github/workflows/sonde-externe.yml:1-22",
      "packages/backend/jobs/veille-ordonnanceur.mjs:16-27,50-51",
      "services/notifier/README.md:26,28",
      "docs/architecture/overview.md:116,131",
    ],
  },
  {
    id: "H10",
    titre: "Des comptes créés à la main",
    aujourdhui:
      "Un administrateur crée les comptes ; pas de mot de passe oublié en libre-service. La connexion d'entreprise (SSO) existe dans le code mais n'est pas branchée sur l'annuaire de MIP.",
    pourquoi: "Une poignée d'utilisateurs, tous connus.",
    production: "La connexion par l'annuaire de MIP, obligatoire, et la gestion des comptes qui va avec.",
    sources: ["apps/console/app/login/page.tsx:164-169", "docs/architecture/overview.md:117", "docs/SSO.md:14-25"],
  },
  {
    id: "H11",
    titre: "Le cloisonnement entre clients tenu par les requêtes",
    aujourdhui:
      "Chaque requête filtre sur l'application du client. Les rôles restreints de la base, et leurs règles par ligne, sont créés mais pas encore branchés.",
    pourquoi: "Peu de clients, et un code qui passe par un seul chemin d'accès.",
    production: "Des rôles restreints en service, pour que la base elle-même refuse de mélanger deux clients.",
    sources: ["docs/architecture/adr/0003-roles-et-tenancy.md:9,21", "docs/MULTITENANT.md:13,52", "docs/operations/runbook.md:92-100"],
  },
  {
    id: "H12",
    titre: "L'extension installée hors du Chrome Web Store",
    aujourdhui: "L'extension s'installe par politique d'entreprise ou à la main, depuis l'archive servie par la console.",
    pourquoi: "Un pilote sur quelques postes n'a pas besoin du Store.",
    production: "Une publication au Store, ou un déploiement par stratégie de groupe avec un identifiant stable.",
    sources: ["apps/console/lib/specs.ts:214-219", "docs/CHROME_WEB_STORE.md:5-10", "docs/DEPLOY_EXTENSION.md:13-15"],
  },
  {
    id: "H13",
    titre: "Des adresses générées, et toutes les sessions mesurées",
    aujourdhui:
      "Les services répondent sur des adresses générées par leurs hébergeurs ; le code de suivi mesure chaque session, sans échantillonnage.",
    pourquoi: "Aucun client ne dépend encore d'une adresse, et le trafic est faible.",
    production: "Un domaine de MIP, et un échantillonnage réglé sur le trafic de chaque site.",
    sources: ["docs/architecture/overview.md:124", "docs/INTEGRATION.md:193"],
  },
  {
    id: "H14",
    titre: "Le SDK écrit lui-même son enveloppe OpenTelemetry",
    aujourdhui:
      "Le SDK parle le format standard d'OpenTelemetry sans en embarquer les bibliothèques : MIP a écrit l'émetteur. La mesure, elle, vient du navigateur et de la bibliothèque web-vitals de Google. Les évolutions de la norme se suivent à la main : les conventions HTTP l'ont été le 01/10/2026.",
    pourquoi:
      "Le SDK pèse deux fois moins lourd (27 → 12 Ko compressés le 15/07/2026), sur chaque page des sites surveillés. Les SDK de Datadog et de Sentry font le même choix.",
    production:
      "La validation de ce choix par l'équipe (ADR-0016) et une relecture de la norme à chaque version. La conformité est contrôlée depuis le 05/10/2026 : le sérialiseur et le collecteur OpenTelemetry officiels relisent la sortie du SDK à chaque modification.",
    sources: [
      "docs/architecture/adr/0016-emetteur-otlp-maison.md:18-25,35-55",
      "packages/rum-sdk/src/otel.ts:1-2,94-110",
      "tests/unit/otlp-emitter.test.ts:1-5",
      "tests/unit/otlp-conformite-officielle.test.ts:1-12",
      "tests/unit/otlp-collecteur-officiel.test.ts:1-6",
    ],
  },
  {
    id: "H15",
    titre: "Le SDK servi par la console, sous un nom sans version",
    aujourdhui:
      "Les sites chargent mip-rum.js depuis l'adresse de la console : une seule adresse pour toutes les versions. Une nouvelle version arrive chez tous les clients au même moment.",
    pourquoi: "Un seul site client (UTI), et une mise à jour qui le suit sans qu'il ait rien à changer.",
    production:
      "Une adresse de diffusion de MIP, des fichiers versionnés (mip-rum-0.6.0.js) que chaque client choisit de suivre, et une empreinte d'intégrité dans la balise.",
    sources: ["docs/INTEGRATION.md:56,83-85", "packages/rum-sdk/package.json:3"],
  },
];

export interface Chantier {
  id: string;
  titre: string;
  texte: string;
  sources: readonly string[];
}

/**
 * Les chantiers d'exploitation, en plus des points de « Ce qui reste » : ceux que les
 * documents d'exploitation tiennent, dans l'ordre où ils se font.
 */
export const CHANTIERS: readonly Chantier[] = [
  {
    id: "X1",
    titre: "Faire passer les écrans par le backend",
    texte:
      "La console lit encore la base directement. Le backend qui doit la remplacer est en service mais éteint : l'ouvrir par paliers (10 %, 50 %, puis tout), puis retirer à la console son accès à la base.",
    sources: ["docs/operations/bascule-console-api.md:28,54-62", "docs/architecture/overview.md:19,22,88"],
  },
  {
    id: "X2",
    titre: "Une collecte qui ne passe plus que par le collecteur",
    texte:
      "Le relais vers le collecteur est à plein depuis le 28/09/2026 ; après sept jours sans repli, retirer l'écriture de secours de la console.",
    sources: ["docs/operations/relais-ingestion.md:301,309-314"],
  },
  {
    id: "X3",
    titre: "Brancher les rôles restreints de la base",
    texte: "Donner au backend de la console ses deux rôles limités, et lui retirer l'accès propriétaire (voir l'hypothèse sur le cloisonnement).",
    sources: ["docs/operations/runbook.md:92-100"],
  },
  {
    id: "X4",
    titre: "Accélérer l'écriture des mesures",
    texte: "Une fonction de la base qui écrit un lot en un seul aller-retour, pour lever le plafond de la collecte.",
    sources: ["docs/architecture/overview.md:130"],
  },
  {
    id: "X5",
    titre: "Une préproduction, et ses exercices",
    texte:
      "Créer l'environnement, puis y répéter les redéploiements sous charge, les retours arrière chronométrés et la panne des notifications.",
    sources: ["docs/operations/presentation-dsi.md:16-26", "docs/operations/relais-ingestion.md:307"],
  },
  {
    id: "X6",
    titre: "Des notifications de production",
    texte: "Vérifier le domaine d'envoi des e-mails, et signer chaque canal avec son propre secret.",
    sources: ["docs/ALERTING.md:70-73", "services/notifier/README.md:61"],
  },
  {
    id: "X7",
    titre: "Un stockage objet pour les rejeux",
    texte: "Préparer la sortie des enregistrements de session vers un stockage objet, à déclencher au seuil fixé.",
    sources: ["docs/architecture/adr/0009-blobs-en-postgres.md:14-15"],
  },
  {
    id: "X8",
    titre: "Mettre à jour la base de géolocalisation",
    texte: "La livraison actuelle de la base qui situe les adresses IP devra être remplacée avant fin février 2027.",
    sources: ["docs/operations/runbook.md:104"],
  },
  {
    id: "X9",
    titre: "Passer le backend d'UTI à l'agent officiel",
    texte:
      "Le serveur d'UTI garde une copie de l'ancien capteur maison. Le remplacer par l'agent OpenTelemetry officiel pour Python, éprouvé en production sous FastAPI le 29/09/2026.",
    sources: ["docs/RUM_PARITY_STATUS.md:336", "docs/capteurs-serveur.md:54"],
  },
  {
    id: "X10",
    titre: "Une case de consentement pour le rejeu",
    texte:
      "Le rejeu de session demande le consentement des visiteurs, et c'est au site client de le recueillir. Avant d'activer le rejeu d'une application, la console doit faire cocher à son gestionnaire qu'il en a la base légale, et garder la trace de qui l'a coché et quand.",
    sources: ["docs/CONFORMITE.md:52", "packages/rum-sdk/src/types.ts:48-58"],
  },
];
