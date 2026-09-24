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
// VARIABLES PARTAGÉES À CRÉER AVANT L'APPLY (environnement production ; le
// plan ne vérifie pas qu'elles existent) :
//   · DATABASE_URL               le pooler Neon, rôle propriétaire ;
//   · IDENTITY_HASH_SECRET       ≥ 32 caractères aléatoires, NEUF ;
//   · IDENTITY_HASH_FINGERPRINT  son empreinte (`empreinteIdentite`) ;
//   · EDGE_PROXY_SECRET          ≥ 32 caractères, la même valeur que Vercel ;
//   · METRICS_TOKEN              ≥ 32 caractères : sans lui, /ready et /metrics
//                                répondent 404 et la fumée ne lit pas /ready ;
//   · RESEND_API_KEY             clé Resend « Sending access » seule — APRÈS la
//                                fusion de la PR de conformité Resend (#288) ;
//   · ALERT_EMAIL_TEST_RECIPIENTS  les destinataires de test : une adresse
//                                personnelle n'a rien à faire dans un dépôt public ;
//   · WEBHOOK_SIGNING_SECRET     ≥ 32 caractères, signe les webhooks d'alerte.
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
import { defineRailway, github, group, preserve, project, service } from "railway/iac";

// LA RÉGION DU PROJET, clé exacte rendue par `config pull` (Amsterdam). Une
// seule source : un service déclaré dans une autre région paierait un aller-
// retour transfrontalier vers Neon (Francfort) à chaque requête.
const REGION = "europe-west4-drams3a";

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
// LE COLLECTOR NAÎT APRÈS LE REMODELAGE : aucun ancien chemin à porter. Sa liste
// est exactement ce que lit `services/collector/Dockerfile`, pas un de plus :
//   - son dossier, puis la FERMETURE de ses dépendances de workspace —
//     `@mip/backend` → `@mip/service-kit`. PAS `packages/db/**` : le collector
//     n'importe pas le migrateur, et une migration se déploie avec le scheduler
//     (seul migrateur, schéma N/N+1) ; la surveiller ici redéploierait deux
//     répliques de collecte pour un fichier SQL qu'elles n'embarquent pas ;
//   - ce que copie la recette commune : lockfile, workspace, `package.json`
//     racine (la version de pnpm y est LUE, `packageManager`), le vérificateur
//     de `pnpm deploy`, le téléchargeur GeoIP (seule image à le lancer), et
//     `.dockerignore`, qui décide de ce qui entre dans le contexte ;
//   - PAS `infra/docker/**` : plus aucune image du collector n'y vit.
// Les motifs suivent la syntaxe gitignore : SANS `/` initial, un nom nu vaut à
// toute profondeur. `/package.json` est donc ancré — il y en a quatorze autres
// dans le dépôt, et celui de la console ne doit pas redéployer la collecte.
const SURVEILLE_COLLECTOR = [
  "services/collector/**", "packages/backend/**", "packages/service-kit/**",
  "pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json", "/.dockerignore",
  "scripts/ci/deploy-fidele.mjs", "scripts/fetch-geoip-db.mjs",
];

// DRAINAGE DU COLLECTOR : 15 s (contrat § 4). Le budget de requête du receveur
// est de ≈ 4 s ; 15 s laissent finir toute écriture en vol avec de la marge,
// sans retarder chaque déploiement de deux répliques. Posé DEUX FOIS, d'une
// seule constante : `deploy.drainingSeconds` est le réglage que Railway
// applique et affiche ; `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` est la variable
// que LIT le kit (`lifecycle.mjs`) pour caler sa sortie forcée juste avant
// SIGKILL. La documentation Railway la range parmi les variables « fournies par
// l'utilisateur », pas parmi celles qu'il injecte : sans elle, le kit
// supposerait 10 s et avertirait au démarrage.
const DRAINAGE_COLLECTOR_S = 15;

// LE NOTIFIER NAÎT APRÈS LE REMODELAGE, comme le collector : exactement ce que lit
// `services/notifier/Dockerfile`. Ni `packages/db/**` (seul le scheduler migre),
// ni le téléchargeur GeoIP (l'image n'embarque pas la base).
const SURVEILLE_NOTIFIER = [
  "services/notifier/**", "packages/backend/**", "packages/service-kit/**",
  "pnpm-lock.yaml", "/pnpm-workspace.yaml", "/package.json", "/.dockerignore",
  "scripts/ci/deploy-fidele.mjs",
];
// 20 s, comme le scheduler : une passe n'entame plus de livraison après 10 s
// (`BUDGET_PASSE_MS`), chaque envoi est borné à 10 s ; 20 s couvrent la passe
// en cours. Posé deux fois, pour la même raison que le collector.
const DRAINAGE_NOTIFIER_S = 20;

// UN DOCKERFILE PAR SERVICE, À CÔTÉ DE SON POINT D'ENTRÉE (contrat de service
// § 9) : `services/<nom>/Dockerfile`. L'ancienne image commune
// (`infra/docker/Dockerfile.backend`) démarrait par défaut un receveur OTLP ; si
// `start` venait à se perdre, le scheduler démarrerait désormais… le scheduler.
// Le chemin est couvert par `services/<nom>/**`, déjà surveillé.
// Les anciennes images (`infra/docker/Dockerfile.{backend,mcp}`) restent dans le
// dépôt, marquées OBSOLÈTE, jusqu'à l'apply de ce fichier : d'ici là, c'est
// elles que le tableau de bord construit à chaque push sur `master`.
export default defineRailway((ctx) => {
  const pocMIP_RUM = github("jt33120/poc-MIP_RUM", { branch: "master", checkSuites: false });

  // ─── 1 · Collecte ──────────────────────────────────────────────────────────
  // P2 : LANCEMENT À BLANC. Le service se déploie, répond, et ne reçoit rien :
  // les capteurs visent toujours la console, qui relaiera en P3. Aucun
  // `preserve()` possible (règle 2) : chaque secret vient d'une variable
  // PARTAGÉE de l'environnement, qui doit exister AVANT l'apply. D'où l'ordre :
  // variables partagées → apply → vrai déploiement → domaine généré (à la main,
  // hors IaC) → fumée `/health`.
  // LE PLAN NE LE VÉRIFIE PAS (constaté le 24/09 : `config plan` classe la
  // création « safe » sans qu'aucune des variables partagées n'existe ; liste
  // en tête du fichier). Ce que devient une référence manquante, la
  // documentation Railway ne le dit pas ; si elle arrive VIDE, le kit traite
  // le vide comme l'absence : `DATABASE_URL` →
  // refus de démarrer (bruyant, le déploiement échoue) ; secret d'identité ou
  // de relais → service DÉGRADÉ EN SILENCE (`identity: "absente"`,
  // `edge_trust: false` sur `/health`). La fumée lit donc ces deux champs.
  const collector = service("collector", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/collector/Dockerfile", watchPatterns: SURVEILLE_COLLECTOR },
    // EXPLICITE, comme le `CMD` de l'image : si l'un des deux se perd, l'autre
    // démarre encore le bon processus — jamais un autre service.
    start: "node services/collector/server.mjs",
    // Processus vivant ET base joignable (`select 1`, 2 s). Railway ne sonde
    // qu'au déploiement : une base injoignable fait ÉCHOUER le déploiement, et
    // l'ancien reste en service — ce qu'on veut, plutôt qu'un collecteur qui
    // perdrait tout en répondant 200.
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // DEUX RÉPLIQUES, dans la région du projet. Sûres sans coordination (README
    // du collector, « Sûreté multi-réplique ») : verrou consultatif par app,
    // idempotence `on conflict`, débit compté en base. Deux répliques, c'est
    // aussi 2 × PGPOOL_MAX connexions : 16 sur les 112 de Neon.
    replicas: { [REGION]: 2 },
    // ALWAYS : le kit transforme un crash (`uncaughtException`, rejet non
    // traité) en arrêt propre code 1 et compte sur Railway pour relancer un
    // processus sain (en-tête de `lifecycle.mjs`) — même politique que le
    // scheduler.
    deploy: { restartPolicyType: "ALWAYS", drainingSeconds: DRAINAGE_COLLECTOR_S },
    env: {
      // Le pooler Neon, rôle propriétaire (moindre privilège après M4).
      DATABASE_URL: ctx.shared.DATABASE_URL,
      // Le secret NEUF d'identité (vide sur Vercel : aucun `user_id_hash`
      // historique à préserver) et son empreinte. Tous deux PARTAGÉS : en C0,
      // `console-api` devra hacher avec le MÊME secret, et l'empreinte rend
      // bruyant tout écart (readiness refusée, identité retirée).
      IDENTITY_HASH_SECRET: ctx.shared.IDENTITY_HASH_SECRET,
      IDENTITY_HASH_FINGERPRINT: ctx.shared.IDENTITY_HASH_FINGERPRINT,
      // Le secret du relais de la console (bord de confiance `mip-edge/1`,
      // P3). Une valeur, ou deux séparées par une virgule pendant une rotation.
      EDGE_PROXY_SECRET: ctx.shared.EDGE_PROXY_SECRET,
      // R8a — « false » TANT QUE LES CLÉS NE SONT PAS PROVISIONNÉES. Relevé du
      // 23/09 : 6 apps sur 7 n'ont AUCUNE clé d'ingestion, dont celle du client
      // (`gip-plateforme`). « true » les couperait toutes en 403, et le repli du
      // relais de P3 ne se déclenche pas sur un 403 : leurs beacons seraient
      // perdus. Ordre : `scripts/ops/provisionner-cles.mjs --appliquer`, clé
      // posée dans chaque snippet, 200 vérifiés, ALORS « true » — ici, en PR :
      // basculé dans le tableau de bord, le prochain apply le remettrait à false.
      REQUIRE_API_KEY: "false",
      // Jeton de /ready et /metrics (kit, ≥ 32 caractères). Partagé : la
      // supervision le porte pour tous les services du kit.
      METRICS_TOKEN: ctx.shared.METRICS_TOKEN,
      // GEOIP ÉTEINT, et c'est voulu. La géolocalisation par adresse du trafic
      // DIRECT est réservée à P6b.G (collecte directe, à une date annoncée et
      // datée par un `deploy_marker`) ; jusque-là les textes de conformité
      // disent « code pays seul, sans adresse IP », et le trafic relayé (P3)
      // porte le pays de Vercel sans jamais d'adresse. « railway » l'allumait
      // dès P2, pour tout ce qui viserait le domaine du collector.
      // AVANT DE L'ALLUMER : prouver sur staging que la façade Railway ÉCRASE
      // un `X-Real-IP` forgé par le client (non constaté, `client-ip.mjs`) —
      // sinon n'importe qui choisit le pays de ses propres beacons.
      GEOIP_IP_SOURCE: "none",
      // Par réplique. Le défaut du schéma (8), écrit ici pour que le calcul des
      // connexions se lise sans ouvrir le code.
      PGPOOL_MAX: "8",
      // Déjà dans l'image ; écrit ici pour que le refus du tampon `/__recent`
      // (payloads en clair) ne dépende pas de la seule image.
      NODE_ENV: "production",
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: String(DRAINAGE_COLLECTOR_S),
    },
  });

  // ─── 2 · Restitution ───────────────────────────────────────────────────────
  const mcp = service("mcp", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/mcp/Dockerfile", watchPatterns: SURVEILLE_MCP },
    start: "node services/mcp/http.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    replicas: { [REGION]: 1 },
    env: { MIP_CONSOLE_URL: preserve(), NODE_ENV: preserve(), PORT: preserve() },
  });

  // ─── 3 · Traitements ───────────────────────────────────────────────────────
  const scheduler = service("scheduler", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/scheduler/Dockerfile", watchPatterns: SURVEILLE_SCHEDULER },
    start: "node services/scheduler/worker.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // Un fichier de câblage à chemin STABLE (voir son en-tête) : le déménagement
    // du migrateur ne change que son import, jamais cette commande.
    preDeploy: "node services/scheduler/migrate.mjs",
    replicas: { [REGION]: 1 },
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
      // P5 — LE TICK NE LIVRE PLUS : le notifier, déclaré juste en dessous et
      // créé dans le MÊME apply, s'en charge. Le scheduler n'a pas la clé
      // Resend : s'il livrait encore, il solderait les e-mails `skipped`. Entre
      // les deux démarrages, les livraisons attendent `queued` ; rien ne se perd.
      // Retour arrière : « on » ici, et le notifier à 0 réplique.
      SCHEDULER_DELIVERY: "off",
    },
  });

  // P5 — LIVRER CE QUE LA PLATEFORME A DÉCIDÉ DE DIRE : webhooks signés, e-mails
  // Resend, tickets, toutes les 15 s. Seul service à détenir les secrets
  // sortants ; tous viennent de variables PARTAGÉES (règle 2), à créer avant
  // l'apply (liste en tête).
  const notifier = service("notifier", {
    source: pocMIP_RUM,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "services/notifier/Dockerfile", watchPatterns: SURVEILLE_NOTIFIER },
    start: "node services/notifier/worker.mjs",
    healthcheck: "/health",
    healthcheckTimeout: 120,
    // UNE réplique : deux seraient sûres (`skip locked` sur chaque file, README
    // du notifier), mais n'apporteraient rien au volume d'un POC.
    replicas: { [REGION]: 1 },
    deploy: { restartPolicyType: "ALWAYS", drainingSeconds: DRAINAGE_NOTIFIER_S },
    env: {
      DATABASE_URL: ctx.shared.DATABASE_URL,
      METRICS_TOKEN: ctx.shared.METRICS_TOKEN,
      // MODE TEST RESEND : domaine d'envoi non vérifié. L'expéditeur de test
      // n'écrit qu'au titulaire du compte ; tout autre destinataire est soldé
      // `skipped` avant l'appel. Le notifier refuse de démarrer si la liste manque.
      RESEND_API_KEY: ctx.shared.RESEND_API_KEY,
      ALERT_EMAIL_FROM: "onboarding@resend.dev",
      ALERT_EMAIL_TEST_RECIPIENTS: ctx.shared.ALERT_EMAIL_TEST_RECIPIENTS,
      WEBHOOK_SIGNING_SECRET: ctx.shared.WEBHOOK_SIGNING_SECRET,
      // BASE GRATUITE (décision du 24/09/2026) : 15 min, la cadence du tick, et
      // passes ALIGNÉES 45 s derrière lui — un seul réveil de la base pour les
      // deux services (README du notifier, « Coût »). Offre payante : « 15000 ».
      NOTIFIER_INTERVAL_MS: "900000",
      PGPOOL_MAX: "2",
      NODE_ENV: "production",
      RAILWAY_DEPLOYMENT_DRAINING_SECONDS: String(DRAINAGE_NOTIFIER_S),
    },
  });

  // LE CANEVAS DIT L'ARCHITECTURE : Capteurs → Collecte → Restitution →
  // Traitements. Un groupe n'est qu'un cadre sur le canevas — il ne change ni
  // le réseau, ni les variables, ni le déploiement d'un service. `api` et
  // `console-api` rejoindront leur groupe en naissant.
  return project("mip-rum-backend", {
    resources: [
      group("1 · Collecte", [collector]),
      group("2 · Restitution", [mcp]),
      group("3 · Traitements", [scheduler, notifier]),
    ],
  });
});
