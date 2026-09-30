// LES DÉTECTIONS À L'ÉCRAN (refonte du monitoring, vague 3b) — logique pure, testée
// sans base ni React.
//
// Deux usages sur la Vue d'ensemble :
//   1. le HERO « observé / attendu » (A2 § 6.1) : la plage habituelle de chaque heure
//      (`vital_horaire`, lue par `chargeurs/detections-accueil.ts`) posée sur la
//      grille du graphique, et les épisodes (`signal_detecte`, détecteur `plage`)
//      marqués par colonnes ;
//   2. les CARTES DE CONSTATS (A2 § 7.6) : les constats ouverts, triés par priorité,
//      chacun avec sa preuve chiffrée, son effectif et sa méthode.
//
// RÈGLES QUI NE SE NÉGOCIENT PAS (A2 § 8) :
//   · jamais de bande avant le minimum d'historique, ni « approximative » : une
//     heure sans plage calculée reste sans bande, et la légende dit pourquoi ;
//   · une p75 ne se moyenne pas : la plage est HORAIRE, elle n'est posée que sur une
//     grille d'une heure, et seulement sur la population entière de l'app (celle
//     que le calcul a vue) — sous un filtre, la comparaison serait fausse ;
//   · le vocabulaire : « plage habituelle », « écarts robustes », « détecté par
//     calcul », « depuis ». Le test de gabarit (`detections-horaires.test.ts`) relit
//     ce fichier.
import type { AnomalyRow } from "./health-libelles";
import { formatDuVital, formater, type VitalName } from "./fmt-ids";
import { FUSEAU_AFFICHAGE } from "./fuseau-local";
import type { Fil } from "@mip/console-contract";
import type { Constat as ConstatLu, LectureConstats, LectureVitalHoraire } from "./queries-detections";

const HEURE_S = 3600;

/** Historique minimal d'une plage (le niveau « 48 dernières heures », A2 § 7.1). */
export const JOURS_HISTORIQUE_MIN = 2;

/** Le libellé de la bande, écrit tel quel dans la légende du graphique. */
export const LIBELLE_PLAGE = "Plage habituelle";

/** La phrase d'une plage pas encore calculable : jamais de bande « en attendant ». */
export const PHRASE_PLAGE_PAS_CALCULEE = `Plage habituelle : pas encore calculée (il faut ${JOURS_HISTORIQUE_MIN} jours d'historique horaire, à 13 mesures ou plus par heure).`;

type Constat = Fil<ConstatLu>;

/** Le filtre de population de la page, réduit à ce qui compte ici. */
export interface PopulationPage {
  device?: string;
  browser?: string;
  os?: string;
  env?: string;
  service?: string;
  release?: string;
  route?: string;
  country?: string;
  includeBots: boolean;
  includeInternal: boolean;
  segments: readonly unknown[];
}

/**
 * Pourquoi la plage NE PEUT PAS être posée sur ce graphique (ou `null` : elle le
 * peut). Lu AVANT la lecture de `vital_horaire` : un cas sans objet ne coûte rien.
 */
export function raisonSansPlage(e: { seauSecondes: number; filtres: PopulationPage; modeRelease: boolean }): string | null {
  if (e.modeRelease) return "Plage habituelle : non tracée en comparaison de releases (elle est calculée sur toute la population de l'app).";
  const f = e.filtres;
  const filtre = f.device || f.browser || f.os || f.env || f.service || f.release || f.route || f.country || f.includeBots || f.includeInternal || f.segments.length > 0;
  if (filtre) return "Plage habituelle : non tracée sous un filtre de population (elle est calculée sur toute la population de l'app).";
  if (e.seauSecondes !== HEURE_S)
    return "Plage habituelle : tracée en tranches d'une heure seulement (une p75 horaire ne se moyenne pas) ; choisissez une période de 14 jours au plus.";
  return null;
}

/** Une heure de la plage, posée sur la grille. */
export interface PlageHeure {
  bas: number;
  haut: number;
  mediane: number;
  /** Écart robuste de l'heure, s'il a été évalué. */
  z: number | null;
}

/** Ce que le hero reçoit pour un vital. */
export type PlageHero =
  | { etat: "tracee"; parInstant: Record<string, PlageHeure>; episodes: EpisodeGrille[]; legende: string; heures: number }
  | { etat: "non_tracee"; raison: string };

/** Un épisode, en bornes de la grille (le premier et le dernier seau qu'il recoupe). */
export interface EpisodeGrille {
  x1: string;
  x2: string;
  enCours: boolean;
}

const instant = (t: string) => Date.parse(t);

/**
 * Les épisodes du détecteur `plage` pour un vital (toutes routes), en seaux de la
 * grille. Un épisode hors de la grille est ignoré ; un épisode en cours s'étend
 * jusqu'au dernier seau.
 */
export function episodesSurGrille(grille: readonly string[], seauSecondes: number, constats: readonly Constat[], vital: string): EpisodeGrille[] {
  if (grille.length === 0) return [];
  const entite = `vital:${vital}`;
  const seauMs = seauSecondes * 1000;
  const out: EpisodeGrille[] = [];
  for (const c of constats) {
    if (c.detecteur !== "plage" || c.entite !== entite) continue;
    const de = instant(c.debut);
    const a = c.fin == null ? Infinity : instant(c.fin);
    const dedans = grille.filter((t) => instant(t) + seauMs > de && instant(t) < a);
    if (dedans.length === 0) continue;
    out.push({ x1: dedans[0], x2: dedans[dedans.length - 1], enCours: c.fin == null });
  }
  return out;
}

/**
 * La plage d'un vital pour le hero, d'après la lecture de `vital_horaire` : tracée
 * si au moins une heure de la grille a sa plage, sinon la raison — table absente,
 * app à choisir, historique insuffisant, lecture en échec. JAMAIS une bande inventée.
 */
export function plageDuHero(
  lecture: { ok: true; data: Fil<LectureVitalHoraire> } | { ok: false } | null,
  grille: readonly string[],
  seauSecondes: number,
  constats: readonly Constat[],
  vital: string,
): PlageHero {
  if (lecture == null) return { etat: "non_tracee", raison: PHRASE_PLAGE_PAS_CALCULEE };
  if (!lecture.ok) return { etat: "non_tracee", raison: "Plage habituelle : lecture en échec." };
  const l = lecture.data;
  if (l.etat === "absent") return { etat: "non_tracee", raison: "Plage habituelle : pas encore calculée (le calcul horaire n'est pas encore en place sur cette base)." };
  if (l.etat === "une_app_requise") return { etat: "non_tracee", raison: "Plage habituelle : choisissez une application (une p75 ne se compare pas entre applications)." };
  if (!l.bande) return { etat: "non_tracee", raison: "Plage habituelle : tracée sur 14 jours au plus." };
  const surGrille = new Set(grille.map(instant));
  const parInstant: Record<string, PlageHeure> = {};
  let legende: string | null = null;
  for (const p of l.points) {
    if (!p.attendu || !surGrille.has(instant(p.heure))) continue;
    const t = grille.find((g) => instant(g) === instant(p.heure))!;
    parInstant[t] = { bas: p.attendu.bas, haut: p.attendu.haut, mediane: p.attendu.mediane, z: p.z };
    legende ??= p.attendu.legende;
  }
  const heures = Object.keys(parInstant).length;
  if (heures === 0 || legende == null) return { etat: "non_tracee", raison: PHRASE_PLAGE_PAS_CALCULEE };
  return { etat: "tracee", parInstant, episodes: episodesSurGrille(grille, seauSecondes, constats, vital), legende, heures };
}

// ─────────────────────────────── Cartes de constats ───────────────────────────────

const LIBELLE_DETECTEUR: Record<string, string> = {
  plage: "Plage habituelle dépassée",
  rupture: "Rupture datée",
  release: "Écart après un déploiement",
  surrep: "Valeur sur-représentée",
  segment_lent: "Segment plus lent que le reste",
  prevision: "Franchissement de seuil projeté",
  erreur: "Erreur nouvelle ou en hausse",
  trafic: "Écart de trafic",
};

/** Le nombre de cartes montrées au plus (A2 § 7.6). */
export const CARTES_MAX = 5;

export interface LigneMethode {
  libelle: string;
  valeur: string;
}

export interface CarteConstat {
  id: number;
  /** Le fait, en une ligne : « LCP p75 au-dessus de sa plage habituelle depuis 14:00 ». */
  titre: string;
  /** La preuve chiffrée : « 3,1 s contre 2,2 s habituellement · +41 % · 3,4 écarts robustes ». */
  preuve: string | null;
  /** L'effectif : « 312 mesures dans l'heure (4 % des mesures de l'app) ». */
  effectif: string | null;
  /** La phrase rédigée au calcul, lue telle quelle. */
  phrase: string | null;
  priorite: number;
  niveauPriorite: "haute" | "moyenne" | "basse";
  enCours: boolean;
  methode: LigneMethode[];
}

const nombre = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const texte = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const decimal = (v: number, chiffres = 1) => v.toLocaleString("fr-FR", { minimumFractionDigits: chiffres, maximumFractionDigits: chiffres });

/** « 14:00 » le jour même, « 29/09 14:00 » sinon (fuseau d'affichage). */
export function horodatageCourt(iso: string, maintenantMs: number = Date.now(), fuseau: string = FUSEAU_AFFICHAGE): string {
  const jour = (ms: number) => new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, day: "2-digit", month: "2-digit" }).format(ms);
  const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: fuseau, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(Date.parse(iso));
  const ms = Date.parse(iso);
  return jour(ms) === jour(maintenantMs) ? heure : `${jour(ms)} ${heure}`;
}

export function niveauPriorite(p: number): CarteConstat["niveauPriorite"] {
  return p >= 0.5 ? "haute" : p >= 0.2 ? "moyenne" : "basse";
}

/** Une carte, d'après un constat lu. Les chiffres viennent de `preuves` et `impact`, jamais d'ailleurs. */
export function carteDeConstat(c: Constat, maintenantMs: number = Date.now()): CarteConstat {
  const pr = c.preuves as Record<string, unknown>;
  const im = c.impact as Record<string, unknown>;
  const me = c.methode as Record<string, unknown>;
  const vital = texte(pr.vital) as VitalName | null;
  const route = texte(pr.route);
  const depuis = horodatageCourt(c.debut, maintenantMs);
  const enCours = c.fin == null;
  const quand = enCours ? `depuis ${depuis}` : `de ${depuis} à ${horodatageCourt(c.fin!, maintenantMs)}`;

  let titre: string;
  let preuve: string | null = null;
  if (c.detecteur === "plage" && vital) {
    titre = `${vital} p75${route ? ` de ${route}` : ""} au-dessus de sa plage habituelle ${quand}`;
    const format = formatDuVital(vital);
    const valeur = nombre(pr.p75);
    const habituel = nombre(pr.mediane_habituelle);
    const z = nombre(pr.z);
    const ecart = nombre(pr.ecart_relatif);
    const morceaux: string[] = [];
    if (valeur != null && habituel != null) morceaux.push(`${formater(format, valeur)} contre ${formater(format, habituel)} habituellement`);
    if (ecart != null) morceaux.push(`${ecart >= 0 ? "+" : "−"}${Math.round(Math.abs(ecart) * 100)} %`);
    if (z != null) morceaux.push(`${decimal(z)} écarts robustes`);
    preuve = morceaux.length ? morceaux.join(" · ") : null;
  } else {
    titre = `${LIBELLE_DETECTEUR[c.detecteur] ?? "Constat"} — ${c.entite} ${quand}`;
  }

  const mesures = nombre(im.mesures);
  const part = nombre(im.part_mesures);
  const effectif =
    mesures != null
      ? `${formater("count", mesures)} mesures dans l'heure${part != null && part < 1 ? ` (${Math.max(1, Math.round(part * 100))} % des mesures de l'app)` : ""}`
      : null;

  const methode: LigneMethode[] = [];
  const pousser = (libelle: string, v: unknown) => {
    const s = typeof v === "number" ? decimal(v, Number.isInteger(v) ? 0 : 1) : texte(v);
    if (s) methode.push({ libelle, valeur: s });
  };
  pousser("Méthode", me.nom);
  pousser("Référence", me.legende);
  pousser("Heures de référence", me.references);
  pousser("Règle", me.regle);
  pousser("Mesures minimales par heure", me.mesures_min_heure);
  methode.push({ libelle: "Priorité", valeur: `${decimal(c.priorite, 2)} (part touchée × ampleur de l'écart × confiance)` });
  methode.push({ libelle: "Origine", valeur: "détecté par calcul, règle publiée ; aucun texte n'est rédigé par un modèle de langage" });

  return {
    id: c.id,
    titre,
    preuve,
    effectif,
    phrase: c.phrase,
    priorite: c.priorite,
    niveauPriorite: niveauPriorite(c.priorite),
    enCours,
    methode,
  };
}

/**
 * Les cartes de la colonne « constats » : les constats OUVERTS, triés par priorité
 * décroissante (puis le plus récent d'abord), `max` au plus. Les clos se lisent
 * sur le graphique (colonnes d'épisodes), pas en carte.
 */
export function cartesConstats(lecture: Fil<LectureConstats> | null, max = CARTES_MAX, maintenantMs: number = Date.now()) {
  if (!lecture || lecture.etat === "absent") return { cartes: [] as CarteConstat[], ouverts: 0, clos: 0, calcul: false };
  const ouverts = lecture.constats.filter((c) => c.statut === "ouvert");
  const tries = [...ouverts].sort((a, b) => b.priorite - a.priorite || Date.parse(b.debut) - Date.parse(a.debut));
  return {
    cartes: tries.slice(0, max).map((c) => carteDeConstat(c, maintenantMs)),
    ouverts: ouverts.length,
    clos: lecture.constats.length - ouverts.length,
    calcul: true,
  };
}

/**
 * SANS DOUBLON avec les constats de la bande historique (`InsightStrip`) : une
 * anomalie LCP de `v_anomaly` que recouvre un épisode détecté sur la même série
 * (même route, heure dans l'épisode) n'est pas redite — la plage habituelle, plus
 * robuste, la remplace.
 */
export function anomaliesSansDoublon<A extends Pick<Fil<AnomalyRow>, "route" | "bucket">>(anomalies: readonly A[], constats: readonly Constat[]): A[] {
  const episodes = constats.filter((c) => c.detecteur === "plage");
  if (episodes.length === 0) return [...anomalies];
  return anomalies.filter((a) => {
    const entite = a.route ? `vital:LCP|route:${a.route}` : "vital:LCP";
    const t = Date.parse(String(a.bucket));
    return !episodes.some((e) => e.entite === entite && t >= Date.parse(e.debut) && (e.fin == null || t < Date.parse(e.fin)));
  });
}

/**
 * LA PHRASE DE LA PLAGE, au-dessus des petits multiples : ce que montrent le gris
 * et les colonnes quand la plage est tracée (sa référence, dite une fois), sinon
 * pourquoi elle ne l'est pas — une raison, dite une fois même si trois vitals la
 * partagent.
 */
export function phrasePlagesHero(plages: readonly (PlageHero | undefined)[]): { etat: "tracee" | "non_tracee"; texte: string } | null {
  const lues = plages.filter((p): p is PlageHero => p !== undefined);
  if (lues.length === 0) return null;
  const tracees = lues.filter((p): p is Extract<PlageHero, { etat: "tracee" }> => p.etat === "tracee");
  if (tracees.length > 0) {
    const legendes = [...new Set(tracees.map((p) => p.legende))];
    const episodes = tracees.reduce((n, p) => n + p.episodes.length, 0);
    const raisons = [...new Set(lues.flatMap((p) => (p.etat === "non_tracee" ? [p.raison] : [])))];
    return {
      etat: "tracee",
      texte:
        `Gris : plage habituelle de chaque heure (± 3 écarts robustes autour de la médiane ; référence : ${legendes.join(" ; ")}). ` +
        (episodes > 0
          ? `Colonnes framboise : ${episodes === 1 ? "un épisode" : `${episodes} épisodes`} hors plage, détecté par calcul.`
          : "Aucun épisode hors plage sur la période.") +
        (raisons.length ? ` ${raisons.join(" ")}` : ""),
    };
  }
  const raisons = [...new Set(lues.map((p) => (p.etat === "non_tracee" ? p.raison : "")))].filter(Boolean);
  return { etat: "non_tracee", texte: raisons.join(" ") };
}
