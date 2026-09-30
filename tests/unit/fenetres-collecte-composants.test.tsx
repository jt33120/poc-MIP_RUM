// Les hachures « non mesuré » de la suite, côté RENDU (le côté chargeur :
// `fenetres-collecte-chargeurs.test.ts`).
//
// Deux choses :
//   · les composants intermédiaires (série mobile, carte de tableau de bord,
//     occurrences d'un groupe d'erreurs) transmettent les fenêtres reçues à CHAQUE
//     panneau qu'ils dessinent, et la note datée n'est écrite qu'une fois ;
//   · un cliquet de source : dans chaque fichier branché, toute série temporelle
//     (`<ThresholdSeries`, `<StackedBars`) reçoit `fenetresCollecte` — un graphique
//     ajouté sans ses fenêtres ferait lire un zéro là où rien n'a été mesuré.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { bucketStarts, parseAnalyticsQuery } from "@/lib/query-contract";
import { grilleIso, type FenetreCollecte } from "@/lib/series";

type Props = { ariaLabel: string; fenetresCollecte?: readonly FenetreCollecte[]; noteCollecte?: boolean };
const trace = (p: Props) => (
  <div
    data-graphe={p.ariaLabel}
    data-note={p.noteCollecte === false ? "non" : "oui"}
    data-fenetres={p.fenetresCollecte === undefined ? "absentes" : p.fenetresCollecte.map((f) => `${f.etat}|${f.debut}`).join(" ")}
  />
);
vi.mock("@/components/charts/ThresholdSeries", async (original) => ({
  ...(await original<typeof import("@/components/charts/ThresholdSeries")>()),
  ThresholdSeries: trace,
}));
vi.mock("@/components/charts/StackedBars", async (original) => ({
  ...(await original<typeof import("@/components/charts/StackedBars")>()),
  StackedBars: trace,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

const query = (() => {
  const p = parseAnalyticsQuery(new URLSearchParams("app=demo-app&period=24h"), {
    principal: { role: "admin", apps: null },
    nowMs: Date.now(),
  });
  if (!p.ok) throw new Error(p.error.code);
  return p.value;
})();
const starts = bucketStarts(query.range);
const grille = grilleIso(starts);
const FENETRE: FenetreCollecte = { debut: grille[3], fin: grille[6], etat: "interrompue", portee: "*" };
const ATTENDU = `interrompue|${FENETRE.debut}`;

/** Les graphes rendus : [libellé, fenêtres, note]. */
function graphes(html: string): [string, string, string][] {
  return [...html.matchAll(/data-graphe="([^"]*)" data-note="([^"]*)" data-fenetres="([^"]*)"/g)].map((m) => [m[1], m[3], m[2]]);
}

const { MobileDansLeTemps } = await import("@/components/mobile/MobileDansLeTemps");
const { WidgetBody } = await import("@/components/dashboards/WidgetBody");
const { OccurrencesDansLeTemps } = await import("@/components/errors/DetailErreur");

describe("composants intermédiaires — les fenêtres arrivent à chaque panneau", () => {
  it("/mobile : sessions ET erreurs hachurées, fenêtres datées une seule fois", () => {
    const html = renderToStaticMarkup(
      <MobileDansLeTemps
        lecture={{ ok: true, data: { disponible: true, raisonErreurs: null, seaux: grille.map((t) => ({ bucket: t, sessions: 4, occurrences: 2 })) } }}
        starts={starts}
        seauSecondes={query.range.bucketSeconds}
        plage="24 h"
        zoomHref="/mobile?from={from}&to={to}"
        annotations={[]}
        annotationsIndisponibles={null}
        capaciteJs="available"
        fenetresCollecte={[FENETRE]}
      />,
    );
    const g = graphes(html);
    expect(g).toHaveLength(2);
    expect(g.map(([, f]) => f)).toEqual([ATTENDU, ATTENDU]);
    expect(g.map(([, , note]) => note)).toEqual(["oui", "non"]);
  });

  it("tableau de bord, carte trafic : les deux panneaux hachurés, fenêtres datées une seule fois", () => {
    const jours = ["2026-09-17", "2026-09-18", "2026-09-19"];
    const html = renderToStaticMarkup(
      <WidgetBody
        data={{ kind: "timeseries", trafic: { grille: jours, points: jours.map((t) => ({ t, pageviews: 10, errors: 1 })), fuseau: "Europe/Paris" } } as never}
        query={query}
        fenetresCollecte={[FENETRE]}
      />,
    );
    const g = graphes(html);
    expect(g).toHaveLength(2);
    expect(g.map(([, f]) => f)).toEqual([ATTENDU, ATTENDU]);
    expect(g.map(([, , note]) => note)).toEqual(["non", "oui"]);
  });

  it("occurrences d'un groupe d'erreurs (panneau, page du groupe, page de l'issue)", () => {
    const html = renderToStaticMarkup(
      <OccurrencesDansLeTemps
        trend={grille.map((t) => ({ bucket: t, occurrences: 3 }))}
        grille={grille}
        plage="24 h"
        bucketLabel="1 h"
        seauSecondes={query.range.bucketSeconds}
        annotations={[]}
        fenetresCollecte={[FENETRE]}
      />,
    );
    expect(graphes(html).map(([, f]) => f)).toEqual([ATTENDU]);
  });

  it("lecture du registre en échec (`fenetresLues` → undefined) : aucune hachure, le graphique reste", () => {
    const html = renderToStaticMarkup(
      <OccurrencesDansLeTemps
        trend={grille.map((t) => ({ bucket: t, occurrences: 3 }))}
        grille={grille}
        plage="24 h"
        bucketLabel="1 h"
        seauSecondes={query.range.bucketSeconds}
        annotations={[]}
        fenetresCollecte={undefined}
      />,
    );
    expect(graphes(html).map(([, f]) => f)).toEqual(["absentes"]);
  });
});

// ───────────── Cliquet de source : aucune série temporelle sans ses fenêtres ─────────────

const CONSOLE = join(__dirname, "../../apps/console");
/** Les fichiers branchés par la suite (les écrans de la vague 1 ont leur propre test). */
const FICHIERS = [
  "app/experience/page.tsx",
  "app/map/page.tsx",
  "app/ux/page.tsx",
  "app/forecast/page.tsx",
  "app/correlation/page.tsx",
  "app/acquisition/page.tsx",
  "app/alerts/page.tsx",
  "app/logs/page.tsx",
  "components/mobile/MobileDansLeTemps.tsx",
  "components/dashboards/WidgetBody.tsx",
  "components/explorer/ResultatAnalyse.tsx",
  "components/perf/RoutePanel.tsx",
  "components/errors/DetailErreur.tsx",
];

/** Chaque ouverture `<ThresholdSeries`/`<StackedBars`, jusqu'à la fin de sa balise (`/>` ou `>` au niveau zéro). */
function balises(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/<(ThresholdSeries|StackedBars)\b/g)) {
    let i = m.index! + m[0].length;
    let accolades = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "{") accolades++;
      else if (c === "}") accolades--;
      else if (c === ">" && accolades === 0) break;
    }
    out.push(source.slice(m.index!, i + 1));
  }
  return out;
}

describe.each(FICHIERS)("cliquet — %s", (fichier) => {
  it("chaque série temporelle reçoit `fenetresCollecte`", () => {
    const source = readFileSync(join(CONSOLE, fichier), "utf8");
    const toutes = balises(source);
    expect(toutes.length).toBeGreaterThan(0);
    // Des props partagées par étalement (`{...partage}`) comptent si l'objet porte les fenêtres.
    const partage = /const partage = \{[^}]*\bfenetresCollecte\b[^}]*\}/.test(source);
    for (const b of toutes) {
      const recue = /\bfenetresCollecte=\{/.test(b) || (partage && /\{\.\.\.partage\}/.test(b));
      expect(recue, b.split("\n").slice(0, 3).join(" ")).toBe(true);
    }
  });
});

describe.each([
  "app/experience/page.tsx",
  "app/map/page.tsx",
  "app/ux/page.tsx",
  "app/forecast/page.tsx",
  "app/correlation/page.tsx",
  "app/acquisition/page.tsx",
  "app/alerts/page.tsx",
  "app/logs/page.tsx",
  "app/mobile/page.tsx",
  "app/dashboards/[id]/page.tsx",
  "app/errors/[fingerprint]/page.tsx",
  "app/errors/issues/[id]/page.tsx",
])("page — %s", (fichier) => {
  it("lit les fenêtres de son chargeur par `fenetresLues` (un échec ne hachure rien)", () => {
    const source = readFileSync(join(CONSOLE, fichier), "utf8");
    expect(source).toMatch(/fenetresLues\([^)]*fenetresCollecte\)/);
  });
});
