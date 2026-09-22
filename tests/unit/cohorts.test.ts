// Rétention par cohortes — matrice triangulaire. Logique pure.
import { describe, expect, it } from "vitest";
import { SEMAINE_S, buildCohorts, lundiDeSemaine } from "../../apps/console/lib/cohorts";
import { cellulesDeCohorte, courbeRetention, indexSemaine, type CohortRow } from "../../apps/console/lib/cohorts";

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

// ═══════════ F49 — courbe pondérée, semaine en cours exclue, cellules ═══════════

/** Une cohorte telle que `buildCohorts` la rend, cellules données par (offset, retenus). */
const cohorteF49 = (cohort: number, size: number, retenus: number[]): CohortRow => ({
  cohort,
  size,
  cells: retenus.map((retained, offset) => ({ offset, retained, rate: retained / size })),
});

describe("F49 — indexSemaine", () => {
  it("même index que la formule SQL, du lundi 00:00 au dimanche 23:59 UTC", () => {
    const lundi = new Date("2026-09-21T00:00:00Z").getTime();
    const index = indexSql(new Date(lundi));
    expect(indexSemaine(lundi)).toBe(index);
    expect(indexSemaine(new Date("2026-09-22T09:30:00Z").getTime())).toBe(index);
    expect(indexSemaine(new Date("2026-09-27T23:59:59Z").getTime())).toBe(index);
    expect(indexSemaine(new Date("2026-09-28T00:00:00Z").getTime())).toBe(index + 1);
    expect(lundiDeSemaine(indexSemaine(lundi + 3 * 86_400_000)).toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });
});

describe("F49 — courbeRetention", () => {
  const COURANTE = 100;

  it("pondération : 2 cohortes complètes de 10 et 30 visiteurs, 50 % et 10 % → 20 %", () => {
    const rows = [cohorteF49(90, 10, [10, 5]), cohorteF49(91, 30, [30, 3])];
    const s1 = courbeRetention(rows, COURANTE, 2)[1];
    // Σ retenus / Σ taille = (5 + 3) / (10 + 30) ; la moyenne des taux dirait 30 %.
    expect(s1.taux).toBeCloseTo(0.2, 10);
    expect(s1).toMatchObject({ cohortes: 2, taille: 40, exclues: 0 });
  });

  it("cohorte à S+1 incomplète exclue : taux inchangé, exclues = 1 (exemple de la tuile)", () => {
    const A = cohorteF49(98, 10, [10, 5]); // S+1 = semaine 99 : complète
    const B = cohorteF49(99, 30, [30, 0]); // S+1 = semaine 100 : la semaine en cours
    const avec = courbeRetention([A, B], COURANTE, 2)[1];
    const sans = courbeRetention([A], COURANTE, 2)[1];
    expect(avec.taux).toBeCloseTo(0.5, 10);
    expect(avec).toMatchObject({ cohortes: 1, exclues: 1, taille: 10 });
    expect(avec.taux).toBe(sans.taux);
  });

  it("aucune cohorte complète à un offset → null, jamais 0", () => {
    const courbe = courbeRetention([cohorteF49(COURANTE, 12, [4])], COURANTE, 2);
    expect(courbe[0]).toMatchObject({ taux: null, cohortes: 0, exclues: 1 });
    expect(courbe[1].taux).toBeNull();
    expect(courbeRetention([], COURANTE, 3).every((p) => p.taux === null)).toBe(true);
  });

  it("la courbe et la tuile S+1 rendent le même nombre (une seule fonction)", () => {
    const rows = [cohorteF49(96, 20, [20, 8, 4]), cohorteF49(97, 5, [5, 1, 0]), cohorteF49(99, 7, [7, 2])];
    const courbe = courbeRetention(rows, COURANTE, 3);
    expect(courbe[1].taux).toBeCloseTo((8 + 1) / (20 + 5), 10);
    expect(courbe[1].exclues).toBe(1);
  });
});

describe("F49 — cellulesDeCohorte", () => {
  it("la cellule de la semaine en cours est incomplete ; au-delà, aucune cellule", () => {
    const cellules = cellulesDeCohorte(cohorteF49(98, 10, [10, 6, 2]), 100, 5);
    expect(cellules.map((c) => c.offset)).toEqual([0, 1, 2]);
    expect(cellules.map((c) => c.incomplete)).toEqual([false, false, true]);
    expect(cellules[1]).toMatchObject({ retenus: 6, taux: 0.6 });
  });

  it("une semaine passée sans activité vaut 0 retenu (complète), pas une case vide", () => {
    // buildCohorts s'arrête à la dernière semaine active (98) ; la semaine 99 est finie.
    const cellules = cellulesDeCohorte(cohorteF49(97, 4, [4, 1]), 100, 4);
    expect(cellules.map((c) => [c.offset, c.retenus, c.incomplete])).toEqual([
      [0, 4, false],
      [1, 1, false],
      [2, 0, false],
      [3, 0, true],
    ]);
  });
});
