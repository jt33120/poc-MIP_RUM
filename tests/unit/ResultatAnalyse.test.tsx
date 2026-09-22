// ResultatAnalyse (F32, plan § 4.3, W-E3 à W-E6, W-E8, règle R-V) : la forme suit
// l'additivité, le verdict suit R-V, l'inconnu reste inconnu, la figure déclare ce
// qu'elle montre. Rendu SSR réel ; les deux îlots recharts (client) sont remplacés
// par des témoins qui exposent les props reçues — c'est là que R-V se vérifie
// (`vital` passé ou non), le dessin lui-même étant testé par `ThresholdSeries.test.ts`.
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

// Témoins des séries : les props, telles que le composant client les recevrait.
vi.mock("@/components/charts/ThresholdSeries", () => ({
  ThresholdSeries: (p: { vital?: string; points: unknown; series: unknown; zoomHref?: string; annotations?: unknown }) => (
    <div
      data-testid="temoin-threshold"
      data-vital={p.vital ?? "aucun"}
      data-points={JSON.stringify(p.points)}
      data-series={JSON.stringify(p.series)}
      data-zoom={p.zoomHref ?? ""}
      data-annotations={JSON.stringify(p.annotations ?? [])}
    />
  ),
}));
vi.mock("@/components/charts/StackedBars", () => ({
  StackedBars: (p: { series: unknown; points: unknown }) => (
    <div data-testid="temoin-stacked" data-series={JSON.stringify(p.series)} data-points={JSON.stringify(p.points)} />
  ),
}));

import { ResultatAnalyse, metaResultat, pointsDeSerie } from "@/components/explorer/ResultatAnalyse";
import { explorerSource } from "@/lib/explorer-page-params";
import { parseExplorerPlan, type ExplorerPlan } from "@/lib/analytics-schema";
import type { ExplorerData, ExplorerMeta } from "@/lib/queries-explorer";
import { parseAnalyticsQuery, type AnalyticsQuery } from "@/lib/query-contract";
import { RATING_CLASS } from "@/lib/rating";

const NOW = Date.parse("2026-09-22T12:00:00.000Z");

function requete(qs: string): AnalyticsQuery {
  const parsed = parseAnalyticsQuery(new URLSearchParams(qs), { principal: { role: "admin", apps: null }, nowMs: NOW });
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.value;
}

function plan(qs: string): ExplorerPlan {
  const parsed = parseExplorerPlan(explorerSource(new URLSearchParams(qs)), requete(qs));
  if (!parsed.ok) throw new Error(`${parsed.error.code} : ${parsed.error.message}`);
  return parsed.value;
}

function meta(p: ExplorerPlan, surcharge: Partial<ExplorerMeta> = {}): ExplorerMeta {
  const q = requete("app=demo&period=1h");
  const additive = p.measure.aggregation === "count" || p.measure.aggregation === "sum";
  return {
    app: "demo",
    period: "1h",
    query_version: 1,
    effective_apps: ["demo"],
    range: { from: q.range.from, to: q.range.to, preset: "1h", bucket_seconds: q.range.bucketSeconds },
    dataset: p.dataset,
    measure: p.measure.field,
    unit: "ms",
    aggregation: p.measure.aggregation,
    additive,
    counting: "mesures reçues",
    source: "raw",
    approximate: false,
    rollup: { eligible: false, source: null, reason: null },
    group_by: p.groupBy,
    visualization: p.visualization,
    warnings: [],
    coverage: { status: "complete", reason: null },
    truncated_groups: false,
    query: {},
    ...surcharge,
  };
}

const DATA: ExplorerData = { total: null, samples: 0, groups: [], series: [], rows: [], next_cursor: null };
const HREFS = { groupe: (key: (string | null)[]) => `/explorer?route=${encodeURIComponent(key[0] ?? "")}&run=1&period=1h` };

type Props = ComponentProps<typeof ResultatAnalyse>;
function rendu(p: ExplorerPlan, data: Partial<ExplorerData>, props: Partial<Props> = {}) {
  return renderToStaticMarkup(
    <ResultatAnalyse plan={p} meta={meta(p)} data={{ ...DATA, ...data }} hrefs={HREFS} taille="page" {...props} />,
  );
}
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");
const VERDICTS = /\b(Bon|À améliorer|Mauvais)\b/;
const attribut = (html: string, nom: string) => {
  const m = html.match(new RegExp(`${nom}="([^"]*)"`));
  return m ? m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&") : null;
};

describe("ResultatAnalyse — Valeur (W-E3) et règle R-V", () => {
  it("LCP p75 : badge de verdict (le seul cas où les seuils web.dev s'appliquent)", () => {
    const html = rendu(plan("dataset=vitals&measure=value:p75&variant=LCP&viz=value"), { total: 2100, samples: 400 });
    expect(texte(html)).toContain("LCP — p75");
    expect(html).toContain('data-testid="kpi-verdict"');
    expect(texte(html)).toMatch(VERDICTS);
  });

  it("LCP moyenne : tuile neutre, aucun badge, et la phrase R-V", () => {
    const html = rendu(plan("dataset=vitals&measure=value:avg&variant=LCP&viz=value"), { total: 2100, samples: 400 });
    expect(html).not.toContain('data-testid="kpi-verdict"');
    expect(texte(html)).not.toMatch(VERDICTS);
    expect(texte(html)).toContain("Seuils web.dev définis pour le p75 : aucun verdict n'est donné pour la moyenne.");
  });

  it("LCP p95 : pas de verdict non plus", () => {
    const html = rendu(plan("dataset=vitals&measure=value:p95&variant=LCP&viz=value"), { total: 5200, samples: 400 });
    expect(texte(html)).not.toMatch(VERDICTS);
    expect(texte(html)).toContain("aucun verdict n'est donné pour le p95");
  });

  it("total null → « — » et sa raison, sans delta", () => {
    const html = rendu(
      plan("dataset=vitals&measure=value:p75&variant=LCP&viz=value"),
      { total: null, samples: 0 },
      { precedent: { total: 1800, plage: "vs 1 h précédentes (22/09 10:00 → 22/09 11:00 UTC)", couverture: { etat: "complete", raison: null, n: 300 } } },
    );
    expect(texte(html)).toContain("—");
    expect(texte(html)).toContain("aucune ligne mesurée sur la fenêtre");
    expect(texte(html)).not.toMatch(/[+−-]\d+ %/);
    expect(html).toContain('data-testid="explorer-vide"');
  });

  it("cmp=prev : la référence est écrite en clair ; une précédente incomplète tait le delta", () => {
    const p = plan("dataset=errors&measure=occurrences:sum&viz=value");
    const plage = "vs 1 h précédentes (22/09 10:00 → 22/09 11:00 UTC)";
    const complete = rendu(p, { total: 120, samples: 40 }, { precedent: { total: 100, plage, couverture: { etat: "complete", raison: null, n: 30 } } });
    expect(texte(complete)).toContain("+20 % vs 1 h précédentes (22/09 10:00 → 22/09 11:00 UTC)");
    const partielle = rendu(p, { total: 120, samples: 40 }, {
      precedent: { total: 100, plage, couverture: { etat: "partielle", raison: "erreurs collectées depuis le 22/09 10:30 UTC seulement", n: 30 } },
    });
    expect(texte(partielle)).toContain("période précédente incomplète : erreurs collectées depuis le 22/09 10:30 UTC seulement");
    expect(texte(partielle)).not.toContain("+20 %");
  });

  it("un compte réellement vide vaut 0, et la figure dit que la population est vide", () => {
    const html = rendu(plan("dataset=errors&measure=occurrences:sum&viz=value"), { total: 0, samples: 0 });
    expect(html).toMatch(/data-testid="kpi-valeur"[^>]*>0</);
    expect(html).toContain('data-testid="explorer-vide"');
  });
});

describe("ResultatAnalyse — Classement (W-E4) : la forme suit l'additivité", () => {
  it("mesure additive → barres, part du total, drill-down sur la ligne", () => {
    const p = plan("dataset=errors&measure=occurrences:sum&viz=toplist&g0=route");
    const html = rendu(p, {
      total: 10,
      samples: 4,
      groups: [
        { key: ["/a"], value: 6, samples: 3 },
        { key: [null], value: 4, samples: 1 },
      ],
    });
    expect(html).toContain('data-forme="toplist"');
    expect(html).not.toContain('data-testid="impact-table"');
    expect(texte(html)).toContain("60,0 % du total");
    expect(texte(html)).toContain("Inconnu");
    expect(html).toContain('href="/explorer?route=%2Fa&amp;run=1&amp;period=1h"');
    // Le total de toute la population est dans la méta (W-E8), pas dans un encadré séparé.
    expect(html).toMatch(/data-testid="explorer-total"[^>]*>10</);
  });

  it("mesure non additive → ImpactTable, référence « Ensemble » = total, verdict seulement au p75", () => {
    const p = plan("dataset=vitals&measure=value:p75&variant=LCP&viz=toplist&g0=route");
    const html = rendu(p, {
      total: 2400,
      samples: 500,
      groups: [
        { key: ["/lente"], value: 4200, samples: 12 },
        { key: ["/moyenne"], value: 3100, samples: 400 },
        { key: ["/sans"], value: null, samples: 3 },
      ],
    });
    expect(html).toContain('data-testid="impact-table"');
    expect(texte(html)).toContain("Ensemble de la population");
    expect(texte(html)).toContain("2,4 s");
    // P3 : l'échantillon faible (12) passe après la ligne à 400 mesures ; l'inconnu ferme la liste.
    const ordre = [...html.matchAll(/title="(\/[a-z]+)"/g)].map((m) => m[1]);
    expect(ordre).toEqual(["/moyenne", "/lente", "/sans"]);
    expect(texte(html)).toContain("vs ensemble");
    expect(texte(html)).toMatch(VERDICTS);
  });

  it("INP p95 par navigateur → aucune teinte ni libellé de verdict (R-V)", () => {
    const p = plan("dataset=vitals&measure=value:p95&variant=INP&viz=toplist&g0=browser");
    const html = rendu(p, {
      total: 300,
      samples: 500,
      groups: [
        { key: ["Chrome"], value: 600, samples: 300 },
        { key: ["Firefox"], value: 180, samples: 200 },
      ],
    });
    expect(html).toContain('data-testid="impact-table"');
    // La bascule « Impact » cite « Mauvais » dans sa raison d'indisponibilité : ce n'est pas un verdict.
    const sansBascule = texte(html).replace(/Impact — indisponible : [^»]*»/, "");
    expect(sansBascule).not.toMatch(VERDICTS);
    for (const classe of Object.values(RATING_CLASS)) expect(html).not.toContain(classe);
    expect(texte(html)).not.toContain("ms ms");
    expect(texte(html)).toContain("aucun verdict n'est donné pour le p95");
  });

  it("cmp=prev demandé sur un classement : non affiché, et la raison est écrite", () => {
    const p = plan("dataset=errors&measure=occurrences:sum&viz=toplist&g0=route");
    const html = rendu(p, { total: 6, samples: 3, groups: [{ key: ["/a"], value: 6, samples: 3 }] }, { precedent: null });
    expect(texte(html)).toContain("deux classements côte à côte trompent sur l'ordre");
  });

  it("aucun groupe → état vide, jamais un axe vide", () => {
    const html = rendu(plan("dataset=errors&measure=occurrences:sum&viz=toplist&g0=route"), { total: 0, samples: 0, groups: [] });
    expect(html).toContain('data-testid="etat-vide"');
  });
});

describe("ResultatAnalyse — Série (W-E5)", () => {
  const q = requete("app=demo&period=1h");
  const debut = Date.parse(q.range.from);
  const largeur = q.range.bucketSeconds * 1000;
  const seau = (i: number) => new Date(Math.floor(debut / largeur) * largeur + i * largeur).toISOString();

  it("p75 LCP → bandes (vital passé) ; moyenne → aucune bande (vital absent)", () => {
    const serie = [{ start: seau(0), end: seau(1), key: [], value: 2000, samples: 50 }];
    const p75 = rendu(plan("dataset=vitals&measure=value:p75&variant=LCP&viz=timeseries&limit=1"), {
      total: 2000,
      samples: 50,
      groups: [{ key: [], value: 2000, samples: 50 }],
      series: serie,
    });
    expect(attribut(p75, "data-vital")).toBe("LCP");
    const avg = rendu(plan("dataset=vitals&measure=value:avg&variant=LCP&viz=timeseries&limit=1"), {
      total: 2000,
      samples: 50,
      groups: [{ key: [], value: 2000, samples: 50 }],
      series: serie,
    });
    expect(avg).toContain('data-testid="temoin-threshold" data-vital="aucun"');
    expect(texte(avg)).toContain("aucun verdict n'est donné pour la moyenne");
  });

  it("un seau sans mesure reste null (trou), jamais 0", () => {
    const p = plan("dataset=vitals&measure=value:p75&variant=LCP&viz=timeseries&limit=1");
    const data: ExplorerData = {
      ...DATA,
      total: 2000,
      samples: 60,
      groups: [{ key: [], value: 2000, samples: 60 }],
      series: [
        { start: seau(0), end: seau(1), key: [], value: 1900, samples: 30 },
        { start: seau(1), end: seau(2), key: [], value: null, samples: 0 },
        { start: seau(2), end: seau(3), key: [], value: 2100, samples: 30 },
      ],
    };
    const { points } = pointsDeSerie(meta(p), data);
    const valeurs = points.map((pt) => pt.s0);
    expect(valeurs).toContain(null);
    expect(valeurs).not.toContain(0);
    // Le dessin reçoit ce null tel quel.
    const html = rendu(p, data);
    expect(attribut(html, "data-points")).toContain('"s0":null');
  });

  it("compte avec groupes → empilé (StackedBars) ; non additif avec groupes → lignes, jamais empilées", () => {
    const additive = rendu(plan("dataset=errors&measure=occurrences:sum&viz=timeseries&g0=route&limit=3"), {
      total: 5,
      samples: 5,
      groups: [
        { key: ["/a"], value: 3, samples: 3 },
        { key: ["/b"], value: 2, samples: 2 },
      ],
      series: [
        { start: seau(0), end: seau(1), key: ["/a"], value: 3, samples: 3 },
        { start: seau(0), end: seau(1), key: ["/b"], value: 2, samples: 2 },
      ],
    });
    expect(additive).toContain('data-testid="temoin-stacked"');
    const moyenne = rendu(plan("dataset=resources&measure=duration_ms:p75&viz=timeseries&g0=route&limit=3"), {
      total: 300,
      samples: 60,
      groups: [{ key: ["/a"], value: 300, samples: 60 }],
      series: [{ start: seau(0), end: seau(1), key: ["/a"], value: 300, samples: 60 }],
    });
    expect(moyenne).toContain('data-testid="temoin-threshold"');
    expect(moyenne).not.toContain("temoin-stacked");
  });

  it("cmp=prev sans groupe : série de référence alignée par rang de seau", () => {
    const p = plan("dataset=vitals&measure=value:p75&variant=LCP&viz=timeseries&limit=1");
    const m = meta(p);
    const precedentDebut = Math.floor((debut - (Date.parse(q.range.to) - debut)) / largeur) * largeur;
    const { points } = pointsDeSerie(m, { ...DATA, groups: [{ key: [], value: 1, samples: 1 }] }, [
      { start: new Date(precedentDebut).toISOString(), end: "", key: [], value: 1500, samples: 40 },
    ]);
    expect(points[0].ref).toBe(1500);
    expect(Date.parse(points[0].t)).toBe(Date.parse(seau(0)));
  });

  it("chaque série a son alternative textuelle (une ligne par seau)", () => {
    const html = rendu(plan("dataset=vitals&measure=value:p75&variant=LCP&viz=timeseries&limit=1"), {
      total: 2000,
      samples: 50,
      groups: [{ key: [], value: 2000, samples: 50 }],
      series: [{ start: seau(0), end: seau(1), key: [], value: 2000, samples: 50 }],
    });
    expect(html).toContain('data-testid="alternative"');
    expect(texte(html)).toContain("Seau (UTC)");
  });
});

describe("ResultatAnalyse — méta (W-E8)", () => {
  it("jamais vide dès qu'une ligne est lue ; « toutes les apps autorisées » sous app=all", () => {
    const p = plan("dataset=errors&measure=occurrences:sum&viz=value");
    const morceaux = metaResultat(p, meta(p, { effective_apps: null, rollup: { eligible: false, source: null, reason: "aucun agrégat ne porte cette mesure" } }), {
      ...DATA,
      total: 6,
      samples: 3,
    });
    expect(morceaux.length).toBeGreaterThan(0);
    expect(morceaux).toContain("toutes les apps autorisées");
    expect(morceaux).toContain("3 lignes de population");
    expect(morceaux).toContain("agrégat non utilisé : aucun agrégat ne porte cette mesure");
  });

  it("journal : l'ordre par date est écrit, la session est un lien", () => {
    const p = plan("dataset=errors&measure=occurrences:sum&viz=table&limit=25");
    const html = renderToStaticMarkup(
      <ResultatAnalyse
        plan={p}
        meta={meta(p)}
        data={{ ...DATA, total: 1, samples: 1, rows: [{ date: "2026-09-22T11:00:00Z", session: "sess-1", occurrences: 1 }] }}
        hrefs={{ ...HREFS, session: (id) => `/sessions/${id}` }}
        taille="page"
      />,
    );
    expect(texte(html)).toContain("aucun tri par mesure : le journal est ordonné par date");
    expect(html).toContain('href="/sessions/sess-1"');
  });
});
