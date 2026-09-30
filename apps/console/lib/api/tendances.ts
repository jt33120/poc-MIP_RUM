// `GET /api/v1/trends` — la réponse, construite à partir des lectures. PURE : ni
// base, ni next/* (la route lit, ce module assemble ; testé par
// tests/unit/api-v1-trends.test.ts).
//
// UN SEUL CALCUL. Chaque vital passe par `analyserSerieQuotidienne` (`@mip/stats`),
// la fonction qu'appellent l'écran « Tendances » et la Vue d'ensemble pour le LCP :
// même droite, même règle de bruit, même échéance, même test de Pettitt. L'API ne
// fait qu'étendre la question aux cinq vitals et la rendre en données.
//
// CE QUE LA RÉPONSE NE DIT PAS. Ni verdict ni échéance pour une série trop courte
// ou dont la pente reste dans le bruit : l'état le dit (`insuffisante`, `bruit`,
// `non_ecrit`), avec ce qui manque EN CHIFFRES (`joursValides` sur `joursRequis`,
// `manque` du refus de datation). Jamais une valeur par défaut.
import { analyserSerieQuotidienne } from "@mip/stats/serie-quotidienne";
import {
  REGLE_RUPTURE,
  phraseRupture,
  phraseSansRupture,
  type Datation,
  type DeploiementJour,
} from "@mip/stats/rupture";
import { MESURES_MIN_JOUR, REGLE_TENDANCE, type Echeance, type Tendance } from "@mip/stats/tendance";
import type { Resultat } from "@mip/stats/types";
import { formatDuVital, formater, VITAUX, type VitalName } from "../fmt-ids";
import { THRESHOLDS } from "../rating";

/** Les jours des Tendances : 14 jours COMPLETS, journée en cours exclue (`GRID_DAYS`). */
export const JOURS_TENDANCES = 14;

/**
 * Les réserves d'interprétation d'une rupture datée (RM5) : écrites par qui affiche,
 * jamais par le calcul (un test interdit le mot à `@mip/stats/rupture`). L'écran
 * « Tendances » et l'API écrivent les mêmes.
 */
export const RESERVE_COINCIDENCE = "Coïncidence de date, pas une cause établie.";
export const RESERVE_TENDANCE_ETABLIE =
  "La tendance est par ailleurs établie sur la même fenêtre : une dérive régulière sépare la série aussi nettement qu'une marche, la date est donc un point de bascule et non la preuve d'un saut.";

/** Un jour lu : la p75 du jour et son effectif (`dailyVitalsSeries`). */
export interface JourLu {
  jour: string;
  p75: number | null;
  n: number;
}

export interface TendanceVitalApi {
  nom: VitalName;
  /** Borne « Bon » INCLUSE (web.dev, `lib/rating.ts`) : l'égalité est encore « Bon ». */
  borneBon: number;
  /** « ms » pour les durées, « score » pour le CLS (sans unité). */
  unite: "ms" | "score";
  /** Un point par jour de la fenêtre, jours vides compris (`p75: null`, `n: 0`). */
  serie: JourLu[];
  tendance: {
    etat: Tendance["etat"];
    jours: number;
    joursValides: number;
    joursRequis: number;
    /** Mesures sous lesquelles un jour est creux et n'entre pas dans la droite. */
    mesuresMinJour: number;
    /** Variation par jour de la droite ajustée ; `null` sans droite. */
    pente: number | null;
    /** Valeur de la droite au PREMIER jour de la fenêtre (rang 0) ; `null` sans droite. */
    ordonnee: number | null;
    /** Écart type des résidus autour de la droite ; `null` sans droite. */
    dispersion: number | null;
    /** Dernière valeur retenue par la droite : celle contre laquelle l'échéance se calcule. */
    courant: number | null;
  };
  echeance: Echeance;
  /** La datation (test de Pettitt) : rupture datée, absence de rupture, ou refus chiffré. */
  rupture: Resultat<Datation>;
  /** Le déploiement à ± 1 jour de la rupture datée : une coïncidence de date. */
  deploiement: DeploiementJour | null;
  /** La phrase de l'écran « Tendances », réserves comprises ; ou le refus en toutes lettres. */
  phrase: string;
}

export interface TendancesApi {
  fenetre: { jours: number; du: string | null; au: string | null; fuseau: string; journeeEnCours: "exclue" };
  regles: { tendance: string; rupture: string };
  vitals: TendanceVitalApi[];
}

/** « Le LCP p75 », « Le CLS p75 » : le nom porte son article (`phraseRupture`). */
function nomDuVital(nom: VitalName): string {
  return `Le ${nom} p75`;
}

/**
 * La phrase de datation, comme l'écran « Tendances » l'écrit sous son graphe :
 * la rupture et ses réserves, l'absence de rupture, ou le refus chiffré.
 */
export function phraseDatation(
  nom: VitalName,
  analyse: Pick<ReturnType<typeof analyserSerieQuotidienne>, "datation" | "deploiement" | "tendance">,
): string {
  const { datation, deploiement, tendance } = analyse;
  if (!datation.ok) return `${nom} p75 — ${datation.raison}.`;
  if (!datation.rupture) return `${nom} p75 — ${phraseSansRupture(datation, tendance.etat === "significative")}`;
  const format = formatDuVital(nom);
  return [
    phraseRupture(datation.rupture, nomDuVital(nom), (v) => formater(format, v), deploiement),
    deploiement ? RESERVE_COINCIDENCE : null,
    tendance.etat === "significative" ? RESERVE_TENDANCE_ETABLIE : null,
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * La réponse de `GET /api/v1/trends` : pour chaque vital, sa série de quatorze
 * jours analysée d'un bloc.
 *
 * @param series séries par nom de vital (`dailyVitalsSeries`, journée en cours exclue)
 * @param deploiements marqueurs ramenés au jour de l'app
 * @param fuseau fuseau de l'app, dans lequel les jours sont découpés
 */
export function tendancesDesVitals(
  series: Readonly<Record<string, readonly JourLu[]>>,
  deploiements: readonly DeploiementJour[],
  fuseau: string,
): TendancesApi {
  const vitals = VITAUX.map((nom): TendanceVitalApi => {
    const serie = [...(series[nom] ?? [])];
    const borneBon = THRESHOLDS[nom][0];
    const analyse = analyserSerieQuotidienne(
      serie.map((j) => ({ jour: j.jour, valeur: j.p75, effectif: j.n })),
      { borne: borneBon, deploiements },
    );
    const t = analyse.tendance;
    return {
      nom,
      borneBon,
      unite: nom === "CLS" ? "score" : "ms",
      serie,
      tendance: {
        etat: t.etat,
        jours: t.jours,
        joursValides: t.joursValides,
        joursRequis: t.joursRequis,
        mesuresMinJour: MESURES_MIN_JOUR,
        pente: t.fit?.slope ?? null,
        ordonnee: t.fit?.intercept ?? null,
        dispersion: t.dispersion,
        courant: analyse.courant,
      },
      // Une borne est toujours passée : l'échéance existe pour chaque vital.
      echeance: analyse.echeance as Echeance,
      rupture: analyse.datation,
      deploiement: analyse.deploiement,
      phrase: phraseDatation(nom, analyse),
    };
  });
  const jours = vitals.find((v) => v.serie.length > 0)?.serie.map((j) => j.jour) ?? [];
  return {
    fenetre: { jours: JOURS_TENDANCES, du: jours[0] ?? null, au: jours.at(-1) ?? null, fuseau, journeeEnCours: "exclue" },
    regles: { tendance: REGLE_TENDANCE, rupture: REGLE_RUPTURE },
    vitals,
  };
}
