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
import type { AlertEventRow } from "./queries-v2";
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

// ────────────────────────── Alertes (F67, plan § 3.7) ──────────────────────────
//
// UNE ALERTE EST UN ÉVÉNEMENT DU TEMPS, comme un déploiement : elle se pose sur la
// série à l'instant où elle s'est déclenchée, et son clic mène à l'écran qui la
// détaille — `/alerts?evt=<id>` (paramètre `evt`, § 3.1). JAMAIS `fired=<id>` :
// `fired` est le NOMBRE d'alertes émises par « Évaluer maintenant », pas un
// identifiant (`app/alerts/page.tsx`).
//
// LA LECTURE N'A PAS DE FENÊTRE NON PLUS. `alertEvents(f)` rend les 100
// déclenchements les plus récents du périmètre, sans borne de temps : la fenêtre
// est appliquée ICI, comme pour `listDeploys`. Et si ces 100 ne remontent pas
// jusqu'au début de la plage, on ne SAIT pas ce qui s'est déclenché avant : la
// figure le dit (`indisponible`) et ne dessine aucun marqueur, plutôt que de
// laisser croire qu'il n'y a rien eu (même règle que B1).
//
// LA ROUTE. Une alerte porte la route de sa règle, ou `null` quand la règle porte
// sur toute l'app. Sur une figure filtrée sur une route (CR7), on garde les deux :
// une alerte de l'app entière concerne AUSSI cette route ; elle est seulement
// étiquetée « (toutes routes) » pour qu'on ne la lise pas comme propre à la route.

/** `alertEvents` rend au plus 100 déclenchements (`queries-v2.ts`). */
export const PLAFOND_ALERTES = 100;

/** Texte dit par la figure quand les 100 derniers ne couvrent pas la plage. */
export const RAISON_ALERTES_TRONQUEES =
  "alertes non affichées : les 100 déclenchements lus ne remontent pas au début de la plage";

/** Ce qu'une annotation d'alerte a besoin de savoir d'un `AlertEventRow`. */
export type EvenementAlerte = Pick<AlertEventRow, "id" | "fired_at" | "metric" | "route" | "app_id">;

export interface OptionsAlertes {
  /** Lien d'une annotation : `/alerts?evt=<id>#evt-<id>` (§ 3.1, § 3.3). */
  lien: (eventId: number) => string;
  /** Destination de l'annotation regroupée : la liste des déclenchements. */
  lienListe?: string;
  /** App de la figure ; absent ou `null` : toutes celles du périmètre. */
  app?: string | null;
  /** Route de la figure ; absent ou `null` : la figure ne porte pas sur une route. */
  route?: string | null;
  /** Nombre d'événements que la lecture peut rendre au plus (défaut `PLAFOND_ALERTES`). */
  plafondLecture?: number;
}

export interface AnnotationsAlertes {
  /** À passer à `ThresholdSeries` / `StackedBars` : au plus `MAX_ANNOTATIONS` traits. */
  annotations: Annotation[];
  /** Tous les déclenchements de la fenêtre, du plus ancien au plus récent. */
  liste: Annotation[];
  /** Raison d'absence (lecture plafonnée) : à passer en `annotationsIndisponibles`. */
  indisponible: string | null;
}

/** Clé de métrique abrégée : `issue:<uuid>` ne tient pas au-dessus d'une série. */
const METRIQUE_MAX = 18;
function abregerMetrique(metric: string): string {
  return metric.length > METRIQUE_MAX ? `${metric.slice(0, METRIQUE_MAX - 1)}…` : metric;
}

/**
 * Déclenchements d'alerte → annotations de la fenêtre (§ 3.7).
 *
 * `evenements` dans l'ordre d'`alertEvents` (du plus récent au plus ancien). Le
 * filtre d'app et de route est celui de la FIGURE, pas celui de l'écran : le hero
 * de `/correlation` porte sur un couple app × route, la série de `/tracing` sur
 * tout le périmètre.
 */
export function annotationsAlertes(
  evenements: readonly EvenementAlerte[],
  range: Pick<ResolvedRange, "from" | "to">,
  options: OptionsAlertes,
): AnnotationsAlertes {
  const plafond = options.plafondLecture ?? PLAFOND_ALERTES;
  const tries = evenements
    .map((e) => ({ e, ms: instant(e.fired_at) }))
    .filter((x): x is { e: EvenementAlerte; ms: number } => x.ms !== null)
    .sort((a, b) => a.ms - b.ms);

  // Lecture plafonnée ET plus ancienne postérieure au début de la plage : ce qui
  // s'est déclenché avant elle n'a pas été lu. On ne dessine rien et on le dit.
  if (evenements.length >= plafond && tries.length > 0 && tries[0].ms > Date.parse(range.from)) {
    return { annotations: [], liste: [], indisponible: RAISON_ALERTES_TRONQUEES };
  }

  const routeFigure = options.route ?? null;
  const liste: Annotation[] = [];
  for (const { e, ms } of tries) {
    if (!dansLaFenetre(new Date(ms), range)) continue;
    if (options.app != null && e.app_id !== options.app) continue;
    if (routeFigure !== null && e.route !== null && e.route !== routeFigure) continue;
    const metrique = abregerMetrique(e.metric ?? "");
    const portee = routeFigure !== null ? (e.route === null ? " (toutes routes)" : "") : e.route ? ` ${e.route}` : "";
    liste.push({
      t: new Date(ms).toISOString(),
      libelle: `Alerte ${metrique}${portee}`,
      type: "alerte",
      href: options.lien(e.id),
    });
  }

  if (liste.length <= MAX_ANNOTATIONS) return { annotations: liste, liste, indisponible: null };
  return { annotations: [regrouper(liste, options.lienListe)], liste, indisponible: null };
}

// ────────────────────── Plusieurs familles sur une figure ──────────────────────
//
// Six traits, c'est ce qu'une série de 220 px porte (§ 3.7). Le compte vaut pour la
// FIGURE, pas par famille : deux familles de six feraient douze traits. Au-delà, la
// famille la plus nombreuse est regroupée à son tour, jusqu'à tenir — on ne perd
// rien, le regroupement ouvre la liste complète.

const NOM_FAMILLE: Record<Annotation["type"], string> = {
  deploiement: "déploiements",
  alerte: "alertes",
  anomalie: "anomalies",
  rupture: "ruptures",
};

/** Une famille d'annotations posée sur la figure (le rendu d'`annotations*`). */
export interface FamilleAnnotations {
  annotations: readonly Annotation[];
  liste: readonly Annotation[];
  /** Destination du regroupement de cette famille. */
  lienListe?: string;
}

/** Annotation qui remplace une liste trop nombreuse, posée sur la plus récente. */
function regrouper(liste: readonly Annotation[], lienListe?: string): Annotation {
  const derniere = liste[liste.length - 1];
  return {
    t: derniere.t,
    libelle: `${liste.length} ${NOM_FAMILLE[derniere.type]}`,
    type: derniere.type,
    ...(lienListe ? { href: lienListe } : {}),
  };
}

/**
 * Annotations de plusieurs familles sur une même figure : au plus `max` traits en
 * tout, du plus ancien au plus récent.
 */
export function fusionnerAnnotations(
  familles: readonly FamilleAnnotations[],
  max = MAX_ANNOTATIONS,
): Annotation[] {
  const retenues = familles
    .filter((f) => f.annotations.length > 0)
    .map((f) => ({ famille: f, courant: [...f.annotations] }));
  const total = () => retenues.reduce((n, r) => n + r.courant.length, 0);
  while (total() > max) {
    const cible = retenues
      .filter((r) => r.courant.length > 1)
      .sort((a, b) => b.courant.length - a.courant.length)[0];
    if (!cible) break;
    const source = cible.famille.liste.length >= cible.courant.length ? cible.famille.liste : cible.courant;
    cible.courant = [regrouper(source, cible.famille.lienListe)];
  }
  return retenues.flatMap((r) => r.courant).sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
}

/**
 * Raisons d'absence de plusieurs familles, en une phrase pour
 * `annotationsIndisponibles` ; `undefined` si toutes les familles sont lisibles.
 */
export function raisonsAnnotations(familles: readonly { indisponible: string | null }[]): string | undefined {
  const raisons = [...new Set(familles.map((f) => f.indisponible).filter((r): r is string => r !== null))];
  return raisons.length > 0 ? raisons.join(" ; ") : undefined;
}
