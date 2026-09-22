// Ce que la tuile d'un Web Vital a le droit d'affirmer — logique PURE (P*.1, 0-b).
//
// Une p75 mesurée sur peu de mesures bouge beaucoup d'un échantillon à l'autre.
// La tuile disait « Bon » en vert sur 15 mesures sans rien en dire ; elle écrit
// désormais l'intervalle à 95 %, et le verdict n'est affirmé que s'il tient sur
// tout l'intervalle. Extrait de components/VitalCard.tsx pour être testé sans
// rendu (tests/unit/vital-card.test.ts).
import { fmtVital } from "./format";
import { RATING_LABEL, THRESHOLDS, rating2026, type Rating } from "./rating";
import type { IntervalleP75 } from "./stats/incertitude";

export type VerdictVital =
  | { kind: "etabli"; rating: Rating }
  | { kind: "incertain"; de: Rating; a: Rating }
  | { kind: "non_etabli"; raison: string };

export interface LectureVital {
  /** null : pas de p75, ou vital sans seuil publié. */
  verdict: VerdictVital | null;
  /** « entre 2,10 s et 3,00 s (95 %) », ou pourquoi l'intervalle manque. */
  texteIntervalle: string | null;
  /** Position de la moustache sur la jauge, en % de son échelle ; null sans intervalle. */
  moustache: { basPct: number; hautPct: number; auDela: boolean } | null;
  /** Ce que lit un lecteur d'écran : valeur, intervalle, verdict, effectif. */
  ariaLabel: string;
}

/** Échelle de la jauge des seuils : la zone « Mauvais » visible mais bornée. */
export function echelleJauge(name: string): number | null {
  const t = THRESHOLDS[name];
  return t ? t[1] * 1.4 : null;
}

const pct = (v: number, max: number) => Math.min(v / max, 1) * 100;

export function texteVerdict(v: VerdictVital): string {
  if (v.kind === "etabli") return RATING_LABEL[v.rating];
  if (v.kind === "incertain") return `verdict incertain : entre ${RATING_LABEL[v.de]} et ${RATING_LABEL[v.a]}`;
  return `verdict non établi (${v.raison})`;
}

export function lireVital(name: string, p75: number | null, n: number, intervalle?: IntervalleP75): LectureVital {
  if (p75 == null) {
    return { verdict: null, texteIntervalle: null, moustache: null, ariaLabel: `${name} p75 : aucune mesure` };
  }
  const max = echelleJauge(name);
  const ratingP75 = rating2026(name, p75);
  const valeur = `${name} p75 ${fmtVital(name, p75)}`;

  // Appelant qui ne fournit pas d'intervalle : le comportement d'avant, inchangé.
  if (!intervalle) {
    const verdict: VerdictVital | null = ratingP75 ? { kind: "etabli", rating: ratingP75 } : null;
    return {
      verdict,
      texteIntervalle: null,
      moustache: null,
      ariaLabel: [valeur, verdict && texteVerdict(verdict), `${n} mesures`].filter(Boolean).join(", "),
    };
  }

  if ("indisponible" in intervalle) {
    // Sans intervalle, le verdict n'est pas affirmé : la couleur disparaît avec lui.
    const verdict: VerdictVital | null = ratingP75 ? { kind: "non_etabli", raison: intervalle.indisponible } : null;
    const texte = `intervalle non calculable : ${intervalle.indisponible}`;
    return {
      verdict,
      texteIntervalle: texte,
      moustache: null,
      ariaLabel: [valeur, texte, "verdict non établi", `${n} mesures`].join(", "),
    };
  }

  const { bas, haut } = intervalle;
  const deBas = rating2026(name, bas);
  const aHaut = rating2026(name, haut);
  const verdict: VerdictVital | null =
    deBas && aHaut
      ? deBas === aHaut
        ? { kind: "etabli", rating: deBas }
        : { kind: "incertain", de: deBas, a: aHaut }
      : null;
  const auDela = max != null && haut > max;
  const texte = `entre ${fmtVital(name, bas)} et ${fmtVital(name, haut)} (95 %)${auDela ? " — borne haute au-delà de l'échelle" : ""}`;
  return {
    verdict,
    texteIntervalle: texte,
    moustache: max != null ? { basPct: pct(bas, max), hautPct: pct(haut, max), auDela } : null,
    ariaLabel: [
      valeur,
      `intervalle ${fmtVital(name, bas)} à ${fmtVital(name, haut)}`,
      verdict && texteVerdict(verdict),
      `${n} mesures`,
    ]
      .filter(Boolean)
      .join(", "),
  };
}
