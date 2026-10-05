// « À faire » X10 — la base légale du rejeu, attestée au journal (`lib/attestation-rejeu.ts`).
//
// CE QUE CES TESTS EMPÊCHENT.
//   - Qu'une attestation d'une application soit lue pour une autre dont l'identifiant
//     la prolonge (« boutique » et « boutique-2 »), ou qu'un « % » ou un « _ » dans un
//     identifiant élargisse le motif `like`.
//   - Qu'une ligne ancienne ou abîmée du journal fasse tomber la page « Installer ».
import { describe, expect, it } from "vitest";
import { lireDetailAttestation, motifAttestation } from "@/lib/attestation-rejeu";

/** Le `like` de Postgres, réécrit pour le test (échappement par `\`). */
function like(texte: string, motif: string): boolean {
  const re = motif.replace(/\\(.)|([%_])|([^\\%_]+)/g, (_t, echappe: string, joker: string, litteral: string) =>
    echappe ? echappe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : joker === "%" ? ".*" : joker === "_" ? "." : litteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  return new RegExp(`^${re}$`, "s").test(texte);
}

const detail = (app: string) => JSON.stringify({ app, base: "consentement", taux: "0.1", masquage: "all", note: null });

describe("le motif d'une application", () => {
  it("retrouve ses lignes, et pas celles d'une application au nom voisin", () => {
    expect(like(detail("boutique"), motifAttestation("boutique"))).toBe(true);
    expect(like(detail("boutique-2"), motifAttestation("boutique"))).toBe(false);
    expect(like(detail("boutique"), motifAttestation("boutique-2"))).toBe(false);
  });

  it("un « % » ou un « _ » de l'identifiant reste littéral", () => {
    expect(like(detail("a_b"), motifAttestation("a_b"))).toBe(true);
    expect(like(detail("axb"), motifAttestation("a_b"))).toBe(false);
    expect(like(detail("a-b-c"), motifAttestation("a%"))).toBe(false);
  });
});

describe("le détail relu", () => {
  it("rend la base, le taux, le masquage et la note", () => {
    expect(lireDetailAttestation(detail("x"))).toEqual({ base: "consentement", taux: "0.1", masquage: "all", note: null });
  });

  it("une base inconnue devient null ; un détail illisible ne lève pas", () => {
    expect(lireDetailAttestation(JSON.stringify({ app: "x", base: "inventee" }))?.base).toBeNull();
    expect(lireDetailAttestation("pas du json")).toBeNull();
    expect(lireDetailAttestation(null)).toBeNull();
  });
});
