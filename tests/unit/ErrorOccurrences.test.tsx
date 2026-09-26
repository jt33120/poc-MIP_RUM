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
    expect(html.match(/<tr class="border-t/g)).toHaveLength(20);
    expect(html).toContain("Afficher les 5 suivantes");
    expect(html).toContain("Occurrences (25)");
  });

  it("messages identiques : pas de colonne « Message » ; différents : la colonne revient", () => {
    expect(rendu([occurrence(1), occurrence(2)])).not.toContain(">Message<");
    expect(rendu([occurrence(1), occurrence(2, { message: "autre" })])).toContain(">Message<");
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
