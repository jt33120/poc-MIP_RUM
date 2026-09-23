// F47 — rendu SSR de l'îlot `ReplaySynchro`, du lecteur `ReplayPlayer` et des liens
// d'instant du déroulé (plan § 4.3, § 5.12.3, § 5.12.4).
//
// CE QUE CE TEST PROUVE (le rendu SERVEUR, celui qu'on reçoit avant tout script) :
//   - le lecteur n'est jamais monté au rendu serveur : rien de rrweb ne se charge
//     avant que l'îlot ait décidé ; sans geste, un bouton « Lancer le rejeu » est prêt
//     pour les petits écrans ; un lien « Replay » suivi (`tab=replay`, `at`) n'en a
//     pas besoin ;
//   - l'en-tête de couverture est écrit dans TOUS les états ;
//   - sans JavaScript, chaque ligne du déroulé est un lien `?at=` qui place le
//     lecteur, et porte `data-ligne` (la ligne que la tête désignera).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { ReplaySynchro } from "@/components/replay/ReplaySynchro";
import { Deroule } from "@/components/sessions/Deroule";
import type { TimelineItem } from "@/lib/queries";
import { TEXTE_COUVERTURE } from "@/lib/replay-synchro";

const T0 = Date.parse("2026-09-22T10:00:00Z");

function item(kind: TimelineItem["kind"], s: number, extra: Partial<TimelineItem> = {}): TimelineItem {
  return {
    kind,
    ts: new Date(T0 + s * 1000),
    title: null,
    detail: null,
    value: null,
    rating: null,
    action_id: null,
    action_name: null,
    ...extra,
  };
}

/** Le texte tel qu'il s'écrit dans le HTML (apostrophes échappées par React). */
const echappe = (s: string) => s.replace(/'/g, "&#x27;");

describe("ReplaySynchro — au rendu serveur", () => {
  it("sans geste : aucun lecteur monté, la couverture écrite, « Lancer le rejeu » prêt sous 640 px", () => {
    const html = renderToStaticMarkup(<ReplaySynchro sessionId="s1" atMs={null} items={[]} marqueurs={[]} />);
    expect(html).toContain('data-testid="replay-attente"');
    // L'îlot n'a pas encore décidé : c'est l'hydratation qui choisit monter ou attendre.
    expect(html).toContain('data-attente="decision"');
    expect(html).not.toContain('data-testid="replay-player"');
    expect(html).toContain(echappe(TEXTE_COUVERTURE));
    expect(html).toContain("Lancer le rejeu");
    expect(html).toMatch(/class="sm:hidden"><button[^>]*>Lancer le rejeu/);
  });

  it("un lien « Replay » suivi (tab=replay ou at) est le geste : pas de bouton à demander", () => {
    for (const html of [
      renderToStaticMarkup(<ReplaySynchro sessionId="s1" atMs={null} items={[]} marqueurs={[]} demande />),
      renderToStaticMarkup(<ReplaySynchro sessionId="s1" atMs={T0} items={[]} marqueurs={[]} />),
    ]) {
      expect(html).not.toContain("Lancer le rejeu");
      expect(html).toContain("Chargement du replay");
    }
  });
});

describe("ReplayPlayer — au rendu serveur", () => {
  it("en chargement, l'en-tête de couverture est déjà là ; aucune position annoncée", () => {
    const html = renderToStaticMarkup(<ReplayPlayer sessionId="s1" atMs={null} marqueurs={[]} />);
    expect(html).toContain('data-testid="replay-player"');
    expect(html).toContain('data-state="loading"');
    expect(html).toContain(echappe(TEXTE_COUVERTURE));
    expect(html).toContain('data-offset-state="none"');
    expect(html).not.toContain("Réessayer");
  });
});

describe("Deroule — liens d'instant du rejeu", () => {
  const ITEMS = [
    item("pageview", 0, { title: "/panier", detail: "navigate" }),
    item("vital", 1, { title: "LCP", detail: "/panier", value: 2100 }),
    item("error", 12, { title: "TypeError", value: 1 }),
  ];
  const instants = {
    0: `/sessions/s1?at=${T0}#evt-0`,
    2: `/sessions/s1?at=${T0 + 12_000}#evt-2`,
  };

  it("avec un rejeu : le décalage de la vue et de chaque ligne est un lien `?at=`, et la ligne porte `data-ligne`", () => {
    const html = renderToStaticMarkup(<Deroule items={ITEMS} t0={T0} voir={null} liens={{}} tronque={false} instants={instants} />);
    expect(html.match(/data-instant=""/g)).toHaveLength(2);
    expect(html).toContain(`href="/sessions/s1?at=${T0 + 12_000}#evt-2"`);
    expect(html).toContain("placer le rejeu à cet instant");
    expect(html).toContain('data-ligne="evt-0"');
    expect(html).toContain('data-ligne="evt-2"');
    // La mesure n'est pas une ligne que la tête désigne.
    expect(html).not.toContain('data-ligne="evt-1"');
  });

  it("sans rejeu : aucun lien d'instant, le décalage reste un texte", () => {
    const html = renderToStaticMarkup(<Deroule items={ITEMS} t0={T0} voir={null} liens={{}} tronque={false} />);
    expect(html).not.toContain("data-instant");
    expect(html).not.toContain("placer le rejeu");
  });
});
