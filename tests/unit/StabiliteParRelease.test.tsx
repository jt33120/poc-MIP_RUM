// Hero « Stabilité par release » de `/mobile` (F38, W-M6) : une release qui ne
// déclare pas collecter les erreurs JS n'affiche aucun « % » ni aucun zéro ; la
// release inconnue s'appelle « Inconnue » ; la référence porte sur les déclarantes.
// Recette du 26/09/2026 : la barre est la part SANS erreur, comme la tuile (plus haut
// = mieux), et la ligne de référence vaut la tuile ; l'écart suit le même sens.
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
  app_id: "app-a",
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
  apps: 1,
  tronque: false,
  declarantes: { rate: 2 / 3, reason: null, sessions: 3, touchees: 1, exclues: 3, occurrences: 2 },
};

const href = (r: string | null, _app: string) => (r === null ? "/mobile?seg=v2%3Arelease%3Ais_null" : `/mobile?release=${r}`);

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

  it("la 1.4 porte sa part SANS erreur (1 touchée sur 3 → 66,7 %), son intervalle et un lien release=", () => {
    expect(texte(html)).toContain("66,7 %");
    expect(texte(html)).toMatch(/entre .* et .* \(95 %\)/);
    expect(html).toContain('href="/mobile?release=1.4"');
  });

  it("la référence est une ligne, pas une barre, et vaut la tuile « Sessions sans erreur JS » (Σ sans erreur / Σ sessions)", () => {
    expect(html).toContain('data-testid="impact-reference"');
    // declarantes.rate = 2/3 : le taux de la tuile, jamais son complément.
    expect(texte(html)).toMatch(/Ensemble des releases qui collectent les erreurs JS 66,7 %/);
  });

  it("l'écart suit le sens de la tuile : plus de sessions touchées = écart négatif", () => {
    const [l] = lignesStabilite([ligne({ release: "1.4", release_precedente: "1.2", ecart_precedente_pts: 5.6 })], href);
    const ecart = l.mesures.find((m) => m.cle === "ecart")!;
    expect(ecart.valeur).toBe(-5.6);
    expect(texte(ecart.affichage)).toBe("−5,6 pt vs 1.2");
  });

  it("« échantillon faible » dit une fois en tête quand toutes les releases le sont, pas sur chaque ligne", () => {
    // Les trois releases ont moins de 30 sessions.
    expect(html).not.toContain('data-faible="1"');
    expect(texte(html)).toContain("Toutes les releases ont moins de 30 sessions : échantillon faible.");
    expect(texte(html).match(/échantillon faible/g)).toHaveLength(1);
  });

  it("ordre fourni écrit ; bascule vers gravité et volume", () => {
    expect(texte(html)).toContain("par première session vue sur la fenêtre, la plus récente en tête");
    expect(html).toContain('href="/mobile?tri=gravite"');
    expect(html).toContain('href="/mobile?tri=volume"');
    expect(texte(html)).toContain("il mêle le code et le contexte");
    expect(texte(html)).toContain("plus haut = plus stable");
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
    // Recette du 30/09/2026 : le vide tient sur UNE ligne (titre et état côte à côte),
    // pas dans une boîte encadrée sous le titre.
    expect(vide).not.toContain("rounded-lg border leading-relaxed");
  });

  it("tri gravité : la release la moins stable en tête, part non calculable en fin", () => {
    const lignes = lignesStabilite(LIGNES, href);
    // 1 − part touchée, en flottants : comparés à 1e-12 près.
    const pilotes = lignes.map((l) => l.pilote);
    expect(pilotes[0]).toBeCloseTo(2 / 3, 12);
    expect(pilotes.slice(1)).toEqual([null, 1]);
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

  it("plusieurs apps : deux « 1.0.0 » sont deux lignes, chacune nommée par son app et liée à elle", () => {
    const hrefApp = (r: string | null, app: string) => `/mobile?app=${app}&release=${r}`;
    const multi = renderToStaticMarkup(
      <StabiliteParRelease
        resultat={{
          ...RESULTAT,
          apps: 2,
          releases: 2,
          lignes: [
            ligne({ app_id: "app-a", release: "1.0.0" }),
            ligne({
              app_id: "app-b",
              release: "1.0.0",
              etat_js_errors: "unknown",
              part_touchee: null,
              raison_part: ERROR_FREE_REASONS.capability_unknown,
            }),
          ],
        }}
        tri="fourni"
        triHref={{ fourni: "/mobile", gravite: "/mobile?tri=gravite", volume: "/mobile?tri=volume" }}
        hrefDeRelease={hrefApp}
        plage="24 h"
      />,
    );
    expect(multi.match(/data-testid="impact-ligne"/g)).toHaveLength(2);
    expect(texte(multi)).toContain("1.0.0 · app-a");
    expect(texte(multi)).toContain("1.0.0 · app-b");
    expect(multi).toContain('href="/mobile?app=app-b&amp;release=1.0.0"');
    expect(texte(multi)).toContain(`Part « — » pour 1.0.0 · app-b : ${ERROR_FREE_REASONS.capability_unknown}`);
  });
});
