// Annotations de déploiement (F08, plan § 3.7) : filtrées sur [from, to), regroupées
// au-delà de 6, message B1 sous plage personnalisée, lien vers la comparaison.
import { describe, expect, it } from "vitest";
import {
  MAX_ANNOTATIONS,
  RAISON_B1,
  annotationsDeploiements,
  annotationsIndisponibles,
  dansLaFenetre,
} from "../../apps/console/lib/annotations";

const RANGE = { from: "2026-09-21T12:00:00.000Z", to: "2026-09-22T12:00:00.000Z", preset: "24h" as const };
const lien = (relB: string, relA: string | null) => `/?cmp=release&rel_b=${relB}${relA ? `&rel_a=${relA}` : ""}`;
const d = (iso: string, version: string | null) => ({ ts: new Date(iso), version });

describe("fenêtre [from, to)", () => {
  it("borne basse incluse, borne haute exclue", () => {
    expect(dansLaFenetre(new Date(RANGE.from), RANGE)).toBe(true);
    expect(dansLaFenetre(new Date(RANGE.to), RANGE)).toBe(false);
    expect(dansLaFenetre("2026-09-21T11:59:59.999Z", RANGE)).toBe(false);
  });

  it("un déploiement hors de la fenêtre est exclu, mais sert de version précédente", () => {
    const { annotations, indisponible } = annotationsDeploiements(
      [d("2026-09-22T12:30:00Z", "1.5.0"), d("2026-09-22T08:00:00Z", "1.4.2"), d("2026-09-20T08:00:00Z", "1.4.1")],
      RANGE,
      { lien },
    );
    expect(indisponible).toBeNull();
    expect(annotations).toEqual([
      { t: "2026-09-22T08:00:00.000Z", libelle: "1.4.2", type: "deploiement", href: "/?cmp=release&rel_b=1.4.2&rel_a=1.4.1" },
    ]);
  });

  it("un redéploiement de la même version n'est pas la version précédente ; sans version, pas de lien", () => {
    const { annotations } = annotationsDeploiements(
      [d("2026-09-22T10:00:00Z", "1.4.2"), d("2026-09-22T09:00:00Z", null), d("2026-09-22T08:00:00Z", "1.4.2"), d("2026-09-21T13:00:00Z", "1.4.1")],
      RANGE,
      { lien },
    );
    expect(annotations.map((a) => a.libelle)).toEqual(["1.4.1", "1.4.2", "Déploiement sans version", "1.4.2"]);
    expect(annotations[3].href).toBe("/?cmp=release&rel_b=1.4.2&rel_a=1.4.1");
    expect(annotations[2].href).toBeUndefined();
    // Le premier de la liste n'a pas de précédent connu : la comparaison choisira A.
    expect(annotations[0].href).toBe("/?cmp=release&rel_b=1.4.1");
  });
});

describe("regroupement au-delà de 6", () => {
  const marqueurs = (n: number) =>
    Array.from({ length: n }, (_v, k) => d(new Date(Date.parse("2026-09-22T11:00:00Z") - k * 3_600_000).toISOString(), `v${n - k}`));

  it("6 marqueurs : 6 traits", () => {
    const r = annotationsDeploiements(marqueurs(MAX_ANNOTATIONS), RANGE, { lien });
    expect(r.annotations).toHaveLength(6);
    expect(r.liste).toHaveLength(6);
  });

  it("7 marqueurs : un seul « 7 déploiements » vers la liste, posé sur le plus récent", () => {
    const r = annotationsDeploiements(marqueurs(7), RANGE, { lien, lienListe: "#deploiements" });
    expect(r.annotations).toEqual([
      { t: "2026-09-22T11:00:00.000Z", libelle: "7 déploiements", type: "deploiement", href: "#deploiements" },
    ]);
    expect(r.liste.map((a) => a.libelle)).toEqual(["v1", "v2", "v3", "v4", "v5", "v6", "v7"]);
  });

  it("les marqueurs hors fenêtre ne comptent pas dans le regroupement", () => {
    const r = annotationsDeploiements([...marqueurs(6), d("2026-09-20T00:00:00Z", "v0")], RANGE, { lien });
    expect(r.annotations).toHaveLength(6);
  });
});

describe("plage personnalisée (B1)", () => {
  it("aucun trait, et le message B1", () => {
    const r = annotationsDeploiements([d("2026-09-22T08:00:00Z", "1.4.2")], { ...RANGE, preset: null }, { lien });
    expect(r).toEqual({ annotations: [], liste: [], indisponible: RAISON_B1 });
    expect(RAISON_B1).toBe("déploiements non affichés sur une plage personnalisée (lecture non migrée)");
  });

  it("sous un préréglage, rien à dire", () => {
    expect(annotationsIndisponibles({ preset: "7d" })).toBeNull();
  });
});

// ───────────────────────────── Alertes (F67, § 3.7) ─────────────────────────────
import {
  MAX_ANNOTATIONS as MAX_F67,
  PLAFOND_ALERTES,
  RAISON_ALERTES_TRONQUEES,
  annotationsAlertes,
  annotationsDeploiements as deploiementsF67,
  fusionnerAnnotations,
  raisonsAnnotations,
  type EvenementAlerte,
} from "../../apps/console/lib/annotations";

const RANGE_F67 = { from: "2026-09-21T12:00:00.000Z", to: "2026-09-22T12:00:00.000Z", preset: "24h" as const };
const lienEvtF67 = (id: number) => `/alerts?app=a&evt=${id}#evt-${id}`;

/** Un `AlertEventRow` réduit à ce qu'une annotation en lit. */
const evt = (
  id: number,
  iso: string,
  extra: Partial<Omit<EvenementAlerte, "id" | "fired_at">> = {},
): EvenementAlerte => ({
  id,
  fired_at: new Date(iso),
  metric: "LCP",
  route: null,
  app_id: "a",
  ...extra,
});

describe("F67 — annotations d'alerte : fenêtre et lien", () => {
  it("un déclenchement hors de [from, to) est exclu ; la borne haute aussi", () => {
    const r = annotationsAlertes(
      [
        evt(9, "2026-09-22T12:00:00Z", { route: "/checkout" }),
        evt(8, "2026-09-22T08:00:00Z", { route: "/checkout" }),
        evt(7, "2026-09-20T08:00:00Z", { route: "/checkout" }),
      ],
      RANGE_F67,
      { lien: lienEvtF67 },
    );
    expect(r.indisponible).toBeNull();
    expect(r.annotations).toEqual([
      {
        t: "2026-09-22T08:00:00.000Z",
        libelle: "Alerte LCP /checkout",
        type: "alerte",
        href: "/alerts?app=a&evt=8#evt-8",
      },
    ]);
  });

  it("le lien porte evt=<id>, jamais fired= (§ 3.1)", () => {
    const r = annotationsAlertes([evt(42, "2026-09-22T09:00:00Z")], RANGE_F67, { lien: lienEvtF67 });
    expect(r.annotations[0].href).toBe("/alerts?app=a&evt=42#evt-42");
    for (const a of r.annotations) expect(a.href).not.toContain("fired=");
  });

  it("les alertes sont rendues du plus ancien au plus récent, quel que soit l'ordre lu", () => {
    const r = annotationsAlertes(
      [evt(3, "2026-09-22T11:00:00Z"), evt(2, "2026-09-22T10:00:00Z"), evt(1, "2026-09-22T09:00:00Z")],
      RANGE_F67,
      { lien: lienEvtF67 },
    );
    expect(r.liste.map((a) => a.t)).toEqual([
      "2026-09-22T09:00:00.000Z",
      "2026-09-22T10:00:00.000Z",
      "2026-09-22T11:00:00.000Z",
    ]);
  });
});

describe("F67 — annotations d'alerte : périmètre de la figure", () => {
  it("figure filtrée sur une route : une autre route est exclue, l'alerte de toute l'app est gardée et dite", () => {
    const r = annotationsAlertes(
      [
        evt(3, "2026-09-22T11:00:00Z", { route: "/panier" }),
        evt(2, "2026-09-22T10:00:00Z", { route: "/checkout" }),
        evt(1, "2026-09-22T09:00:00Z", { route: null }),
      ],
      RANGE_F67,
      { lien: lienEvtF67, route: "/checkout" },
    );
    expect(r.annotations.map((a) => a.libelle)).toEqual(["Alerte LCP (toutes routes)", "Alerte LCP"]);
  });

  it("figure d'un couple app × route : une alerte d'une autre app est exclue", () => {
    const r = annotationsAlertes(
      [evt(2, "2026-09-22T10:00:00Z", { app_id: "b" }), evt(1, "2026-09-22T09:00:00Z", { app_id: "a" })],
      RANGE_F67,
      { lien: lienEvtF67, app: "a", route: "/checkout" },
    );
    expect(r.annotations.map((a) => a.href)).toEqual(["/alerts?app=a&evt=1#evt-1"]);
  });

  it("une clé de métrique trop longue est abrégée (elle est dessinée au-dessus de la série)", () => {
    const r = annotationsAlertes(
      [evt(1, "2026-09-22T09:00:00Z", { metric: "issue:3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d" })],
      RANGE_F67,
      { lien: lienEvtF67 },
    );
    expect(r.annotations[0].libelle).toBe("Alerte issue:3f2b1c4d-5e…");
  });
});

describe("F67 — annotations d'alerte : regroupement et lecture plafonnée", () => {
  const rafale = (n: number) =>
    Array.from({ length: n }, (_v, k) => evt(n - k, new Date(Date.parse("2026-09-22T11:00:00Z") - k * 600_000).toISOString()));

  it("6 déclenchements : 6 traits", () => {
    const r = annotationsAlertes(rafale(MAX_F67), RANGE_F67, { lien: lienEvtF67 });
    expect(r.annotations).toHaveLength(6);
  });

  it("7 déclenchements : un seul « 7 alertes » vers la liste, posé sur le plus récent", () => {
    const r = annotationsAlertes(rafale(7), RANGE_F67, { lien: lienEvtF67, lienListe: "/alerts?app=a" });
    expect(r.annotations).toEqual([
      { t: "2026-09-22T11:00:00.000Z", libelle: "7 alertes", type: "alerte", href: "/alerts?app=a" },
    ]);
    expect(r.liste).toHaveLength(7);
  });

  it("lecture plafonnée qui ne remonte pas au début de la plage : aucun trait, et on le dit", () => {
    const lus = rafale(PLAFOND_ALERTES); // le plus ancien est APRÈS `from`
    const r = annotationsAlertes(lus, RANGE_F67, { lien: lienEvtF67 });
    expect(r).toEqual({ annotations: [], liste: [], indisponible: RAISON_ALERTES_TRONQUEES });
  });

  it("lecture plafonnée mais qui couvre le début de la plage : les annotations tiennent", () => {
    const lus = [...rafale(PLAFOND_ALERTES - 1), evt(0, "2026-09-21T11:00:00Z")];
    const r = annotationsAlertes(lus, RANGE_F67, { lien: lienEvtF67, lienListe: "/alerts?app=a" });
    expect(r.indisponible).toBeNull();
    expect(r.annotations.map((a) => a.libelle)).toEqual([`${PLAFOND_ALERTES - 1} alertes`]);
  });
});

describe("F67 — plusieurs familles sur une figure", () => {
  const dep = (iso: string, version: string) => ({ ts: new Date(iso), version });
  const lienRelease = (relB: string) => `/?cmp=release&rel_b=${relB}`;

  it("déploiements et alertes se mêlent, du plus ancien au plus récent", () => {
    const deploiements = deploiementsF67([dep("2026-09-22T10:00:00Z", "1.4.2")], RANGE_F67, { lien: lienRelease });
    const alertes = annotationsAlertes([evt(1, "2026-09-22T09:00:00Z")], RANGE_F67, { lien: lienEvtF67 });
    expect(fusionnerAnnotations([deploiements, alertes]).map((a) => [a.type, a.t])).toEqual([
      ["alerte", "2026-09-22T09:00:00.000Z"],
      ["deploiement", "2026-09-22T10:00:00.000Z"],
    ]);
  });

  it("au-delà de 6 traits sur la figure, la famille la plus nombreuse est regroupée", () => {
    const deploiements = deploiementsF67(
      Array.from({ length: 5 }, (_v, k) => dep(new Date(Date.parse("2026-09-22T11:00:00Z") - k * 600_000).toISOString(), `v${5 - k}`)),
      RANGE_F67,
      { lien: lienRelease },
    );
    const alertes = annotationsAlertes(
      [evt(2, "2026-09-22T08:00:00Z"), evt(1, "2026-09-22T07:00:00Z")],
      RANGE_F67,
      { lien: lienEvtF67, lienListe: "/alerts?app=a" },
    );
    const fusion = fusionnerAnnotations([deploiements, alertes]);
    expect(fusion).toHaveLength(3);
    expect(fusion.map((a) => a.libelle)).toEqual(["Alerte LCP", "Alerte LCP", "5 déploiements"]);
  });

  it("une seule famille tient déjà dans la limite : rien n'est regroupé", () => {
    const alertes = annotationsAlertes([evt(1, "2026-09-22T09:00:00Z")], RANGE_F67, { lien: lienEvtF67 });
    expect(fusionnerAnnotations([alertes]).map((a) => a.libelle)).toEqual(["Alerte LCP"]);
  });

  it("les raisons d'absence sont réunies en une phrase, sans doublon", () => {
    expect(raisonsAnnotations([{ indisponible: null }, { indisponible: null }])).toBeUndefined();
    expect(raisonsAnnotations([{ indisponible: "a" }, { indisponible: "a" }, { indisponible: "b" }])).toBe("a ; b");
  });
});
