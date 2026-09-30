// `GET /api/v1/detections` — la réponse, construite à partir des constats lus. PURE :
// ni base, ni next/* (testé par tests/unit/api-v1-detections.test.ts).
//
// CE QUI EST SERVI. Les épisodes que le travail `detections_horaires` du scheduler
// a écrits dans `signal_detecte` (v101) : une p75 horaire sortie de sa plage
// habituelle (médiane et écart absolu médian du même créneau, échelle
// logarithmique, `@mip/backend/shared/plage-habituelle.mjs`). L'API ne recalcule
// rien : elle rend ce que le scheduler a constaté, avec la plage qu'il a consignée
// — le même fait que l'encart « Constats » de la console.
//
// LA POPULATION. `vital_horaire` agrège toutes les mesures reçues des cinq vitals,
// robots compris (le calcul horaire ne joint pas les sessions) : ni l'appareil, ni
// une dimension, ni `bots` ne découpent un constat. La route refuse les deux
// premiers (400) ; la réponse le dit pour le troisième (`population`).
import { FRAICHEUR_MAX_MS, MESURES_MIN_HEURE, Z_FERMETURE, Z_OUVERTURE } from "@mip/backend/shared/plage-habituelle.mjs";
import type { Constat, LectureConstats } from "../queries-detections";

/** Constats rendus par défaut, et au plus (la lecture est triée par priorité). */
export const DETECTIONS_DEFAUT = 50;
export const DETECTIONS_MAX = 100;

export const POPULATION_DETECTIONS =
  "toutes les mesures reçues des cinq Core Web Vitals, robots compris : le calcul horaire ne distingue ni les sessions, ni l'appareil, ni les dimensions";

export const REGLE_DETECTIONS =
  `plage habituelle = médiane et écart absolu médian du même créneau (même heure et même jour des 3 à 6 dernières semaines, ` +
  `à défaut même heure des 14 derniers jours, à défaut les 48 dernières heures), échelle logarithmique ; ` +
  `épisode ouvert quand l'écart robuste dépasse ${Z_OUVERTURE} deux heures de suite ou trois heures sur quatre, ` +
  `fermé après deux heures à ${Z_FERMETURE} ou moins ; heure évaluée à partir de ${MESURES_MIN_HEURE} mesures ; ` +
  `détection suspendue sans ingestion depuis ${Math.round(FRAICHEUR_MAX_MS / 60_000)} min`;

/** La plage habituelle consignée par le scheduler à l'heure qui a fait preuve. */
export interface PlageHabituelle {
  mediane: number;
  bas: number;
  haut: number;
  /** « hebdomadaire », « quotidien » ou « 48h » : le niveau de repli retenu. */
  niveau: string | null;
  legende: string | null;
}

/** L'heure qui a fait preuve : sa p75, son intervalle, son effectif et son écart. */
export interface HeureObservee {
  heure: string | null;
  p75: number | null;
  p75Bas: number | null;
  p75Haut: number | null;
  n: number | null;
  /** Écart robuste à la plage (en écarts robustes). */
  z: number | null;
  /** Écart relatif à la médiane habituelle (0,4 = +40 %). */
  ecartRelatif: number | null;
}

export interface DetectionApi {
  id: number;
  app: string;
  detecteur: Constat["detecteur"];
  entite: string;
  /** Le vital de l'entité (« LCP »), `null` si l'entité n'en nomme pas. */
  vital: string | null;
  /** La route de l'entité ; `null` = toutes routes. */
  route: string | null;
  debut: string;
  /** `null` : épisode en cours. */
  fin: string | null;
  statut: Constat["statut"];
  /** impact × ampleur × confiance, dans [0 ; 1]. */
  priorite: number;
  /** Le fait chiffré, rédigé par règles au calcul (jamais par un modèle de langage). */
  phrase: string | null;
  plageHabituelle: PlageHabituelle | null;
  observe: HeureObservee | null;
  methode: Record<string, unknown>;
  preuves: Record<string, unknown>;
  impact: Record<string, unknown>;
}

export interface DetectionsApi {
  /** `absent` : la table n'existe pas encore (v101 non appliquée) — pas une erreur, et pas « aucun épisode ». */
  etat: "ok" | "absent";
  detections: DetectionApi[];
  /** Au plus ce nombre, les plus prioritaires d'abord : `tronque` dit s'il a été atteint. */
  limite: number;
  tronque: boolean;
  population: string;
  regle: string;
}

const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** « vital:LCP|route:/checkout » → { vital, route } ; une clé absente vaut `null`. */
export function lireEntite(entite: string): { vital: string | null; route: string | null } {
  const parties = Object.fromEntries(
    entite.split("|").map((p) => {
      const i = p.indexOf(":");
      return i < 0 ? [p, ""] : [p.slice(0, i), p.slice(i + 1)];
    }),
  );
  return { vital: texte(parties.vital), route: texte(parties.route) };
}

/** Un constat lu, dans la forme de l'API. */
export function detectionDe(c: Constat): DetectionApi {
  const p = c.preuves ?? {};
  const { vital, route } = lireEntite(c.entite);
  const mediane = nombre(p.mediane_habituelle);
  const bas = nombre(p.plage_bas);
  const haut = nombre(p.plage_haut);
  const plageHabituelle =
    mediane !== null && bas !== null && haut !== null
      ? { mediane, bas, haut, niveau: texte(p.niveau) ?? texte(c.methode?.niveau), legende: texte(c.methode?.legende) }
      : null;
  const observe =
    "p75" in p || "z" in p
      ? {
          heure: texte(p.heure),
          p75: nombre(p.p75),
          p75Bas: nombre(p.p75_bas),
          p75Haut: nombre(p.p75_haut),
          n: nombre(p.n),
          z: nombre(p.z),
          ecartRelatif: nombre(p.ecart_relatif),
        }
      : null;
  return {
    id: c.id,
    app: c.appId,
    detecteur: c.detecteur,
    entite: c.entite,
    vital: texte(p.vital) ?? vital,
    route: texte(p.route) ?? route,
    debut: c.debut,
    fin: c.fin,
    statut: c.statut,
    priorite: c.priorite,
    phrase: c.phrase,
    plageHabituelle,
    observe,
    methode: c.methode,
    preuves: c.preuves,
    impact: c.impact,
  };
}

/** La réponse entière, depuis la lecture et la limite appliquée. */
export function detectionsDe(lecture: LectureConstats, limite: number): DetectionsApi {
  const base = { limite, population: POPULATION_DETECTIONS, regle: REGLE_DETECTIONS };
  if (lecture.etat === "absent") return { etat: "absent", detections: [], tronque: false, ...base };
  return { etat: "ok", detections: lecture.constats.map(detectionDe), tronque: lecture.constats.length >= limite, ...base };
}
