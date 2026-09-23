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
  collector: "server.mjs",
  scheduler: "worker.mjs",
  mcp: "http.mjs",
};

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
  it("les trois services, et eux seuls, sont ceux qu'on attend", () => {
    // Un quatrième service (api, notifier…) doit s'ajouter ici EN CONNAISSANCE
    // DE CAUSE : son entrée, puis le reste de ce fichier s'appliquera à lui.
    expect(SERVICES).toEqual(Object.keys(ENTREE).sort());
  });

  it.each(SERVICES)("%s : services/%s/Dockerfile existe", (svc) => {
    expect(existsSync(join("services", svc, "Dockerfile"))).toBe(true);
  });

  it("chaque FROM est épinglé par digest, et les trois images épinglent LE MÊME", () => {
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
    expect(existsSync(join("services", svc, ENTREE[svc]))).toBe(true);
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
