// Le bas de la carte : le dépôt GitHub, ce qui vérifie (tests, gardes, fumée, sondes)
// et ce qui déploie (workflows). Relevé du 30/09/2026 ; les nombres de fichiers de
// tests se recomptent dans tests/unit/cartographie.test.ts (CHIFFRES).
import type { Element, Lien } from "./types";

/** Les fichiers de chaque suite, recomptés par le test : une suite qui grandit le fait échouer. */
export const FICHIERS_DE_TESTS = { unit: 424, integration: 68, contract: 5, e2e: 55 } as const;

const WF = ".github/workflows";

/** Les gardes du dépôt : des tests qui font échouer la CI quand une règle du projet est enfreinte. */
const GARDES: readonly { nom: string; role: string }[] = [
  { nom: "inventaire-console", role: "aucun écran de plus ne lit la base directement" },
  { nom: "migrations-figees", role: "une migration fusionnée ne se modifie plus" },
  { nom: "cible-locale", role: "un script qui écrit refuse une base distante" },
  { nom: "conformite", role: "les sous-traitants du dossier sont ceux des pages légales" },
  { nom: "agents-md", role: "chaque chemin cité par AGENTS.md existe" },
  { nom: "couverture-site", role: "la vitrine n'affirme rien de plus que le document de couverture" },
  { nom: "perf-domaine-gardes", role: "aucun seuil de Web Vital recopié dans un écran" },
  { nom: "jargon-affiche", role: "aucun code interne dans un texte affiché" },
  { nom: "ingest-endpoint", role: "une CSP qui apparaît doit laisser passer la collecte" },
  { nom: "console-sans-base", role: "la mécanique de la console sans base" },
  { nom: "readme", role: "les zones générées du README suivent la vitrine" },
  { nom: "composants-open-source", role: "l'inventaire des composants est à jour" },
  { nom: "console-api-doc", role: "la doc de console-api est le rendu de sa table" },
  { nom: "api-doc-verite", role: "le contrat d'API décrit les routes réelles, et elles seules" },
  { nom: "sonde-externe", role: "la sonde externe ne vise rien qui touche la base" },
  { nom: "images-services", role: "Dockerfiles, compose, IaC et fumée cohérents" },
  { nom: "console-env-example", role: "toute variable lue par la console est dans .env.example" },
  { nom: "pools-connexions", role: "la somme des pools tient sous le plafond de Neon" },
  { nom: "iac-secret-identite", role: "console-api partage le secret d'identité du collector" },
  { nom: "chemins-publics", role: "la liste des pages lisibles sans compte" },
  { nom: "base-gratuite", role: "les cadences restent sur la grille ralentie" },
  { nom: "cartographie", role: "cette carte : tables, services, sources et chiffres" },
];

const X = (rang: number) => 100 + rang * 500;

export const ELEMENTS_GITHUB: readonly Element[] = [
  {
    id: "depot",
    famille: "externe",
    zone: "github",
    titre: "Dépôt GitHub",
    sousTitre: "public · monorepo pnpm",
    resume:
      "Tout le code est dans un dépôt public : console, services, capteurs, migrations, tests et infrastructure. Aucun secret, aucune donnée client.",
    etiquettes: ["public", "Node 24", "pnpm 9.15"],
    faits: [
      { texte: "Le dépôt est public : ni secret, ni donnée client, ni adresse e-mail personnelle.", sources: ["AGENTS.md:109-111"] },
      { texte: "Node 24 et pnpm 9.15.9, épinglés.", sources: [".nvmrc", "package.json:16"] },
      { texte: "Toute PR vise master ; une migration fusionnée ne se modifie plus.", sources: ["AGENTS.md:139", "AGENTS.md:67"] },
    ],
    x: X(0),
    y: 3080,
  },
  {
    id: "workflow-ci",
    famille: "qualite",
    zone: "github",
    titre: "CI",
    sousTitre: "ci.yml · à chaque push et à chaque PR",
    resume:
      "À chaque push sur master et à chaque PR : build des SDK, types, tests unitaires, SQL, contrats, E2E et bancs, sur des bases Postgres jetables.",
    etiquettes: ["5 jobs", "Postgres 17", "en parallèle"],
    faits: [
      { texte: "Cinq jobs : unit, build-propre, migrations-figees (sur PR), e2e, bancs.", sources: [`${WF}/ci.yml`] },
      { texte: "Le migrateur passe deux fois : le second passage ne doit rien trouver à faire.", sources: [`${WF}/ci.yml`] },
      { texte: "Les droits des rôles de base sont vérifiés contre une liste blanche.", sources: ["scripts/ci/verify-db-roles.mjs", "scripts/ci/verify-db-roles-console.mjs"] },
    ],
    x: X(1),
    y: 3080,
  },
  {
    id: "tests-unit",
    famille: "qualite",
    zone: "github",
    titre: "Tests unitaires",
    sousTitre: `vitest · ${FICHIERS_DE_TESTS.unit} fichiers · sans base`,
    resume: "Le parseur, le SDK, les écrans rendus, les statistiques, les services, et les gardes du dépôt : tout ce qui se vérifie sans base.",
    etiquettes: [`${FICHIERS_DE_TESTS.unit} fichiers`, "vitest"],
    faits: [{ texte: "Lancés par pnpm test:unit, sans aucune base.", sources: ["package.json:9"] }],
    x: X(2),
    y: 3080,
  },
  {
    id: "tests-integration",
    famille: "qualite",
    zone: "github",
    titre: "Tests SQL",
    sousTitre: `${FICHIERS_DE_TESTS.integration} fichiers · bases réelles`,
    resume:
      "Sur de vraies bases Postgres migrées : les migrations et leurs fenêtres de déploiement, les lectures, les rôles, l'effacement RGPD, les sondes.",
    etiquettes: [`${FICHIERS_DE_TESTS.integration} fichiers`, "8 bases"],
    faits: [{ texte: "Lancés par pnpm test:sql, un fichier à la fois.", sources: ["package.json:11"] }],
    x: X(3),
    y: 3080,
  },
  {
    id: "tests-contract",
    famille: "qualite",
    zone: "github",
    titre: "Contrats de parité",
    sousTitre: `${FICHIERS_DE_TESTS.contract} contrats`,
    resume:
      "La console et le collector répondent pareil au même lot ; la console et le service api, à la même lecture ; console-api tient sa matrice d'autorisations.",
    etiquettes: ["console ↔ collector", "console ↔ api"],
    faits: [
      { texte: "Parité de l'ingestion et du relais, bout en bout jusqu'à la base.", sources: ["tests/contract/ingest-parity.test.ts", "tests/contract/relais-ingestion.test.ts"] },
      { texte: "Parité de l'API v1 et du service api.", sources: ["tests/contract/api-parity.test.ts"] },
      { texte: "Matrice des autorisations de console-api.", sources: ["tests/contract/console-api-authz.test.ts"] },
    ],
    x: X(4),
    y: 3080,
  },
  {
    id: "tests-e2e",
    famille: "qualite",
    zone: "github",
    titre: "E2E Playwright",
    sousTitre: `${FICHIERS_DE_TESTS.e2e} scénarios · 5 serveurs`,
    resume:
      "Un vrai navigateur sur une vraie pile : collector, site cobaye, rejeu, console-api et console démarrés, puis chaque écran parcouru en admin, en lecteur et en démo.",
    etiquettes: [`${FICHIERS_DE_TESTS.e2e} scénarios`, "Chromium"],
    faits: [
      { texte: "Cinq serveurs démarrés pour les tests, dont un site cobaye instrumenté.", sources: ["playwright.config.ts:46-122"] },
      { texte: "Une base distante est refusée.", sources: ["playwright.config.ts:26-29"] },
    ],
    x: X(5),
    y: 3080,
  },
  {
    id: "gardes",
    famille: "qualite",
    zone: "github",
    titre: "Gardes du dépôt",
    sousTitre: "des règles qui font échouer la CI",
    resume:
      "Des tests qui ne testent pas une fonction mais une règle du projet : pas de nouvel écran branché sur la base, pas de migration réécrite, pas de promesse de plus que la doc.",
    etiquettes: ["cliquets", "règles écrites en tests"],
    faits: [
      { texte: "Le cliquet de la console sans base refuse tout nouvel accès direct.", sources: ["tests/unit/inventaire-console.test.ts"] },
      { texte: "Une migration fusionnée ne se modifie plus.", sources: ["scripts/ci/migrations-figees.mjs"] },
    ],
    liste: { titre: "Gardes", entrees: GARDES },
    x: X(6),
    y: 3080,
  },
  {
    id: "workflow-docker-smoke",
    famille: "qualite",
    zone: "github",
    titre: "Fumée des images",
    sousTitre: "docker-smoke.yml · 6 services",
    resume:
      "Chaque image de service est construite et démarrée : migration, /health, une requête de référence, utilisateur non-root, arrêt propre sur SIGTERM.",
    etiquettes: ["6 images", "SIGTERM"],
    faits: [{ texte: "Une matrice des six services, sur PR et sur master.", sources: [`${WF}/docker-smoke.yml`] }],
    x: 350,
    y: 3270,
  },
  {
    id: "workflow-railway-config",
    famille: "qualite",
    zone: "github",
    titre: "Apply Railway",
    sousTitre: "railway-config.yml · relu par un humain",
    resume:
      "Un changement d'infrastructure est planifié sur la PR, relu par un humain, puis appliqué tel quel après la fusion, dans un environnement protégé.",
    etiquettes: ["plan · apply", "allow-destroy"],
    faits: [
      { texte: "Le plan se calcule sur la PR, sous un environnement qui demande un relecteur.", sources: [`${WF}/railway-config.yml:65-145`] },
      { texte: "Toute suppression est refusée sans le label allow-destroy.", sources: [`${WF}/railway-config.yml:116-145`] },
      { texte: "Après la fusion, le plan épinglé s'applique, sans exécutions concurrentes.", sources: [`${WF}/railway-config.yml:147-193`] },
      { texte: "Jamais --include-variables : les secrets restent sur Railway.", sources: [`${WF}/railway-config.yml:26-29`] },
    ],
    x: 950,
    y: 3270,
  },
  {
    id: "workflow-sonde-externe",
    famille: "qualite",
    zone: "github",
    titre: "Sonde externe",
    sousTitre: "sonde-externe.yml · toutes les 15 min",
    resume: "Depuis GitHub, toutes les 15 minutes, chaque service exposé doit répondre ; le scheduler et le notifier, sans domaine, ne sont pas sondés.",
    etiquettes: ["cron", "/live · /health"],
    faits: [{ texte: "Aux minutes 7, 22, 37 et 52 de chaque heure.", sources: [`${WF}/sonde-externe.yml:20-23`] }],
    x: 1550,
    y: 3270,
  },
  {
    id: "s-secrets",
    famille: "securite",
    zone: "github",
    titre: "Secrets hors du dépôt",
    sousTitre: "ce qui empêche une fuite",
    resume:
      "Aucun secret n'est versionné : ils vivent sur Railway et Vercel. Les fichiers d'environnement sont ignorés, l'IaC ne les écrit jamais, et les scripts qui écrivent refusent une base distante.",
    etiquettes: [".gitignore", "preserve()", "cible locale"],
    faits: [
      { texte: "Fichiers d'environnement, clés et certificats ignorés par git.", sources: [".gitignore:22-33"] },
      { texte: "Jamais vercel env pull dans le dépôt, jamais .env sourcé.", sources: ["AGENTS.md:112-113"] },
      { texte: "Un script qui écrit refuse une base distante, sauf dérogation qui nomme l'hôte.", sources: ["scripts/lib/cible-locale.mjs:1-23"] },
    ],
    x: 2150,
    y: 3270,
  },
  {
    id: "s-conformite",
    famille: "securite",
    zone: "github",
    titre: "Conformité",
    sousTitre: "pages légales ↔ dossier",
    resume:
      "Hébergeurs et sous-traitants sont déclarés dans le code des pages légales, et le dossier de conformité doit dire exactement la même chose : un test refuse toute divergence.",
    etiquettes: ["RGPD", "sous-traitants", "régions"],
    faits: [
      { texte: "Les hébergeurs et leurs régions, dans le code des pages légales.", sources: ["apps/console/lib/legal.ts:124-133"] },
      { texte: "Le dossier de conformité se déclare le reflet de ce code.", sources: ["docs/CONFORMITE.md:10-16"] },
      { texte: "Un test confronte sous-traitants, régions et affirmations.", sources: ["tests/unit/conformite.test.ts:48-66"] },
    ],
    x: 2750,
    y: 3270,
  },
];

export const LIENS_QUALITE: readonly Lien[] = [
  { de: "depot", vers: "workflow-ci", nature: "declenche", libelle: "push, PR" },
  { de: "depot", vers: "workflow-docker-smoke", nature: "declenche", libelle: "chemins des services" },
  { de: "depot", vers: "workflow-railway-config", nature: "declenche", libelle: ".railway, lockfile" },
  { de: "depot", vers: "railway-projet", nature: "deploie", libelle: "build des Dockerfile depuis master" },
  { de: "depot", vers: "console", nature: "deploie", libelle: "déploiement Vercel" },
  { de: "workflow-ci", vers: "tests-unit", nature: "declenche" },
  { de: "workflow-ci", vers: "tests-integration", nature: "declenche" },
  { de: "workflow-ci", vers: "tests-contract", nature: "declenche" },
  { de: "workflow-ci", vers: "tests-e2e", nature: "declenche" },
  { de: "tests-unit", vers: "gardes", nature: "embarque", libelle: "les gardes sont des tests unitaires" },
  { de: "tests-unit", vers: "sdk-web", nature: "verifie" },
  { de: "tests-integration", vers: "base", nature: "verifie", libelle: "migrations, rôles, RGPD" },
  { de: "tests-contract", vers: "reception", nature: "verifie", libelle: "parité" },
  { de: "tests-contract", vers: "collector", nature: "verifie", libelle: "parité" },
  { de: "tests-contract", vers: "api", nature: "verifie", libelle: "parité" },
  { de: "tests-contract", vers: "console-api", nature: "verifie", libelle: "autorisations" },
  { de: "tests-e2e", vers: "console-ecrans", nature: "verifie", libelle: "chaque écran, trois rôles" },
  { de: "gardes", vers: "base-fonctions", nature: "verifie", libelle: "migrations figées" },
  { de: "workflow-docker-smoke", vers: "railway-projet", nature: "verifie", libelle: "les six images" },
  { de: "workflow-railway-config", vers: "railway-projet", nature: "deploie", libelle: "plan relu, puis apply" },
  { de: "workflow-sonde-externe", vers: "console", nature: "verifie", libelle: "/api/live" },
  { de: "workflow-sonde-externe", vers: "railway-projet", nature: "verifie", libelle: "/live, /health" },
  { de: "s-secrets", vers: "depot", nature: "protege" },
  { de: "s-conformite", vers: "console", nature: "protege", libelle: "pages légales" },
];
