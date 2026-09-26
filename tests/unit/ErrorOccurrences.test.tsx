// Occurrences d'un groupe (components/errors/ErrorOccurrences.tsx), rendu SSR réel.
//
// Recette du 26/09/2026 : 55 lignes d'un coup (page de 11 000 px), une colonne
// « Message » qui répétait 55 fois le titre, et une pastille d'action écrasée sur
// cinq lignes, préfixée de « button ». Ce test protège les trois corrections.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorOccurrences } from "@/components/errors/ErrorOccurrences";
import type { ErrorOccurrenceRow } from "@/lib/queries-errors";

function occurrence(id: number, o: Partial<ErrorOccurrenceRow> = {}): ErrorOccurrenceRow {
  return {
    id,
    ts: new Date(Date.UTC(2026, 8, 26, 12, 0, 0) - id * 60_000),
    route: "/partners/:id",
    session_id: `s${id}`,
    kind: "error",
    message: "Uncaught TypeError: boom",
    device_type: "desktop",
    occurrences: 1,
    release: "4.13.0",
    error_source: "browser_js",
    handled: false,
    is_fatal: null,
    view_name: null,
    env: null,
    service: null,
    trace_id: null,
    source_parent_span_id: null,
    links: { session: true, replay: false, trace: false, parent_span: false, action: null },
    ...o,
  };
}

const rendu = (occurrences: ErrorOccurrenceRow[]) =>
  renderToStaticMarkup(
    <ErrorOccurrences appId="demo-app" occurrences={occurrences} caption="Occurrences" firstHref={null} nextHref={null} />,
  );

describe("ErrorOccurrences", () => {
  it("25 occurrences lues : 20 lignes montrées, les 5 suivantes à un clic", () => {
    const html = rendu(Array.from({ length: 25 }, (_, i) => occurrence(i + 1)));
    expect(html.match(/data-testid="occurrence"/g)).toHaveLength(20);
    expect(html).toContain("Afficher les 5 suivantes");
    expect(html).toContain("Occurrences (25)");
  });

  it("messages identiques : pas de colonne « Message » ; différents : la colonne revient", () => {
    expect(rendu([occurrence(1), occurrence(2)])).not.toContain(">Message<");
    expect(rendu([occurrence(1), occurrence(2, { message: "autre" })])).toContain(">Message<");
  });

  // Contre-recette du 26/09/2026 : à 390 px, le tableau de 1 120 px ne montrait que
  // « Quand » et « ×N ». Sous 640 px, chaque occurrence est une carte libellée.
  it("sous 640 px, une carte par occurrence : cellules libellées, en-tête réservé au tableau", () => {
    const html = rendu([occurrence(1, { links: { session: true, replay: true, trace: true, parent_span: false, action: null } })]);
    expect(html).toMatch(/<table class="block w-full[^"]*sm:table/);
    expect(html).toMatch(/<thead class="hidden[^"]*sm:table-header-group/);
    expect(html).toMatch(/<tr[^>]*class="block [^"]*sm:table-row/);
    for (const libelle of ["Release", "Source", "Appareil"]) expect(html).toContain(`sm:hidden">${libelle}</span>`);
    // Plus de largeur minimale de 70rem : elle dépassait la carte à 1 440 px.
    expect(html).not.toContain("min-w-table");
  });

  it("l'action tient sur une ligne, sans préfixe technique, le nom complet en infobulle", () => {
    const html = rendu([
      occurrence(1, {
        links: {
          session: true,
          replay: true,
          trace: false,
          parent_span: false,
          action: { id: "a1", name: 'button "Afficher la fiche SIRET"', type: "click" },
        },
      }),
    ]);
    expect(html).toContain("Action : Afficher la fiche SIRET");
    expect(html).not.toContain("button &quot;");
    expect(html).toMatch(/class="[^"]*truncate[^"]*whitespace-nowrap/);
    expect(html).toContain(">Rejeu<");
  });
});
