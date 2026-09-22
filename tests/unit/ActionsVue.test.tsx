// ActionsVue (F34, W-V3, V9) : une session de démonstration ne voit aucun bouton
// d'écriture ; une vue d'un autre compte non plus ; la suppression se fait en deux
// temps, sans couleur de verdict (CE11).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Les actions serveur tirent la base : des fonctions inertes suffisent au rendu.
vi.mock("@/app/explorer/actions", () => ({ renameViewAction: async () => {}, deleteViewAction: async () => {} }));

import { ActionsVue } from "@/components/explorer/ActionsVue";

const VUE = { id: "0b8f7c1e-3a0c-4f9e-9d57-2b1c6a1f0e11", name: "LCP des pages produit", revision: "3", mine: true };
const rendu = (vue: typeof VUE, demo: boolean) => renderToStaticMarkup(<ActionsVue vue={vue} demo={demo} />);

describe("ActionsVue", () => {
  it("session de démonstration : aucun formulaire, aucun bouton, et la raison écrite", () => {
    const html = rendu(VUE, true);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Renommer");
    expect(html).not.toContain("Supprimer");
    expect(html).toContain("Session de démonstration : lecture seule.");
  });

  it("vue d'un autre compte : lecture seule, dite", () => {
    const html = rendu({ ...VUE, mine: false }, false);
    expect(html).not.toContain("<button");
    expect(html).toContain("une vue n’est modifiable que par son propriétaire");
  });

  it("propriétaire : renommer, puis supprimer en deux temps, sans rouge", () => {
    const html = rendu(VUE, false);
    expect(html).toContain("Renommer");
    expect(html).toMatch(/<details[^>]*data-testid="vue-supprimer"/);
    expect(html).toContain("Supprimer…");
    expect(html).toContain(`aria-label="Confirmer la suppression de ${VUE.name}"`);
    expect(html).not.toMatch(/bg-red-|bg-bad|text-bad/);
    // La révision affichée voyage avec le renommage (concurrence optimiste).
    expect(html).toContain('name="revision" value="3"');
  });
});
