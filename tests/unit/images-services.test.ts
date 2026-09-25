// P1 — les images de service (contrat de service § 9), vérifiées sans Docker.
//
// Le job de fumée (`.github/workflows/docker-smoke.yml`) construit et démarre
// les images ; il ne tourne que sur les PR qui touchent le backend, et il est
// lent. Ce qui suit tient en millisecondes et tourne à CHAQUE `pnpm test:unit` :
// la forme des Dockerfiles, et leur accord avec les trois fichiers qui les
// nomment (compose, IaC Railway, workflow de fumée). Un service ajouté sans
// Dockerfile, un digest monté dans une image et pas dans les autres, un `CMD`
// qui pointe dans le vide, une IaC qui vise encore l'ancienne image commune :
// chacun fait échouer un test ci-dessous, nommément.
//
// Puis la garde `scripts/ci/deploy-fidele.mjs`, que chaque image exécute après
// `pnpm deploy` : fonction pure, sur des lockfiles de fixture.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { comparer, estWorkspace, main, resolutions } from "../../scripts/ci/deploy-fidele.mjs";

const lire = (chemin: string) => readFileSync(chemin, "utf8");

/** Les services = les dossiers de `services/` qui portent un package.json. */
const SERVICES = readdirSync("services", { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join("services", d.name, "package.json")))
  .map((d) => d.name)
  .sort();

/** Le point d'entrée que chaque image démarre. */
const ENTREE: Record<string, string> = {
  api: "dist/server.mjs",
  collector: "server.mjs",
  "console-api": "dist/server.mjs",
  scheduler: "worker.mjs",
  notifier: "worker.mjs",
  mcp: "http.mjs",
};
/**
 * Le fichier SOURCE du point d'entrée, quand l'image démarre un fichier construit
 * (`dist/`, hors dépôt) : `api` compile les routes v1 de la console, `console-api`
 * ses paquets TypeScript — l'un et l'autre à partir de `server.mjs`.
 */
const SOURCE: Record<string, string> = { api: "server.mjs", "console-api": "server.mjs" };

const dockerfile = (svc: string) => lire(join("services", svc, "Dockerfile"));
/** Les instructions, sans les commentaires ni les lignes vides. */
const instructions = (texte: string) =>
  texte.split("\n").filter((l) => l.trim() && !l.trimStart().startsWith("#")).join("\n");
/** Ce qui suit le DERNIER `FROM` : l'étape d'exécution, la seule qui part en production. */
const etapeFinale = (texte: string) => {
  const inst = instructions(texte);
  return inst.slice(inst.lastIndexOf("\nFROM ") + 1);
};
const FROM = /^FROM (\S+)/gm;

describe("images — un Dockerfile par service", () => {
  it("les services, et eux seuls, sont ceux qu'on attend", () => {
    // Un service de plus (api, console-api…) doit s'ajouter ici EN CONNAISSANCE
    // DE CAUSE : son entrée, puis le reste de ce fichier s'appliquera à lui.
    expect(SERVICES).toEqual(Object.keys(ENTREE).sort());
  });

  it.each(SERVICES)("%s : services/%s/Dockerfile existe", (svc) => {
    expect(existsSync(join("services", svc, "Dockerfile"))).toBe(true);
  });

  it("chaque FROM est épinglé par digest, et toutes les images épinglent LE MÊME", () => {
    const refs = SERVICES.flatMap((svc) => [...instructions(dockerfile(svc)).matchAll(FROM)].map((m) => m[1]));
    expect(refs.length).toBe(SERVICES.length * 2); // construction + exécution
    for (const ref of refs) expect(ref).toMatch(/^node:[\w.-]+@sha256:[0-9a-f]{64}$/);
    expect(new Set(refs).size).toBe(1);
  });

  it("le runtime des images est celui de .nvmrc", () => {
    const majeure = lire(".nvmrc").trim();
    const [ref] = [...instructions(dockerfile("collector")).matchAll(FROM)].map((m) => m[1]);
    expect(ref).toMatch(new RegExp(`^node:${majeure}\\.`));
  });

  it.each(SERVICES)("%s : la recette pnpm fetch → install --offline → build → deploy --prod", (svc) => {
    const inst = instructions(dockerfile(svc));
    const etapes = [
      "RUN pnpm fetch",
      `RUN pnpm install --offline --frozen-lockfile --filter "@mip/service-${svc}..."`,
      `RUN pnpm --filter "@mip/service-${svc}..." run --if-present build`,
      `RUN pnpm --filter @mip/service-${svc} deploy --prod /app/services/${svc}`,
      `node scripts/ci/deploy-fidele.mjs pnpm-lock.yaml /app/services/${svc}`,
    ];
    const positions = etapes.map((e) => inst.indexOf(e));
    for (const [i, p] of positions.entries()) expect(p, etapes[i]).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions); // dans cet ordre
    // L'étape de construction ne va pas chercher un cache monté : Railway en
    // refuse la syntaxe générique (identifiant préfixé par le service exigé).
    expect(inst).not.toContain("--mount=type=cache");
  });

  it.each(SERVICES)("%s : étape d'exécution en production, non-root, sondée, CMD explicite", (svc) => {
    const finale = etapeFinale(dockerfile(svc));
    expect(finale).toMatch(/^ENV NODE_ENV=production\b/m);
    expect(finale).toMatch(/^USER node$/m);
    expect(finale).not.toMatch(/^USER (root|0)\b/m);
    expect(finale).toMatch(/^HEALTHCHECK .*\n?.*\/health/m);
    // L'étape finale ne reprend QUE l'arbre déployé : ni le dépôt, ni le store.
    expect(finale).toMatch(/^COPY --from=construction \/app \/app$/m);
    expect(finale.match(/^COPY /gm)).toHaveLength(1);
    // Le CMD désigne ce service, et un fichier qui existe.
    const cmd = `CMD ["node", "services/${svc}/${ENTREE[svc]}"]`;
    expect(finale).toContain(cmd);
    expect(finale.match(/^CMD /gm)).toHaveLength(1);
    expect(existsSync(join("services", svc, SOURCE[svc] ?? ENTREE[svc]))).toBe(true);
    expect(finale).not.toMatch(/^ENTRYPOINT /m);
  });

  it("la base GeoIP n'entre que dans l'image collector, depuis le manifeste", () => {
    for (const svc of SERVICES) {
      const inst = instructions(dockerfile(svc));
      expect(inst.includes("fetch-geoip-db.mjs"), svc).toBe(svc === "collector");
    }
    const collector = instructions(dockerfile("collector"));
    expect(collector).toContain("/app/services/collector/node_modules/@mip/backend/data/");
    // Plus d'empreinte recopiée en argument de build : le manifeste fait foi.
    expect(collector).not.toMatch(/GEOIP_SHA256|GEOIP_VERSION/);
    expect(existsSync("packages/backend/data/dbip-country-lite.manifest.json")).toBe(true);
  });

  it("@mip/db embarque sql/ (le migrateur le lit à côté de lui)", () => {
    const db = JSON.parse(lire("packages/db/package.json"));
    expect(db.files).toEqual(expect.arrayContaining(["migrate.mjs", "sql"]));
  });

  it(".dockerignore tient les secrets et une base GeoIP locale hors du contexte", () => {
    const ignore = lire(".dockerignore").split("\n").map((l) => l.trim());
    expect(ignore).toContain("**/.env");
    expect(ignore).toContain("**/node_modules");
    expect(ignore).toContain(".claude");
    expect(ignore).toContain("packages/backend/data/dbip-country-lite-*.csv.gz");
  });
});

describe("images — le compose et la fumée", () => {
  // Le compose est lu par blocs d'indentation : pas de dépendance YAML ajoutée
  // pour un test, et le fichier garde une forme simple, que ce découpage exige.
  // Sans ses commentaires : ils NOMMENT ce qui est absent (« ni DATABASE_URL »,
  // « initdb.sh appliquait… »), et c'est la configuration qu'on juge.
  const compose = instructions(lire("infra/docker/docker-compose.yml")) + "\n";
  const services = compose.slice(compose.indexOf("\nservices:\n"), compose.indexOf("\nvolumes:\n"));
  const bloc = (nom: string) => {
    const m = services.match(new RegExp(`\\n  ${nom}:\\n((?:    .*\\n|\\s*\\n)*)`));
    return m?.[1] ?? "";
  };

  it.each(SERVICES)("compose : %s a son profil, son image de production", (svc) => {
    const b = bloc(svc);
    expect(b, `service compose « ${svc} »`).not.toBe("");
    expect(b).toContain(`profiles: ["${svc}", "tout"]`);
    expect(b).toContain(`dockerfile: services/${svc}/Dockerfile`);
  });

  it("compose : `migrate` est un one-shot du scheduler, dont dépendent les services qui ont une base", () => {
    const migrate = bloc("migrate");
    expect(migrate).toContain("dockerfile: services/scheduler/Dockerfile");
    expect(migrate).toContain('command: ["node", "services/scheduler/migrate.mjs"]');
    expect(migrate).toContain('restart: "no"');
    expect(migrate).not.toContain("profiles:");
    for (const svc of ["api", "collector", "console-api", "scheduler", "notifier"]) expect(bloc(svc)).toContain("depends_on: *apres-migration");
    expect(compose).toMatch(/x-apres-migration: &apres-migration\n\s+migrate:\n\s+condition: service_completed_successfully/);
    // Le schéma n'est plus posé par un script d'initialisation de Postgres.
    expect(compose).not.toContain("docker-entrypoint-initdb.d");
    expect(compose).not.toContain("initdb.sh");
  });

  it("compose : mcp n'a ni base, ni dépendance à la migration", () => {
    const mcp = bloc("mcp");
    expect(mcp).not.toContain("DATABASE_URL");
    expect(mcp).not.toContain("depends_on");
  });

  it("la fumée couvre chaque service, en matrice", () => {
    const wf = lire(".github/workflows/docker-smoke.yml");
    const matrice = [...wf.matchAll(/- service: ([a-z-]+)/g)].map((m) => m[1]).sort();
    expect(matrice).toEqual(SERVICES);
    expect(wf).toContain("COMPOSE_PROFILES: ${{ matrix.service }}");
  });

  // JONCTION des deux lots P1 : le scheduler passé sur le kit n'a plus de
  // `/status` (sans jeton) ; son bilan vit dans `/ready`, derrière METRICS_TOKEN.
  // Une fumée qui interrogerait encore `/status` recevrait 404 — et le compose
  // doit transmettre le jeton, sinon `/ready` répond 404 lui aussi.
  it("scheduler : le compose passe METRICS_TOKEN, la fumée lit /ready sous jeton, plus /status", () => {
    expect(bloc("scheduler")).toMatch(/METRICS_TOKEN: \$\{METRICS_TOKEN:-\}/);
    const wf = instructions(lire(".github/workflows/docker-smoke.yml"));
    expect(wf).not.toMatch(/\/status\b/);
    expect(wf).toMatch(/METRICS_TOKEN: \S{32,}/);
    expect(wf).toContain('-H "authorization: Bearer $METRICS_TOKEN"');
    expect(wf).toContain("/ready");
  });
});

describe("images — l'IaC Railway, et la sortie des images communes", () => {
  it("chaque service déclaré dans .railway/railway.ts construit SON Dockerfile", () => {
    const iac = lire(".railway/railway.ts");
    const declares = [...iac.matchAll(/service\("([a-z-]+)",[\s\S]*?dockerfilePath: "([^"]+)"/g)];
    expect(declares.length).toBeGreaterThan(0);
    for (const [, nom, chemin] of declares) {
      expect(chemin).toBe(`services/${nom}/Dockerfile`);
      expect(existsSync(chemin)).toBe(true);
    }
    // Plus aucun service ne construit l'ancienne image commune (les chemins
    // surveillés peuvent encore la nommer : ils sont l'union ancien ∪ nouveau).
    expect(iac).not.toMatch(/dockerfilePath: "infra\/docker\//);
  });

  it("l'initialisation par psql a disparu ; plus rien ne construit les images communes", () => {
    expect(existsSync("infra/docker/db/initdb.sh")).toBe(false);
    // Les deux anciennes images RESTENT le temps de l'apply de l'IaC : le
    // tableau de bord Railway les désigne encore, et Railway construit à chaque
    // push. Marquées obsolètes, et construites par AUCUN fichier du dépôt ; les
    // supprimer est l'étape d'après (voir leur en-tête).
    const compose = instructions(lire("infra/docker/docker-compose.yml"));
    const fumee = lire(".github/workflows/docker-smoke.yml");
    for (const ancien of ["infra/docker/Dockerfile.backend", "infra/docker/Dockerfile.mcp"]) {
      if (existsSync(ancien)) expect(lire(ancien).split("\n")[0], ancien).toMatch(/^# OBSOLÈTE/);
      const nom = ancien.split("/").pop()!;
      expect(compose).not.toContain(nom);
      expect(fumee).not.toContain(nom);
    }
  });
});

// ─── scripts/ci/deploy-fidele.mjs ───────────────────────────────────────────
const LOCK_DEPOT = `lockfileVersion: '9.0'

importers:

  services/scheduler:
    dependencies:
      pg:
        specifier: 8.21.0
        version: 8.21.0

packages:

  '@types/node@22.19.20':
    resolution: {integrity: sha512-TYPES}

  pg-pool@3.14.0:
    resolution: {integrity: sha512-POOL}
    peerDependencies:
      pg: '>=8.0'

  pg@8.21.0:
    resolution: {integrity: sha512-PG}
    engines: {node: '>= 16.0.0'}

snapshots:

  pg-pool@3.14.0(pg@8.21.0):
    dependencies:
      pg: 8.21.0
`;
const deploye = (...entrees: string[]) => `lockfileVersion: '9.0'

packages:

  '@mip/backend@file:packages/backend':
    resolution: {directory: packages/backend, type: directory}

${entrees.join("\n\n")}
`;

describe("deploy-fidele — l'arbre déployé est celui du lockfile", () => {
  it("lit la section packages (clés entre apostrophes comprises), jamais les snapshots", () => {
    const r = resolutions(LOCK_DEPOT);
    expect([...r.keys()]).toEqual(["@types/node@22.19.20", "pg-pool@3.14.0", "pg@8.21.0"]);
    expect(r.get("pg@8.21.0")).toBe("{integrity: sha512-PG}");
  });

  it("conforme : mêmes versions, mêmes empreintes ; le workspace est hors champ", () => {
    const d = deploye("  pg@8.21.0:\n    resolution: {integrity: sha512-PG}", "  pg-pool@3.14.0:\n    resolution: {integrity: sha512-POOL}");
    expect(comparer(LOCK_DEPOT, d)).toEqual({ verifies: 2, ecarts: [] });
    expect(estWorkspace("@mip/backend@file:packages/backend", "{directory: packages/backend, type: directory}")).toBe(true);
  });

  it("une version que le lockfile ne connaît pas est un écart", () => {
    const d = deploye("  pg-pool@3.15.0:\n    resolution: {integrity: sha512-NOUVEAU}");
    expect(comparer(LOCK_DEPOT, d).ecarts).toEqual([{ paquet: "pg-pool@3.15.0", raison: "absent du lockfile du dépôt" }]);
  });

  it("une même version à une autre empreinte est un écart (tarball republié)", () => {
    const d = deploye("  pg@8.21.0:\n    resolution: {integrity: sha512-AUTRE}");
    const { ecarts } = comparer(LOCK_DEPOT, d);
    expect(ecarts).toHaveLength(1);
    expect(ecarts[0].raison).toContain("empreinte différente");
  });

  it("un lockfile illisible n'est jamais un succès", () => {
    expect(() => comparer("rien", deploye())).toThrow(/dépôt illisible/);
    expect(() => comparer(LOCK_DEPOT, "lockfileVersion: '9.0'\n")).toThrow(/déployé illisible/);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(main([])).toBe(2);
      expect(main(["pnpm-lock.yaml", "/nulle/part"])).toBe(2);
    } finally {
      log.mockRestore();
    }
  });
});
