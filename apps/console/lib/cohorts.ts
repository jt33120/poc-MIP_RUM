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

// ─────────────────── Semaine en cours, cellules et courbe (F49) ───────────────────
//
// LA SEMAINE EN COURS N'EST PAS UNE SEMAINE. Mardi matin, la cellule « S+1 » d'une
// cohorte de la semaine dernière ne compte que les visiteurs revenus depuis lundi :
// elle est basse parce qu'elle n'est pas finie, pas parce qu'on décroche. L'ancienne
// courbe l'incluait (et rendait 0 sans cohorte) : la dernière valeur plongeait
// chaque début de semaine. Une cellule est INCOMPLÈTE quand `cohorte + offset ≥
// semaineCourante` ; elle sort du numérateur ET du dénominateur de la courbe, et la
// matrice la hache.

const JOUR_MS = 86_400_000;

/**
 * Index de la semaine (lundi UTC) qui contient `ms` — la même formule que le SQL
 * (`floor(extract(epoch from date_trunc('week', started_at)) / 604800)`,
 * lib/queries-cohorts.ts) : `floor(epoch(lundi UTC) / 604800)`.
 */
export function indexSemaine(ms: number): number {
  const jour = Math.floor(ms / JOUR_MS);
  // Le jour 0 (01/01/1970) est un jeudi : (jour + 3) mod 7 vaut 0 le lundi.
  const lundi = jour - ((((jour + 3) % 7) + 7) % 7);
  return Math.floor((lundi * 86_400) / SEMAINE_S);
}

export interface CelluleRetention {
  offset: number;
  retenus: number;
  /** retenus / taille ; `null` sans taille (jamais 0 à la place). */
  taux: number | null;
  /** Semaine en cours : la valeur n'est pas finie. */
  incomplete: boolean;
}

/**
 * Cellules d'une cohorte jusqu'à la semaine en cours (offsets 0 à `colonnes − 1`).
 * Une semaine passée sans aucune activité dans les données n'a pas de cellule dans
 * `buildCohorts` (qui s'arrête à la dernière semaine active) : elle vaut 0 retenu —
 * la semaine est finie et personne n'est revenu. Au-delà de la semaine en cours,
 * aucune cellule : c'est l'avenir, pas un zéro.
 */
export function cellulesDeCohorte(row: CohortRow, semaineCourante: number, colonnes: number): CelluleRetention[] {
  const cellules: CelluleRetention[] = [];
  for (let offset = 0; offset < colonnes && row.cohort + offset <= semaineCourante; offset++) {
    const retenus = row.cells.find((c) => c.offset === offset)?.retained ?? 0;
    cellules.push({
      offset,
      retenus,
      taux: row.size > 0 ? retenus / row.size : null,
      incomplete: row.cohort + offset >= semaineCourante,
    });
  }
  return cellules;
}

export interface PointRetention {
  offset: number;
  /** Σ retenus / Σ taille des cohortes COMPLÈTES à cet offset ; `null` s'il n'y en a aucune. */
  taux: number | null;
  /** Cohortes complètes qui contribuent. */
  cohortes: number;
  /** Σ taille de ces cohortes (le dénominateur). */
  taille: number;
  /** Cohortes écartées : leur semaine à cet offset n'est pas finie (en cours ou à venir). */
  exclues: number;
}

/**
 * Courbe de rétention pondérée (Datadog « Retention curve ») : à chaque offset,
 * Σ retenus / Σ taille sur les seules cohortes dont la cellule est COMPLÈTE — une
 * moyenne pondérée par la taille, jamais une moyenne des taux. La tuile « Retour
 * en S+1 » en est le point d'offset 1 : les deux rendent le même nombre.
 */
export function courbeRetention(rows: readonly CohortRow[], semaineCourante: number, colonnes: number): PointRetention[] {
  return Array.from({ length: Math.max(0, colonnes) }, (_v, offset) => {
    let retenus = 0;
    let taille = 0;
    let cohortes = 0;
    let exclues = 0;
    for (const row of rows) {
      if (row.cohort + offset >= semaineCourante) {
        exclues++;
        continue;
      }
      retenus += row.cells.find((c) => c.offset === offset)?.retained ?? 0;
      taille += row.size;
      cohortes++;
    }
    return { offset, taux: cohortes > 0 && taille > 0 ? retenus / taille : null, cohortes, taille, exclues };
  });
}
