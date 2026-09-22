// Satisfaction déclarée — logique PURE (aucune I/O), testée unitairement : CSAT,
// note moyenne, répartition des notes. Les entrées sont des primitives : la couche
// SQL (queries-experience) les fournit, la couche UI les affiche.
//
// Le « score d'expérience /100 » qui vivait ici a été retiré : il pondérait au
// jugé des paliers de LCP sans source. L'écran montre désormais ses constituants
// côte à côte, chacun avec sa source.

/** Une note ≥ 4/5 (ou 👍) compte comme positive. */
export const CSAT_POSITIVE = 4;

/** Part de retours positifs (score ≥ CSAT_POSITIVE). null si aucun feedback. */
export function csatRatio(scores: number[]): number | null {
  if (!scores.length) return null;
  const pos = scores.filter((s) => s >= CSAT_POSITIVE).length;
  return pos / scores.length;
}

/** Note moyenne (1..5). null si aucun feedback. */
export function avgScore(scores: number[]): number | null {
  if (!scores.length) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** Répartition promoteurs (5) / passifs (3–4) / détracteurs (1–2). */
export function breakdown(scores: number[]): { promoters: number; passives: number; detractors: number } {
  let promoters = 0, passives = 0, detractors = 0;
  for (const s of scores) {
    if (s >= 5) promoters++;
    else if (s >= 3) passives++;
    else detractors++;
  }
  return { promoters, passives, detractors };
}

// ─────────────────────────── F26 — écran Satisfaction ───────────────────────────
//
// Ce que l'écran a le droit de tirer des lectures (plan § 5.5). Un seul principe :
// sans avis noté, il n'y a PAS de satisfaction — ni 0 %, ni 100 %. Un jour sans
// avis est un trou dans la courbe ; une page qui n'a reçu que des commentaires
// n'a pas de CSAT.

/** Sous ce nombre d'avis, une part est un « échantillon faible » (§ 3.12 : 10 pour les avis). */
export const AVIS_FAIBLE_SOUS = 10;
/** Nuage « Ressenti face au LCP » : pages avec au moins 10 avis, trois pages au moins. */
export const AVIS_MIN_NUAGE = 10;
export const PAGES_MIN_NUAGE = 3;

/** Part `k / n` ; aucun avis noté (`n = 0`) → `null`, jamais 0. Bornée à [0, 1]. */
export function partPositive(k: number, n: number): number | null {
  if (!(n > 0) || !Number.isFinite(k)) return null;
  return Math.min(1, Math.max(0, k / n));
}

export interface RepartitionNote {
  cle: "promoteurs" | "passifs" | "detracteurs";
  libelle: string;
  n: number;
  /** Part des avis notés ; `null` sans avis. */
  part: number | null;
}

/**
 * « Répartition des notes » (§ 5.5.3) : trois parts d'un même tout — l'empilement
 * est vrai. Le libellé nomme les notes, pas un état de mesure (aucune couleur de
 * verdict : une note n'est pas une mesure au regard d'un seuil).
 */
export function repartitionNotes(s: { count: number; promoters: number; passives: number; detractors: number }): RepartitionNote[] {
  return [
    { cle: "promoteurs", libelle: "Notes 5", n: s.promoters, part: partPositive(s.promoters, s.count) },
    { cle: "passifs", libelle: "Notes 3-4", n: s.passives, part: partPositive(s.passives, s.count) },
    { cle: "detracteurs", libelle: "Notes 1-2", n: s.detractors, part: partPositive(s.detractors, s.count) },
  ];
}

/** Une page vue par les avis (`feedbackByRoute`). */
export interface AvisParPage {
  route: string | null;
  count: number;
  positives: number;
  detracteurs: number;
}

/** LCP d'une page (`vitalsBreakdown(f, "route", 200)`). */
export interface LcpParPage {
  valeur: string | null;
  lcp_p75: number | null;
  lcp_n: number;
}

export interface LigneSatisfactionPage {
  route: string | null;
  /** Avis notés de la page. */
  avis: number;
  /** Avis notés 4 ou 5 (numérateur du CSAT, pour son intervalle). */
  positifs: number;
  /** CSAT de la page (part d'avis ≥ 4/5) ; `null` sans avis noté. */
  csat: number | null;
  /** Pilote du classement : part d'avis NON positifs (1 − CSAT) ; `null` sans avis noté. */
  nonPositifs: number | null;
  /** Part de notes 1-2 ; `null` sans avis noté. */
  partDetracteurs: number | null;
  /** LCP p75 de la même route ; `null` si non mesuré (ou route inconnue). */
  lcp: number | null;
  lcpN: number | null;
}

/**
 * « Satisfaction par page » : les pages lues par `feedbackByRoute`, jointes à leur
 * LCP p75 par ROUTE. Une page absente des Web Vitals garde son CSAT et un LCP
 * `null` ; la route « toute l'app » (`null`) n'a pas de LCP de route.
 */
export function lignesSatisfactionParPage(pages: readonly AvisParPage[], lcp: readonly LcpParPage[]): LigneSatisfactionPage[] {
  const parRoute = new Map(lcp.filter((l) => l.valeur !== null).map((l) => [l.valeur as string, l]));
  return pages.map((p) => {
    const csat = partPositive(p.positives, p.count);
    const l = p.route === null ? undefined : parRoute.get(p.route);
    return {
      route: p.route,
      avis: p.count,
      positifs: p.positives,
      csat,
      nonPositifs: csat === null ? null : 1 - csat,
      partDetracteurs: partPositive(p.detracteurs, p.count),
      lcp: l?.lcp_p75 ?? null,
      lcpN: l ? l.lcp_n : null,
    };
  });
}

export interface PointRessenti {
  route: string;
  lcp: number;
  csat: number;
  avis: number;
}

/**
 * Nuage « Ressenti face au LCP, par page » : pages nommées, au moins `minAvis` avis
 * notés et un LCP p75 mesuré. Sous `PAGES_MIN_NUAGE` pages éligibles, pas de nuage
 * (`suffisant: false`) : deux points ne disent rien d'un lien.
 */
export function nuageRessenti(
  lignes: readonly LigneSatisfactionPage[],
  minAvis: number = AVIS_MIN_NUAGE,
): { points: PointRessenti[]; eligibles: number; suffisant: boolean } {
  const points: PointRessenti[] = [];
  for (const l of lignes) {
    if (l.route === null || l.avis < minAvis || l.lcp === null || l.csat === null) continue;
    points.push({ route: l.route, lcp: l.lcp, csat: l.csat, avis: l.avis });
  }
  return { points, eligibles: points.length, suffisant: points.length >= PAGES_MIN_NUAGE };
}

// ─────────────── Frustration pour 1 000 sessions : garde de capteur (R-F) ───────────────
//
// La garde est UNE règle de la console, écrite une fois par F22 pour `/ux`
// (`etatCapteurFrustration`, lib/perf-domain.ts) : même capteur, mêmes textes, même
// décision de masquer. Cet écran n'y ajoute que son taux.
import { etatCapteurFrustration, type EtatCapteurFrustration } from "./perf-domain";

/**
 * Taux « pour 1 000 sessions commencées », avec la garde de capteur de F22 :
 *   - aucune session commencée → `null` « aucune session commencée » ;
 *   - la garde MASQUE (population entièrement React Native) → `null` et
 *     `non_collecte` : jamais « 0,00 », qui se lirait « personne ne s'acharne » là
 *     où personne n'écoute ;
 *   - sinon le taux, sur les seules sessions dont le capteur émet (toutes, si la
 *     colonne `runtime` manque), et l'état `partiel` éventuel de la garde.
 * `n` est le dénominateur effectivement employé (règle d'échantillon faible).
 */
export function frustrationPour1000(
  l: { sessions: number; sessionsCouvertes: number; signaux: number; runtimeLu: boolean },
  plage?: string,
): { valeur: number | null; raisonNull: string | null; n: number; etat: EtatCapteurFrustration | null } {
  const garde = etatCapteurFrustration({ sessionsCouvertes: l.sessionsCouvertes, sessionsTotal: l.sessions, runtimeLu: l.runtimeLu });
  if (!(l.sessions > 0)) {
    return { valeur: null, raisonNull: `aucune session commencée${plage ? ` sur ${plage}` : ""}`, n: 0, etat: garde.etat };
  }
  if (garde.masquer) {
    const manque = garde.etat?.kind === "non_collecte" ? garde.etat.manque : "capteur absent";
    return { valeur: null, raisonNull: `non collecté : ${manque}`, n: 0, etat: garde.etat };
  }
  const n = l.runtimeLu ? l.sessionsCouvertes : l.sessions;
  return { valeur: n > 0 ? (l.signaux / n) * 1000 : null, raisonNull: null, n, etat: garde.etat };
}
