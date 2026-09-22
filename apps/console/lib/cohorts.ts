// Rétention par cohortes — logique PURE et testée (Lot 8c, à la Matomo/Amplitude).
// À partir des SEMAINES d'activité par visiteur (visitor_id, tirage aléatoire), on
// regroupe les utilisateurs par semaine de PREMIÈRE activité (cohorte) et on mesure
// combien reviennent aux semaines suivantes -> matrice triangulaire cohorte × offset.
// Les semaines sont des index entiers (semaines depuis l'epoch) : l'arithmétique
// d'offset reste exacte ; l'étiquetage en date se fait côté page.

/** Secondes par semaine : l'index de semaine vaut `floor(epoch(lundi) / SEMAINE_S)`. */
export const SEMAINE_S = 604_800;

/** Décalage du lundi dans une semaine d'index : l'epoch (01/01/1970) tombe un JEUDI. */
const LUNDI_APRES_EPOCH_S = 4 * 86_400;

/**
 * Lundi (00:00 UTC) de la semaine d'index `index`, tel que le SQL le calcule :
 * `floor(extract(epoch from date_trunc('week', started_at)) / 604800)`
 * (lib/queries-cohorts.ts). `date_trunc('week')` rend le LUNDI de la semaine ISO,
 * mais `index × 604800` retombe sur un JEUDI — l'epoch est un jeudi. L'ancienne
 * étiquette (`weekIndexToDate`) datait donc chaque cohorte du jeudi qui PRÉCÈDE
 * son lundi (une date de la semaine d'avant) ; celle-ci rend le lundi, 4 jours
 * après `index × 604800`.
 *
 * Exact quel que soit le fuseau de la session PostgreSQL : un lundi 00:00 local
 * (au plus 14 h d'écart avec l'UTC) reste dans le même index, puisque le lundi
 * UTC est à 4 jours du début de l'intervalle d'index.
 */
export function lundiDeSemaine(index: number): Date {
  return new Date((index * SEMAINE_S + LUNDI_APRES_EPOCH_S) * 1000);
}

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
