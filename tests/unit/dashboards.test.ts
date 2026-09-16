// P1 — helpers purs des tableaux de bord (lib/dashboards.ts) : normalisation du layout.
import { describe, expect, it } from "vitest";
import { defaultTitle, MAX_WIDGETS, normalizeLayout } from "../../apps/console/lib/dashboards";

describe("normalizeLayout", () => {
  it("rejette une entrée non-array", () => {
    expect(normalizeLayout(null)).toEqual([]);
    expect(normalizeLayout({})).toEqual([]);
    expect(normalizeLayout("x")).toEqual([]);
  });

  it("garde les widgets valides, écarte les types inconnus", () => {
    const out = normalizeLayout([
      { type: "traffic", title: "Trafic" },
      { type: "inconnu", title: "x" },
      { type: "frustration" },
    ]);
    expect(out.map((w) => w.type)).toEqual(["traffic", "frustration"]);
  });

  it("vital_p75 sans métrique valide → écarté ; avec métrique → gardé", () => {
    expect(normalizeLayout([{ type: "vital_p75", title: "x" }])).toEqual([]);
    expect(normalizeLayout([{ type: "vital_p75", metric: "ZZZ" }])).toEqual([]);
    const ok = normalizeLayout([{ type: "vital_p75", metric: "LCP" }]);
    expect(ok).toHaveLength(1);
    expect(ok[0]).toMatchObject({ type: "vital_p75", metric: "LCP", title: "LCP p75" });
  });

  it("titre par défaut si absent", () => {
    const [w] = normalizeLayout([{ type: "traffic" }]);
    expect(w.title).toBe(defaultTitle("traffic"));
  });

  it("event_count exige un nom borné et le conserve pour le rendu/export partagé", () => {
    expect(normalizeLayout([{ type: "event_count" }])).toEqual([]);
    expect(normalizeLayout([{ type: "event_count", eventName: "x".repeat(101) }])).toEqual([]);
    expect(normalizeLayout([{ type: "event_count", eventName: "checkout" }])).toEqual([{
      type: "event_count", eventName: "checkout", title: "Événements · checkout",
    }]);
  });

  it("borne le nombre de widgets à MAX_WIDGETS", () => {
    const many = Array.from({ length: MAX_WIDGETS + 10 }, () => ({ type: "traffic" }));
    expect(normalizeLayout(many)).toHaveLength(MAX_WIDGETS);
  });

  it("tronque les titres trop longs", () => {
    const [w] = normalizeLayout([{ type: "traffic", title: "x".repeat(200) }]);
    expect(w.title.length).toBeLessThanOrEqual(60);
  });
});
