// F39 — « Sessions et erreurs JS dans le temps » (W-M10, plan § 5.6.4), rendu serveur.
// Le graphique (client, recharts) est remplacé par un témoin : ce qui se teste ici,
// ce sont les ÉTATS, les panneaux dessinés et l'alternative textuelle.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER. Un axe vide (ou un panneau de zéros)
// qui se lirait comme une période calme : aucune session React Native, erreurs JS
// déclarées non collectées, ou colonne `error_source` absente.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

vi.mock("@/components/charts/ThresholdSeries", () => ({
  ThresholdSeries: (p: { series: { cle: string }[]; points: unknown; legendeAnnotations?: boolean; synchro?: string }) => (
    <div
      data-testid="temoin-threshold"
      data-cle={p.series[0]?.cle}
      data-points={JSON.stringify(p.points)}
      data-legende={String(p.legendeAnnotations ?? true)}
      data-synchro={p.synchro ?? ""}
    />
  ),
}));

const { MobileDansLeTemps, NOTE_CAPACITE_INCONNUE } = await import("@/components/mobile/MobileDansLeTemps");
const { RAISON_SANS_RUNTIME, RAISON_SANS_SOURCE_JS } = await import("@/lib/mobile-capabilities");

const texte = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const H = 3_600_000;
const T0 = Date.parse("2026-09-22T10:00:00Z");
const STARTS = [T0, T0 + H, T0 + 2 * H];
const COMMUN = {
  starts: STARTS,
  seauSecondes: 3600,
  plage: "24 h",
  zoomHref: "/mobile?from={from}&to={to}",
  annotations: [],
  annotationsIndisponibles: null,
  capaciteJs: "active" as const,
};
const seaux = (sessions: number[], occurrences: (number | null)[]) =>
  STARTS.map((ms, i) => ({ bucket: new Date(ms).toISOString(), sessions: sessions[i], occurrences: occurrences[i] }));
const lue = (s: number[], o: (number | null)[], raisonErreurs: string | null = null) =>
  ({ ok: true, data: { disponible: true, seaux: seaux(s, o), raisonErreurs } }) as const;
const temoins = (html: string) => [...html.matchAll(/data-testid="temoin-threshold" data-cle="([a-z]+)"/g)].map((m) => m[1]);

/** Les cellules de la colonne `nom` de l'alternative textuelle. */
function colonne(html: string, nom: string): string[] {
  const table = html.slice(html.indexOf("<table"));
  const entetes = [...table.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
  const i = entetes.indexOf(nom);
  const lignes = [...table.matchAll(/<tr class="border-b border-line\/60[^"]*">([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map((c) => c[1]),
  );
  return lignes.map((l) => l[i]);
}

describe("MobileDansLeTemps — deux panneaux empilés, avec alternative", () => {
  it("nominal : sessions puis erreurs JS, même survol, une ligne par seau, totaux = tuiles", () => {
    const html = renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} lecture={lue([3, 0, 1], [2, 0, 0])} />);
    expect(temoins(html)).toEqual(["sessions", "occurrences"]);
    expect([...html.matchAll(/data-synchro="([^"]*)"/g)].map((m) => m[1])).toEqual(["mobile-temps", "mobile-temps"]);
    // Les déploiements ne sont listés qu'une fois : sous le dernier panneau.
    expect([...html.matchAll(/data-legende="([^"]*)"/g)].map((m) => m[1])).toEqual(["false", "true"]);
    const t = texte(html);
    expect(t).toContain("4 sessions commencées");
    expect(t).toContain("2 occurrences d'erreurs JS");
    expect(t).toContain("Alternative textuelle");
    expect(colonne(html, "Sessions React Native commencées")).toEqual(["3", "0", "1"]);
    expect(colonne(html, "Occurrences d'erreurs JS")).toEqual(["2", "0", "0"]);
    expect(html).toContain('id="mobile-temps"');
  });

  it("aucune session React Native : l'état vide motivé, aucun axe", () => {
    const html = renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} lecture={lue([0, 0, 0], [0, 0, 0])} />);
    expect(temoins(html)).toEqual([]);
    expect(html).toContain('data-etat="vide"');
    const t = texte(html);
    expect(t).toContain("Aucune session React Native commencée sur 24 h.");
    expect(t).toContain("un axe plat se lirait comme une période calme");
    expect(t).not.toContain("Alternative textuelle");
  });

  it("schéma sans runtime (v82) : « non disponible », avec la raison ; lecture en échec : l'état d'erreur", () => {
    const html = renderToStaticMarkup(
      <MobileDansLeTemps {...COMMUN} lecture={{ ok: true, data: { disponible: false, raison: RAISON_SANS_RUNTIME } }} />,
    );
    expect(temoins(html)).toEqual([]);
    expect(texte(html)).toContain(`Série non disponible : ${RAISON_SANS_RUNTIME}.`);
    const echec = renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} lecture={{ ok: false, raison: "base coupée" }} />);
    expect(temoins(echec)).toEqual([]);
    expect(texte(echec)).toContain("Lecture en échec.");
    expect(texte(echec)).not.toContain("base coupée");
  });

  it("erreurs JS déclarées non collectées : « Non collecté » à la place du panneau, « — » dans l'alternative", () => {
    const html = renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} capaciteJs="unavailable" lecture={lue([3, 0, 1], [0, 0, 0])} />);
    expect(temoins(html)).toEqual(["sessions"]);
    const t = texte(html);
    expect(t).toContain("Non collecté : les erreurs JavaScript sont déclarées non collectées");
    expect(t).toContain("occurrences d'erreurs JS : non collectées");
    expect(t).not.toContain("0 occurrences d'erreurs JS");
    expect(colonne(html, "Occurrences d'erreurs JS")).toEqual(["—", "—", "—"]);
  });

  it("colonne error_source absente (v69) : occurrences « non lues », jamais 0", () => {
    const html = renderToStaticMarkup(
      <MobileDansLeTemps {...COMMUN} lecture={lue([3, 0, 1], [null, null, null], RAISON_SANS_SOURCE_JS)} />,
    );
    expect(temoins(html)).toEqual(["sessions"]);
    const t = texte(html);
    expect(t).toContain("occurrences d'erreurs JS : non lues");
    expect(t).toContain(RAISON_SANS_SOURCE_JS);
    expect(colonne(html, "Occurrences d'erreurs JS")).toEqual(["—", "—", "—"]);
  });

  it("capacité jamais déclarée : le zéro est dit, pas prouvé", () => {
    const vide = texte(renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} capaciteJs="unknown" lecture={lue([3, 0, 1], [0, 0, 0])} />));
    expect(vide).toContain("Aucune occurrence d'erreur JS sur 24 h.");
    expect(vide).toContain(NOTE_CAPACITE_INCONNUE);
    const avec = texte(renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} capaciteJs="unknown" lecture={lue([3, 0, 1], [2, 0, 0])} />));
    expect(avec).toContain(NOTE_CAPACITE_INCONNUE);
  });

  it("l'Explorer rejoue le panneau des sessions, et la figure le dit", () => {
    const html = renderToStaticMarkup(
      <MobileDansLeTemps {...COMMUN} explorer="/explorer?seg=v2%3Aruntime%3Aeq%3Areact_native" lecture={lue([3, 0, 1], [2, 0, 0])} />,
    );
    expect(html).toContain('href="/explorer?seg=v2%3Aruntime%3Aeq%3Areact_native"');
    expect(texte(html)).toContain("L'Explorer rejoue le panneau des sessions");
    const sans = renderToStaticMarkup(<MobileDansLeTemps {...COMMUN} lecture={lue([3, 0, 1], [2, 0, 0])} />);
    expect(sans).not.toContain("/explorer");
  });
});
