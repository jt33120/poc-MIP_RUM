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

export default defineRailway(() => {
  const pocMIP_RUM = github("jt33120/poc-MIP_RUM", { branch: "master", checkSuites: false });

  const scheduler = service("scheduler", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "infra/docker/Dockerfile.backend", watchPatterns: SURVEILLE_SCHEDULER },
    start: "node services/scheduler/worker.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // Un fichier de câblage à chemin STABLE (voir son en-tête) : le déménagement
    // du migrateur ne change que son import, jamais cette commande.
    preDeploy: "node services/scheduler/migrate.mjs",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    env: { DATABASE_URL: preserve(), LOG_LEVEL: preserve(), NODE_ENV: preserve(), PGPOOL_MAX: preserve(), PORT: preserve() },
  });
  const mcp = service("mcp", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "infra/docker/Dockerfile.mcp", watchPatterns: SURVEILLE_MCP },
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
