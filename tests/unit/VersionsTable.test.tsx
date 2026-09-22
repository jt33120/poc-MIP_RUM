// VersionsTable (P*.1, revue de vague 4) : un écart de part de sessions en erreur
// n'est coloré que s'il est ÉTABLI (Newcombe hors de zéro). Non établi, ou non
// testable (numérateur au-delà des sessions : pas une proportion), il reste écrit
// sans couleur, et le dit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VersionsTable } from "@/components/VersionsTable";
import type { VersionRow } from "@/lib/queries-deploys";

const ligne = (version: string, sessions: number, sessionsEnErreur: number): VersionRow => ({
  version,
  sessions,
  lcp: null,
  inp: null,
  erreurs: sessionsEnErreur,
  sessionsEnErreur,
});
const rendu = (rows: VersionRow[]) =>
  renderToStaticMarkup(<VersionsTable comparaison={{ rows, source: "occurrence" }} periodLabel="24 h" />);
const celluleEcart = (html: string) => /<span[^>]*data-testid="version-ecart-[^"]*"[^>]*>/.exec(html)?.[0] ?? "";

describe("VersionsTable — couleur d'écart seulement si établi (P*.1)", () => {
  it("écart établi (10 % contre 40 %) : coloré", () => {
    const html = rendu([ligne("1.0", 100, 10), ligne("1.1", 100, 40)]);
    expect(html).toContain('data-testid="version-ecart-etabli"');
    expect(celluleEcart(html)).toContain("text-bad-ink");
  });

  it("écart non établi (10 % contre 12 %) : sans couleur, « non établi »", () => {
    const html = rendu([ligne("1.0", 100, 10), ligne("1.1", 100, 12)]);
    expect(celluleEcart(html)).not.toMatch(/text-(good|bad)-ink/);
    expect(html).toContain("non établi");
  });

  it("écart non testable (ecartProportions rend null : 12 sessions en erreur pour 10) : sans couleur", () => {
    const html = rendu([ligne("1.0", 100, 10), ligne("1.1", 10, 12)]);
    expect(html).toContain('data-testid="version-ecart-non-etabli"');
    expect(celluleEcart(html)).not.toMatch(/text-(good|bad)-ink/);
    expect(html).toContain("non testable");
    expect(html).not.toContain('data-testid="version-ecart-etabli"');
  });
});
