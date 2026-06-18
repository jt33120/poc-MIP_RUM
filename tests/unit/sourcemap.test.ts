// P0 #3 — moteur de symbolication source map (lib/sourcemap.ts). On teste contre
// une source map construite avec un encodeur VLQ INDÉPENDANT (écrit ici), pour
// prouver le round-trip décodage + résolution de position, puis la réécriture de
// stack minifiée → stack source.
import { describe, expect, it } from "vitest";
import {
  createConsumer,
  parseStackLine,
  type RawSourceMap,
  symbolicateStack,
} from "../../apps/console/lib/sourcemap";

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
