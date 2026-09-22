// ModeleCarte (F35, W-D1, plan § 4.3) : du texte et un bouton — aucun chiffre ; sans
// droit de créer, aucun bouton « Cloner » n'est rendu et la raison est écrite (V9).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// L'action serveur tire la base : une fonction inerte suffit au rendu.
vi.mock("@/app/dashboards/actions", () => ({ cloneTemplateAction: async () => {} }));

import { ModeleCarte } from "@/components/dashboards/ModeleCarte";
import { MODELES_TABLEAUX, apercuDuModele } from "@/lib/dashboard-templates";

const PERF = MODELES_TABLEAUX[0];
const rendu = (props: Partial<Parameters<typeof ModeleCarte>[0]> = {}) =>
  renderToStaticMarkup(
    <ModeleCarte
      cle={PERF.cle}
      titre={PERF.titre}
      question={PERF.question}
      sections={apercuDuModele(PERF)}
      cloner={{ apps: [{ id: "app-a", libelle: "Mini-site A" }, { id: "app-b", libelle: "Boutique" }] }}
      {...props}
    />,
  );

describe("ModeleCarte", () => {
  it("titre, question, sections par question et nombre de cartes ; aucun chiffre mesuré", () => {
    const html = rendu();
    expect(html).toContain("Performance");
    expect(html).toContain("Les vitals tiennent-ils les seuils ?");
    expect(html).toContain("LCP p75 · INP p75 · CLS p75");
    expect(html).toContain("7 cartes");
    expect(html).not.toMatch(/\d+(,\d+)?\s?(ms|s|%)\b/);
  });

  it("cloner : le modèle et l'app partent avec le formulaire ; l'app de l'écran est présélectionnée", () => {
    const html = rendu({ appParDefaut: "app-b", ctx: "period=7d" });
    expect(html).toContain('name="modele" value="performance"');
    expect(html).toContain('name="ctx" value="period=7d"');
    expect(html).toMatch(/<option value="app-b" selected="">Boutique<\/option>/);
    expect(html).toContain('aria-label="Cloner le modèle Performance"');
  });

  it("sans droit de créer : pas de bouton, la raison à la place", () => {
    const html = rendu({ cloner: null, raisonSansClonage: "Session de démonstration : lecture seule." });
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(html).toContain("Session de démonstration : lecture seule.");
  });

  it("une limite du modèle est écrite avec son lien (Releases)", () => {
    const releases = MODELES_TABLEAUX[3];
    const html = renderToStaticMarkup(
      <ModeleCarte
        cle={releases.cle}
        titre={releases.titre}
        question={releases.question}
        sections={apercuDuModele(releases)}
        cloner={null}
        limite={releases.limite}
      />,
    );
    expect(html).toContain("aucune mesure de ratio");
    expect(html).toContain('href="/?cmp=release"');
  });
});
