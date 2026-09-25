// Contrat commun des filtres (P6.2) — logique pure : périmètre signé, plage UTC et
// changement d'heure, bornes, segments v1/v2, intersections de widget, empreinte
// de cache et reprise des segments enregistrés.
import { describe, expect, it } from "vitest";
import {
  CONTRACT_PARAMS,
  MAX_CONDITIONS,
  MAX_POINTS,
  RANGE_MAX_MS,
  authorizedAppsOf,
  authorizedScope,
  bucketLabel,
  bucketSecondsFor,
  bucketStarts,
  conditionsOf,
  contextSearchParams,
  contractErrorStatus,
  hrefWithQuery,
  intersectApp,
  intersectQuery,
  localInputToUtc,
  migrateSavedSegments,
  parseAnalyticsQuery,
  parseFilterParams,
  parseSegmentParam,
  parseUtcInstant,
  previousRange,
  queryFingerprint,
  queryToSearchParams,
  rangeLabel,
  relativeChange,
  requestedAppOf,
  resolveRange,
  resolveScope,
  resourceScope,
  serializeSegments,
  utcToLocalInput,
  type AnalyticsQuery,
  type ContractError,
  type FilterCondition,
  type Parsed,
  type ScopePrincipal,
} from "../../apps/console/lib/query-contract";

const NOW = Date.parse("2026-09-17T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PARIS = "Europe/Paris";
const ADMIN: ScopePrincipal = { role: "admin", apps: null };

function ok<T>(parsed: Parsed<T>): T {
  if (!parsed.ok) throw new Error(`refus inattendu : ${parsed.error.code} — ${parsed.error.message}`);
  return parsed.value;
}
function ko<T>(parsed: Parsed<T>): ContractError {
  if (parsed.ok) throw new Error("acceptation inattendue");
  return parsed.error;
}
const requete = (qs: string, principal: ScopePrincipal | null = ADMIN, nowMs = NOW): Parsed<AnalyticsQuery> =>
  parseAnalyticsQuery(new URLSearchParams(qs), { principal, nowMs });

// ══════════════════════════════ Périmètre ════════════════════════════════════

describe("périmètre signé", () => {
  it("anonyme ou liste vide : AUCUNE app ; liste absente : toutes ; un admin d'une liste, sa liste (C9)", () => {
    expect(authorizedAppsOf(null)).toEqual([]);
    expect(authorizedAppsOf({ role: "viewer", apps: [] })).toEqual([]);
    expect(authorizedAppsOf({ role: "viewer", apps: null })).toBeNull();
    expect(authorizedAppsOf({ role: "admin", apps: null })).toBeNull();
    // C9 : le rôle ne donne plus toutes les apps — un admin d'une liste lit ce qu'il administre.
    expect(authorizedAppsOf({ role: "admin", apps: ["b", "a"] })).toEqual(["a", "b"]);
    expect(authorizedAppsOf({ role: "viewer", apps: ["b", "a", "b"] })).toEqual(["a", "b"]);
  });

  it("une liste vide est refusée (403) quelle que soit l'app demandée — jamais « sans restriction »", () => {
    for (const requested of [null, "a"]) {
      const error = ko(resolveScope({ role: "viewer", apps: [] }, requested));
      expect(error.code).toBe("no_app_access");
      expect(contractErrorStatus(error)).toBe(403);
    }
    expect(ko(resolveScope(null, null)).code).toBe("no_app_access");
  });

  it("app hors périmètre refusée, jamais rabattue sur la première app autorisée", () => {
    const error = ko(resolveScope({ role: "viewer", apps: ["a", "b"] }, "c"));
    expect(error).toMatchObject({ code: "forbidden_app", parameter: "app" });
    expect(contractErrorStatus(error)).toBe(403);
  });

  it("« toutes » = toutes les apps AUTORISÉES ; une app nommée resserre le périmètre effectif", () => {
    expect(ok(resolveScope({ role: "viewer", apps: ["b", "a"] }, null))).toEqual({
      requestedApp: null,
      authorizedApps: ["a", "b"],
      effectiveApps: ["a", "b"],
    });
    expect(ok(resolveScope({ role: "viewer", apps: ["b", "a"] }, "b")).effectiveApps).toEqual(["b"]);
    expect(ok(resolveScope(ADMIN, null)).effectiveApps).toBeNull();
    expect(ok(resolveScope(ADMIN, "z")).effectiveApps).toEqual(["z"]);
  });

  it("app absente, vide ou « all » = pas d'app demandée ; caractère de contrôle refusé", () => {
    for (const raw of [null, undefined, "", "  ", "all"]) expect(requestedAppOf(raw)).toBeNull();
    expect(requestedAppOf(" a ")).toBe("a");
    expect(ko(resolveScope(ADMIN, "a\u0000b")).code).toBe("invalid_filter");
    expect(ko(resolveScope(ADMIN, "x".repeat(201))).code).toBe("invalid_filter");
  });
});

// ═══════════════════════════════ Plages ══════════════════════════════════════

describe("plage [from,to) UTC résolue une fois", () => {
  it("instants ISO UTC explicites seulement, dates réelles", () => {
    expect(parseUtcInstant("2026-09-17T10:00:00Z")).toBe(Date.parse("2026-09-17T10:00:00Z"));
    expect(parseUtcInstant("2026-09-17T10:00:00.123Z")).toBe(Date.parse("2026-09-17T10:00:00.123Z"));
    expect(parseUtcInstant("2026-09-17T10:00Z")).toBe(Date.parse("2026-09-17T10:00:00Z"));
    for (const raw of ["2026-09-17T10:00:00", "2026-09-17T10:00:00+02:00", "2026-02-30T10:00:00Z", "2026-09-17T24:00:00Z", "demain"]) {
      expect(parseUtcInstant(raw), raw).toBeNull();
    }
  });

  it("presets : to = instant serveur, from = to − durée, défaut documenté 24 h", () => {
    expect(ok(resolveRange({}, NOW))).toEqual({
      from: "2026-09-16T12:00:00.000Z",
      to: "2026-09-17T12:00:00.000Z",
      preset: "24h",
      bucketSeconds: 3600,
    });
    expect(ok(resolveRange({ period: "7j" }, NOW))).toMatchObject({ preset: "7d", bucketSeconds: 21_600 });
    expect(ok(resolveRange({ period: "1h" }, NOW))).toMatchObject({ preset: "1h", bucketSeconds: 300, from: "2026-09-17T11:00:00.000Z" });
    // Ancienne URL : période inconnue = 24 h, comme avant P6.2.
    expect(ok(resolveRange({ period: "30d" }, NOW)).preset).toBe("24h");
  });

  it("plage personnalisée : bornes UTC normalisées, seau dérivé de la durée", () => {
    expect(ok(resolveRange({ from: "2026-09-17T10:00:00Z", to: "2026-09-17T11:00:00Z" }, NOW))).toEqual({
      from: "2026-09-17T10:00:00.000Z",
      to: "2026-09-17T11:00:00.000Z",
      preset: null,
      bucketSeconds: 300,
    });
    expect(ok(resolveRange({ from: "2026-08-18T12:00:00Z", to: "2026-09-17T12:00:00Z" }, NOW)).bucketSeconds).toBe(86_400);
  });

  it("refus typés : conflit preset + plage, borne manquante, ordre, futur, plus de 30 jours", () => {
    expect(ko(resolveRange({ period: "24h", from: "2026-09-17T10:00:00Z", to: "2026-09-17T11:00:00Z" }, NOW)).code).toBe("range_conflict");
    expect(ko(resolveRange({ from: "2026-09-17T10:00:00Z" }, NOW))).toMatchObject({ code: "invalid_range", parameter: "to" });
    expect(ko(resolveRange({ to: "2026-09-17T10:00:00Z" }, NOW))).toMatchObject({ code: "invalid_range", parameter: "from" });
    expect(ko(resolveRange({ from: "2026-09-17T11:00:00Z", to: "2026-09-17T11:00:00Z" }, NOW)).code).toBe("invalid_range");
    expect(ko(resolveRange({ from: "2026-09-17T12:00:00Z", to: "2026-09-17T11:00:00Z" }, NOW)).code).toBe("invalid_range");
    expect(ko(resolveRange({ from: "hier", to: "2026-09-17T11:00:00Z" }, NOW))).toMatchObject({ code: "invalid_range", parameter: "from" });
    // `to` égal à l'instant serveur : accepté ; une milliseconde plus tard : refusé.
    expect(resolveRange({ from: "2026-09-17T11:00:00Z", to: "2026-09-17T12:00:00.000Z" }, NOW).ok).toBe(true);
    expect(ko(resolveRange({ from: "2026-09-17T11:00:00Z", to: "2026-09-17T12:00:00.001Z" }, NOW))).toMatchObject({
      code: "range_in_future",
      parameter: "to",
    });
    // 30 jours exactement : accepté ; au-delà : refusé.
    const to = "2026-09-17T12:00:00.000Z";
    expect(resolveRange({ from: new Date(NOW - RANGE_MAX_MS).toISOString(), to }, NOW).ok).toBe(true);
    expect(ko(resolveRange({ from: new Date(NOW - RANGE_MAX_MS - 1).toISOString(), to }, NOW)).code).toBe("range_too_long");
    for (const code of ["range_conflict", "invalid_range", "range_in_future", "range_too_long"] as const) {
      expect(contractErrorStatus({ code, message: "" })).toBe(400);
    }
  });

  it("seaux : ≤ 1 h → 5 min, ≤ 24 h → 1 h, ≤ 7 j → 6 h, au-delà → 24 h", () => {
    expect(bucketSecondsFor(HOUR)).toBe(300);
    expect(bucketSecondsFor(HOUR + 1)).toBe(3600);
    expect(bucketSecondsFor(DAY)).toBe(3600);
    expect(bucketSecondsFor(7 * DAY)).toBe(21_600);
    expect(bucketSecondsFor(7 * DAY + 1)).toBe(86_400);
    expect([300, 3600, 21_600, 86_400].map(bucketLabel)).toEqual(["5 min", "1 h", "6 h", "1 j"]);
  });

  it("seaux alignés UTC couvrant [from,to), bords partiels compris, au plus 300 points", () => {
    const glissante = ok(resolveRange({ period: "1h" }, Date.parse("2026-09-17T12:02:30Z")));
    const starts = bucketStarts(glissante);
    // 11:02:30 → 12:02:30 : 11:00 (partiel) … 12:00 (partiel) = 13 seaux.
    expect(starts).toHaveLength(13);
    expect(new Date(starts[0]).toISOString()).toBe("2026-09-17T11:00:00.000Z");
    expect(new Date(starts.at(-1)!).toISOString()).toBe("2026-09-17T12:00:00.000Z");
    for (const start of starts) expect(start % (300 * 1000)).toBe(0);
    // `to` exclu : une fenêtre qui finit pile sur un seau ne l'ouvre pas.
    expect(bucketStarts({ from: "2026-09-17T11:00:00.000Z", to: "2026-09-17T12:00:00.000Z", bucketSeconds: 300 })).toHaveLength(12);
    for (const period of ["1h", "24h", "7d"]) {
      expect(bucketStarts(ok(resolveRange({ period }, NOW))).length).toBeLessThanOrEqual(MAX_POINTS + 1);
    }
    const trente = ok(resolveRange({ from: new Date(NOW - RANGE_MAX_MS).toISOString(), to: new Date(NOW).toISOString() }, NOW));
    expect(bucketStarts(trente).length).toBeLessThanOrEqual(MAX_POINTS);
  });

  it("période précédente contiguë de même durée ; dénominateur nul → variation null", () => {
    const range = ok(resolveRange({ from: "2026-09-17T10:00:00Z", to: "2026-09-17T11:30:00Z" }, NOW));
    expect(previousRange(range)).toMatchObject({ from: "2026-09-17T08:30:00.000Z", to: "2026-09-17T10:00:00.000Z" });
    expect(relativeChange(15, 10)).toBe(0.5);
    expect(relativeChange(3, 0)).toBeNull();
    expect(relativeChange(null, 4)).toBeNull();
    expect(relativeChange(4, null)).toBeNull();
  });
});

describe("heure locale de l'app ↔ instants UTC (Europe/Paris, changements d'heure)", () => {
  it("heure d'hiver et d'été ordinaires", () => {
    expect(localInputToUtc("2026-01-15T10:00", PARIS)).toBe("2026-01-15T09:00:00.000Z");
    expect(localInputToUtc("2026-07-15T10:00", PARIS)).toBe("2026-07-15T08:00:00.000Z");
    expect(utcToLocalInput("2026-07-15T08:00:00.000Z", PARIS)).toBe("2026-07-15T10:00");
  });

  it("printemps (29/03/2026) : 02:30 n'existe pas et est refusée, jamais décalée en silence", () => {
    expect(localInputToUtc("2026-03-29T01:30", PARIS)).toBe("2026-03-29T00:30:00.000Z");
    expect(localInputToUtc("2026-03-29T02:30", PARIS)).toBeNull();
    expect(localInputToUtc("2026-03-29T03:30", PARIS)).toBe("2026-03-29T01:30:00.000Z");
  });

  it("automne (25/10/2026) : 02:30 ambiguë = première occurrence (heure d'été)", () => {
    expect(localInputToUtc("2026-10-25T02:30", PARIS)).toBe("2026-10-25T00:30:00.000Z");
    expect(localInputToUtc("2026-10-25T03:30", PARIS)).toBe("2026-10-25T02:30:00.000Z");
    // La seconde occurrence reste lisible dans l'autre sens.
    expect(utcToLocalInput("2026-10-25T01:30:00.000Z", PARIS)).toBe("2026-10-25T02:30");
  });

  it("la journée locale du recul d'heure dure 25 h en UTC, et reste une plage valide", () => {
    const from = localInputToUtc("2026-10-25T00:00", PARIS)!;
    const to = localInputToUtc("2026-10-26T00:00", PARIS)!;
    expect([from, to]).toEqual(["2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"]);
    const range = ok(resolveRange({ from, to }, Date.parse("2026-11-01T00:00:00Z")));
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(25 * HOUR);
    expect(range.bucketSeconds).toBe(21_600);
    expect(rangeLabel(range, PARIS)).toMatch(/^du 25\/10,? 00:00 au 26\/10,? 00:00$/);
    expect(rangeLabel(ok(resolveRange({ period: "7d" }, NOW)), PARIS)).toBe("7 j");
  });

  it("saisies illisibles refusées", () => {
    for (const raw of ["2026-02-30T10:00", "2026-03-29 02:30", "2026-03-29T2:30", ""]) {
      expect(localInputToUtc(raw, PARIS), raw).toBeNull();
    }
  });
});

// ═══════════════════════════════ Filtres ═════════════════════════════════════

describe("segments d'URL v1 et v2", () => {
  it("v1 repris tel quel (geo → country), égalité et différence", () => {
    expect(ok(parseSegmentParam("geo==FR;device!=mobile;source==extension;client==mip"))).toEqual([
      { dimension: "country", operator: "eq", value: "FR" },
      { dimension: "device", operator: "neq", value: "mobile" },
      { dimension: "source", operator: "eq", value: "extension" },
      { dimension: "client", operator: "eq", value: "mip" },
    ]);
    expect(ok(parseSegmentParam(""))).toEqual([]);
    expect(ok(parseSegmentParam(null))).toEqual([]);
  });

  it("v1 : un jeton inconnu ou mal formé est REFUSÉ, plus ignoré", () => {
    for (const raw of ["evil==1;geo==FR", "geo~FR", "geo==", "GEO==FR"]) {
      expect(ko(parseSegmentParam(raw)), raw).toMatchObject({ code: "invalid_filter", parameter: "seg" });
    }
  });

  it("v2 : aller-retour exact, valeurs encodées (séparateurs, unicode)", () => {
    const conditions: FilterCondition[] = [
      { dimension: "release", operator: "eq", value: "4.8.0;beta:2 é" },
      { dimension: "route", operator: "neq", value: "/a/:id" },
      { dimension: "browser", operator: "is_null", value: null },
    ];
    const raw = serializeSegments(conditions);
    expect(raw.startsWith("v2:")).toBe(true);
    expect(raw).toContain("browser:is_null");
    expect(ok(parseSegmentParam(raw))).toEqual(conditions);
    expect(serializeSegments([])).toBe("");
  });

  it("v2 : dimension inconnue, opérateur, encodage, appareil et bornes refusés", () => {
    expect(ko(parseSegmentParam("v2:ville:eq:Paris"))).toMatchObject({ code: "unsupported_dimension", dimension: "ville" });
    expect(ko(parseSegmentParam(`v2:${"x".repeat(150)}:eq:1`)).dimension).toHaveLength(100);
    expect(ko(parseSegmentParam("v2:route:like:%2Fa")).code).toBe("invalid_filter");
    expect(ko(parseSegmentParam("v2:route:eq:%E0%A4%A")).code).toBe("invalid_filter");
    expect(ko(parseSegmentParam("v2:browser:is_null:Firefox")).code).toBe("invalid_filter");
    expect(ko(parseSegmentParam("v2:device:eq:phablet")).code).toBe("invalid_filter");
    expect(ok(parseSegmentParam("v2:device:eq:tablet"))).toEqual([{ dimension: "device", operator: "eq", value: "tablet" }]);
    expect(ok(parseSegmentParam(`v2:route:eq:${"a".repeat(500)}`))).toHaveLength(1);
    expect(ko(parseSegmentParam(`v2:route:eq:${"a".repeat(501)}`)).code).toBe("invalid_filter");
    expect(ko(parseSegmentParam("v2:route:eq:%00")).code).toBe("invalid_filter");
    expect(ko(parseSegmentParam("v2:route:eq:")).code).toBe("invalid_filter");
  });
});

describe("paramètres de filtres", () => {
  const lire = (qs: string) => parseFilterParams(new URLSearchParams(qs));

  it("paramètre du contrat répété : ambigu, refusé plutôt que choisi", () => {
    for (const name of CONTRACT_PARAMS) {
      expect(ko(lire(`${name}=a&${name}=b`)), name).toMatchObject({ code: "ambiguous_parameter", parameter: name });
    }
  });

  it("appareil connu (tablette comprise), sinon tous ; drapeaux bots et apps internes", () => {
    expect(ok(lire("device=tablet")).device).toBe("tablet");
    expect(ok(lire("device=TABLET")).device).toBe("tablet");
    expect(ok(lire("device=all")).device).toBeUndefined();
    expect(ok(lire("device=phablet")).device).toBeUndefined();
    expect(ok(lire("bots=1&internal=1"))).toMatchObject({ includeBots: true, includeInternal: true });
    expect(ok(lire("bots=true&internal=0"))).toMatchObject({ includeBots: false, includeInternal: false });
  });

  it("dimensions dédiées bornées à 500 caractères sans contrôle", () => {
    expect(ok(lire(`browser=${"F".repeat(500)}`)).browser).toHaveLength(500);
    expect(ko(lire(`browser=${"F".repeat(501)}`))).toMatchObject({ code: "invalid_filter", dimension: "browser" });
    expect(ko(lire("route=%2Fa%0A")).code).toBe("invalid_filter");
    expect(ok(lire("browser=")).browser).toBeUndefined();
  });

  it("au plus 10 conditions ET, toutes sources confondues, dans un ordre stable", () => {
    const dix = "device=mobile&browser=a&os=b&env=c&service=d&release=e&route=f&country=g&seg=v2:source:eq:sdk;client:is_null";
    const filters = ok(lire(dix));
    expect(conditionsOf(filters).map((c) => c.dimension)).toEqual([
      "device", "browser", "os", "env", "service", "release", "route", "country", "source", "client",
    ]);
    expect(conditionsOf(filters)).toHaveLength(MAX_CONDITIONS);
    expect(ko(lire(`${dix};route:neq:x`)).code).toBe("too_many_conditions");
  });
});

// ═══════════════════════════ Requête et intersections ═════════════════════════

describe("intersections (widgets, drill-downs, ressources)", () => {
  const viewer: ScopePrincipal = { role: "viewer", apps: ["a", "b"] };

  it("intersectApp resserre sans jamais élargir : hors périmètre effectif = zéro ligne", () => {
    const toutes = ok(requete("", viewer));
    expect(intersectApp(toutes, "a").scope.effectiveApps).toEqual(["a"]);
    expect(intersectApp(toutes, "c").scope.effectiveApps).toEqual([]);
    const surA = ok(requete("app=a", viewer));
    expect(intersectApp(surA, "b").scope.effectiveApps).toEqual([]);
    expect(intersectApp(ok(requete("")), "z").scope.effectiveApps).toEqual(["z"]);
  });

  it("resourceScope suit l'app d'une ressource AUTORISÉE, même si l'URL en nommait une autre", () => {
    const surA = ok(requete("app=a", viewer));
    expect(resourceScope(surA, "b").scope).toEqual({ requestedApp: "b", authorizedApps: ["a", "b"], effectiveApps: ["b"] });
    expect(resourceScope(surA, "c").scope.effectiveApps).toEqual([]);
    expect(authorizedScope(surA).scope).toEqual({ requestedApp: null, authorizedApps: ["a", "b"], effectiveApps: ["a", "b"] });
  });

  it("filtre local ET global, jamais un remplacement : app B sur un écran A rend vide", () => {
    const globale = ok(requete("app=a&device=mobile&seg=geo==FR", viewer));
    const widget = intersectQuery(globale, { app: "b", conditions: [{ dimension: "route", operator: "eq", value: "/pay" }] });
    expect(widget.scope.effectiveApps).toEqual([]);
    expect(widget.filters.device).toBe("mobile");
    expect(widget.filters.segments).toEqual([
      { dimension: "country", operator: "eq", value: "FR" },
      { dimension: "route", operator: "eq", value: "/pay" },
    ]);
    // Même dimension des deux côtés : les deux conditions restent (ET).
    const meme = intersectQuery(globale, { conditions: [{ dimension: "country", operator: "eq", value: "DE" }] });
    expect(conditionsOf(meme.filters).filter((c) => c.dimension === "country")).toHaveLength(2);
  });
});

describe("sérialisation, liens et empreinte", () => {
  it("URL canonique : défauts omis, plage personnalisée explicite, segment v2", () => {
    expect(queryToSearchParams(ok(requete(""))).toString()).toBe("");
    expect(queryToSearchParams(ok(requete("app=a&period=7j&device=tablet&browser=Firefox&seg=geo==FR&bots=1&internal=1"))).toString())
      .toBe("app=a&period=7d&device=tablet&browser=Firefox&seg=v2%3Acountry%3Aeq%3AFR&bots=1&internal=1");
    const custom = ok(requete("from=2026-09-17T10:00:00Z&to=2026-09-17T11:00:00Z"));
    expect(Object.fromEntries(queryToSearchParams(custom))).toEqual({
      from: "2026-09-17T10:00:00.000Z",
      to: "2026-09-17T11:00:00.000Z",
    });
  });

  it("aller-retour : relire l'URL canonique rend la même requête", () => {
    for (const qs of [
      "app=a&period=1h&device=mobile&os=iOS&seg=v2:browser:is_null",
      "from=2026-09-10T00:00:00Z&to=2026-09-17T00:00:00Z&release=4.8.0&internal=1",
    ]) {
      const query = ok(requete(qs));
      expect(ok(requete(queryToSearchParams(query).toString()))).toEqual(query);
    }
  });

  it("drill-down : filtres courants conservés, paramètres propres à la cible ajoutés ou retirés", () => {
    const query = ok(requete("app=a&period=7d&device=tablet"));
    expect(hrefWithQuery("/sessions/s1", query, { tab: "replay", period: null })).toBe("/sessions/s1?app=a&device=tablet&tab=replay");
    expect(hrefWithQuery("/pages", ok(requete("")))).toBe("/pages");
  });

  it("navigation : seul le contexte global suit, jamais curseur, pagination ni recherche", () => {
    const sp = new URLSearchParams("app=a&period=7d&cursor=x&offset=20&name=checkout&browser=Firefox&seg=v2:os:eq:iOS&status=open");
    expect(contextSearchParams(sp).toString()).toBe("app=a&period=7d&seg=v2%3Aos%3Aeq%3AiOS&browser=Firefox");
  });

  it("empreinte : stable à l'ordre des conditions, distincte par périmètre, plage et drapeaux", () => {
    const base = ok(requete("app=a&seg=v2:route:eq:%2Fa;os:eq:iOS", { role: "viewer", apps: ["a"] }));
    const inverse = ok(requete("app=a&seg=v2:os:eq:iOS;route:eq:%2Fa", { role: "viewer", apps: ["a"] }));
    expect(queryFingerprint(inverse)).toBe(queryFingerprint(base));
    expect(queryFingerprint(base)).toMatch(/^[0-9a-f]{8}$/);
    // Même app demandée, autre principal : la réponse A ne sert jamais B.
    const autrePrincipal = ok(requete("app=a&seg=v2:route:eq:%2Fa;os:eq:iOS", { role: "viewer", apps: ["a", "b"] }));
    expect(queryFingerprint(autrePrincipal)).not.toBe(queryFingerprint(base));
    const plusTard = ok(requete("app=a&seg=v2:route:eq:%2Fa;os:eq:iOS", { role: "viewer", apps: ["a"] }, NOW + 1));
    expect(queryFingerprint(plusTard)).not.toBe(queryFingerprint(base));
    const bots = ok(requete("app=a&bots=1&seg=v2:route:eq:%2Fa;os:eq:iOS", { role: "viewer", apps: ["a"] }));
    expect(queryFingerprint(bots)).not.toBe(queryFingerprint(base));
    expect(queryFingerprint(ok(requete("app=b")))).not.toBe(queryFingerprint(ok(requete("app=a"))));
  });

  it("URL hostiles : refus typés, jamais un filtre ignoré", () => {
    expect(ko(requete("seg=v2:route:eq:%2F';drop table rum_error;--:x")).code).toBe("unsupported_dimension");
    expect(ko(requete("seg=v2:app_id:eq:b")).code).toBe("unsupported_dimension");
    expect(ok(requete("route=%2Fa%27%20or%20%271%27%3D%271")).filters.route).toBe("/a' or '1'='1");
    expect(ko(requete("app=b", { role: "viewer", apps: ["a"] })).code).toBe("forbidden_app");
  });
});

// ═════════════════════════ Segments enregistrés (navigateur) ═════════════════

describe("reprise versionnée des segments enregistrés", () => {
  it("v1 seule : convertie au format v2 canonique, entrées illisibles écartées ET comptées", () => {
    const v1 = JSON.stringify([
      { name: "France mobile", seg: "geo==FR;device==mobile" },
      { name: "Cassé", seg: "evil==1" },
      { name: "", seg: "geo==DE" },
      { name: "Sans segment", seg: "" },
      "pas un objet",
    ]);
    const { store, dropped } = migrateSavedSegments(null, v1);
    expect(store).toEqual({
      version: 2,
      items: [{ name: "France mobile", seg: "v2:country:eq:FR;device:eq:mobile" }],
    });
    expect(dropped).toBe(4);
  });

  it("le magasin v2 fait foi dès qu'il existe : un segment supprimé ne ressuscite pas depuis la v1", () => {
    const v1 = JSON.stringify([{ name: "Ancien", seg: "geo==FR" }]);
    const v2 = JSON.stringify({ version: 2, items: [{ name: "Récent", seg: "v2:os:eq:iOS" }] });
    expect(migrateSavedSegments(v2, v1)).toEqual({ store: { version: 2, items: [{ name: "Récent", seg: "v2:os:eq:iOS" }] }, dropped: 0 });
    expect(migrateSavedSegments(JSON.stringify({ version: 2, items: [] }), v1).store.items).toEqual([]);
  });

  it("JSON illisible ou version inconnue : rien d'inventé, un écart compté", () => {
    expect(migrateSavedSegments(null, "{pas du json")).toEqual({ store: { version: 2, items: [] }, dropped: 1 });
    expect(migrateSavedSegments(JSON.stringify({ version: 3, items: [] }), null)).toEqual({ store: { version: 2, items: [] }, dropped: 1 });
    expect(migrateSavedSegments(null, null)).toEqual({ store: { version: 2, items: [] }, dropped: 0 });
  });

  it("noms en double : le dernier gagne ; au-delà de 10 conditions, écarté", () => {
    const v1 = JSON.stringify([
      { name: "X", seg: "geo==FR" },
      { name: "X", seg: "geo==DE" },
      { name: "Trop", seg: Array.from({ length: 11 }, (_, i) => `client==c${i}`).join(";") },
    ]);
    const { store, dropped } = migrateSavedSegments(null, v1);
    expect(store.items).toEqual([{ name: "X", seg: "v2:country:eq:DE" }]);
    expect(dropped).toBe(1);
  });
});
