// RecitSession (P*.9) : chaque phrase est un lien vers son ancre, la mention fixe
// est toujours là, et une session sans rejeu le dit.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecitSession } from "@/components/sessions/RecitSession";
import { MENTION_RECIT } from "@/lib/recit-session";

const PHRASES = [
  { texte: "2 vues : / → /paiement.", ancre: "evt-0" },
  {
    texte: "3 occurrences de TypeError sur /paiement, 3 s après le clic “Payer”.",
    ancre: "evt-5",
    action: { texte: "le clic “Payer”", ancre: "evt-4" },
  },
];

describe("RecitSession", () => {
  it("chaque phrase est un lien vers la ligne qui la fonde, l'action aussi", () => {
    const html = renderToStaticMarkup(<RecitSession phrases={PHRASES} rejeu="present" />);
    expect(html).toContain('href="#evt-0"');
    expect(html).toContain('href="#evt-5"');
    expect(html).toContain('href="#evt-4"');
    expect(html).toContain("3 occurrences de TypeError");
    expect(html).toContain(MENTION_RECIT.replace(/'/g, "&#x27;"));
    expect(html).not.toContain('data-testid="recit-rejeu"');
  });

  it("onglet Replay : les liens mènent à la chronologie", () => {
    const html = renderToStaticMarkup(
      <RecitSession phrases={PHRASES} rejeu="present" lienBase="/sessions/s1?app=a" />,
    );
    expect(html).toContain('href="/sessions/s1?app=a#evt-0"');
  });

  it("session sans rejeu → mention", () => {
    const html = renderToStaticMarkup(<RecitSession phrases={PHRASES} rejeu="absent" />);
    expect(html).toContain("Aucun rejeu enregistré pour cette session");
  });

  it("aucun événement → état vide, pas de liste", () => {
    const html = renderToStaticMarkup(<RecitSession phrases={[]} rejeu="absent" />);
    expect(html).toContain("Aucun événement pour cette session");
    expect(html).not.toContain('data-testid="recit-phrases"');
  });
});
