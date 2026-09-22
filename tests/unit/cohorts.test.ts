// Rétention par cohortes — matrice triangulaire. Logique pure.
import { describe, expect, it } from "vitest";
import { SEMAINE_S, buildCohorts, lundiDeSemaine } from "../../apps/console/lib/cohorts";

// F40 — l'étiquette d'une cohorte est le LUNDI de sa semaine. L'index vient du SQL :
// `floor(extract(epoch from date_trunc('week', started_at)) / 604800)`, où
// `date_trunc('week')` rend le lundi 00:00 (semaine ISO). `index × 604800` tombe un
// jeudi (l'epoch est un jeudi) : c'était l'ancienne étiquette, `weekIndexToDate`.
const indexSql = (lundiUtc: Date) => Math.floor(lundiUtc.getTime() / 1000 / SEMAINE_S);

describe("lundiDeSemaine", () => {
  it("rend un lundi 00:00 UTC pour 10 index", () => {
    for (let index = 2900; index < 2910; index++) {
      const d = lundiDeSemaine(index);
      expect(d.getUTCDay(), `index ${index}`).toBe(1);
      expect(d.toISOString(), `index ${index}`).toMatch(/T00:00:00\.000Z$/);
    }
  });

  it("aller-retour avec la formule SQL : le lundi d'une semaine redonne son index", () => {
    // Lundi 21/09/2026 (semaine du 22/09/2026) et lundi 07/09/2026.
    for (const lundi of ["2026-09-21T00:00:00Z", "2026-09-07T00:00:00Z", "2026-01-05T00:00:00Z"]) {
      const d = new Date(lundi);
      expect(lundiDeSemaine(indexSql(d)).toISOString()).toBe(d.toISOString());
    }
  });

  it("une session PostgreSQL en Europe/Paris (lundi 00:00 local = dimanche 22:00 UTC) donne le même lundi", () => {
    const lundiParis = new Date("2026-09-20T22:00:00Z"); // lundi 21/09 00:00 heure d'été de Paris
    expect(lundiDeSemaine(indexSql(lundiParis)).toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });

  it("n'est plus le jeudi de `index × 604800`", () => {
    const index = indexSql(new Date("2026-09-21T00:00:00Z"));
    expect(new Date(index * SEMAINE_S * 1000).getUTCDay()).toBe(4); // jeudi : l'ancienne étiquette
    expect(lundiDeSemaine(index).getUTCDay()).toBe(1);
  });
});

describe("buildCohorts", () => {
  it("vide -> []", () => {
    expect(buildCohorts([], 4)).toEqual([]);
  });

  it("cohorte = 1re semaine ; offset 0 = 100 %", () => {
    // u1 actif s10, s11 ; u2 actif s10 seulement
    const rows = [
      { user: "u1", week: 10 },
      { user: "u1", week: 11 },
      { user: "u2", week: 10 },
    ];
    const c = buildCohorts(rows, 4);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ cohort: 10, size: 2 });
    // offset 0 : les 2 ; offset 1 : seul u1
    expect(c[0].cells[0]).toEqual({ offset: 0, retained: 2, rate: 1 });
    expect(c[0].cells[1]).toEqual({ offset: 1, retained: 1, rate: 0.5 });
  });

  it("plusieurs cohortes, matrice triangulaire (pas d'offset futur)", () => {
    const rows = [
      { user: "a", week: 10 },
      { user: "a", week: 12 },
      { user: "b", week: 11 },
    ];
    const c = buildCohorts(rows, 5);
    // latest = 12. cohorte 10 -> offsets 0..2 ; cohorte 11 -> 0..1
    const c10 = c.find((x) => x.cohort === 10)!;
    const c11 = c.find((x) => x.cohort === 11)!;
    expect(c10.cells.map((x) => x.offset)).toEqual([0, 1, 2]);
    expect(c10.cells[2]).toMatchObject({ offset: 2, retained: 1, rate: 1 }); // a revient s12
    expect(c10.cells[1].retained).toBe(0); // a absent s11
    expect(c11.cells.map((x) => x.offset)).toEqual([0, 1]);
  });

  it("maxOffset borne le nombre de colonnes", () => {
    const rows = [
      { user: "a", week: 0 },
      { user: "a", week: 9 },
    ];
    const c = buildCohorts(rows, 3);
    expect(c[0].cells).toHaveLength(4); // offsets 0..3 malgré latest-cohort=9
  });
});
