// SHA-256 en JS pur du parseur partagé : il fonde l'identité des exceptions
// dérivées (P5.3), donc il doit égaler `node:crypto` octet pour octet.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
// @ts-expect-error module JS partagé sans déclarations
import { sha256Hex } from "../../packages/backend/shared/sha256.mjs";

const reference = (texte: string) => createHash("sha256").update(texte, "utf8").digest("hex");

describe("sha256Hex", () => {
  it("rend les vecteurs de la norme", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("égale node:crypto autour des frontières de bloc et en UTF-8 multi-octets", () => {
    for (const longueur of [1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 1_000, 70_000]) {
      const texte = "x".repeat(longueur);
      expect(sha256Hex(texte), String(longueur)).toBe(reference(texte));
    }
    for (const texte of ["é", "€", "😀", "日本語", "ligne\nNUL\u0000fin", JSON.stringify(["mip.exception.v1", "app", 3])]) {
      expect(sha256Hex(texte), texte).toBe(reference(texte));
    }
  });
});
