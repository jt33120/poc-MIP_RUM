// Écrans Erreurs P5.1 : liens et chiffres affichés, sans base ni rendu.
//
// Ce que ces fonctions protègent ne se voit pas à l'écran. Un lien sans `app`
// laisse la porte projet du middleware substituer l'app du cookie ; un lien de
// session émis sans vérification ouvrirait celle d'un autre tenant ; un compteur
// NULL affiché « 0 » dirait « personne n'est touché » d'une erreur backend dont on
// ne connaît personne ; et « autres » calculé sur la page ferait mentir la hauteur
// d'une colonne dès la deuxième page.
import { describe, expect, it } from "vitest";
import {
  errorGroupHref,
  errorSearchParams,
  errorsHref,
  errorVolumeChart,
  fmtCount,
  fmtCoverage,
  occurrenceHrefs,
} from "../../apps/console/components/errors/error-view";
import type { ErrorFilters, ErrorGroupRow, ErrorOccurrenceRow } from "../../apps/console/lib/queries-errors";

const filtres = (over: Partial<ErrorFilters> = {}): ErrorFilters => ({
  app: "p51-app-a",
  period: "24h",
  device: "desktop",
  segment: [],
  includeBots: false,
  includeInternal: false,
  ...over,
});

const T1 = "1".repeat(32);
const P1 = "aaaaaaaaaaaaaaa1";
const TS = new Date("2026-09-16T10:00:00.123Z");

const occurrence = (over: Partial<ErrorOccurrenceRow> = {}): ErrorOccurrenceRow => ({
  id: 1, ts: TS, route: "/pay", session_id: "p51-a-desktop", kind: "error", message: "boom", device_type: "desktop",
  occurrences: 37, release: "1.4.2", error_source: "browser_js", handled: false, is_fatal: null, view_name: null,
  env: null, service: null, trace_id: T1, source_parent_span_id: P1,
  links: { session: true, replay: true, trace: true, parent_span: true, action: null },
  ...over,
});

const groupe = (fingerprint: string, series: number[]): ErrorGroupRow => ({
  app_id: "p51-app-a", fingerprint, error_type: `Type${fingerprint}`, sample_message: null,
  occurrences: series.reduce((s, v) => s + v, 0), sessions: 0, users_affected: 0, sessions_affected: null,
  visitors_affected: null, identified_users_affected: null, session_coverage: 0, identity_coverage: 0,
  first_seen: TS, last_seen: TS, status: "open", resolved_at: null, regressed: false, series,
});

const params = (href: string) => new URL(href, "http://console.local").searchParams;

describe("paramètres d'URL des écrans Erreurs", () => {
  it("retient la première valeur d'un paramètre répété, comme la porte projet du middleware", () => {
    const url = errorSearchParams({ app: ["p51-app-a", "p51-app-b"], period: "7d", cursor: undefined });
    expect(url.get("app")).toBe("p51-app-a");
    expect(url.get("period")).toBe("7d");
    expect(url.has("cursor")).toBe(false);
  });

  it("garde période, appareil, segment (format v2), bots et apps internes — et une app TOUJOURS explicite", () => {
    const f = filtres({
      app: null,
      period: "7d",
      device: "tablet",
      segment: [{ dim: "geo", op: "==", value: "FR" }],
      includeBots: true,
      includeInternal: true,
    });
    const p = params(errorsHref("/errors", f, f.app));
    // Sans app, le middleware substituerait l'app du cookie projet.
    expect(p.get("app")).toBe("all");
    expect(Object.fromEntries(p)).toEqual({
      app: "all", period: "7d", device: "tablet", seg: "v2:country:eq:FR", bots: "1", internal: "1",
    });
  });

  it("ne propage ni curseur ni limite, sauf ajout explicite ; la période par défaut n'est pas écrite", () => {
    const p = params(errorsHref("/errors", filtres({ device: null }), "p51-app-a"));
    expect(Object.fromEntries(p)).toEqual({ app: "p51-app-a" });
    expect(params(errorsHref("/errors", filtres(), "p51-app-a", { offset: "100" })).get("offset")).toBe("100");
  });

  it("le détail d'un groupe vise SON app, empreinte encodée", () => {
    const href = errorGroupHref({ app_id: "p51-app-b", fingerprint: "fp/1 ?" }, filtres());
    expect(href.startsWith("/errors/fp%2F1%20%3F?")).toBe(true);
    expect(params(href).get("app")).toBe("p51-app-b");
  });
});

describe("liens d'une occurrence", () => {
  it("session, replay positionné à l'instant de l'erreur et trace avec son span parent, dans l'app", () => {
    expect(occurrenceHrefs("p51-app-a", occurrence())).toEqual({
      session: "/sessions/p51-a-desktop?app=p51-app-a",
      replay: `/sessions/p51-a-desktop?app=p51-app-a&tab=replay&at=${TS.getTime()}`,
      trace: `/tracing/${T1}?app=p51-app-a&span=${P1}`,
    });
  });

  it("aucun lien vers une relation absente de l'app, même si l'identifiant est émis", () => {
    // r10 : la session citée appartient à un autre tenant.
    const croisee = occurrence({
      session_id: "p51-b-desktop",
      links: { session: false, replay: false, trace: false, parent_span: false, action: null },
    });
    expect(occurrenceHrefs("p51-app-a", croisee)).toEqual({ session: null, replay: null, trace: null });
  });

  it("une trace présente sans son span parent n'annonce pas de span", () => {
    const hrefs = occurrenceHrefs("p51-app-a", occurrence({
      links: { session: true, replay: false, trace: true, parent_span: false, action: null },
    }));
    expect(hrefs.replay).toBeNull();
    expect(hrefs.trace).toBe(`/tracing/${T1}?app=p51-app-a`);
  });

  it("encode les identifiants émis par le client", () => {
    const hrefs = occurrenceHrefs("app a&b", occurrence({ session_id: "s/1?x" }));
    expect(hrefs.session).toBe("/sessions/s%2F1%3Fx?app=app%20a%26b");
  });
});

describe("chiffres affichés", () => {
  it("NULL se lit « Inconnu », jamais zéro ; un vrai zéro reste 0", () => {
    expect(fmtCount(null)).toBe("Inconnu");
    expect(fmtCount(0)).toBe("0");
    expect(fmtCoverage(null)).toBe("Inconnue");
    expect(fmtCoverage(0)).toBe("0 %");
    expect(fmtCoverage(1)).toBe("100 %");
    expect(fmtCoverage(45 / 47)).toBe("95,7 %");
  });
});

describe("volume empilé par groupe", () => {
  const trend = [0, 1, 2].map((i) => ({ bucket: new Date(TS.getTime() + i * 3_600_000), occurrences: [10, 7, 0][i] }));

  it("« autres » = population moins les cinq groupes dessinés, jamais négatif", () => {
    const groups = ["a", "b", "c", "d", "e", "f"].map((fp) => groupe(fp, [1, 1, 0]));
    const { data, series } = errorVolumeChart(groups, trend, "24h");
    expect(data).toHaveLength(trend.length);
    expect(series.map((s) => s.key)).toEqual(["g0", "g1", "g2", "g3", "g4", "autres"]);
    expect(data.map((row) => row.autres)).toEqual([5, 2, 0]);
    // La hauteur d'une colonne est celle de la tendance.
    for (const [i, row] of data.entries()) {
      const colonne = series.reduce((s, se) => s + Number(row[se.key]), 0);
      expect(colonne).toBe(trend[i].occurrences);
    }
  });

  it("pas de couche « autres » quand les groupes dessinés couvrent toute la population", () => {
    const { data, series } = errorVolumeChart([groupe("a", [10, 7, 0])], trend, "24h");
    expect(series.map((s) => s.key)).toEqual(["g0"]);
    expect(data.map((row) => row.autres)).toEqual([0, 0, 0]);
  });

  it("borne à zéro une série qui dépasserait la tendance", () => {
    const { data } = errorVolumeChart([groupe("a", [12, 7, 0])], trend, "24h");
    expect(data[0].autres).toBe(0);
  });
});
