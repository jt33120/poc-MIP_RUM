// C0a — `docs/api/console-api.md` EST la table des opérations, rendue.
//
// Régénérer : MAJ_DOC_CONSOLE_API=1 pnpm vitest run tests/unit/console-api-doc.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { chargerTrousseau, creerDebitAuth, creerTable, rendreDoc } from "@mip/console-api";

const FICHIER = "docs/api/console-api.md";

describe("C0a — la doc de console-api est générée depuis sa table", () => {
  it("le fichier versionné est exactement ce que la table rend", async () => {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid: "doc" }] }), { production: false });
    const db = { query: async () => ({ rows: [] }) };
    // La table COMPLÈTE, telle que le service la sert : identité comprise (C1).
    const { table } = await creerTable({
      trousseau,
      version: "doc",
      db,
      identite: {
        transacteur: { transaction: (fn) => fn(db) },
        debit: await creerDebitAuth("d".repeat(32)),
        verifierMotDePasse: async () => false,
        hachageFactice: "",
        demo: null,
        oublierSession: () => {},
      },
      ecrans: { coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }) },
    });
    const rendu = rendreDoc(table);
    if (process.env.MAJ_DOC_CONSOLE_API === "1") writeFileSync(FICHIER, rendu);
    expect(existsSync(FICHIER), `${FICHIER} absent : MAJ_DOC_CONSOLE_API=1 pour le générer`).toBe(true);
    expect(readFileSync(FICHIER, "utf8"), `${FICHIER} n'est plus à jour : MAJ_DOC_CONSOLE_API=1 pour le régénérer`).toBe(rendu);
  });
});
