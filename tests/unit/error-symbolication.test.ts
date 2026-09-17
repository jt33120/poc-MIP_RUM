// P5.4 — symbolication à l'ingestion : cache borné, budget de travail, statuts.
//
// La base est simulée : ce fichier verrouille ce que le symbolicateur DEMANDE
// (et ne redemande pas) et ce qu'il rend pour chaque erreur. Le chemin réel —
// map uploadée, lot OTLP, colonne écrite — est prouvé sur PostgreSQL dans
// tests/integration/sourcemaps-p54-sql.test.ts.
import { describe, expect, it, vi } from "vitest";
import {
  creerSymbolicateur,
  LIMITES_SYMBOLICATION,
} from "../../apps/ingest/lib/error-symbolication.mjs";
import { _resetColonnesCache, writeRows } from "../../apps/ingest/lib/pg-ingest.mjs";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function vlq(n: number): string {
  let v = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let out = "";
  do {
    let d = v & 31;
    v >>>= 5;
    if (v > 0) d |= 32;
    out += B64[d];
  } while (v > 0);
  return out;
}

/** Map d'un bundle : colonne 0 → src/<fichier>:10 fonction `nom`. */
const mapPour = (fichier: string, nom: string) =>
  JSON.stringify({ version: 3, sources: [`webpack:///./src/${fichier}`], names: [nom], mappings: vlq(0) + vlq(0) + vlq(9) + vlq(4) + vlq(0) });

const stackPour = (...bundles: string[]) =>
  ["TypeError: boom", ...bundles.map((b) => `    at t (https://app.exemple.fr/assets/${b}:1:1)`)].join("\n");

interface Ligne {
  content: string;
  version: string;
  size_bytes?: number;
}

/** Base simulée : (app, release, fichier) → map ; journal des requêtes. */
function baseFactice(maps: Record<string, Ligne> = {}) {
  const requetes: Array<{ sql: string; params: unknown[] }> = [];
  let panne = false;
  const cle = (app: unknown, release: unknown, fichier: string) => `${app}|${release}|${fichier}`;
  return {
    requetes,
    maps,
    tomber: () => {
      panne = true;
    },
    db: {
      async query(sql: string, params: unknown[] = []) {
        requetes.push({ sql, params });
        if (panne) throw Object.assign(new Error("connexion perdue"), { code: "57P01" });
        const [app, release, noms] = params as [string, string, string[]];
        const presentes = noms.filter((n) => maps[cle(app, release, n)]);
        if (sql.includes("size_bytes")) {
          return {
            rows: presentes.map((n) => {
              const m = maps[cle(app, release, n)];
              return { filename: n, version: m.version, size_bytes: m.size_bytes ?? Buffer.byteLength(m.content) };
            }),
          };
        }
        return { rows: presentes.map((n) => ({ filename: n, content: maps[cle(app, release, n)].content })) };
      },
    },
  };
}

const lectures = (b: ReturnType<typeof baseFactice>) => b.requetes.filter((r) => r.sql.includes("content")).length;
const sondes = (b: ReturnType<typeof baseFactice>) => b.requetes.filter((r) => r.sql.includes("size_bytes")).length;

describe("creerSymbolicateur — statuts", () => {
  it("résout, rescrubbe et situe les frames ; la stack brute n'est pas touchée", async () => {
    const base = baseFactice({ "a|1.0|main.4f2a.js": { content: mapPour("panier.ts", "valider.alice@exemple.fr"), version: "v1" } });
    const s = creerSymbolicateur();
    const erreur = { app_id: "a", release: "1.0", stack: stackPour("main.4f2a.js") };
    const [r] = await s.symboliquerLot(base.db, [erreur]);
    expect(r).toMatchObject({ status: "resolved", raison: null });
    expect(r!.stack).toContain("src/panier.ts:10:5");
    // Un nom venu de la map passe par le même scrub que la stack brute.
    expect(r!.stack).toContain("[email]");
    expect(r!.stack).not.toContain("alice@exemple.fr");
    expect(r!.positions).toEqual([
      { index: 1, bundle: "main.4f2a.js", source: "src/panier.ts", line: 10, column: 4, name: "valider.alice@exemple.fr" },
    ]);
    expect(erreur.stack).toBe(stackPour("main.4f2a.js"));
  });

  it("rien à faire sans frame JavaScript : null, et aucune requête", async () => {
    const base = baseFactice();
    const s = creerSymbolicateur();
    const python = 'Traceback (most recent call last):\n  File "app.py", line 3, in <module>';
    expect(await s.symboliquerLot(base.db, [{ app_id: "a", release: "1", stack: python }, { app_id: "a", release: "1", stack: "" }]))
      .toEqual([null, null]);
    expect(base.requetes).toEqual([]);
  });

  it("release absente, map absente ou positions hors map : unavailable, avec la raison", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("a.ts", "f"), version: "v1" } });
    const s = creerSymbolicateur();
    const [sansRelease, sansMap, horsMap] = await s.symboliquerLot(base.db, [
      { app_id: "a", release: null, stack: stackPour("main.js") },
      { app_id: "a", release: "2.0", stack: stackPour("main.js") },
      { app_id: "a", release: "1.0", stack: "Error\n    at t (https://x/main.js:7:1)" },
    ]);
    expect(sansRelease).toMatchObject({ status: "unavailable", stack: null, raison: "release absente" });
    expect(sansMap).toMatchObject({ status: "unavailable", raison: "aucune source map pour la release 2.0" });
    expect(horsMap).toMatchObject({ status: "unavailable", raison: "positions absentes des source maps de cette release" });
  });

  it("une map hostile donne failed, journalisé UNE fois par version, sans relecture ni blocage du lot", async () => {
    const base = baseFactice({
      "a|1.0|casse.js": { content: "{ pas du json", version: "v1" },
      "a|1.0|main.js": { content: mapPour("a.ts", "f"), version: "v1" },
    });
    const warn = vi.fn();
    let t = 0;
    const s = creerSymbolicateur({ log: { warn }, maintenant: () => t });
    const lot = [
      { app_id: "a", release: "1.0", stack: stackPour("casse.js") },
      { app_id: "a", release: "1.0", stack: stackPour("main.js") },
    ];
    const [casse, saine] = await s.symboliquerLot(base.db, lot);
    expect(casse).toMatchObject({ status: "failed", raison: "JSON illisible" });
    expect(saine?.status).toBe("resolved");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][1]).toMatchObject({ app_id: "a", release: "1.0", filename: "casse.js", raison: "JSON illisible" });

    // Même version dans le TTL : ni sonde, ni relecture, ni nouveau journal.
    const avant = base.requetes.length;
    expect((await s.symboliquerLot(base.db, lot)).map((r) => r?.status)).toEqual(["failed", "resolved"]);
    expect(base.requetes.length).toBe(avant);
    // Après le TTL, la sonde revient ; la version n'a pas changé : pas de relecture.
    t += LIMITES_SYMBOLICATION.ttlMs;
    await s.symboliquerLot(base.db, lot);
    expect(lectures(base)).toBe(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("une map trop lourde à indexer est refusée avant tout décodage", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("a.ts", "f"), version: "v1" } });
    const s = creerSymbolicateur({ limites: { octetsParMap: 16 } });
    const [r] = await s.symboliquerLot(base.db, [{ app_id: "a", release: "1.0", stack: stackPour("main.js") }]);
    expect(r).toMatchObject({ status: "failed" });
    expect(r!.raison).toMatch(/trop lourde à indexer/);
    expect(s.etat().entrees).toBe(0);
  });

  it("une panne de lecture n'annule rien : pending pour tout le lot", async () => {
    const base = baseFactice();
    base.tomber();
    const warn = vi.fn();
    const s = creerSymbolicateur({ log: { warn } });
    const r = await s.symboliquerLot(base.db, [
      { app_id: "a", release: "1", stack: stackPour("main.js") },
      { app_id: "a", release: "1", stack: stackPour("vendor.js") },
    ]);
    expect(r.map((x) => x?.status)).toEqual(["pending", "pending"]);
    expect(warn).toHaveBeenCalledWith("symbolication: lecture des source maps impossible", expect.anything());
  });
});

describe("creerSymbolicateur — bornes", () => {
  it("cache LRU : au plus N consommateurs et M octets retenus", async () => {
    const maps: Record<string, Ligne> = {};
    for (const n of [1, 2, 3, 4]) maps[`a|1.0|b${n}.js`] = { content: mapPour(`f${n}.ts`, "f"), version: "v" };
    const base = baseFactice(maps);
    const s = creerSymbolicateur({ limites: { entrees: 2 } });
    for (const n of [1, 2, 3, 4]) {
      const [r] = await s.symboliquerLot(base.db, [{ app_id: "a", release: "1.0", stack: stackPour(`b${n}.js`) }]);
      expect(r?.status).toBe("resolved");
    }
    expect(s.etat().entrees).toBe(2);

    const serre = creerSymbolicateur({ limites: { octetsCache: 1 } });
    await serre.symboliquerLot(base.db, [{ app_id: "a", release: "1.0", stack: stackPour("b1.js", "b2.js") }]);
    expect(serre.etat()).toMatchObject({ entrees: 0, octets: 0 });
  });

  it("budget d'octets par lot : la première map passe toujours, la suivante attend (pending)", async () => {
    const base = baseFactice({
      "a|1.0|b1.js": { content: mapPour("f1.ts", "f"), version: "v", size_bytes: 600 },
      "a|1.0|b2.js": { content: mapPour("f2.ts", "f"), version: "v", size_bytes: 600 },
    });
    const s = creerSymbolicateur({ limites: { octetsLusParLot: 1000 } });
    const lot = [
      { app_id: "a", release: "1.0", stack: stackPour("b1.js") },
      { app_id: "a", release: "1.0", stack: stackPour("b2.js") },
    ];
    const [premiere, seconde] = await s.symboliquerLot(base.db, lot);
    expect(premiere?.status).toBe("resolved");
    expect(seconde).toMatchObject({ status: "pending", raison: "budget de symbolication du lot épuisé" });
    // Lot suivant : la première est en cache, la seconde passe à son tour.
    expect((await s.symboliquerLot(base.db, lot)).map((r) => r?.status)).toEqual(["resolved", "resolved"]);
  });

  it("budgets de frames et de durée : les erreurs au-delà restent pending", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("a.ts", "f"), version: "v" } });
    const erreur = { app_id: "a", release: "1.0", stack: stackPour("main.js", "main.js") };
    const frames = creerSymbolicateur({ limites: { framesParLot: 2 } });
    expect((await frames.symboliquerLot(base.db, [erreur, erreur])).map((r) => r?.status)).toEqual(["resolved", "pending"]);

    let t = 0;
    const lente = creerSymbolicateur({ limites: { msParLot: 10 }, maintenant: () => (t += 20) });
    expect((await lente.symboliquerLot(base.db, [erreur])).map((r) => r?.status)).toEqual(["pending"]);
  });

  it("absence mémorisée pendant le TTL, puis revérifiée : une map mise en ligne ensuite est prise", async () => {
    const base = baseFactice();
    let t = 0;
    const s = creerSymbolicateur({ maintenant: () => t });
    const lot = [{ app_id: "a", release: "1.0", stack: stackPour("main.js") }];
    expect((await s.symboliquerLot(base.db, lot))[0]?.status).toBe("unavailable");
    base.maps["a|1.0|main.js"] = { content: mapPour("a.ts", "f"), version: "v1" };
    expect((await s.symboliquerLot(base.db, lot))[0]?.status).toBe("unavailable");
    expect(sondes(base)).toBe(1);
    t += LIMITES_SYMBOLICATION.ttlMs;
    expect((await s.symboliquerLot(base.db, lot))[0]?.status).toBe("resolved");
  });

  it("une map remplacée (nouvelle version) est relue au TTL suivant", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("ancien.ts", "f"), version: "v1" } });
    let t = 0;
    const s = creerSymbolicateur({ maintenant: () => t });
    const lot = [{ app_id: "a", release: "1.0", stack: stackPour("main.js") }];
    expect((await s.symboliquerLot(base.db, lot))[0]?.stack).toContain("src/ancien.ts");
    base.maps["a|1.0|main.js"] = { content: mapPour("nouveau.ts", "f"), version: "v2" };
    t += LIMITES_SYMBOLICATION.ttlMs;
    expect((await s.symboliquerLot(base.db, lot))[0]?.stack).toContain("src/nouveau.ts");
    expect(lectures(base)).toBe(2);
  });

  it("la stack écrite est bornée à une frontière de ligne", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("un-chemin-assez-long.ts", "f"), version: "v" } });
    const s = creerSymbolicateur({ limites: { longueurStack: 120 } });
    const [r] = await s.symboliquerLot(base.db, [{ app_id: "a", release: "1.0", stack: stackPour("main.js", "main.js", "main.js") }]);
    expect(r!.stack!.length).toBeLessThanOrEqual(120);
    expect(r!.stack!.endsWith(")")).toBe(true);
  });

  it("les maps d'une app ne servent jamais une autre app", async () => {
    const base = baseFactice({ "a|1.0|main.js": { content: mapPour("a.ts", "f"), version: "v" } });
    const s = creerSymbolicateur();
    const [a, b] = await s.symboliquerLot(base.db, [
      { app_id: "a", release: "1.0", stack: stackPour("main.js") },
      { app_id: "b", release: "1.0", stack: stackPour("main.js") },
    ]);
    expect(a?.status).toBe("resolved");
    expect(b?.status).toBe("unavailable");
  });
});

describe("writeRows — symbolication avant la transaction, seulement après v71", () => {
  function pool(colonnesErreur: string[]) {
    const appels: string[] = [];
    const query = async (sql: string, params: unknown[] = []) => {
      appels.push(sql);
      if (sql.includes("information_schema.columns")) {
        return { rows: params[0] === "rum_error" ? colonnesErreur.map((column_name) => ({ column_name })) : [] };
      }
      return { rows: [] };
    };
    return { appels, pool: { connect: async () => ({ query, release() {} }) } };
  }
  const lot = (errors: unknown[]) => ({
    sessions: [], pageviews: [], metrics: [], errors, resources: [], longtasks: [], breadcrumbs: [],
    events: [], spans: [], sviCalls: [], sviSteps: [], sviLegs: [],
  });
  const erreur = { span_id: "00000000000000a1", app_id: "a", release: "1.0", stack: stackPour("main.js"), ts: new Date() };

  it("sur v71 : symboliquée avant `begin`, statut et stack écrits", async () => {
    _resetColonnesCache();
    const { appels, pool: p } = pool(["symbolication_status", "stack_symbolicated"]);
    const symbolicateur = {
      symboliquerLot: vi.fn(async () => [{ status: "resolved", stack: "    at f (src/a.ts:10:5)", raison: null, positions: [] }]),
      etat: () => ({ entrees: 0, octets: 0, negatifs: 0 }),
    };
    await writeRows(p, lot([erreur]), { symbolicateur });
    expect(symbolicateur.symboliquerLot).toHaveBeenCalledTimes(1);
    const insert = appels.find((sql) => sql.startsWith("insert into rum_error"))!;
    expect(insert).toContain("symbolication_status,stack_symbolicated");
    expect(appels.indexOf("begin")).toBeGreaterThan(appels.findIndex((sql) => sql.includes("information_schema")));
  });

  it("avant v71 : aucun appel, aucune colonne nouvelle", async () => {
    _resetColonnesCache();
    const { appels, pool: p } = pool(["occurrences"]);
    const symbolicateur = { symboliquerLot: vi.fn(), etat: () => ({ entrees: 0, octets: 0, negatifs: 0 }) };
    await writeRows(p, lot([erreur]), { symbolicateur });
    expect(symbolicateur.symboliquerLot).not.toHaveBeenCalled();
    expect(appels.find((sql) => sql.startsWith("insert into rum_error"))).not.toContain("symbolication_status");
  });
});
