// LongtasksView (F16, plan § 5.2.2) : la série des blocages posée sur la grille du
// contrat, et deux lectures indépendantes — la série en échec ne fait pas taire les
// pires cas, et l'inverse. Les panneaux recharts (client) ne sont pas rendus ici
// (§ 0.4) : on teste la préparation des points et les états.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dureesP75, LongtasksView, PHRASE_BLOCAGE_NEUTRE, pointsBlocages } from "@/components/LongtasksView";
import type { LongtaskBucket } from "@/lib/queries-longtasks";
import { RATING_CLASS } from "@/lib/rating";
import { SEUILS_MIP, texteRegleMip } from "@/lib/seuils";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même montage que tests/unit/Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/pages" }));
// Les panneaux recharts (client) ne se rendent pas hors navigateur : des bornes vides.
vi.mock("@/components/charts/StackedBars", () => ({ StackedBars: () => null }));
vi.mock("@/components/charts/ThresholdSeries", () => ({ ThresholdSeries: () => null }));

const HEURE = 3_600_000;
const T0 = Date.parse("2026-09-22T10:00:00Z");
const GRILLE = [T0, T0 + HEURE, T0 + 2 * HEURE];
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

const PIRE = {
  session_id: "0123456789abcdef",
  route: "/panier",
  quoi: "recalculerTotal",
  source: "loaf",
  blocking_ms: 420,
  ts: new Date(T0 + 10 * 60_000),
};

const vue = (props: Partial<Parameters<typeof LongtasksView>[0]>) =>
  renderToStaticMarkup(
    <LongtasksView
      serie={{ ok: true, data: [] }}
      worst={{ ok: true, data: [] }}
      grille={GRILLE}
      bucketSeconds={3600}
      bucketLabel="1 h"
      periodLabel="24 h"
      sessionHref={(id) => `/sessions/${id}`}
      {...props}
    />,
  );

describe("pointsBlocages", () => {
  it("un point par seau de la grille : comptes absents = 0, p75 absent = trou (null), n = Σ des API", () => {
    const points = pointsBlocages(
      [
        { bucket: new Date(T0), loaf: 3, longtask: 1, inconnu: 0, p75_ms: 180, duree_p75_loaf: null, duree_p75_longtask: null },
        { bucket: new Date(T0 + 2 * HEURE), loaf: 0, longtask: 2, inconnu: 1, p75_ms: null, duree_p75_loaf: null, duree_p75_longtask: null },
      ],
      GRILLE,
    );
    expect(points).toEqual([
      { t: "2026-09-22T10:00:00Z", loaf: 3, longtask: 1, inconnu: 0, p75: 180, n: 4 },
      { t: "2026-09-22T11:00:00Z", loaf: 0, longtask: 0, inconnu: 0, p75: null, n: 0 },
      { t: "2026-09-22T12:00:00Z", loaf: 0, longtask: 2, inconnu: 1, p75: null, n: 3 },
    ]);
  });
});

describe("LongtasksView — états", () => {
  it("série en échec : « Lecture en échec » à la place des panneaux, les pires cas restent", () => {
    const html = vue({ serie: { ok: false, raison: "base coupée" }, worst: { ok: true, data: [PIRE] } });
    expect(texte(html)).toContain("Lecture en échec");
    expect(texte(html)).toContain("Tâches longues dans le temps");
    expect(html).not.toContain("recharts");
    expect(texte(html)).toContain("recalculerTotal");
    expect(html).toContain('href="/sessions/0123456789abcdef"');
  });

  it("pires cas en échec : leur bloc le dit, la série n'est pas touchée", () => {
    const html = vue({ worst: { ok: false, raison: "base coupée" } });
    expect(texte(html)).toContain("Lecture en échec");
    expect(texte(html)).toContain("Aucun blocage mesuré sur 24 h");
  });

  it("aucun blocage : la phrase Chromium, et aucun cumul de durées n'est jamais affiché", () => {
    const html = vue({});
    expect(texte(html)).toContain("La mesure des trames longues (LoAF) n'existe que sur Chromium");
    expect(texte(html)).toContain("Aucun cumul de durées");
    expect(texte(html)).not.toMatch(/temps d'attente total|cumul : /);
  });
});

// Suite de la vague 4 (30/09/2026) : la règle MIP porte sur la DURÉE p75 d'une tâche ou
// d'une trame, pas sur son temps de blocage. La durée est notée, règle écrite ; le
// blocage reste neutre, et l'écran le dit.
describe("LongtasksView — durée p75 notée, blocage neutre", () => {
  const seau = (extra: Partial<LongtaskBucket>): LongtaskBucket => ({
    bucket: new Date(T0),
    loaf: 2,
    longtask: 1,
    inconnu: 0,
    p75_ms: 180,
    duree_p75_loaf: null,
    duree_p75_longtask: null,
    ...extra,
  });
  // Le HTML échappe les chevrons : « > » devient « &gt; ».
  const echappe = (t: string) =>
    t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;");

  it("dureesP75 lit la première ligne ; aucune mesure = null, jamais 0", () => {
    expect(dureesP75([seau({ duree_p75_loaf: 312.5, duree_p75_longtask: 120 })])).toEqual({ loaf: 312.5, longtask: 120 });
    expect(dureesP75([seau({})])).toEqual({ loaf: null, longtask: null });
    expect(dureesP75([])).toEqual({ loaf: null, longtask: null });
  });

  it("LoAF notée par SEUILS_MIP.LOAF, tâches longues par SEUILS_MIP.LONGTASK, chaque règle écrite", () => {
    const html = vue({
      serie: {
        ok: true,
        data: [seau({ duree_p75_loaf: SEUILS_MIP.LOAF.mauvais + 1, duree_p75_longtask: SEUILS_MIP.LONGTASK.bon })],
      },
    });
    expect(html).toContain('data-testid="durees-p75"');
    expect(html).toMatch(/data-note="poor" data-mesure="LOAF"/);
    expect(html).toMatch(/data-note="good" data-mesure="LONGTASK"/);
    expect(html).toContain(RATING_CLASS.poor);
    expect(html).toContain("■");
    expect(html).toContain("●");
    expect(html).toContain(echappe(texteRegleMip("LOAF")));
    expect(html).toContain(echappe(texteRegleMip("LONGTASK")));
  });

  it("une API sans mesure : « pas de mesure », sans couleur ni règle", () => {
    const html = vue({ serie: { ok: true, data: [seau({ duree_p75_loaf: SEUILS_MIP.LOAF.bon })] } });
    expect(html).toMatch(/data-note="" data-mesure="LONGTASK"/);
    expect(texte(html)).toContain("pas de mesure");
    expect(html).not.toContain('data-regle-mip="LONGTASK"');
    expect(html).toContain('data-regle-mip="LOAF"');
  });

  it("le blocage n'a pas de règle MIP : la phrase est écrite, et ni sa série ni les pires cas ne sont colorés", () => {
    const html = vue({
      serie: { ok: true, data: [seau({ p75_ms: SEUILS_MIP.LOAF.mauvais * 4 })] },
      worst: { ok: true, data: [{ ...PIRE, blocking_ms: SEUILS_MIP.LOAF.mauvais * 4 }] },
    });
    expect(texte(html)).toContain(PHRASE_BLOCAGE_NEUTRE);
    expect(html).toContain('data-testid="blocage-neutre"');
    // Aucune note hors du bloc des durées : la table des pires blocages reste neutre.
    const table = html.slice(html.indexOf("Les blocages les plus longs, et leur session"));
    expect(table).not.toContain("data-note");
    expect(table).not.toContain(RATING_CLASS.poor);
  });

  it("le bloc des durées est `relative` (piège 16) et coupe ses textes à 390 px", () => {
    const html = vue({ serie: { ok: true, data: [seau({ duree_p75_loaf: SEUILS_MIP.LOAF.mauvais + 1 })] } });
    const bloc = html.match(/<div class="([^"]*)" data-testid="durees-p75"/);
    expect(bloc?.[1]).toContain("relative");
    expect(bloc?.[1]).toContain("min-w-0");
    expect(html).toContain("[overflow-wrap:anywhere]");
  });

  it("partie « pires » : pas de bloc des durées (il accompagne la série)", () => {
    const html = vue({ partie: "pires", serie: { ok: true, data: [seau({ duree_p75_loaf: 1 })] } });
    expect(html).not.toContain("durees-p75");
  });
});
