// Le côté lecture de la carte : la console (Vercel), l'API v1, et les services qui
// servent les données (api, console-api, mcp sur Railway), avec ceux qui les lisent.
// Relevé du 30/09/2026 dans le code (apps/console, services/api, services/mcp,
// packages/console-api, packages/mcp-tools) ; l'état des drapeaux vient des documents
// d'exploitation datés (docs/operations/relais-*.md, docs/architecture/overview.md).
import type { Element, Lien } from "./types";

const CONSOLE = "apps/console";

/** Les 19 outils du serveur MCP (packages/mcp-tools/lib/catalogue.mjs), et ce qu'ils lisent. */
const OUTILS_MCP: readonly { nom: string; role: string }[] = [
  { nom: "mip_rum_list_apps", role: "/apps : les applications du jeton" },
  { nom: "mip_rum_get_overview", role: "/overview : la vue d'ensemble" },
  { nom: "mip_rum_get_vitals", role: "/vitals : les Web Vitals" },
  { nom: "mip_rum_list_slow_pages", role: "/pages : les pages qui font attendre" },
  { nom: "mip_rum_list_errors", role: "/errors : les groupes d'erreurs" },
  { nom: "mip_rum_get_error_group", role: "/errors/{empreinte} : un groupe d'erreurs" },
  { nom: "mip_rum_list_issues", role: "/issues : les problèmes" },
  { nom: "mip_rum_get_issue", role: "/issues/{id} : un problème" },
  { nom: "mip_rum_list_sessions", role: "/sessions : les sessions" },
  { nom: "mip_rum_get_session", role: "/sessions/{id} : une session" },
  { nom: "mip_rum_list_events", role: "/events : le journal des événements" },
  { nom: "mip_rum_mobile_summary", role: "/mobile/summary : la couche mobile" },
  { nom: "mip_rum_get_tracing", role: "/tracing : navigateur → serveur" },
  { nom: "mip_rum_get_correlation", role: "/correlation : robot contre réel" },
  { nom: "mip_rum_get_health_grid", role: "/health-grid : la grille de santé" },
  { nom: "mip_rum_get_trends", role: "/trends : les tendances" },
  { nom: "mip_rum_list_detections", role: "/detections : les constats détectés" },
  { nom: "mip_rum_get_error_overrepresentation", role: "/errors/{empreinte}/overrepresentation : où l'erreur se concentre" },
  { nom: "mip_rum_query_explorer", role: "POST /explorer/query : une requête de l'Explorer" },
];

/** Les écrans de la console, par famille (54 pages hors vitrine). */
const ECRANS: readonly { nom: string; role: string }[] = [
  { nom: "/", role: "vue d'ensemble : note de santé, Web Vitals, compteurs" },
  { nom: "/pages", role: "les pages qui font attendre" },
  { nom: "/forecast", role: "tendances sur 14 jours" },
  { nom: "/errors", role: "groupes d'erreurs, problème, détail" },
  { nom: "/tracing", role: "traçage navigateur → serveur, détail d'une trace" },
  { nom: "/correlation", role: "robot contre réel" },
  { nom: "/map", role: "carte pages → services" },
  { nom: "/ux · /actions", role: "interactions et frustration" },
  { nom: "/acquisition · /paths", role: "d'où viennent les visiteurs, leurs parcours" },
  { nom: "/forms · /goals", role: "formulaires et objectifs" },
  { nom: "/retention · /experience", role: "retour des visiteurs, satisfaction déclarée" },
  { nom: "/events · /sessions", role: "journal des événements, sessions et rejeu" },
  { nom: "/mobile", role: "couche JavaScript React Native" },
  { nom: "/explorer · /dashboards", role: "Explorer, vues enregistrées, tableaux de bord" },
  { nom: "/alerts · /slo", role: "alertes et objectifs de service" },
  { nom: "/installer", role: "l'installation des trois capteurs, vérifiée en direct" },
  { nom: "/logs · /ai", role: "capacités fermées" },
  { nom: "/admin/*", role: "13 écrans : comptes, santé, postes, audit, consommation, jetons, RGPD…" },
  { nom: "/select", role: "le choix du projet, l'ajout d'un site" },
  { nom: "/login · /legal", role: "connexion, démo, documents légaux" },
];

export const ELEMENTS_VERCEL: readonly Element[] = [
  {
    id: "reception",
    famille: "service",
    zone: "vercel",
    titre: "Réception des mesures",
    sousTitre: "/api/ingest/v1/* · relais vers le collector",
    resume:
      "L'adresse que visent les capteurs des clients : la console reçoit traces, journaux, rejeux et battements, les relaie au collector, et ne les écrit elle-même qu'en repli, avec le même code.",
    etiquettes: ["tout le trafic relayé", "repli local", "8 s", "disjoncteur"],
    faits: [
      { texte: "Relais allumé pour tout le trafic depuis le 28/09/2026, 07:10 UTC.", sources: ["docs/architecture/overview.md:13"] },
      {
        texte: "Corps transmis octet pour octet, en-têtes par liste exacte ; aucune adresse transmise.",
        sources: [`${CONSOLE}/lib/ingest-relay.ts:35-59`],
      },
      {
        texte: "8 s de délai ; 5 échecs en 30 s coupent le relais 60 s, et la console écrit elle-même.",
        sources: [`${CONSOLE}/lib/ingest-relay.ts:125-131`, `${CONSOLE}/lib/ingest-relay.ts:234-248`],
      },
      { texte: "Un corps trop gros est refusé avant d'être lu, puis pendant la lecture.", sources: [`${CONSOLE}/app/api/ingest/v1/traces/route.ts:58-80`] },
      {
        texte: "Envoi direct des sites au collector : code prêt, mise en service pas avant le 05/10/2026.",
        sources: ["docs/architecture/overview.md:20"],
      },
    ],
    x: 2650,
    y: 1420,
    largeur: 580,
  },
  {
    id: "console",
    famille: "interface",
    zone: "vercel",
    titre: "Console Next.js",
    sousTitre: "Vercel · Francfort (fra1)",
    resume:
      "L'application web : ses écrans, l'API v1 et la réception des mesures. Elle peut se construire sans aucune variable de base ni de secret, et ne porte plus aucune tâche planifiée.",
    etiquettes: ["Next.js 15.5", "React 19", "fra1"],
    faits: [
      { texte: "Next.js 15.5.19 et React 19.2.7.", sources: [`${CONSOLE}/package.json:21-23`] },
      { texte: "Région fra1 ; ni cron ni en-tête dans vercel.json.", sources: [`${CONSOLE}/vercel.json:1-4`] },
      {
        texte: "Avec MIP_CONSOLE_SANS_BASE=1, le build refuse de se faire si une variable de base ou de secret est présente.",
        sources: [`${CONSOLE}/next.config.mjs:13-19`],
      },
      { texte: "Plus de route /api/cron : le scheduler a remplacé Vercel Cron et pg_cron.", sources: ["services/scheduler/run-once.mjs:1-2"] },
    ],
    x: 3290,
    y: 1420,
  },
  {
    id: "console-bascule",
    famille: "interface",
    zone: "vercel",
    titre: "Bascule vers console-api",
    sousTitre: "écrans et écritures, session par session",
    resume:
      "Un aiguillage décide, session par session, si c'est console-api ou la console elle-même qui lit et écrit ; à zéro aujourd'hui, la console lit la base directement.",
    statut: "drapeau",
    etiquettes: ["console_api_ecrans_pct", "disjoncteur"],
    faits: [
      {
        texte: "Cinq conditions dans l'ordre ; la première qui manque garde la console.",
        sources: [`${CONSOLE}/lib/aiguillage-console-api.ts:6-18`],
      },
      { texte: "Tirage stable par session ; 5 échecs en 30 s coupent le service pendant 60 s.", sources: [`${CONSOLE}/lib/aiguillage-console-api.ts:40-46`] },
      { texte: "Drapeaux lus en base, gardés 30 s ; zéro par défaut.", sources: [`${CONSOLE}/lib/platform-flag.ts:48-50`] },
      { texte: "Écrans et écritures non basculés au 29/09/2026 ; la connexion, elle, passe par console-api.", sources: ["docs/architecture/overview.md:92"] },
    ],
    x: 2650,
    y: 1800,
  },
  {
    id: "console-auth",
    famille: "interface",
    zone: "vercel",
    titre: "Connexion et sessions",
    sousTitre: "par console-api · démo en lecture",
    resume:
      "La connexion passe par console-api, qui signe la session ; la console la vérifie à chaque page. La démo est en lecture seule ; l'inscription est libre, mais plafonnée.",
    etiquettes: ["JWT ES256", "démo lecture seule", "inscription plafonnée"],
    faits: [
      { texte: "Session signée en ES256 par console-api ; la clé publique se vérifie en échec fermé.", sources: [`${CONSOLE}/lib/session-console.ts:3-21`] },
      { texte: "Une démo ne peut rien écrire : le middleware refuse tout sauf GET et HEAD.", sources: [`${CONSOLE}/middleware.ts:142-166`] },
      {
        texte: "Inscription libre, plafonnée : 3 par heure et par IP, un plafond par jour (fermée sans lui), un seul site par compte.",
        sources: ["packages/db/sql/migration-v107.sql:5-17", "packages/console-api/src/debit-auth.ts:38-44", `${CONSOLE}/app/inscription/page.tsx:1-8`],
      },
      { texte: "GET /logout ne déconnecte pas : un site tiers ne peut pas forcer la déconnexion.", sources: [`${CONSOLE}/app/logout/route.ts:82-90`] },
    ],
    x: 2970,
    y: 1800,
  },
  {
    id: "console-ecrans",
    famille: "interface",
    zone: "vercel",
    titre: "Écrans de la console",
    sousTitre: "54 écrans · Next.js 15",
    resume:
      "L'application web où l'on lit les mesures d'une application : santé, pages, erreurs, sessions, traçage, alertes, administration. Chaque écran charge ses données par un chargeur.",
    etiquettes: ["54 écrans", "48 chargeurs"],
    faits: [
      {
        texte: "Chaque écran appelle chargerEcran : la même opération peut venir de console-api ou de la console.",
        sources: [`${CONSOLE}/lib/ecran.ts:1-15`, `${CONSOLE}/lib/ecran.ts:235-242`],
      },
      { texte: "Refus : sans session vers /login, rôle insuffisant vers /, hors périmètre vers /select.", sources: [`${CONSOLE}/lib/ecran.ts:238-240`] },
      { texte: "Deux capacités fermées : /logs et /ai.", sources: [`${CONSOLE}/lib/capacites.ts:6`] },
    ],
    liste: { titre: "Écrans", entrees: ECRANS },
    x: 3290,
    y: 1800,
  },
  {
    id: "console-commandes",
    famille: "interface",
    zone: "vercel",
    titre: "Commandes d'écriture",
    sousTitre: "55 commandes · audit dans la transaction",
    resume:
      "Chaque écriture de la console (tableaux, alertes, comptes, RGPD…) est une commande avec sa règle d'accès, et son audit écrit dans la même transaction.",
    etiquettes: ["55 commandes", "audit"],
    faits: [
      { texte: "55 commandes, une par opération d'écriture du contrat.", sources: [`${CONSOLE}/lib/commandes/index.ts:53-114`] },
      { texte: "L'audit s'écrit dans la même transaction que l'écriture.", sources: [`${CONSOLE}/lib/commandes/commun.ts:4-8`] },
    ],
    x: 2650,
    y: 2110,
  },
  {
    id: "stats",
    famille: "interface",
    zone: "vercel",
    titre: "Statistiques partagées",
    sousTitre: "@mip/stats · sans dépendance",
    resume:
      "Un seul calcul statistique pour la console, l'API et console-api : intervalles de confiance, tendances, ruptures, sur-représentation. Il dit aussi ce qu'il ne sait pas.",
    etiquettes: ["Wilson", "Pettitt", "Fisher"],
    faits: [
      { texte: "Intervalle de la p75 par statistiques d'ordre, Wilson, Newcombe, règle de trois.", sources: ["packages/stats/src/incertitude.ts"] },
      { texte: "Rupture : test de Pettitt, 10 jours valides, déploiement coïncident à un jour près.", sources: ["packages/stats/src/rupture.ts"] },
      { texte: "Sur-représentation : Fisher exact, puis Benjamini-Hochberg.", sources: ["packages/stats/src/surrepresentation.ts"] },
    ],
    x: 2970,
    y: 2110,
  },
  {
    id: "s-porte-console",
    famille: "securite",
    zone: "vercel",
    titre: "Porte de la console",
    sousTitre: "session, périmètre, démo",
    resume:
      "Toute page exige une session ; une application hors du périmètre renvoie au choix du projet ; la démo ne peut rien écrire. La console n'envoie en revanche encore aucun en-tête de sécurité (CSP, HSTS).",
    etiquettes: ["session", "démo en lecture", "sans CSP"],
    faits: [
      { texte: "Sans session : /login, ou l'accueil public pour la racine.", sources: [`${CONSOLE}/middleware.ts:124-125`] },
      { texte: "Démo : toute méthode autre que GET et HEAD est refusée.", sources: [`${CONSOLE}/middleware.ts:142-166`] },
      { texte: "Une application hors du périmètre renvoie au choix du projet.", sources: [`${CONSOLE}/middleware.ts:205-230`] },
      {
        texte: "Mots de passe en bcrypt ; la comparaison est toujours faite, même pour un compte inconnu.",
        sources: ["packages/console-api/src/operations/identite.ts:11-14"],
      },
      { texte: "Ni CSP, ni HSTS, ni X-Frame-Options : un test fige cet état tant qu'aucune n'est posée.", sources: ["tests/unit/ingest-endpoint.test.ts:296-305"] },
    ],
    x: 3290,
    y: 2110,
  },
  {
    id: "s-jetons",
    famille: "securite",
    zone: "vercel",
    titre: "Jetons d'accès",
    sousTitre: "lecture seule, par application",
    resume:
      "Les machines lisent avec un jeton : il ne donne qu'une lecture, éventuellement limitée à certaines applications, et ne se stocke jamais en clair.",
    etiquettes: ["SHA-256", "échéance", "CORS en liste"],
    faits: [
      { texte: "Jetons d'accès mrk_ stockés en SHA-256, avec une échéance de 1 à 365 jours.", sources: [`${CONSOLE}/lib/read-tokens.ts:1-14`] },
      { texte: "Jetons machine de l'API v1 : lecture seule, comparés à temps constant.", sources: [`${CONSOLE}/lib/api/auth.ts`] },
      { texte: "Jetons de CI des source maps : secret en SHA-256, 90 jours au plus.", sources: ["packages/backend/lib/sourcemap-upload.mjs"] },
      { texte: "CORS de l'API v1 en liste blanche.", sources: [`${CONSOLE}/lib/api/cors.ts:1-34`] },
    ],
    x: 3290,
    y: 2410,
  },
  {
    id: "api-v1",
    famille: "interface",
    zone: "vercel",
    titre: "API v1",
    sousTitre: "28 routes · lecture au jeton",
    resume:
      "L'API REST de lecture des mesures, pour les machines : scripts, CI, partenaires, et le serveur MCP. Les lectures au jeton sont relayées au service api.",
    etiquettes: ["OpenAPI 3.0", "Swagger", "CORS en liste"],
    faits: [
      { texte: "Relais des lectures au jeton vers le service api : tout le trafic depuis le 28/09/2026.", sources: ["docs/operations/relais-api.md:5"] },
      { texte: "Un appel avec cookie n'est jamais relayé ; ni cookie ni IP ne sont transmis.", sources: [`${CONSOLE}/lib/api-relay.ts:9-15`, `${CONSOLE}/lib/api-relay-commun.ts:11-18`] },
      { texte: "Spécification OpenAPI construite dans le code, Swagger UI servi sans CDN.", sources: [`${CONSOLE}/lib/api/openapi.ts`, `${CONSOLE}/app/api/v1/docs/route.ts:1-6`] },
      { texte: "Une seule écriture : les marqueurs de déploiement, avec un jeton de CI.", sources: [`${CONSOLE}/app/api/v1/route.ts:75`] },
    ],
    x: 3290,
    y: 2700,
  },
];

export const ELEMENTS_RAILWAY_LECTURE: readonly Element[] = [
  {
    id: "mcp",
    famille: "service",
    zone: "railway",
    titre: "mcp",
    sousTitre: "19 outils en lecture pour les agents IA",
    resume:
      "Le serveur MCP : il expose l'API v1 à un assistant IA sous forme d'outils en lecture seule. Il n'a pas accès à la base, et relaie le jeton de l'appelant.",
    etiquettes: ["stdio · HTTP", "lecture seule", "0 accès base"],
    faits: [
      { texte: "Chaque outil se déclare en lecture seule et non destructif.", sources: ["packages/mcp-tools/serveur.mjs:181-186"] },
      { texte: "En HTTP, le client se construit à chaque appel avec le jeton de l'appelant.", sources: ["packages/mcp-tools/serveur.mjs:161-170"] },
      { texte: "L'écriture des déploiements n'est volontairement pas exposée.", sources: ["packages/mcp-tools/lib/catalogue.mjs:90-95"] },
      { texte: "Il lit l'API v1 par le service api, sur le réseau privé de Railway, et ne touche pas la base.", sources: ["docs/TOPOLOGIE_BACKEND.md:26"] },
    ],
    liste: { titre: "Outils", entrees: OUTILS_MCP },
    x: 50,
    y: 2700,
  },
  {
    id: "api",
    famille: "service",
    zone: "railway",
    titre: "api",
    sousTitre: "l'API v1, sans session, en lecture seule",
    resume:
      "Les routes de l'API v1 compilées sans Next.js ni session, servies sous un rôle de base en lecture seule. Il sert le serveur MCP et les lectures au jeton relayées par la console.",
    etiquettes: ["rôle mip_api", "2 répliques"],
    faits: [
      { texte: "Deux répliques ; son client principal est le serveur MCP.", sources: ["docs/TOPOLOGIE_BACKEND.md:24"] },
      { texte: "GET, HEAD et OPTIONS, plus la requête de l'Explorer ; toute autre écriture répond 405.", sources: ["services/api/routeur.mjs:10-19"] },
      { texte: "Aucune session : seul le jeton ouvre une lecture.", sources: ["services/api/shims/auth.mjs:1-27"] },
      { texte: "Le build refuse d'embarquer la session de la console ou un module Next.js.", sources: ["services/api/build.mjs:98-119"] },
      { texte: "Rôle mip_api : 28 tables et vues en liste blanche, transaction en lecture seule, 15 s au plus.", sources: ["packages/db/roles/mip-api.mjs"] },
    ],
    x: 370,
    y: 2700,
  },
  {
    id: "console-api",
    famille: "service",
    zone: "railway",
    titre: "console-api",
    sousTitre: "le backend de la console · 117 opérations",
    resume:
      "Le service que seul le serveur de la console appelle : identité, sessions, inscription, et à terme tous les écrans et toutes les écritures. Il sert déjà la connexion.",
    etiquettes: ["117 opérations", "sessions révocables"],
    faits: [
      { texte: "117 opérations : exploitation, identité (dont l'inscription), 48 écrans et 57 commandes.", sources: ["packages/console-api/src/table.ts", "docs/api/console-api.md"] },
      {
        texte: "Chaque opération déclare son accès, sa portée, la démo et l'audit ; une écriture sans audit empêche le démarrage.",
        sources: ["packages/console-api/src/politique.ts:15-77", "packages/console-api/src/politique.ts:110-154"],
      },
      { texte: "Connexion : bcrypt toujours calculé, refus générique, débit compté en base.", sources: ["packages/console-api/src/operations/identite.ts:11-14", "packages/console-api/src/debit-auth.ts:38-44"] },
      {
        texte: "Appelé par le seul serveur de la console : sans son secret client, un 404 nu ; un en-tête Origin, 403.",
        sources: ["docs/api/console-api.md:9-21"],
      },
    ],
    x: 690,
    y: 2700,
  },
];

export const ELEMENTS_TIERS_LECTURE: readonly Element[] = [
  {
    id: "equipes",
    famille: "externe",
    titre: "Équipes et DSI",
    sousTitre: "dans leur navigateur",
    resume: "Ceux qui lisent la console : équipes produit, développeurs, DSI. Un administrateur crée leurs comptes, ou ils s'inscrivent eux-mêmes, avec un seul site.",
    etiquettes: ["admin", "viewer", "démo"],
    faits: [{ texte: "Deux rôles, admin et viewer ; la démo est un viewer en lecture seule.", sources: ["packages/console-contract/src/operations.ts:94"] }],
    x: 3760,
    y: 1800,
  },
  {
    id: "machines",
    famille: "externe",
    titre: "Scripts, CI et partenaires",
    sousTitre: "avec un jeton",
    resume: "Ce qui lit l'API v1 avec un jeton : un script, une chaîne d'intégration continue, un partenaire, un tableau de bord externe.",
    faits: [{ texte: "Un jeton hors de son périmètre reçoit 403.", sources: [`${CONSOLE}/app/api/v1/route.ts:32`] }],
    x: 3760,
    y: 2700,
  },
  {
    id: "assistants-ia",
    famille: "externe",
    titre: "Assistants IA",
    sousTitre: "Claude, Cursor… par MCP",
    resume: "Un assistant IA branché au serveur MCP interroge les mesures en langage naturel, avec le jeton de son utilisateur.",
    faits: [{ texte: "En stdio, l'adresse de la console et un jeton sont obligatoires.", sources: ["services/mcp/stdio.mjs:15-28"] }],
    x: -440,
    y: 2700,
  },
  {
    // Placé à droite de la console, à sa hauteur, dans la colonne des tiers de la
    // lecture (équipes, scripts) : la seule place libre qui ne croise aucune zone.
    id: "mistral",
    famille: "externe",
    titre: "Mistral AI",
    sousTitre: "assistant du tableau de bord",
    resume:
      "Le modèle qui rédige les réponses de l'assistant à partir des chiffres agrégés de la Vue d'ensemble ; déclaré comme sous-traitant, appelé seulement si sa clé est posée.",
    statut: "option",
    etiquettes: ["sous-traitant", "UE", "agrégats seuls"],
    faits: [
      { texte: "Appelé par la route de l'assistant, sinon réponse par règles.", sources: [`${CONSOLE}/app/api/assistant/route.ts:87`, `${CONSOLE}/lib/assistant/mistral.ts:175-182`] },
      { texte: "Trois conditions : une clé, un fournisseur déclaré, une réponse en 20 s.", sources: [`${CONSOLE}/lib/assistant/mistral.ts:8-16`] },
      { texte: "Déclaré au registre des sous-traitants.", sources: [`${CONSOLE}/lib/legal.ts:172-182`] },
    ],
    x: 3760,
    y: 1420,
  },
];

export const LIENS_LECTURE: readonly Lien[] = [
  { de: "console", vers: "mistral", nature: "appel", libelle: "question + chiffres agrégés" },
  { de: "equipes", vers: "console-ecrans", nature: "lit", libelle: "consultent" },
  { de: "equipes", vers: "console-auth", nature: "appel", libelle: "se connectent" },
  { de: "console-auth", vers: "console-api", nature: "appel", libelle: "connexion, /v1/me, déconnexion" },
  { de: "console-ecrans", vers: "console-bascule", nature: "appel", libelle: "chargerEcran" },
  { de: "console-bascule", vers: "console-api", nature: "appel", libelle: "si le drapeau l'accorde" },
  { de: "console-ecrans", vers: "console-commandes", nature: "appel", libelle: "server actions" },
  { de: "console-ecrans", vers: "stats", nature: "embarque" },
  { de: "api", vers: "stats", nature: "embarque" },
  { de: "console-api", vers: "stats", nature: "embarque" },
  { de: "machines", vers: "api-v1", nature: "lit", libelle: "Bearer" },
  { de: "api-v1", vers: "api", nature: "appel", libelle: "relais des lectures au jeton" },
  { de: "assistants-ia", vers: "mcp", nature: "appel", libelle: "outils MCP" },
  { de: "mcp", vers: "api", nature: "appel", libelle: "réseau privé Railway" },
];
