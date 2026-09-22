// Annotations des séries temporelles (F08, plan § 3.7, P9) — construction PURE,
// testée, sans accès base. F67 y ajoutera les déclenchements d'alerte.
//
// LA FENÊTRE EST APPLIQUÉE ICI. `listDeploys(f, 20)` lit les 20 derniers marqueurs
// du périmètre SANS borne de temps : un déploiement d'avant-hier n'a rien à faire
// sur la série d'une heure. On garde les marqueurs dont l'instant est dans
// `[from, to)` — la même convention que le contrat (V6).
//
// SOUS PLAGE PERSONNALISÉE, ON NE SAIT PAS. Les 20 derniers marqueurs peuvent ne pas
// remonter jusqu'au début d'une plage choisie dans le passé ; afficher ceux qu'on a
// laisserait croire qu'il n'y en a pas eu d'autres. Tant que la lecture n'est pas
// migrée sur la fenêtre du contrat (backend B1), la figure le DIT
// (`annotationsIndisponibles`) et ne dessine aucun marqueur.
//
// AU-DELÀ DE 6, ON REGROUPE. Sept traits verticaux sur une série de 220 px ne se
// lisent plus : une seule annotation « N déploiements » les remplace, et son lien
// ouvre la liste (tous les marqueurs restent atteignables, rien n'est tronqué).
import type { DeployRow } from "./queries-deploys";
import type { ResolvedRange } from "./query-contract";
import type { Annotation } from "./series";

/** Au-delà de ce nombre dans la fenêtre, les annotations sont regroupées. */
export const MAX_ANNOTATIONS = 6;

/** Texte du message B1 (§ 3.7), repris tel quel par chaque figure. */
export const RAISON_B1 = "déploiements non affichés sur une plage personnalisée (lecture non migrée)";

/** Un instant `Date` (node-postgres) ou ISO → millisecondes ; illisible → `null`. */
function instant(ts: Date | string): number | null {
  const ms = ts instanceof Date ? ts.getTime() : Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

/** Dans `[from, to)`, bornes ISO UTC du contrat. */
export function dansLaFenetre(ts: Date | string, fenetre: Pick<ResolvedRange, "from" | "to">): boolean {
  const ms = instant(ts);
  return ms !== null && ms >= Date.parse(fenetre.from) && ms < Date.parse(fenetre.to);
}

/**
 * Raison pour laquelle les déploiements ne peuvent pas être annotés sur cette
 * plage, ou `null`. Sous plage personnalisée (`preset: null`), tant que B1 manque.
 */
export function annotationsIndisponibles(range: Pick<ResolvedRange, "preset">): string | null {
  return range.preset === null ? RAISON_B1 : null;
}

export interface OptionsDeploiements {
  /**
   * Lien d'une annotation de déploiement (§ 3.3) : écran courant avec
   * `cmp=release&rel_b=<version>&rel_a=<version précédente>` — calculé par
   * l'appelant (`hrefWithQuery`), qui connaît l'écran et la requête.
   */
  lien: (relB: string, relA: string | null) => string;
  /** Destination de l'annotation regroupée : la liste des déploiements (ancre, panneau…). */
  lienListe?: string;
}

export interface AnnotationsDeploiements {
  /** À passer à `ThresholdSeries` / `StackedBars` : au plus `MAX_ANNOTATIONS` traits. */
  annotations: Annotation[];
  /** Tous les déploiements de la fenêtre, du plus ancien au plus récent : la liste qu'ouvre le regroupement. */
  liste: Annotation[];
  /** Raison d'absence (B1) : à passer en `annotationsIndisponibles`. */
  indisponible: string | null;
}

/**
 * Marqueurs de déploiement → annotations de la fenêtre.
 *
 * `deploys` dans l'ordre de `listDeploys` (du plus récent au plus ancien) ; la
 * version « précédente » d'un marqueur est celle du marqueur suivant de la liste
 * qui porte une AUTRE version (un redéploiement de la même version n'est pas une
 * version précédente) — cherchée dans toute la liste, pas seulement la fenêtre :
 * le déploiement d'avant peut précéder la plage affichée.
 */
export function annotationsDeploiements(
  deploys: readonly Pick<DeployRow, "ts" | "version">[],
  range: Pick<ResolvedRange, "from" | "to" | "preset">,
  options: OptionsDeploiements,
): AnnotationsDeploiements {
  const indisponible = annotationsIndisponibles(range);
  if (indisponible) return { annotations: [], liste: [], indisponible };

  const tries = deploys
    .map((d) => ({ d, ms: instant(d.ts) }))
    .filter((x): x is { d: Pick<DeployRow, "ts" | "version">; ms: number } => x.ms !== null)
    .sort((a, b) => b.ms - a.ms);

  const liste: Annotation[] = [];
  tries.forEach(({ d, ms }, i) => {
    if (!dansLaFenetre(new Date(ms), range)) return;
    const t = new Date(ms).toISOString();
    if (!d.version) {
      liste.push({ t, libelle: "Déploiement sans version", type: "deploiement" });
      return;
    }
    const precedente = tries.slice(i + 1).find((x) => x.d.version && x.d.version !== d.version)?.d.version ?? null;
    liste.push({ t, libelle: d.version, type: "deploiement", href: options.lien(d.version, precedente) });
  });
  liste.reverse();

  if (liste.length <= MAX_ANNOTATIONS) return { annotations: liste, liste, indisponible: null };
  // Le regroupement se pose sur le plus récent : c'est lui qu'on cherche d'abord.
  const groupe: Annotation = {
    t: liste[liste.length - 1].t,
    libelle: `${liste.length} déploiements`,
    type: "deploiement",
    ...(options.lienListe ? { href: options.lienListe } : {}),
  };
  return { annotations: [groupe], liste, indisponible: null };
}
