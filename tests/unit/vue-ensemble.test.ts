// Vue d'ensemble `/` (F11, plan § 5.1) — ce que l'écran a le droit d'écrire
// (lib/vue-ensemble.ts) : la référence d'un écart en toutes lettres, le sous-texte
// du ratio d'erreurs, les releases comparées et les constats à règle publiée.
import { describe, expect, it } from "vitest";
import type { AnomalyRow } from "../../apps/console/lib/health";
import type { DeployImpact } from "../../apps/console/lib/queries-deploys";
import type { AlertFiringRow } from "../../apps/console/lib/queries-v2";
import { choisirReleases } from "../../apps/console/lib/presets";
import { queryOf } from "../../apps/console/lib/filters";
import {
  ALERTES_PAR_EVENEMENT,
  constatsVueEnsemble,
  lectureErreursPour100,
  referencePrecedente,
  referenceRelease,
  releasesComparees,
  REGLE_ANOMALIE_SOUS_FILTRE,
  sansConditionRelease,
  type EntreesConstats,
  type LiensConstats,
} from "../../apps/console/lib/vue-ensemble";

const espaces = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

describe("referencePrecedente (§ 3.12)", () => {
  it("24 h : « vs 24 h précédentes (JJ/MM HH:MM → JJ/MM HH:MM UTC) »", () => {
    expect(
      referencePrecedente({ from: "2026-09-21T14:00:00Z", to: "2026-09-22T14:00:00Z", preset: "24h" }),
    ).toBe("vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC)");
  });

  it("plage personnalisée : « période précédente », même durée juste avant", () => {
    expect(
      referencePrecedente({ from: "2026-09-10T08:00:00Z", to: "2026-09-10T10:00:00Z", preset: null }),
    ).toBe("vs période précédente (10/09 06:00 → 10/09 08:00 UTC)");
  });

  it("release : même fenêtre", () => {
    expect(referenceRelease("1.4.1")).toBe("vs release 1.4.1 (même fenêtre)");
  });
});

describe("lectureErreursPour100 (CP14)", () => {
  it("ne cite que ce qui est laissé de côté, et seulement s'il existe", () => {
    expect(lectureErreursPour100({ restreint: true, sansSource: 0, serveur: 0 })).toBe("erreurs navigateur seulement");
    expect(espaces(lectureErreursPour100({ restreint: true, sansSource: 3, serveur: 5 }))).toBe(
      "erreurs navigateur seulement ; 3 occurrence(s) sans source déclarée et 5 occurrence(s) hors navigateur (serveur, mobile) non comptée(s)",
    );
  });

  it("sans la colonne de source : le numérateur porte toutes les sources, et le dit", () => {
    expect(lectureErreursPour100({ restreint: false, sansSource: 0, serveur: 0 })).toContain(
      "inclut les erreurs serveur sans page vue",
    );
  });
});

describe("sansConditionRelease", () => {
  it("retire le paramètre release et les conditions de release du segment, rien d'autre", () => {
    const base = queryOf({ app: "a", period: "24h", device: null, segment: [] });
    const q = {
      ...base,
      filters: {
        ...base.filters,
        release: "1.4.2",
        browser: "Chrome",
        segments: [
          { dimension: "release" as const, operator: "neq" as const, value: "1.0.0" },
          { dimension: "route" as const, operator: "eq" as const, value: "/a" },
        ],
      },
    };
    const sans = sansConditionRelease(q);
    expect(sans.filters.release).toBeUndefined();
    expect(sans.filters.browser).toBe("Chrome");
    expect(sans.filters.segments).toEqual([{ dimension: "route", operator: "eq", value: "/a" }]);
    expect(sans.range).toEqual(q.range);
  });
});

describe("releasesComparees (§ 3.2)", () => {
  const versions = [
    { version: "1.4.1", sessions: 500 },
    { version: "1.4.2", sessions: 200 },
    { version: "1.3.9", sessions: 50 },
  ];
  const choix = choisirReleases([{ version: "1.4.2" }, { version: "1.4.1" }], versions);

  it("sans rel_a / rel_b : la règle du dernier déploiement, écrite", () => {
    expect(releasesComparees({ relA: null, relB: null }, choix)).toEqual({
      ok: true,
      relB: "1.4.2",
      relA: "1.4.1",
      regle: "1.4.2 : dernier déploiement déclaré ; 1.4.1 : déploiement précédent",
    });
  });

  it("rel_b de l'URL : la référence est complétée par la règle, jamais la même release deux fois", () => {
    const r = releasesComparees({ relA: null, relB: "1.4.1" }, choix);
    expect(r).toMatchObject({ ok: true, relB: "1.4.1", relA: "1.4.2" });
    expect(r.ok && r.regle).toBe("1.4.1 : choisie dans l'URL (rel_b) ; 1.4.2 : complétée par la règle du dernier déploiement");
  });

  it("moins de deux releases : pas de comparaison, et sa raison", () => {
    const seule = choisirReleases([], [{ version: "1.0.0", sessions: 10 }]);
    expect(releasesComparees({ relA: null, relB: null }, seule)).toEqual({
      ok: false,
      raison: "moins de deux releases sur la fenêtre",
    });
  });

  it("releases illisibles (lecture en échec) mais données par l'URL : l'URL suffit", () => {
    expect(releasesComparees({ relA: "1.0.0", relB: "1.1.0" }, null)).toMatchObject({ ok: true, relA: "1.0.0", relB: "1.1.0" });
  });
});

// ─────────────────────────────── Constats ───────────────────────────────

const LIENS: LiensConstats = {
  anomalie: (a) => `/pages?route=${encodeURIComponent(a.route ?? "")}&from=x&to=y`,
  deploiement: (relB, relA) => `/?cmp=release&rel_b=${relB}&rel_a=${relA}`,
  alertes: "/alerts?app=a",
  alerte: (evt) => `/alerts?app=a&evt=${evt}`,
  erreur: (g) => `/errors?panel=error%3A${g.fingerprint}`,
  regresses: "/errors?statut=regressed",
};

const ANOMALIE: AnomalyRow = {
  app_id: "a",
  route: "/checkout",
  bucket: new Date("2026-09-22T14:00:00Z"),
  p75: 4800,
  mean_7d: 2100,
  z_score: 4.2,
};

const IMPACT: DeployImpact = {
  deploy_ts: new Date("2026-09-22T10:00:00Z"),
  version: "1.4.2",
  env: "prod",
  lcp_before: 2000,
  lcp_after: 2440,
  pageviews_before: 1204,
  pageviews_after: 1380,
  sessions_before: 300,
  sessions_after: 320,
  errors_before: 10,
  errors_after: 11,
};

const alerte = (event_id: number, minutes: number, acknowledged = false): AlertFiringRow => ({
  source: "regle",
  source_id: "1",
  libelle: "LCP p75 · /checkout",
  fired_at: new Date(Date.parse("2026-09-22T12:00:00Z") + minutes * 60_000),
  severity: "warning",
  delivered: 1,
  pending: 0,
  acknowledged,
  event_id,
});

const entrees = (surcharge: Partial<EntreesConstats> = {}): EntreesConstats => ({
  anomalies: { ok: true, data: { lignes: [], filtrees: false } },
  deploiement: { ok: true, data: null },
  alertes: { ok: true, data: { mode: "compte", n: 0 } },
  regresses: { ok: true, data: [] },
  ...surcharge,
});

describe("constatsVueEnsemble (§ 5.1.2, zone 4)", () => {
  it("zéro constat : les quatre règles sont citées, aucune source en échec", () => {
    const r = constatsVueEnsemble(entrees(), LIENS);
    expect(r.constats).toEqual([]);
    expect(r.regles).toHaveLength(4);
    expect(r.echecs).toEqual([]);
  });

  it("anomalie : titre chiffré, règle z > 3, lien vers la route et l'heure", () => {
    const r = constatsVueEnsemble(entrees({ anomalies: { ok: true, data: { lignes: [ANOMALIE], filtrees: false } } }), LIENS);
    expect(r.constats).toHaveLength(1);
    expect(espaces(r.constats[0].titre)).toBe("LCP /checkout : 4,8 s à 22/09 14:00 UTC (moyenne 7 j : 2,1 s)");
    expect(r.constats[0].regle).toContain("> 3 sur la moyenne horaire des 7 derniers jours");
    expect(r.constats[0].href).toContain("/pages?route=%2Fcheckout");
  });

  it("anomalies sous filtre : non cherchées, et la règle le dit", () => {
    const r = constatsVueEnsemble(entrees({ anomalies: { ok: true, data: { lignes: [], filtrees: true } } }), LIENS);
    expect(r.regles).toContain(REGLE_ANOMALIE_SOUS_FILTRE);
  });

  it("dernier déploiement en régression : +20 %, effectifs avant / après écrits, lien cmp=release", () => {
    const r = constatsVueEnsemble(
      entrees({ deploiement: { ok: true, data: { impact: IMPACT, versionPrecedente: "1.4.1" } } }),
      LIENS,
    );
    expect(r.constats).toHaveLength(1);
    const c = r.constats[0];
    expect(c.type).toBe("regression");
    expect(espaces(c.titre)).toBe("Déploiement 1.4.2 : LCP p75 +22 % (1 204 pages vues avant, 1 380 après)");
    expect(c.href).toBe("/?cmp=release&rel_b=1.4.2&rel_a=1.4.1");
  });

  it("dernier déploiement stable : aucun constat", () => {
    const r = constatsVueEnsemble(
      entrees({ deploiement: { ok: true, data: { impact: { ...IMPACT, lcp_after: 2010 }, versionPrecedente: "1.4.1" } } }),
      LIENS,
    );
    expect(r.constats).toEqual([]);
  });

  it("repli d'avant F67 : UN constat « N alertes non acquittées » → /alerts, sans identifiant", () => {
    expect(ALERTES_PAR_EVENEMENT).toBe(false);
    const r = constatsVueEnsemble(entrees({ alertes: { ok: true, data: { mode: "compte", n: 4 } } }), LIENS);
    expect(r.constats).toEqual([
      expect.objectContaining({ type: "alerte", titre: "4 alerte(s) non acquittée(s)", href: "/alerts?app=a" }),
    ]);
  });

  it("par événement (F67) : trois au plus, les plus récents, lien evt=, puis « et N autres »", () => {
    const lignes = [alerte(1, 0), alerte(2, 10), alerte(3, 20, true), alerte(4, 30), alerte(5, 40), alerte(6, 50)];
    const r = constatsVueEnsemble(entrees({ alertes: { ok: true, data: { mode: "evenements", lignes } } }), LIENS);
    expect(r.constats.map((c) => c.href)).toEqual([
      "/alerts?app=a&evt=6",
      "/alerts?app=a&evt=5",
      "/alerts?app=a&evt=4",
      "/alerts?app=a",
    ]);
    expect(r.constats[3].titre).toBe("et 2 autre(s) alerte(s) non acquittée(s)");
  });

  it("aucun lien de constat ne porte fired= (§ 3.1)", () => {
    const r = constatsVueEnsemble(
      entrees({
        anomalies: { ok: true, data: { lignes: [ANOMALIE], filtrees: false } },
        deploiement: { ok: true, data: { impact: IMPACT, versionPrecedente: "1.4.1" } },
        alertes: { ok: true, data: { mode: "evenements", lignes: [alerte(9, 0)] } },
        regresses: { ok: true, data: [{ app_id: "a", fingerprint: "fp1", sample_message: "boom", error_type: "TypeError", occurrences: 3 }] },
      }),
      LIENS,
    );
    expect(r.constats).toHaveLength(4);
    for (const c of r.constats) expect(c.href).not.toContain("fired=");
  });

  it("groupes régressés : cinq nommés au plus, puis « et N autres » vers la liste filtrée", () => {
    const groupes = Array.from({ length: 7 }, (_, i) => ({
      app_id: "a",
      fingerprint: `fp${i}`,
      sample_message: i === 0 ? null : `erreur ${i}`,
      error_type: i === 0 ? null : "TypeError",
      occurrences: i + 1,
    }));
    const r = constatsVueEnsemble(entrees({ regresses: { ok: true, data: groupes } }), LIENS);
    expect(r.constats).toHaveLength(6);
    expect(r.constats[0].titre).toBe("Erreur réapparue : empreinte fp0 (1 occurrence(s) sur la période)");
    expect(r.constats[0].href).toBe("/errors?panel=error%3Afp0");
    expect(r.constats[5]).toMatchObject({ titre: "et 2 autre(s) groupe(s) d'erreurs régressé(s)", href: "/errors?statut=regressed" });
  });

  it("une source illisible est nommée, les autres constats restent", () => {
    const r = constatsVueEnsemble(
      entrees({ anomalies: { ok: false }, alertes: { ok: false }, deploiement: { ok: true, data: { impact: IMPACT, versionPrecedente: null } } }),
      LIENS,
    );
    expect(r.echecs).toEqual(["anomalies LCP", "alertes non acquittées"]);
    expect(r.constats).toHaveLength(1);
  });
});
