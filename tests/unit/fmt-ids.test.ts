// Formats nommés (F03, plan § 4.0) : un identifiant en chaîne, sérialisable, et des
// règles de vérité — l'inconnu ne se chiffre pas, un ratio n'est pas une part.
import { describe, expect, it } from "vitest";
import {
  estVital,
  formatDuVital,
  formater,
  libelleReference,
  referenceSansVs,
  type FormatId,
} from "@/lib/fmt-ids";

/** Espaces insécables (fines ou non) → espace simple : on teste ce qu'on lit. */
const lu = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("formater — exemples du plan (§ 4.0)", () => {
  const cas: [FormatId, number, string][] = [
    ["ms", 820, "820 ms"],
    ["ms", 2700, "2,7 s"],
    ["ms", 3000, "3,0 s"],
    ["s-auto", 372_000, "6 min 12 s"],
    ["cls", 0.0312, "0,031"],
    ["pct", 0.124, "12,4 %"],
    ["count", 1240, "1 240"],
    ["bytes", 18_432, "18 Ko"],
    ["score", 72, "72"],
    ["ratio", 3, "3,00"],
    ["pour100", 150, "150 pour 100"],
    ["pour100", 2.43, "2,4 pour 100"],
  ];
  for (const [id, v, attendu] of cas) {
    it(`${id} : ${v} → « ${attendu} »`, () => {
      expect(lu(formater(id, v))).toBe(attendu);
    });
  }
});

describe("formater — l'inconnu reste inconnu (V3)", () => {
  const ids: FormatId[] = ["ms", "s-auto", "cls", "pct", "count", "bytes", "score", "ratio", "pour100"];
  it("null → « — » pour chaque format, jamais « 0 »", () => {
    for (const id of ids) expect(formater(id, null)).toBe("—");
  });
  it("un nombre non fini (division par zéro) est un inconnu, pas un infini", () => {
    for (const id of ids) {
      expect(formater(id, Number.NaN)).toBe("—");
      expect(formater(id, Number.POSITIVE_INFINITY)).toBe("—");
    }
  });
  it("un vrai zéro reste un zéro", () => {
    expect(formater("count", 0)).toBe("0");
    expect(lu(formater("pct", 0))).toBe("0,0 %");
  });
});

describe("formater — un ratio n'est pas une part", () => {
  it("pour100 ne contient jamais « % »", () => {
    for (const v of [150, 2.43, 0, 12_000]) expect(formater("pour100", v)).not.toContain("%");
  });
  it("ratio : deux décimales, sans « % »", () => {
    expect(formater("ratio", 3)).toBe("3,00");
    expect(formater("ratio", 1.005)).not.toContain("%");
  });
});

describe("formater — bornes des unités", () => {
  it("ms : l'arrondi à 1 000 passe en secondes (jamais « 1000 ms »)", () => {
    expect(lu(formater("ms", 999.6))).toBe("1,0 s");
    expect(lu(formater("ms", 999.4))).toBe("999 ms");
  });
  it("s-auto : secondes, minutes, heures", () => {
    expect(lu(formater("s-auto", 450))).toBe("450 ms");
    expect(lu(formater("s-auto", 4_500))).toBe("4,5 s");
    expect(lu(formater("s-auto", 360_000))).toBe("6 min");
    expect(lu(formater("s-auto", 7_500_000))).toBe("2 h 5 min");
  });
  it("bytes : octets, puis base 1 024", () => {
    expect(lu(formater("bytes", 512))).toBe("512 o");
    expect(lu(formater("bytes", 1536))).toBe("1,5 Ko");
    expect(lu(formater("bytes", 2.5 * 1024 * 1024))).toBe("2,5 Mo");
  });
  it("le nombre et son unité ne se séparent pas en fin de ligne", () => {
    expect(formater("ms", 2700)).toMatch(/2,7\u00a0s/);
    expect(formater("pct", 0.124)).toMatch(/12,4\u00a0%/);
  });
});

describe("vitaux et références", () => {
  it("estVital / formatDuVital", () => {
    expect(estVital("LCP")).toBe(true);
    expect(estVital("DNS")).toBe(false);
    expect(formatDuVital("CLS")).toBe("cls");
    expect(formatDuVital("INP")).toBe("ms");
  });
  it("libelleReference : un seul « vs », avec ou sans celui de l'appelant", () => {
    expect(libelleReference("période précédente")).toBe("vs période précédente");
    expect(libelleReference("vs 24 h précédentes")).toBe("vs 24 h précédentes");
    expect(referenceSansVs("vs 24 h précédentes (…)")).toBe("24 h précédentes (…)");
  });
});
