// La table des opérations de console-api, telle que le service la sert : identité
// comprise (C1). La carte technique en affiche le nombre (CHIFFRES.operationsConsoleApi) :
// ce test le recompte depuis la table, et vérifie qu'aucune opération n'est en double.
import { describe, expect, it } from "vitest";
import { chargerTrousseau, creerDebitAuth, creerTable } from "@mip/console-api";
import { CHIFFRES } from "@/lib/cartographie/donnees";
import { ECRANS_FACTICES } from "../fixtures/ecrans-factices";
import { COMMANDES_FACTICES } from "../fixtures/commandes-factices";

describe("la table des opérations de console-api", () => {
  it("compte les opérations qu'affiche la carte technique, sans doublon", async () => {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid: "table" }] }), { production: false });
    const db = { query: async () => ({ rows: [] }) };
    const { table } = await creerTable({
      trousseau,
      version: "table",
      db,
      identite: {
        transacteur: { transaction: (fn) => fn(db) },
        debit: await creerDebitAuth("d".repeat(32)),
        verifierMotDePasse: async () => false,
        hachageFactice: "",
        demo: null,
        oublierSession: () => {},
      },
      ecrans: ECRANS_FACTICES,
      commandes: COMMANDES_FACTICES,
    });
    expect(table.length).toBe(CHIFFRES.operationsConsoleApi);
    const ids = table.map((e) => e.operation.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
