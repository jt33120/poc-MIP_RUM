// Hero « Stabilité par release » de `/mobile` (F38, W-M6) : une release qui ne
// déclare pas collecter les erreurs JS n'affiche aucun « % » ni aucun zéro ; la
// release inconnue s'appelle « Inconnue » ; la référence porte sur les déclarantes.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StabiliteParRelease, lignesStabilite } from "@/components/mobile/StabiliteParRelease";
import { ERROR_FREE_REASONS } from "@/lib/mobile-capabilities";
import type { MobileParRelease, MobileReleaseRow } from "@/lib/queries-mobile";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const ligne = (over: Partial<MobileReleaseRow>): MobileReleaseRow => ({
  release: "1.4",
  sessions: 3,
  sessions_touchees: 1,
  occurrences: 2,
  etat_js_errors: "active",
  part_touchee: 1 / 3,
  raison_part: null,
  ecart_precedente_pts: null,
  release_precedente: null,
  demarrage_froid_p75_ms: 820,
  demarrage_froid_n: 3,
  premiere_session: "2026-09-21T10:00:00.000Z",
  ...over,
});

const LIGNES: MobileReleaseRow[] = [
  ligne({ release: "1.4", release_precedente: "1.2" }),
  ligne({
    release: "1.2",
    sessions: 2,
    sessions_touchees: 0,
    occurrences: 0,
    etat_js_errors: "unknown",
    part_touchee: null,
    raison_part: ERROR_FREE_REASONS.capability_unknown,
    demarrage_froid_p75_ms: null,
    demarrage_froid_n: 0,
    premiere_session: "2026-09-20T10:00:00.000Z",
  }),
  ligne({ release: null, sessions: 1, sessions_touchees: 0, occurrences: 0, part_touchee: 0, premiere_session: "2026-09-19T10:00:00.000Z" }),
];

const RESULTAT: Extract<MobileParRelease, { disponible: true }> = {
  disponible: true,
  lignes: LIGNES,
  releases: 3,
  tronque: false,
  declarantes: { rate: 2 / 3, reason: null, sessions: 3, touchees: 1, exclues: 3, occurrences: 2 },
};

const href = (r: string | null) => (r === null ? "/mobile?seg=v2%3Arelease%3Ais_null" : `/mobile?release=${r}`);

describe("StabiliteParRelease", () => {
  const html = renderToStaticMarkup(
    <StabiliteParRelease
      resultat={RESULTAT}
      tri="fourni"
      triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
      hrefDeRelease={href}
      plage="24 h"
    />,
  );

  it("la ligne 1.2 (aucune déclaration) n'affiche aucun « % », ni « 0 sur 2 », ni occurrence 0", () => {
    const lignes = html.split('data-testid="impact-ligne"');
    const l12 = lignes.find((l) => l.includes("/mobile?release=1.2"))!;
    // Seul le contenu de la ligne compte (jusqu'à la fin de son <li>).
    const contenu = texte(l12.slice(0, l12.indexOf("</li>")));
    expect(contenu).toContain("1.2");
    expect(contenu).not.toContain("%");
    expect(contenu).not.toMatch(/0 sur 2/);
    expect(contenu).not.toMatch(/Occurrences 0\b/);
    // La raison est écrite sous la table.
    expect(texte(html)).toContain(`Part « — » pour 1.2 : ${ERROR_FREE_REASONS.capability_unknown}`);
  });

  it("la release null est « Inconnue », et son lien pose seg=release:is_null", () => {
    expect(texte(html)).toContain("Inconnue");
    expect(html).toContain("seg=v2%3Arelease%3Ais_null");
  });

  it("la 1.4 porte sa part, son intervalle et un lien release=", () => {
    expect(texte(html)).toContain("33,3 %");
    expect(texte(html)).toMatch(/entre .* et .* \(95 %\)/);
    expect(html).toContain('href="/mobile?release=1.4"');
  });

  it("la référence « Releases déclarantes » est une ligne, pas une barre, sur Σ touchées / Σ sessions", () => {
    expect(html).toContain('data-testid="impact-reference"');
    expect(texte(html)).toMatch(/Releases déclarantes 33,3 %/);
  });

  it("ordre fourni écrit ; bascule vers gravité et volume", () => {
    expect(texte(html)).toContain("par première session vue sur la fenêtre, la plus récente en tête");
    expect(html).toContain('href="/mobile?tri=gravite"');
    expect(html).toContain('href="/mobile?tri=volume"');
    expect(texte(html)).toContain("même fenêtre, sans normalisation de trafic : l'écart mêle le code et le contexte");
  });

  it("aucune déclarante : pas de ligne de référence, la raison à la place", () => {
    const sans = renderToStaticMarkup(
      <StabiliteParRelease
        resultat={{ ...RESULTAT, declarantes: { rate: null, reason: "capability_unknown", sessions: 0, touchees: 0, exclues: 6, occurrences: 0 } }}
        tri="fourni"
        triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
        hrefDeRelease={href}
        plage="24 h"
      />,
    );
    expect(sans).toContain('data-testid="impact-reference-absente"');
    expect(texte(sans)).toContain(ERROR_FREE_REASONS.capability_unknown);
  });

  it("aucune session : état vide motivé, pas de table", () => {
    const vide = renderToStaticMarkup(
      <StabiliteParRelease
        resultat={{ ...RESULTAT, lignes: [], releases: 0 }}
        tri="fourni"
        triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
        hrefDeRelease={href}
        plage="24 h"
      />,
    );
    expect(texte(vide)).toContain("Aucune session React Native sur 24 h.");
    expect(vide).not.toContain('data-testid="impact-table"');
  });

  it("tri gravité : part la plus forte en tête, part non calculable en fin", () => {
    const lignes = lignesStabilite(LIGNES, href);
    expect(lignes.map((l) => l.pilote)).toEqual([1 / 3, null, 0]);
    const g = renderToStaticMarkup(
      <StabiliteParRelease
        resultat={RESULTAT}
        tri="gravite"
        triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
        hrefDeRelease={href}
        plage="24 h"
      />,
    );
    const ordre = [...g.matchAll(/href="(\/mobile\?(?:release=[^"]+|seg=[^"]+))"/g)].map((m) => m[1]);
    expect(ordre.indexOf("/mobile?release=1.2")).toBe(ordre.length - 1);
  });
});
