// @mip/service-kit — metrics.mjs : format texte Prometheus correct
// (échappements, types), jauges calculées au rendu, et plafond de séries
// contre une étiquette nourrie par une entrée client.
import { describe, expect, it } from "vitest";
import { createMetrics, registerProcessMetrics } from "../../packages/service-kit/metrics.mjs";

describe("service-kit/metrics", () => {
  it("rend compteurs et jauges au format d'exposition 0.0.4", async () => {
    const m = createMetrics({ prefix: "mip_" });
    const c = m.counter("requests_total", "Requêtes servies.", { labels: ["method", "code"] });
    c.inc({ method: "GET", code: "200" });
    c.inc({ method: "GET", code: "200" }, 2);
    c.inc({ method: "POST", code: "413" });
    const g = m.gauge("backlog", "Lots en attente.");
    g.set(7);
    g.dec(2);
    const texte = await m.render();
    expect(texte).toContain("# HELP mip_requests_total Requêtes servies.\n# TYPE mip_requests_total counter\n");
    expect(texte).toContain('mip_requests_total{method="GET",code="200"} 3\n');
    expect(texte).toContain('mip_requests_total{method="POST",code="413"} 1\n');
    expect(texte).toContain("# TYPE mip_backlog gauge\nmip_backlog 5\n");
    expect(texte.endsWith("\n")).toBe(true);
  });

  it("échappe les valeurs d'étiquettes et l'aide", async () => {
    const m = createMetrics();
    m.counter("x_total", "ligne 1\nligne \\ 2", { labels: ["v"] }).inc({ v: 'a"b\\c\nd' });
    const texte = await m.render();
    expect(texte).toContain("# HELP x_total ligne 1\\nligne \\\\ 2");
    expect(texte).toContain('x_total{v="a\\"b\\\\c\\nd"} 1');
  });

  it("jauge calculée au rendu ; une collecte qui lève ne fait pas tomber /metrics", async () => {
    const m = createMetrics();
    let n = 1;
    m.gauge("pool_total", "Connexions.", { collect: () => n });
    m.gauge("casse", "Toujours en échec.", {
      collect: () => {
        throw new Error("boom");
      },
    });
    n = 4;
    const texte = await m.render();
    expect(texte).toContain("pool_total 4\n");
    expect(texte).toContain("# TYPE casse gauge");
    expect(texte).toContain("metrics_collect_errors 1\n");
  });

  it("plafonne les séries par métrique et compte ce qui est ignoré", async () => {
    const m = createMetrics({ maxSeries: 3 });
    const c = m.counter("hits_total", "Par chemin (mauvaise idée).", { labels: ["path"] });
    for (let i = 0; i < 10; i++) c.inc({ path: `/x/${i}` });
    const texte = await m.render();
    expect(texte.match(/^hits_total\{/gm)).toHaveLength(3);
    expect(texte).toContain("metrics_series_dropped_total 7\n");
  });

  it("refuse noms et étiquettes invalides, incrément négatif, redéclaration divergente", () => {
    const m = createMetrics();
    expect(() => m.counter("1abc", "x")).toThrow(/nom invalide/);
    expect(() => m.counter("ok_total", "x", { labels: ["__reserve"] })).toThrow(/étiquette invalide/);
    const c = m.counter("ok_total", "x");
    expect(() => c.inc(-1)).toThrow(RangeError);
    expect(m.counter("ok_total", "x")).toBeTruthy(); // même déclaration : même métrique
    expect(() => m.gauge("ok_total", "x")).toThrow(/déjà déclarée/);
  });

  it("registerProcessMetrics expose mémoire et ancienneté", async () => {
    const m = createMetrics();
    registerProcessMetrics(m);
    const texte = await m.render();
    expect(texte).toMatch(/^process_uptime_seconds \d/m);
    expect(texte).toMatch(/^process_resident_memory_bytes \d+/m);
    expect(texte).toMatch(/^nodejs_heap_used_bytes \d+/m);
  });
});
