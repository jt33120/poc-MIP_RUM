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
