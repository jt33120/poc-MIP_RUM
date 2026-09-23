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

export default defineRailway(() => {
  const pocMIP_RUM = github("jt33120/poc-MIP_RUM", { branch: "master", checkSuites: false });

  const scheduler = service("scheduler", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "infra/docker/Dockerfile.backend", watchPatterns: ["apps/ingest/**", "services/scheduler/**", "infra/docker/Dockerfile.backend"] },
    start: "node services/scheduler/worker.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    preDeploy: "node node_modules/ingest/migrate.mjs",
    replicas: { "europe-west4-drams3a": 1 },
    deploy: { restartPolicyType: "ALWAYS" },
    env: { DATABASE_URL: preserve(), LOG_LEVEL: preserve(), NODE_ENV: preserve(), PGPOOL_MAX: preserve(), PORT: preserve() },
  });
  const mcp = service("mcp", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "infra/docker/Dockerfile.mcp", watchPatterns: ["apps/mcp/**", "services/mcp/**", "infra/docker/Dockerfile.mcp"] },
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
