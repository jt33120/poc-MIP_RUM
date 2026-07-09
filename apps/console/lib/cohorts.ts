// Rétention par cohortes — logique PURE et testée (Lot 8c, à la Matomo/Amplitude).
// À partir des SEMAINES d'activité par utilisateur (user_hash anonymisé), on
// regroupe les utilisateurs par semaine de PREMIÈRE activité (cohorte) et on mesure
// combien reviennent aux semaines suivantes -> matrice triangulaire cohorte × offset.
// Les semaines sont des index entiers (semaines depuis l'epoch) : l'arithmétique
// d'offset reste exacte ; l'étiquetage en date se fait côté page.

export interface CohortCell {
  offset: number; // 0 = semaine de la cohorte, 1 = +1 semaine, ...
  retained: number; // utilisateurs de la cohorte actifs à cet offset
  rate: number; // retained / size (0..1)
}

export interface CohortRow {
  cohort: number; // index de semaine de première activité
  size: number; // taille de la cohorte
  cells: CohortCell[]; // offsets observables (0..min(maxOffset, latest-cohort))
}

/**
 * Construit la matrice de rétention. `rows` = paires (user, semaine) DISTINCTES
 * (un utilisateur peut apparaître sur plusieurs semaines). `maxOffset` borne le
 * nombre de colonnes ; chaque cohorte n'affiche que les offsets réellement
 * observables (pas de semaines dans le futur).
 */
export function buildCohorts(rows: { user: string; week: number }[], maxOffset: number): CohortRow[] {
  const active = new Map<string, Set<number>>();
  let latest = -Infinity;
  for (const r of rows) {
    if (!Number.isFinite(r.week)) continue;
    let set = active.get(r.user);
    if (!set) active.set(r.user, (set = new Set()));
    set.add(r.week);
    if (r.week > latest) latest = r.week;
  }
  if (!active.size) return [];

  // Cohorte de chaque utilisateur = sa 1re semaine d'activité.
  const cohortUsers = new Map<number, string[]>();
  for (const [user, weeks] of active) {
    let first = Infinity;
    for (const w of weeks) if (w < first) first = w;
    (cohortUsers.get(first) ?? cohortUsers.set(first, []).get(first)!).push(user);
  }

  return [...cohortUsers.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cohort, users]) => {
      const size = users.length;
      const maxO = Math.min(maxOffset, latest - cohort);
      const cells: CohortCell[] = [];
      for (let o = 0; o <= maxO; o++) {
        const target = cohort + o;
        let retained = 0;
        for (const u of users) if (active.get(u)!.has(target)) retained++;
        cells.push({ offset: o, retained, rate: size > 0 ? retained / size : 0 });
      }
      return { cohort, size, cells };
    });
}
