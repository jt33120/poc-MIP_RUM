// P5.4 — CLI de CI scripts/upload-sourcemaps.mjs, contre un serveur HTTP local.
//
// Ce qui est verrouillé : le jeton ne vient que de l'environnement et n'est
// jamais écrit ; les maps sont reliées aux bundles et TOUTES validées avant le
// premier envoi ; les lots respectent le plafond du port visé ; les nouvelles
// tentatives sont bornées ; tout upload incomplet sort en code non nul. La
// recette avec un vrai bundle compilé et un vrai receveur est dans
// tests/integration/sourcemaps-p54-sql.test.ts.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  construireManifeste,
  decouperEnLots,
  executer,
  lireArguments,
  SORTIE,
} from "../../scripts/upload-sourcemaps.mjs";

const RACINE = join(__dirname, "..", "..");
const JETON = `msu_${"a".repeat(32)}_${"b".repeat(64)}`;
const MAP = JSON.stringify({ version: 3, sources: ["src/a.ts"], names: [], mappings: "AAAA" });
const sha = (texte: string) => createHash("sha256").update(texte, "utf8").digest("hex");

let dossier: string;

function ecrire(relatif: string, contenu: string) {
  const chemin = join(dossier, relatif);
  mkdirSync(dirname(chemin), { recursive: true });
  writeFileSync(chemin, contenu);
  return chemin;
}

/** Bundle minifié et sa map voisine, reliés par sourceMappingURL. */
function bundle(relatif: string, map = MAP) {
  ecrire(relatif, `(()=>{throw new Error("x")})();\n//# sourceMappingURL=${relatif.split("/").pop()}.map\n`);
  ecrire(`${relatif}.map`, map);
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), "p54-cli-"));
});

afterEach(() => {
  rmSync(dossier, { recursive: true, force: true });
});

describe("arguments", () => {
  const base = ["--app", "app-a", "--release", "1.0", "--dir", "dist"];
  it.each([
    [[...base, "--url", "https://i.exemple.fr/v1/sourcemaps", "--token", JETON], /jamais en argument/],
    [[...base, `--token=${JETON}`, "--url", "https://i.exemple.fr/v1/sourcemaps"], /jamais en argument/],
    [base, /--url requis/],
    [[...base, "--url", "http://i.exemple.fr/v1/sourcemaps"], /https/],
    [[...base, "--url", "https://i.exemple.fr/upload"], /\/api\/sourcemaps \(console\) ou \/v1\/sourcemaps/],
    [[...base, "--url", "https://c.exemple.fr/api/sourcemaps", "--max-batch-bytes", String(5 * 1024 * 1024)], /max-batch-bytes/],
    [[...base, "--url", "https://i.exemple.fr/v1/sourcemaps", "--retries", "9"], /retries/],
  ])("refuse %j", (argv, message) => {
    expect(() => lireArguments(argv)).toThrow(message);
  });

  it("déduit le plafond de lot du port : 3 Mio console, 20 Mio backend direct ; http seulement vers localhost", () => {
    expect(lireArguments([...base, "--url", "https://c.exemple.fr/api/sourcemaps"]).lotMax).toBe(3 * 1024 * 1024);
    expect(lireArguments([...base, "--url", "https://i.exemple.fr/v1/sourcemaps"]).lotMax).toBe(20 * 1024 * 1024);
    expect(lireArguments([...base, "--url", "http://127.0.0.1:4318/v1/sourcemaps"]).port.nom).toBe("backend direct");
  });
});

describe("manifeste : bundles reliés à leurs maps, tout validé avant l'envoi", () => {
  it("relie chaque bundle à sa map, calcule tailles et SHA-256, signale orphelines et maps inline", () => {
    bundle("assets/main-4f2a.js");
    ecrire("assets/sans-map.js", "console.log(1)\n");
    ecrire("assets/orpheline.js.map", MAP);
    ecrire("assets/inline.js", "x\n//# sourceMappingURL=data:application/json;base64,e30=\n");
    const { entrees, erreurs, avertissements } = construireManifeste(dossier);
    expect(erreurs).toEqual([]);
    expect(entrees.map(({ content: _c, ...e }) => e)).toEqual([
      { bundle: "assets/main-4f2a.js", map: "assets/main-4f2a.js.map", filename: "main-4f2a.js", size_bytes: MAP.length, checksum: sha(MAP) },
    ]);
    expect(avertissements).toEqual([
      "assets/inline.js : map inline ignorée (elle est déjà publiée avec le bundle)",
      "assets/orpheline.js.map : map sans bundle correspondant, ignorée",
    ]);
  });

  it("refuse explicitement : map absente, map distante, sortie du dossier, lien symbolique, homonymes, map invalide, jeton embarqué", () => {
    ecrire("a/declaree.js", "x\n//# sourceMappingURL=introuvable.js.map\n");
    ecrire("a/distante.js", "x\n//# sourceMappingURL=https://cdn.exemple.fr/distante.js.map\n");
    ecrire("a/evasion.js", "x\n//# sourceMappingURL=../../evasion.map\n");
    writeFileSync(join(dossier, "..", "evasion.map"), MAP);
    const dehors = mkdtempSync(join(tmpdir(), "p54-dehors-"));
    writeFileSync(join(dehors, "lien.js.map"), MAP);
    ecrire("a/lien.js", "x\n");
    symlinkSync(join(dehors, "lien.js.map"), join(dossier, "a", "lien.js.map"));
    bundle("a/app.js");
    bundle("b/app.js");
    bundle("c/casse.js", JSON.stringify({ version: 3, sources: [], mappings: "AAAA" }));
    ecrire("c/fuite.js", `const t="${JETON}";\n`);

    const { erreurs } = construireManifeste(dossier, { secret: JETON });
    rmSync(dehors, { recursive: true, force: true });
    rmSync(join(dossier, "..", "evasion.map"), { force: true });
    expect(erreurs).toEqual([
      "a/declaree.js : map déclarée introuvable (introuvable.js.map)",
      "a/distante.js : map distante non récupérée, aucune lecture réseau (https://cdn.exemple.fr/distante.js.map)",
      "a/evasion.js : map hors du dossier du build, refusée",
      "a/lien.js : map hors du dossier du build, refusée",
      "deux bundles portent le nom app.js (a/app.js, b/app.js) : les stacks ne les distinguent pas",
      "c/casse.js.map : source map invalide (index de source 0 hors bornes en position 0)",
      "c/fuite.js : contient le jeton MIP_SOURCEMAP_TOKEN, il serait publié avec le client",
    ]);
  });

  it("découpe en lots sous le plafond ; une map indivisible trop lourde pour la console renvoie au backend direct", () => {
    const grosse = (n: number) =>
      JSON.stringify({ version: 3, sources: ["src/a.ts"], names: [], mappings: "AAAA", sourcesContent: ["x".repeat(n)] });
    for (const i of [1, 2, 3, 4]) bundle(`assets/m${i}.js`, grosse(1024 * 1024));
    bundle("assets/geante.js", grosse(3 * 1024 * 1024 + 10));
    const { entrees } = construireManifeste(dossier);
    const options = lireArguments(["--app", "a", "--release", "1", "--dir", dossier, "--url", "https://c.exemple.fr/api/sourcemaps"]);
    const { lots, erreurs } = decouperEnLots(entrees, options);
    expect(lots.map((lot) => lot.length)).toEqual([2, 2]);
    for (const lot of lots) {
      const taille = Buffer.byteLength(JSON.stringify({ appId: "a", release: "1", maps: lot.map((m) => ({ filename: m.filename, content: m.content })) }));
      expect(taille).toBeLessThanOrEqual(3 * 1024 * 1024);
    }
    expect(erreurs).toHaveLength(1);
    expect(erreurs[0]).toMatch(/assets\/geante\.js\.map : indivisible.*--url https:\/\/<ingest>\/v1\/sourcemaps/);
  });
});

describe("exécution contre un serveur local", () => {
  type Reponse = { statut: number; corps?: unknown; entetes?: Record<string, string> };
  let serveur: Server;
  let url: string;
  let reponses: Array<Reponse | ((corps: { maps: Array<{ filename: string; content: string }> }) => Reponse)>;
  let recues: Array<{ entetes: IncomingMessage["headers"]; corps: { appId: string; release: string; maps: Array<{ filename: string; content: string }> } }>;

  /** Réponse 200 honnête : l'empreinte que calculerait le serveur. */
  const succes = (corps: { maps: Array<{ filename: string; content: string }> }): Reponse => ({
    statut: 200,
    corps: {
      uploaded: corps.maps.length,
      created: corps.maps.length,
      unchanged: 0,
      replaced: 0,
      maps: corps.maps.map((m) => ({ filename: m.filename, status: "created", checksum: sha(m.content), size_bytes: m.content.length })),
      release: { files: corps.maps.length, fingerprint: "empreinte-serveur" },
    },
  });

  beforeEach(async () => {
    reponses = [];
    recues = [];
    serveur = createServer((req, res) => {
      let brut = "";
      req.on("data", (c) => (brut += c));
      req.on("end", () => {
        const corps = JSON.parse(brut);
        recues.push({ entetes: req.headers, corps });
        const suivante = reponses.shift() ?? succes;
        const r = typeof suivante === "function" ? suivante(corps) : suivante;
        res.writeHead(r.statut, { "content-type": "application/json", ...r.entetes });
        res.end(JSON.stringify(r.corps ?? {}));
      });
    });
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    url = `http://127.0.0.1:${(serveur.address() as { port: number }).port}/v1/sourcemaps`;
  });

  afterEach(async () => {
    await new Promise((ok) => serveur.close(ok));
  });

  async function lancer(extra: string[] = [], env: Record<string, string> = { MIP_SOURCEMAP_TOKEN: JETON }) {
    const sortie: string[] = [];
    const code = await executer(
      ["--app", "app-a", "--release", "2.3.1", "--dir", dossier, "--url", url, "--retry-delay-ms", "1", ...extra],
      env,
      { log: (l: string) => sortie.push(l), erreur: (l: string) => sortie.push(l) },
    );
    return { code, sortie: sortie.join("\n") };
  }

  it("simulation : aucun envoi, aucun jeton requis, manifeste écrit sans le contenu des maps", async () => {
    bundle("assets/main.js");
    const manifeste = join(dossier, "..", `manifeste-${Date.now()}.json`);
    const { code, sortie } = await lancer(["--dry-run", "--manifest", manifeste], {});
    expect(code).toBe(SORTIE.succes);
    expect(recues).toHaveLength(0);
    expect(sortie).toContain("simulation : rien n'a été envoyé");
    const ecrit = JSON.parse(readFileSync(manifeste, "utf8"));
    rmSync(manifeste);
    expect(ecrit.maps).toEqual([{ bundle: "assets/main.js", map: "assets/main.js.map", filename: "main.js", size_bytes: MAP.length, checksum: sha(MAP) }]);
    expect(JSON.stringify(ecrit)).not.toContain("mappings");
  });

  it("jeton absent ou au format d'un jeton de lecture : code 2, rien n'est envoyé", async () => {
    bundle("assets/main.js");
    expect((await lancer([], {})).code).toBe(SORTIE.usage);
    const lecture = await lancer([], { MIP_SOURCEMAP_TOKEN: "mrk_lecture" });
    expect(lecture.code).toBe(SORTIE.usage);
    expect(lecture.sortie).toContain("un jeton de lecture n'y donne pas droit");
    expect(lecture.sortie).not.toContain("mrk_lecture");
    expect(recues).toHaveLength(0);
  });

  it("upload complet : jeton en en-tête seulement, jamais dans la sortie ; empreintes vérifiées", async () => {
    bundle("assets/main.js");
    bundle("assets/vendor.js");
    const { code, sortie } = await lancer();
    expect(code).toBe(SORTIE.succes);
    expect(recues).toHaveLength(1);
    expect(recues[0].entetes.authorization).toBe(`Bearer ${JETON}`);
    expect(recues[0].corps).toMatchObject({ appId: "app-a", release: "2.3.1" });
    expect(recues[0].corps.maps.map((m) => m.filename)).toEqual(["main.js", "vendor.js"]);
    expect(sortie).toContain("upload complet");
    expect(sortie).not.toContain(JETON);
    expect(sortie).not.toContain("b".repeat(64));
  });

  it("nouvelle tentative sur 5xx puis succès ; tentatives bornées sinon, avec code 1", async () => {
    bundle("assets/main.js");
    reponses.push({ statut: 503, corps: { error: "indisponible" } });
    expect((await lancer()).code).toBe(SORTIE.succes);
    expect(recues).toHaveLength(2);

    recues = [];
    reponses.push(...Array.from({ length: 5 }, () => ({ statut: 500, corps: { error: "panne" } })));
    const { code, sortie } = await lancer(["--retries", "2"]);
    expect(code).toBe(SORTIE.incomplet);
    expect(recues).toHaveLength(3);
    expect(sortie).toContain("upload incomplet : 0 lot(s) sur 1 enregistrés");
  });

  it("409 : pas de nouvelle tentative, conflit affiché, code 1 et lots suivants non envoyés", async () => {
    for (const i of [1, 2]) bundle(`assets/m${i}.js`, JSON.stringify({ version: 3, sources: ["a"], names: [], mappings: "AAAA", sourcesContent: ["x".repeat(1024 * 1024)] }));
    reponses.push({ statut: 409, corps: { error: "contenu différent", conflicts: [{ filename: "m1.js", existing_checksum: "e1", received_checksum: "r1" }] } });
    const { code, sortie } = await lancer(["--max-batch-bytes", String(1024 * 1024 + 4096)]);
    expect(code).toBe(SORTIE.incomplet);
    expect(recues).toHaveLength(1);
    expect(sortie).toContain("conflit m1.js : présent e1, envoyé r1");
  });

  it("empreinte rendue par le serveur différente de la map envoyée : code 1", async () => {
    bundle("assets/main.js");
    reponses.push((corps) => {
      const r = succes(corps) as { statut: number; corps: { maps: Array<{ checksum: string }> } };
      r.corps.maps[0].checksum = "0".repeat(64);
      return r;
    });
    const { code, sortie } = await lancer();
    expect(code).toBe(SORTIE.incomplet);
    expect(sortie).toContain("empreinte serveur différente pour main.js");
  });

  it("une map invalide dans le build : aucun envoi, code 1", async () => {
    bundle("assets/a.js");
    bundle("assets/z.js", "{ pas du json");
    const { code, sortie } = await lancer();
    expect(code).toBe(SORTIE.incomplet);
    expect(recues).toHaveLength(0);
    expect(sortie).toContain("aucune map envoyée");
  });

  it("serveur injoignable : code 1 après les tentatives", async () => {
    bundle("assets/main.js");
    await new Promise((ok) => serveur.close(ok));
    serveur = createServer();
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    const port = (serveur.address() as { port: number }).port;
    await new Promise((ok) => serveur.close(ok));
    url = `http://127.0.0.1:${port}/v1/sourcemaps`;
    serveur = createServer();
    await new Promise<void>((ok) => serveur.listen(0, "127.0.0.1", ok));
    const { code, sortie } = await lancer(["--retries", "1"]);
    expect(code).toBe(SORTIE.incomplet);
    expect(sortie).toMatch(/lot 1 refusé \(réseau\)/);
  });
});

describe("script exécutable", () => {
  it("code 2 et message explicite pour un jeton passé en argument ; simulation réelle en code 0", () => {
    const script = join(RACINE, "scripts", "upload-sourcemaps.mjs");
    const refus = spawnSync(process.execPath, [script, "--token", JETON], { encoding: "utf8" });
    expect(refus.status).toBe(2);
    expect(refus.stderr).toContain("MIP_SOURCEMAP_TOKEN");
    expect(refus.stderr).not.toContain(JETON);

    bundle("assets/main.js");
    const sortie = execFileSync(
      process.execPath,
      [script, "--app", "a", "--release", "1", "--dir", dossier, "--url", "https://i.exemple.fr/v1/sourcemaps", "--dry-run"],
      { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
    );
    expect(sortie).toContain("1 map(s) pour a @ 1 → backend direct, 1 lot(s)");
  });
});
