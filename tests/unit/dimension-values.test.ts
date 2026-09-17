// P6.1 — sélecteurs de valeurs de dimension (apps/console/lib/dimensions.ts).
//
// La portée se décide AVANT le SQL : une app exactement, contenue dans les apps
// du principal ; `[]` ne donne rien, et « toutes les apps » n'est pas une portée.
// La preuve sur PostgreSQL (A/B, fenêtre, plafond, robots, historique) est dans
// tests/integration/dimensions-v75-sql.test.ts.
import { describe, expect, it } from "vitest";
import {
  DIMENSIONS,
  DIMENSION_VALUES_CAP,
  dimensionValuesFrom,
  dimensionValuesRequest,
  dimensionValuesSql,
  type DimensionValuesInput,
  type DimensionValuesRequest,
} from "../../apps/console/lib/dimensions";

const FENETRE = { from: "2026-09-16T00:00:00Z", to: "2026-09-17T00:00:00Z" };
const demande = (over: Partial<DimensionValuesInput> = {}) =>
  dimensionValuesRequest({ dimension: "release", app: "app-a", authorizedApps: ["app-a", "app-b"], range: FENETRE, ...over });
const valide = (over: Partial<DimensionValuesRequest> = {}): DimensionValuesRequest =>
  ({ dimension: "release", app: "app-a", from: FENETRE.from, to: FENETRE.to, includeBots: false, ...over });

describe("dimensionValuesRequest — portée et fenêtre avant tout SQL", () => {
  it("une app autorisée et une fenêtre UTC explicite", () => {
    expect(demande()).toEqual({ ok: true, request: valide() });
    // Admin transverse : toute app nommée, mais une seule.
    expect(demande({ authorizedApps: null, app: "app-z", includeBots: true }))
      .toEqual({ ok: true, request: valide({ app: "app-z", includeBots: true }) });
  });

  it("jamais d'inventaire transverse : app requise, hors périmètre refusée, [] ne donne rien", () => {
    for (const app of [null, undefined, "", "   "]) expect(demande({ app })).toEqual({ ok: false, error: "app_required" });
    expect(demande({ authorizedApps: null, app: null })).toEqual({ ok: false, error: "app_required" });
    expect(demande({ app: "app-c" })).toEqual({ ok: false, error: "app_forbidden" });
    expect(demande({ authorizedApps: [] })).toEqual({ ok: false, error: "app_forbidden" });
  });

  it("une dimension hors registre est refusée, jamais ignorée", () => {
    for (const dimension of ["constructor", "toString", "__proto__", "props.plan", "user_agent", ""]) {
      expect(demande({ dimension })).toEqual({ ok: false, error: "unsupported_dimension" });
    }
  });

  it("fenêtre : UTC explicite, date réelle, from < to, 30 jours au plus", () => {
    const refus = { ok: false, error: "invalid_range" };
    expect(demande({ range: { from: "2026-09-16T00:00:00+02:00", to: FENETRE.to } })).toEqual(refus);
    expect(demande({ range: { from: "2026-09-16", to: FENETRE.to } })).toEqual(refus);
    expect(demande({ range: { from: "2026-02-30T00:00:00Z", to: "2026-03-05T00:00:00Z" } })).toEqual(refus);
    expect(demande({ range: { from: FENETRE.to, to: FENETRE.from } })).toEqual(refus);
    expect(demande({ range: { from: FENETRE.from, to: FENETRE.from } })).toEqual(refus);
    expect(demande({ range: { from: "2026-08-17T00:00:00Z", to: "2026-09-16T00:00:00.000001Z" } })).toEqual(refus);
    // Exactement 30 jours, et les microsecondes transmises telles quelles à PostgreSQL.
    const trenteJours = demande({ range: { from: "2026-08-17T00:00:00.123456Z", to: "2026-09-16T00:00:00.123456Z" } });
    expect(trenteJours).toMatchObject({ ok: true, request: { from: "2026-08-17T00:00:00.123456Z", to: "2026-09-16T00:00:00.123456Z" } });
  });
});

describe("dimensionValuesSql — identifiants du registre, valeurs liées", () => {
  it("chaque requête lie l'app et la fenêtre, et n'interpole aucune valeur", () => {
    for (const dimension of Object.keys(DIMENSIONS) as Array<keyof typeof DIMENSIONS>) {
      for (const includeBots of [false, true]) {
        const r = valide({ dimension, app: "app'); drop table rum_session; --", includeBots });
        const { text, params } = dimensionValuesSql(r);
        expect(params).toEqual([r.app, r.from, r.to]);
        expect(text).not.toContain("drop table");
        expect(text).not.toContain(r.from);
        expect(text).toContain(`limit ${DIMENSION_VALUES_CAP + 1}`);
        // Chaque table lue est bornée par l'app ET par la fenêtre.
        const lectures = text.match(/from rum_\w+ \w+\s+where [^\n]*/g) ?? [];
        expect(lectures.length).toBeGreaterThan(0);
        for (const lecture of lectures) expect(lecture).toMatch(/app_id = \$1 and .*\$2::timestamptz.*\$3::timestamptz/);
      }
    }
  });

  it("sessions : rum_session seule, sessions actives dans la fenêtre", () => {
    const { text } = dimensionValuesSql(valide({ dimension: "browser" }));
    expect(text).toContain("select s.browser as valeur");
    expect(text).toContain("s.last_seen_at >= $2::timestamptz and s.started_at < $3::timestamptz and not s.is_bot");
    expect(text).not.toContain("rum_event_index");
    expect(dimensionValuesSql(valide({ dimension: "browser", includeBots: true })).text).not.toContain("is_bot");
  });

  it("signaux : projection et exceptions dérivées disjointes ; robots exclus par une session de la même app", () => {
    const { text } = dimensionValuesSql(valide({ dimension: "env" }));
    expect(text).toContain("from rum_event_index i");
    expect(text).toContain("e.origin_signal is not null");
    expect(text).toContain("left join rum_session s on s.app_id = o.app_id and s.session_id = o.session_id");
    expect(text).toContain("where not coalesce(s.is_bot, false)");
    expect(text).not.toContain("i.kind in");
    // Robots inclus : aucune jointure à payer.
    expect(dimensionValuesSql(valide({ dimension: "env", includeBots: true })).text).not.toContain("rum_session");
    // Seuls spans et erreurs portent un service.
    expect(dimensionValuesSql(valide({ dimension: "service" })).text).toContain("and i.kind in ('error', 'span')");
  });
});

describe("dimensionValuesFrom — plafond, troncature et inconnu à part", () => {
  it("l'inconnu n'est jamais une valeur, et 0 quand rien ne manque", () => {
    const r = valide();
    expect(dimensionValuesFrom(r, [{ valeur: "2.4.0", n: 7 }, { valeur: "2.3.1", n: 3 }, { valeur: null, n: 5 }])).toEqual({
      dimension: "release", label: "Release", population: "signaux", available: true,
      values: [{ value: "2.4.0", count: 7 }, { value: "2.3.1", count: 3 }], unknown: 5, truncated: false,
    });
    expect(dimensionValuesFrom(r, [{ valeur: "2.4.0", n: 7 }]).unknown).toBe(0);
  });

  it("au plus 100 valeurs ; la 101e lue dit seulement que la liste est tronquée", () => {
    const lignes = Array.from({ length: DIMENSION_VALUES_CAP + 1 }, (_, i) => ({ valeur: `r${i}`, n: 200 - i }));
    const resultat = dimensionValuesFrom(valide(), [...lignes, { valeur: null, n: 2 }]);
    expect(resultat.values).toHaveLength(DIMENSION_VALUES_CAP);
    expect(resultat.values.at(-1)).toEqual({ value: `r${DIMENSION_VALUES_CAP - 1}`, count: 200 - (DIMENSION_VALUES_CAP - 1) });
    expect(resultat).toMatchObject({ truncated: true, unknown: 2 });
    expect(dimensionValuesFrom(valide(), lignes.slice(0, DIMENSION_VALUES_CAP)).truncated).toBe(false);
  });

  it("colonnes absentes : indisponible, sans valeur ni erreur", () => {
    expect(dimensionValuesFrom(valide({ dimension: "browser" }), [], false)).toEqual({
      dimension: "browser", label: "Navigateur", population: "sessions", available: false,
      values: [], unknown: 0, truncated: false,
    });
  });
});
