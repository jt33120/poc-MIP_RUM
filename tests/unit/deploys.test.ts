// Voie A inc.3 — détection de régression post-déploiement (logique pure).
// « Plus haut = pire » (LCP, volume d'erreurs) : régression si l'après dépasse
// l'avant d'au moins +20 % (ratio par défaut).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { q } = vi.hoisted(() => ({ q: vi.fn() }));
vi.mock("@/lib/db", () => ({ q }));

import { assessRegression, latestDeployImpact } from "../../apps/console/lib/queries-deploys";

beforeEach(() => q.mockReset());

const FILTRES = { app: "app-a", period: "24h" as const, device: null, segment: [] };
const LIGNE = {
  deploy_ts: new Date("2026-09-20T10:00:00Z"),
  version: "4.8.0",
  env: "production",
  lcp_before: 2100,
  lcp_after: 2300,
  sessions_before: 0,
  sessions_after: 9,
};

describe("latestDeployImpact", () => {
  it("sans page vue sur une fenêtre, ses erreurs sont null (V3) ; avec des pages vues, 0 reste 0", async () => {
    q.mockResolvedValueOnce([{ ...LIGNE, pageviews_before: 0, errors_before: 0, pageviews_after: 12, errors_after: 0 }]);
    const impact = await latestDeployImpact(FILTRES);
    expect(impact?.errors_before).toBeNull();
    expect(impact?.errors_after).toBe(0);
    expect(impact?.pageviews_after).toBe(12);
    expect(impact?.sessions_after).toBe(9);
  });

  it("compte pages vues et sessions sur started_at, dans l'app du marqueur, fenêtres [d−2 h, d) et [d, d+2 h)", async () => {
    q.mockResolvedValueOnce([{ ...LIGNE, pageviews_before: 3, errors_before: 1, pageviews_after: 4, errors_after: 2 }]);
    await latestDeployImpact(FILTRES);
    const [sql] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("from rum_pageview p, d");
    expect(sql).toContain("p.app_id = d.app_id");
    expect(sql).toContain("p.started_at >= d.ts - interval '2 hours' and p.started_at < d.ts");
    expect(sql).toContain("p.started_at >= d.ts and p.started_at < d.ts + interval '2 hours'");
    expect(sql).toContain("count(distinct p.session_id)");
    expect(sql).toContain("sum(e.occurrences)");
  });

  it("aucun déploiement : null", async () => {
    q.mockResolvedValueOnce([{ deploy_ts: null }]);
    await expect(latestDeployImpact(FILTRES)).resolves.toBeNull();
  });
});

describe("assessRegression", () => {
  it("détecte une dégradation >= +20 %", () => {
    expect(assessRegression(2000, 2600)).toEqual({ regressed: true, deltaPct: 30 });
    expect(assessRegression(10, 12)).toEqual({ regressed: true, deltaPct: 20 });
  });

  it("ne signale pas une variation sous le seuil", () => {
    expect(assessRegression(2000, 2200)).toEqual({ regressed: false, deltaPct: 10 });
    expect(assessRegression(2000, 1500)).toEqual({ regressed: false, deltaPct: -25 });
  });

  it("neutre si donnée manquante ou avant <= 0", () => {
    expect(assessRegression(null, 3000)).toEqual({ regressed: false, deltaPct: null });
    expect(assessRegression(2000, null)).toEqual({ regressed: false, deltaPct: null });
    expect(assessRegression(0, 100)).toEqual({ regressed: false, deltaPct: null });
  });

  it("respecte un ratio personnalisé", () => {
    expect(assessRegression(100, 130, 1.5).regressed).toBe(false); // +30 % < +50 %
    expect(assessRegression(100, 160, 1.5).regressed).toBe(true);
  });
});
