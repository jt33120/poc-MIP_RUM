// LA TOPOLOGIE DU BACKEND, EN UN FICHIER (Infrastructure as Code Railway).
//
// Généré par `railway config pull` le 23/09/2026, puis tenu à la main. Jusqu'ici
// la configuration des services n'existait QUE dans le tableau de bord : le
// chemin du Dockerfile, les chemins surveillés, la commande de pré-déploiement et
// la sonde de santé ne se lisaient nulle part dans le dépôt. Une commande de
// démarrage perdue suffisait à faire booter au `scheduler` le receveur OTLP, qui
// est le CMD par défaut de son image.
//
// Config as Code (`railway.json`) est déprécié — coupure au 01/12/2026 — et un
// nouveau service ne peut plus s'y rattacher. C'est donc ce fichier-ci.
//
// DEUX RÈGLES, APPRISES DE LA DOCUMENTATION AVANT D'APPLIQUER QUOI QUE CE SOIT :
//
//   1. OMETTRE UNE RESSOURCE OU UNE VARIABLE LA SUPPRIME. `apply` réconcilie :
//      tout ce qui vit sur Railway sans figurer ici disparaît. Les variables sont
//      donc toutes déclarées, en `preserve()` quand leur valeur doit rester sur
//      Railway (le CLI ne la lit pas, et on ne veut pas de secret dans le dépôt).
//   2. UN SERVICE NOUVEAU NE PEUT PAS UTILISER `preserve()` : il n'y a aucune
//      valeur à préserver. Ses secrets passent par des variables PARTAGÉES de
//      l'environnement, créées AVANT le service (`ctx.shared.X`).
//
// Ce que `config pull` rend réellement, vérifié ici : `dockerfilePath` et
// `watchPatterns` sortent dans un objet `build`, `preDeploy` en champ de premier
// niveau, la politique de redémarrage dans `deploy`, et `checkSuites` sur la
// source GitHub. Les domaines générés (`*.up.railway.app`) ne sont PAS gérés par
// l'IaC : les recréer se fait à la main, et un service recréé change d'URL.
//
// `railway config plan --detailed-exit-code` doit rendre 0 sur `master`.
// Toute dérive est soit un changement à écrire ici, soit une modification faite
// dans le tableau de bord qu'il faut défaire.
import { defineRailway, github, preserve, project, service } from "railway/iac";

// CHEMINS SURVEILLÉS : L'UNION DES CHEMINS D'AUJOURD'HUI ET DE CEUX DE DEMAIN.
// Le remodelage P1 déplace le code (`apps/ingest` → `packages/backend` et
// `packages/db`, `apps/mcp` → `packages/mcp-tools`). Railway ne reconstruit un
// service que si un commit touche l'un de ses chemins surveillés : si la liste
// ne portait que les chemins actuels, le commit du déménagement — et tous ceux
// qui suivent — ne déploierait plus rien, en silence. La liste est donc élargie
// AVANT le déménagement ; les anciens chemins en sortiront après, une fois la
// PR du renommage fusionnée et déployée.
//   - `infra/docker/**` entier, et non plus le seul Dockerfile : la PR du
//     renommage réécrit les deux images d'un coup.
//   - `pnpm-lock.yaml` : une version de `pg` ou du SDK MCP qui bouge change ce
//     que l'image embarque, sans toucher un seul fichier du service.
//   - `packages/service-kit/**` : le kit commun que P1 introduit (PR-C).
const SURVEILLE_SCHEDULER = [
  // aujourd'hui
  "apps/ingest/**", "services/scheduler/**", "infra/docker/Dockerfile.backend",
  // après le remodelage
  "packages/backend/**", "packages/db/**", "packages/service-kit/**", "infra/docker/**", "pnpm-lock.yaml",
];
const SURVEILLE_MCP = [
  // aujourd'hui
  "apps/mcp/**", "services/mcp/**", "infra/docker/Dockerfile.mcp",
  // après le remodelage
  "packages/mcp-tools/**", "packages/service-kit/**", "infra/docker/**", "pnpm-lock.yaml",
];

// UN DOCKERFILE PAR SERVICE, À CÔTÉ DE SON POINT D'ENTRÉE (contrat de service
// § 9) : `services/<nom>/Dockerfile`. L'ancienne image commune
// (`infra/docker/Dockerfile.backend`) démarrait par défaut un receveur OTLP ; si
// `start` venait à se perdre, le scheduler démarrerait désormais… le scheduler.
// Le chemin est couvert par `services/<nom>/**`, déjà surveillé.
// Les anciennes images (`infra/docker/Dockerfile.{backend,mcp}`) restent dans le
// dépôt, marquées OBSOLÈTE, jusqu'à l'apply de ce fichier : d'ici là, c'est
// elles que le tableau de bord construit à chaque push sur `master`.
export default defineRailway(() => {
  const pocMIP_RUM = github("jt33120/poc-MIP_RUM", { branch: "master", checkSuites: false });

  const scheduler = service("scheduler", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/scheduler/Dockerfile", watchPatterns: SURVEILLE_SCHEDULER },
    start: "node services/scheduler/worker.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // Un fichier de câblage à chemin STABLE (voir son en-tête) : le déménagement
    // du migrateur ne change que son import, jamais cette commande.
    preDeploy: "node services/scheduler/migrate.mjs",
    replicas: { "europe-west4-drams3a": 1 },
    // DRAINAGE EXPLICITE (contrat § 4). Railway vaut 0 s par défaut : SIGKILL suit
    // SIGTERM, le passage en cours meurt et son bail reste posé jusqu'à expiration
    // (jusqu'à 10 min de ticks sautés par la nouvelle instance). 20 s couvrent un tick.
    deploy: { restartPolicyType: "ALWAYS", drainingSeconds: 20 },
    env: {
      DATABASE_URL: preserve(), LOG_LEVEL: preserve(), NODE_ENV: preserve(), PGPOOL_MAX: preserve(), PORT: preserve(),
      // BASE GRATUITE (décision du 24/09/2026) : un tick toutes les 5 minutes
      // gardait le calcul Neon éveillé en permanence et a épuisé les 100 CU-h
      // du mois. À 15 minutes, la base dort ~63 % du temps (~65 CU-h). Pour un
      // vrai produit RUM, offre payante et « 5 » ici (README du scheduler,
      // « Base gratuite »). La vitrine lit la cadence publiée, pas cette ligne.
      SCHEDULER_TICK_MIN: "15",
    },
  });
  const mcp = service("mcp", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/mcp/Dockerfile", watchPatterns: SURVEILLE_MCP },
    start: "node services/mcp/http.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { "europe-west4-drams3a": 1 },
    env: { MIP_CONSOLE_URL: preserve(), NODE_ENV: preserve(), PORT: preserve() },
  });

  return project("mip-rum-backend", {
    resources: [scheduler, mcp],
  });
});
