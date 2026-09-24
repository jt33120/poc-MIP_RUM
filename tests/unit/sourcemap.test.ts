// P0 #3 puis P5.4 — moteur de symbolication source map. On teste contre une
// source map construite avec un encodeur VLQ INDÉPENDANT (écrit ici), pour prouver
// le round-trip décodage + résolution de position, puis la réécriture de stack
// minifiée → stack source.
//
// Depuis P5.4 le moteur vit dans `packages/backend/shared/sourcemap.mjs`,
// partagé par l'ingestion, l'upload, le CLI et la console. Les premiers blocs
// passent par la réexportation console (importateurs historiques) ; les suivants
// prouvent ce que P5.4 ajoute : validation stricte, index à points de reprise,
// empreinte mémoire calculée avant décodage, chemins virtuels, garde ReDoS.
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createConsumer,
  parseStackLine,
  type RawSourceMap,
  symbolicateStack,
} from "../../apps/console/lib/sourcemap";
import {
  CHECKPOINT_EVERY,
  codeContext,
  consumerFootprint,
  hasControlCharacters,
  MAX_FRAME_LINE_LENGTH,
  SourceMapError,
  symbolicateStackWith,
  validateSourceMap,
  virtualSourcePath,
} from "../../packages/backend/shared/sourcemap.mjs";

// --- encodeur VLQ de test (implémentation distincte du décodeur du module) -----
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function encodeVlq(n: number): string {
  let vlq = n < 0 ? ((-n) << 1) | 1 : n << 1;
  let out = "";
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += B64[digit];
  } while (vlq > 0);
  return out;
}
const seg = (...fields: number[]) => fields.map(encodeVlq).join("");

// Source map : 1 ligne générée, 2 segments.
//   seg A @genCol 0  -> source0, origLine 5 (→ ligne 6), origCol 2, name0 ("boom")
//   seg B @genCol 20 -> Δsrc 0, Δline 0, Δcol +10 (→ col 12), Δname +1 ("x")
const MAP: RawSourceMap = {
  version: 3,
  sources: ["app.js"],
  names: ["boom", "x"],
  mappings: [seg(0, 0, 5, 2, 0), seg(20, 0, 0, 10, 1)].join(","),
};

describe("createConsumer.originalPositionFor", () => {
  const c = createConsumer(MAP);
  it("résout le 1er segment (colonne 0)", () => {
    expect(c.originalPositionFor(1, 0)).toEqual({ source: "app.js", line: 6, column: 2, name: "boom" });
  });
  it("résout dans le 1er segment (colonne < seuil suivant)", () => {
    expect(c.originalPositionFor(1, 5)).toMatchObject({ source: "app.js", line: 6, name: "boom" });
  });
  it("bascule sur le 2e segment au-delà de son genCol (cumul des deltas)", () => {
    expect(c.originalPositionFor(1, 25)).toEqual({ source: "app.js", line: 6, column: 12, name: "x" });
  });
  it("ligne sans mapping → vide", () => {
    expect(c.originalPositionFor(2, 0).source).toBeNull();
  });
  it("applique sourceRoot", () => {
    const c2 = createConsumer({ ...MAP, sourceRoot: "src/" });
    expect(c2.originalPositionFor(1, 0).source).toBe("src/app.js");
  });
});

describe("parseStackLine", () => {
  it("format Chrome avec fonction", () => {
    expect(parseStackLine("    at n (https://cdn/app.min.js:1:21)")).toEqual({
      fn: "n", file: "https://cdn/app.min.js", line: 1, col: 21,
    });
  });
  it("format Chrome sans fonction", () => {
    expect(parseStackLine("    at https://cdn/app.min.js:1:21")).toMatchObject({
      fn: null, file: "https://cdn/app.min.js", line: 1, col: 21,
    });
  });
  it("format Firefox (fn@url)", () => {
    expect(parseStackLine("n@https://cdn/app.min.js:1:21")).toMatchObject({
      fn: "n", file: "https://cdn/app.min.js", line: 1, col: 21,
    });
  });
  it("ligne non-frame → null", () => {
    expect(parseStackLine("Error: boom")).toBeNull();
  });
});

describe("symbolicateStack", () => {
  const stack = [
    "Error: x",
    "    at n (https://cdn/app.min.js:1:21)", // col 21 (1-based) → genCol 20 → seg B
    "    at m (https://cdn/app.min.js:1:1)", // col 1 → genCol 0 → seg A
    "    at native code", // non résolu, conservé
  ].join("\n");

  it("réécrit les frames résolus, conserve le reste", () => {
    const { stack: out, resolved } = symbolicateStack(stack, { "app.min.js": MAP });
    expect(resolved).toBe(2);
    expect(out).toContain("at x (app.js:6:13)"); // origCol 12 → présenté 13
    expect(out).toContain("at boom (app.js:6:3)"); // origCol 2 → présenté 3
    expect(out).toContain("Error: x");
    expect(out).toContain("at native code");
  });

  it("sans map correspondante → stack inchangée, 0 résolu", () => {
    const { stack: out, resolved } = symbolicateStack(stack, { "autre.js": MAP });
    expect(resolved).toBe(0);
    expect(out).toBe(stack);
  });
});

// ═════════════════════════════════ P5.4 ═══════════════════════════════════════

/** Map dense : `lignes` lignes générées, `parLigne` segments chacune, positions connues. */
function mapDense(lignes: number, parLigne: number) {
  const attendus: Array<{ line: number; col: number; source: number; origLine: number; origCol: number; name: number | null }> = [];
  let src = 0;
  let ol = 0;
  let oc = 0;
  let nm = 0;
  const texte: string[] = [];
  for (let l = 0; l < lignes; l++) {
    let col = 0;
    let precedente = 0;
    const segments: string[] = [];
    for (let s = 0; s < parLigne; s++) {
      col += 3 + ((l + s) % 5);
      const source = (l * 7 + s) % 3;
      const origLine = (l * 13 + s * 3) % 400;
      const origCol = (s * 11) % 90;
      const name = s % 4 === 0 ? null : (l + s) % 6;
      let segment = encodeVlq(col - precedente) + encodeVlq(source - src) + encodeVlq(origLine - ol) + encodeVlq(origCol - oc);
      if (name !== null) {
        segment += encodeVlq(name - nm);
        nm = name;
      }
      precedente = col;
      src = source;
      ol = origLine;
      oc = origCol;
      segments.push(segment);
      attendus.push({ line: l + 1, col, source, origLine, origCol, name });
    }
    texte.push(segments.join(","));
  }
  const map = {
    version: 3,
    sources: ["src/a.ts", "src/b.ts", "src/c.ts"],
    names: ["zero", "un", "deux", "trois", "quatre", "cinq"],
    mappings: texte.join(";"),
  };
  return { map, attendus };
}

describe("P5.4 — index à points de reprise", () => {
  it("résout exactement chaque segment d'une map dense, de part et d'autre des points de reprise", () => {
    const { map, attendus } = mapDense(3, CHECKPOINT_EVERY * 4 + 7);
    const c = createConsumer(map, { strict: true });
    for (const [i, a] of attendus.entries()) {
      const attendu = {
        source: map.sources[a.source],
        line: a.origLine + 1,
        column: a.origCol,
        name: a.name === null ? null : map.names[a.name],
      };
      expect(c.originalPositionFor(a.line, a.col)).toEqual(attendu);
      // Entre deux segments de la même ligne : toujours le précédent.
      const suivant = attendus[i + 1];
      if (suivant && suivant.line === a.line && suivant.col - a.col > 1) {
        expect(c.originalPositionFor(a.line, suivant.col - 1)).toEqual(attendu);
      }
    }
    expect(c.originalPositionFor(1, 0).source).toBeNull(); // avant le premier segment
    expect(c.originalPositionFor(4, 10).source).toBeNull(); // ligne inexistante
    expect(c.originalPositionFor(0, 10).source).toBeNull();
    expect(c.originalPositionFor(1, -1).source).toBeNull();
  });

  it("annonce sa mémoire AVANT décodage, et une map de lignes vides ne coûte rien", () => {
    const { map } = mapDense(2, 200);
    expect(createConsumer(map).bytes).toBe(consumerFootprint(map));
    const vide = { version: 3, sources: [], names: [], mappings: ";".repeat(2_000_000) };
    // Deux millions de lignes générées, aucun segment : ni tableau par ligne, ni point de reprise.
    expect(consumerFootprint(vide)).toBeLessThan(2_100_000);
    expect(createConsumer(vide).originalPositionFor(1_999_999, 0).source).toBeNull();
  });

  it("reste tolérante aux maps anciennes : index de source hors bornes → position vide, pas d'exception", () => {
    const ancienne = { version: 3, sources: ["a.js"], names: [], mappings: seg(0, 4, 1, 1) };
    expect(() => createConsumer(ancienne, { strict: true })).toThrow(SourceMapError);
    expect(createConsumer(ancienne).originalPositionFor(1, 0).source).toBeNull();
  });
});

describe("P5.4 — validateSourceMap refuse explicitement", () => {
  const valide = { version: 3, sources: ["src/app.ts"], names: ["f"], mappings: seg(0, 0, 0, 0, 0) };
  const refus: Array<[string, unknown, RegExp]> = [
    ["une map indexée (sections)", { version: 3, sections: [] }, /indexée/],
    ["une autre version", { ...valide, version: 2 }, /version 3/],
    ["un contenu qui n'est pas un objet", "https://cdn/app.js.map", /objet JSON/],
    ["mappings absent", { ...valide, mappings: undefined }, /mappings/],
    ["sources absent", { ...valide, sources: "src/app.ts" }, /sources/],
    ["un nom non textuel", { ...valide, names: [42] }, /names\[0\]/],
    ["un sourceRoot avec caractère de contrôle", { ...valide, sourceRoot: `src${String.fromCharCode(1)}` }, /sourceRoot/],
    ["sourcesContent plus long que sources", { ...valide, sourcesContent: ["a", "b"] }, /sourcesContent/],
    ["un caractère hors base64", { ...valide, mappings: "AA!A" }, /caractère invalide/],
    ["un VLQ tronqué", { ...valide, mappings: "g" }, /tronquée/],
    ["un segment à deux champs", { ...valide, mappings: "AA" }, /2 champ/],
    ["un index de source hors bornes", { ...valide, mappings: seg(0, 1, 0, 0) }, /source 1 hors bornes/],
    ["un index de nom hors bornes", { ...valide, mappings: seg(0, 0, 0, 0, 3) }, /nom 3 hors bornes/],
    ["des segments non ordonnés", { ...valide, mappings: [seg(10, 0, 0, 0), seg(-5, 0, 0, 0)].join(",") }, /non ordonnés/],
    ["une valeur négative cumulée", { ...valide, mappings: seg(0, 0, -1, 0) }, /hors bornes/],
    ["une valeur au-delà d'Int32", { ...valide, mappings: "gggggggB" }, /hors bornes/],
  ];
  it.each(refus)("%s", (_, map, message) => {
    expect(() => validateSourceMap(map)).toThrow(message);
  });

  it("accepte une map v3 cohérente et compte ses segments sans les retenir", () => {
    expect(validateSourceMap(valide)).toEqual({ sources: 1, names: 1, segments: 1 });
  });
});

describe("P5.4 — chemins virtuels : des étiquettes, jamais un chemin lisible", () => {
  it.each([
    ["src/", "app.js", "src/app.js"],
    [undefined, "webpack:///./src/app.ts", "src/app.ts"],
    [undefined, "webpack://mon-app/./src/app.ts", "mon-app/src/app.ts"],
    ["https://cdn.exemple.fr/", "../../etc/passwd", "etc/passwd"],
    ["https://cdn.exemple.fr/assets/", "../src/app.ts", "cdn.exemple.fr/src/app.ts"],
    [undefined, "../../../etc/passwd", "etc/passwd"],
    ["src", "/abs/app.ts", "abs/app.ts"],
    [undefined, "file:///C:/projet/src/app.ts", "projet/src/app.ts"],
    [undefined, "https://cdn.exemple.fr/src/app.ts?v=3#L2", "cdn.exemple.fr/src/app.ts"],
    [undefined, "src\\win\\app.ts", "src/win/app.ts"],
  ])("sourceRoot %s + %s → %s", (root, source, attendu) => {
    expect(virtualSourcePath(root, source)).toBe(attendu);
  });

  it("retire les caractères de contrôle et rend null quand rien ne reste", () => {
    expect(virtualSourcePath(null, `src/a${String.fromCharCode(0)}b.ts`)).toBe("src/ab.ts");
    expect(virtualSourcePath(null, "../..")).toBeNull();
    expect(virtualSourcePath(null, null)).toBeNull();
    expect(hasControlCharacters(`a${String.fromCharCode(31)}`)).toBe(true);
    expect(hasControlCharacters("main.4f2a.js")).toBe(false);
  });
});

describe("P5.4 — stack hostile et frames bornées", () => {
  it("une ligne de plus de MAX_FRAME_LINE_LENGTH caractères n'est pas analysée, ni coûteuse", () => {
    const longue = `    at ${"a (".repeat(MAX_FRAME_LINE_LENGTH)}x.js:1:1)`;
    const debut = performance.now();
    expect(parseStackLine(longue)).toBeNull();
    const limite = `    at ${"a (".repeat(300)}`.padEnd(MAX_FRAME_LINE_LENGTH, "b");
    expect(parseStackLine(limite)).toBeNull();
    expect(performance.now() - debut).toBeLessThan(500);
  });

  it("symbolicateStackWith borne les frames et situe chaque frame résolue", () => {
    const stack = ["Error: x", ...Array.from({ length: 5 }, () => "    at n (https://cdn/app.min.js:1:21)")].join("\n");
    const c = createConsumer(MAP);
    const r = symbolicateStackWith(stack, (f: string) => (f.endsWith("app.min.js") ? c : null), { maxFrames: 2 });
    expect(r.frames).toBe(2);
    expect(r.resolved).toBe(2);
    expect(r.positions).toEqual([
      { index: 1, bundle: "app.min.js", source: "app.js", line: 6, column: 12, name: "x" },
      { index: 2, bundle: "app.min.js", source: "app.js", line: 6, column: 12, name: "x" },
    ]);
    // Ligne pour ligne : les frames au-delà de la borne restent brutes.
    expect(r.stack.split("\n")[3]).toBe("    at n (https://cdn/app.min.js:1:21)");
  });
});

describe("P5.4 — analyseur de frames linéaire, même résultat que les expressions historiques", () => {
  // L'oracle : les deux expressions d'avant P5.4, exactes mais quadratiques.
  const CHROME = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;
  const FIREFOX = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;
  const oracle = (ligne: string) => {
    const m = CHROME.exec(ligne) || FIREFOX.exec(ligne);
    return m ? { fn: m[1] || null, file: m[2], line: Number(m[3]), col: Number(m[4]) } : null;
  };

  it("donne le résultat de l'oracle sur 60 000 lignes aléatoires, pièges compris", () => {
    const pieces = ["a", "t", "at", " ", "(", ")", ":", "1", "2", "@", "\r", "x", ".js", "\t", "\u2028", "at "];
    const fins = ["", ":1:2", ":12:3)", " :1:2", ":1:2 ", "(x.js:1:2)", "@x.js:3:4"];
    let graine = 54;
    const hasard = (n: number) => {
      graine = (graine * 1103515245 + 12345) & 0x7fffffff;
      return graine % n;
    };
    const ecarts: string[] = [];
    for (let i = 0; i < 60_000; i++) {
      let ligne = "";
      for (let j = hasard(14); j > 0; j--) ligne += pieces[hasard(pieces.length)];
      ligne += fins[hasard(fins.length)];
      if (JSON.stringify(parseStackLine(ligne)) !== JSON.stringify(oracle(ligne))) ecarts.push(JSON.stringify(ligne));
    }
    expect(ecarts.slice(0, 5)).toEqual([]);
  });

  it("reste linéaire sur des lignes hostiles qui font exploser les expressions", () => {
    const hostiles = [
      `at${" ".repeat(340)}${" (".repeat(170)}${"1:".repeat(170)}`,
      `at ${"a (".repeat(340)}`,
      `${"@".repeat(1000)}:1:`,
      `at ${" \r(".repeat(250)}`,
    ].map((h) => h.slice(0, MAX_FRAME_LINE_LENGTH));
    const debut = performance.now();
    for (let i = 0; i < 50; i++) for (const h of hostiles) parseStackLine(h);
    expect(performance.now() - debut).toBeLessThan(200);
  });
});

describe("P5.4 — séparateurs et noms : coût et contenu bornés", () => {
  it("un segment vide est une erreur de structure, à l'upload comme à la lecture ; une ligne vide ne l'est pas", () => {
    for (const mappings of ["AAAA,,CAAA", ",AAAA", "AAAA,", "AAAA,;AAAA", ";,AAAA"]) {
      const map = { version: 3, sources: ["a.ts"], names: [], mappings };
      expect(() => validateSourceMap(map), mappings).toThrow(/segment vide/);
      expect(() => createConsumer(map), mappings).toThrow(/segment vide/);
    }
    expect(validateSourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA;;;AAAA" }).segments).toBe(2);
  });

  it("une recherche ne parcourt jamais les lignes suivantes, même séparées par des millions de `;`", () => {
    const c = createConsumer({ version: 3, sources: ["a.ts"], names: [], mappings: `AAAA${";".repeat(4 * 1024 * 1024)}CAAA` });
    const debut = performance.now();
    for (let i = 0; i < 2_000; i++) c.originalPositionFor(1, 5);
    expect(performance.now() - debut).toBeLessThan(200);
    expect(c.originalPositionFor(1, 5)).toEqual({ source: "a.ts", line: 1, column: 0, name: null });
    expect(c.originalPositionFor(4 * 1024 * 1024 + 1, 1)).toEqual({ source: "a.ts", line: 1, column: 0, name: null });
  });

  it("un nom de map ancienne perd ses caractères de contrôle et reste borné", () => {
    const nom = createConsumer({ version: 3, sources: ["a.ts"], names: [`f${String.fromCharCode(0)}x${"y".repeat(400)}`], mappings: "AAAAA" })
      .originalPositionFor(1, 0).name;
    expect(nom?.startsWith("fxy")).toBe(true);
    expect(nom).toHaveLength(256);
  });

  it("le consommateur ne retient pas la map d'origine (sourcesContent compris)", () => {
    // Processus dédié : seul `--expose-gc` permet d'observer la libération.
    const moteur = pathToFileURL(join(__dirname, "..", "..", "packages/backend/shared/sourcemap.mjs")).href;
    const script = `
      const { createConsumer } = await import(${JSON.stringify(moteur)});
      let map = { version: 3, sources: ["src/a.ts"], names: ["f"], mappings: "AAAAA", sourcesContent: ["x".repeat(4 * 1024 * 1024)] };
      const ref = new WeakRef(map);
      const consommateur = createConsumer(map);
      map = null;
      for (let i = 0; i < 3; i++) { await new Promise((ok) => setTimeout(ok, 0)); globalThis.gc(); }
      process.stdout.write(JSON.stringify({ libere: ref.deref() === undefined, source: consommateur.originalPositionFor(1, 0).source }));
    `;
    const sortie = execFileSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { encoding: "utf8" });
    expect(JSON.parse(sortie)).toEqual({ libere: true, source: "src/a.ts" });
  });
});

describe("P5.4 — codeContext (admin)", () => {
  const avecSource = {
    ...MAP,
    sourceRoot: "webpack:///./",
    sourcesContent: [Array.from({ length: 12 }, (_, i) => `ligne ${i + 1}`).join("\n")],
  };
  it("rend ±3 lignes autour de la ligne résolue, par chemin virtuel", () => {
    expect(codeContext(avecSource, "app.js", 6)).toEqual({
      source: "app.js",
      line: 6,
      start: 3,
      lines: ["ligne 3", "ligne 4", "ligne 5", "ligne 6", "ligne 7", "ligne 8", "ligne 9"],
    });
    expect(codeContext(avecSource, "app.js", 1)?.lines).toEqual(["ligne 1", "ligne 2", "ligne 3", "ligne 4"]);
  });
  it("rien sans sourcesContent, pour une source inconnue ou une ligne hors du fichier", () => {
    expect(codeContext(MAP, "app.js", 6)).toBeNull();
    expect(codeContext(avecSource, "autre.js", 6)).toBeNull();
    expect(codeContext(avecSource, "app.js", 99)).toBeNull();
  });
});
