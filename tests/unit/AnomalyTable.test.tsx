// AnomalyTable (F13, plan § 5.1.2 zone 9) : la section existe TOUJOURS, repliée,
// cible `#anomalies` ; zéro anomalie est dit avec sa règle ; sous filtre, la
// détection n'est pas appliquée et c'est écrit ; une ligne ouvre sa route.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnomalyTable, REGLE_ANOMALIES } from "@/components/health/AnomalyTable";
import type { Health } from "@/lib/health";

const SANTE: Health = { score: 80, label: "Bon", factors: [], anomalies: [] };
const ANOMALIE = { app_id: "a", route: "/checkout", bucket: new Date("2026-09-22T14:00:00Z"), p75: 4800, mean_7d: 2100, z_score: 4.2 };

describe("AnomalyTable", () => {
  it("aucune anomalie : la section reste, repliée, et dit sa règle", () => {
    const html = renderToStaticMarkup(<AnomalyTable health={SANTE} />);
    expect(html).toContain('<details id="anomalies"');
    const texte = html.replace(/<!-- -->/g, "").replace(/&gt;/g, ">").replace(/&#x27;/g, "'");
    expect(texte).toContain(`Aucune anomalie (${REGLE_ANOMALIES}).`);
    expect(html).not.toContain("<table");
  });

  it("sous filtre : non cherchées, et pourquoi", () => {
    const html = renderToStaticMarkup(<AnomalyTable health={SANTE} filtree />);
    expect(html).toContain("non cherchées sous filtre");
    expect(html).not.toContain("Aucune anomalie");
  });

  it("une ligne par anomalie, la route mène à son heure", () => {
    const html = renderToStaticMarkup(
      <AnomalyTable health={{ ...SANTE, anomalies: [ANOMALIE] }} lien={(a) => `/pages?route=${encodeURIComponent(a.route ?? "")}`} />,
    );
    expect(html).toContain('data-compte="1"');
    expect(html).toContain('href="/pages?route=%2Fcheckout"');
    expect(html).toContain("<caption");
    // Aucune couleur de verdict sur un z-score (R-S).
    const zScore = html.match(/<td[^>]*>\+(?:<!-- -->)?4,2<\/td>/)?.[0];
    expect(zScore).toBeDefined();
    expect(zScore).not.toMatch(/good|bad/);
  });
});
