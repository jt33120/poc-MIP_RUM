// LongtasksView (F16, plan § 5.2.2) : la série des blocages posée sur la grille du
// contrat, et deux lectures indépendantes — la série en échec ne fait pas taire les
// pires cas, et l'inverse. Les panneaux recharts (client) ne sont pas rendus ici
// (§ 0.4) : on teste la préparation des points et les états.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { LongtasksView, pointsBlocages } from "@/components/LongtasksView";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même montage que tests/unit/Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }), usePathname: () => "/pages" }));

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
        { bucket: new Date(T0), loaf: 3, longtask: 1, inconnu: 0, p75_ms: 180 },
        { bucket: new Date(T0 + 2 * HEURE), loaf: 0, longtask: 2, inconnu: 1, p75_ms: null },
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
    expect(texte(html)).toContain("Long Animation Frames n'existe que sur Chromium");
    expect(texte(html)).toContain("Aucun cumul de durées");
    expect(texte(html)).not.toMatch(/temps d'attente total|cumul : /);
  });
});
