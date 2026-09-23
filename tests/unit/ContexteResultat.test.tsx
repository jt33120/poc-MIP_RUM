// Contexte du résultat (F33, plan § 5.21.3 zone 8 — W-E2 « Volume du résultat » et
// W-E7 « Répartition par … »). Rendu SSR réel ; l'îlot recharts de la série est
// remplacé par un témoin qui expose les props reçues — c'est là que se vérifie la
// forme « barres » et l'ABSENCE de bande de seuil sur un volume.
//
// Ce que ces cas existent pour empêcher :
//   - qu'un volume non lu (budget dépassé) se dessine en barres à zéro, qu'on
//     lirait comme une absence de trafic ;
//   - qu'une panne de contexte se présente comme un simple « Partiel » (ou
//     l'inverse : qu'un budget dépassé propose « Réessayer » ce qui échouera pareil) ;
//   - qu'une dimension indisponible disparaisse, ou que sa raison ne vive que dans
//     un `title` que personne n'entend ;
//   - qu'un groupe sans valeur devienne autre chose qu'« Inconnu ».
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

vi.mock("@/components/charts/ThresholdSeries", () => ({
  ThresholdSeries: (p: { vital?: string; series: unknown; points: unknown; hauteur?: number; zoomHref?: string }) => (
    <div
      data-testid="temoin-threshold"
      data-vital={p.vital ?? "aucun"}
      data-series={JSON.stringify(p.series)}
      data-points={JSON.stringify(p.points)}
      data-hauteur={String(p.hauteur ?? "")}
      data-zoom={p.zoomHref ?? ""}
    />
  ),
}));

import { RepartitionResultat, VolumeResultat, type OngletRepartition } from "@/components/explorer/ContexteResultat";
import { parseExplorerPlan, type ExplorerPlan } from "@/lib/analytics-schema";
import { explorerSource, planDeRepartition, planDeVolume } from "@/lib/explorer-page-params";
import type { ExplorerData, ExplorerMeta, ExplorerResult } from "@/lib/queries-explorer";
import { bucketStarts, parseAnalyticsQuery, type AnalyticsQuery } from "@/lib/query-contract";

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

const QUERY = requete("app=demo&period=1h");

function meta(p: ExplorerPlan, surcharge: Partial<ExplorerMeta> = {}): ExplorerMeta {
  return {
    app: "demo",
    period: "1h",
    query_version: 1,
    effective_apps: ["demo"],
    range: { from: QUERY.range.from, to: QUERY.range.to, preset: "1h", bucket_seconds: QUERY.range.bucketSeconds },
    dataset: p.dataset,
    measure: p.measure.field,
    unit: "vues",
    aggregation: p.measure.aggregation,
    additive: true,
    counting: "vues commencées dans la fenêtre",
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
const resultat = (p: ExplorerPlan, data: Partial<ExplorerData>, m: Partial<ExplorerMeta> = {}): ExplorerResult => ({
  meta: meta(p, m),
  data: { ...DATA, ...data },
});

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

/** Les seaux attendus sur la fenêtre de test : la grille du contrat, pas une estimation. */
const SEAUX = bucketStarts(QUERY.range).length;

describe("F33 — W-E2 « Volume du résultat »", () => {
  const source = plan("dataset=views&measure=rows:count&viz=toplist&g0=route&limit=10");
  const p = planDeVolume(source)!;

  it("des barres, aucune bande de seuil, 120 px : un volume se situe, il ne se juge pas", () => {
    const html = renderToStaticMarkup(
      <VolumeResultat
        plan={p}
        unite="vues"
        lecture={{ etat: "ok", resultat: resultat(p, { total: 12, samples: 12, series: [{ start: QUERY.range.from, end: QUERY.range.to, key: [], value: 12, samples: 12 }] }) }}
        zoomHref="/explorer?from={from}&to={to}"
      />,
    );
    const series = JSON.parse(html.match(/data-series="([^"]*)"/)![1].replace(/&quot;/g, '"'));
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ forme: "barres", role: "principale", libelle: "vues", additive: true });
    expect(html).toContain('data-vital="aucun"');
    expect(html).toContain('data-hauteur="120"');
    expect(texte(html)).toContain("Volume du résultat");
  });

  it("l'alternative textuelle a une ligne par seau de la grille, un seau sans ligne valant 0", () => {
    const html = renderToStaticMarkup(
      <VolumeResultat
        plan={p}
        unite="vues"
        lecture={{ etat: "ok", resultat: resultat(p, { total: 3, samples: 3, series: [{ start: QUERY.range.from, end: QUERY.range.to, key: [], value: 3, samples: 3 }] }) }}
      />,
    );
    const corps = html.split("<tbody>")[1] ?? "";
    expect(corps.match(/<tr/g) ?? []).toHaveLength(SEAUX);
    // Un dénombrement : le seau sans ligne vaut réellement zéro, pas « — ».
    expect(corps).toContain(">0<");
  });

  it("budget dépassé : un bandeau « Partiel », aucune barre, et le résultat reste hors de cause", () => {
    const html = renderToStaticMarkup(<VolumeResultat plan={p} unite="vues" lecture={{ etat: "budget" }} />);
    expect(html).toContain('data-testid="etat-partiel"');
    expect(texte(html)).toContain("Volume non lu : budget de lecture dépassé");
    expect(texte(html)).toContain("Le résultat ci-dessus, lui, a été lu");
    expect(html).not.toContain('data-testid="temoin-threshold"');
    expect(html).not.toContain('data-testid="alternative"');
  });

  it("lecture en échec : « Lecture en échec » et son bouton, jamais un « Partiel »", () => {
    const html = renderToStaticMarkup(<VolumeResultat plan={p} unite="vues" lecture={{ etat: "echec" }} />);
    expect(html).toContain('data-testid="echec-lecture"');
    expect(texte(html)).toContain("La lecture de « Volume du résultat » a échoué");
    expect(html).not.toContain('data-testid="etat-partiel"');
  });

  it("population réellement vide : l'état « vide », pas une série de zéros", () => {
    const html = renderToStaticMarkup(
      <VolumeResultat plan={p} unite="vues" lecture={{ etat: "ok", resultat: resultat(p, { total: 0, samples: 0 }) }} />,
    );
    expect(html).toContain('data-testid="etat-vide"');
    expect(html).not.toContain('data-testid="temoin-threshold"');
  });
});

describe("F33 — W-E7 « Répartition par … »", () => {
  const source = plan("dataset=views&measure=rows:count&viz=value");
  const p = planDeRepartition(source, "browser")!;
  const ONGLETS: OngletRepartition[] = [
    { dimension: "browser", label: "Navigateur", courant: true, href: "/explorer?split=browser", raison: null },
    { dimension: "route", label: "Route", courant: false, href: null, raison: "les sessions ne portent pas de route" },
  ];
  const lienValeur = (valeur: string | null) =>
    valeur === null ? "/explorer?seg=v2:browser:is_null&run=1" : `/explorer?browser=${encodeURIComponent(valeur)}&run=1`;

  const rendu = (data: Partial<ExplorerData>, m: Partial<ExplorerMeta> = {}) =>
    renderToStaticMarkup(
      <RepartitionResultat
        plan={p}
        dimensionLabel="Navigateur"
        unite="vues"
        notice="Famille déduite de l'user-agent déjà collecté."
        onglets={ONGLETS}
        lecture={{ etat: "ok", resultat: resultat(p, data, m) }}
        lienValeur={lienValeur}
        limite={10}
      />,
    );

  it("une part par valeur, rapportée au total de TOUTE la population", () => {
    const html = rendu({
      total: 10,
      samples: 10,
      groups: [
        { key: ["Chrome"], value: 6, samples: 6 },
        { key: ["Firefox"], value: 4, samples: 4 },
      ],
    });
    expect(texte(html)).toContain("Répartition par navigateur");
    expect(texte(html)).toContain("60,0 % du total");
    expect(texte(html)).toContain("40,0 % du total");
    expect(html).toContain("/explorer?browser=Chrome&amp;run=1");
    expect(texte(html)).toContain("Chaque part est rapportée au total de toute la population (10 vues)");
  });

  it("le groupe sans valeur est « Inconnu », et son lien se compile en is_null", () => {
    const html = rendu({ total: 5, samples: 5, groups: [{ key: [null], value: 5, samples: 5 }] });
    expect(texte(html)).toContain("Inconnu");
    expect(html).toContain("seg=v2:browser:is_null");
  });

  it("une dimension indisponible reste visible, barrée, avec sa raison EN TOUTES LETTRES", () => {
    const html = rendu({ total: 1, samples: 1, groups: [{ key: ["Chrome"], value: 1, samples: 1 }] });
    expect(html).toContain('data-testid="repartition-tab-route"');
    expect(html).toMatch(/aria-disabled="true"[^>]*data-testid="repartition-tab-route"/);
    // La raison est un texte lisible, pas seulement un `title`.
    expect(html).toContain('data-testid="repartition-indisponibles"');
    expect(texte(html)).toContain("Route : les sessions ne portent pas de route");
    expect(html).toContain('id="repartition-raison-route"');
    expect(html).toContain('aria-describedby="repartition-raison-route"');
  });

  it("troncature : le nombre affiché est dit, et le total reste celui de la population", () => {
    const html = rendu({ total: 100, samples: 100, groups: [{ key: ["Chrome"], value: 60, samples: 60 }] }, { truncated_groups: true });
    expect(texte(html)).toContain("Seules les 10 valeurs les plus nombreuses sont affichées");
    expect(texte(html)).toContain("le total, lui, porte sur toute la population");
  });

  it("budget dépassé : le bandeau, et les onglets restent là pour en demander une autre", () => {
    const html = renderToStaticMarkup(
      <RepartitionResultat
        plan={p}
        dimensionLabel="Navigateur"
        unite="vues"
        notice="—"
        onglets={ONGLETS}
        lecture={{ etat: "budget" }}
        lienValeur={lienValeur}
        limite={10}
      />,
    );
    expect(texte(html)).toContain("Répartition non lue : budget de lecture dépassé");
    expect(html).toContain('data-testid="repartition-onglets"');
    expect(html).not.toContain('role="list"');
  });
});
