// Ce qu'un écran affiche d'une note MIP — logique PURE, testée, sans React.
//
// `components/NoteMip.tsx` réunit couleur, forme et règle écrite pour une valeur en
// ligne. Les figures (barres de `RankBar`, séries SVG) ne prennent pas un composant
// mais une couleur et un texte : elles lisent ici les MÊMES trois éléments, pour
// qu'aucune ne puisse colorer sans écrire la règle (amendement de R-S, plan § 1.5).
import { FORME_RATING, RATING_LABEL, type Rating } from "./rating";
import { RATING_JETON } from "./palette";
import { noteMip, texteRegleMip } from "./seuils";

export interface NoteAffichee {
  note: Rating;
  /** ● ▲ ■ : la forme qui double la couleur. */
  forme: string;
  /** « Bon », « À améliorer », « Mauvais ». */
  libelle: string;
  /** Couleur de figure (jeton de thème, suit le mode sombre). */
  jeton: string;
  /** « règle MIP : DNS > … » — à écrire à côté de la valeur. */
  regle: string;
}

/** La note d'une valeur et ce qu'il faut écrire avec ; `null` sans règle MIP ou sans valeur. */
export function noteAffichee(mesure: string, valeur: number | null | undefined): NoteAffichee | null {
  const note = noteMip(mesure, valeur);
  if (!note) return null;
  return { note, forme: FORME_RATING[note], libelle: RATING_LABEL[note], jeton: RATING_JETON[note], regle: texteRegleMip(mesure) };
}

/** « ■ 212 ms » : la valeur précédée de sa forme, ou la valeur seule sans note. */
export function texteNote(n: NoteAffichee | null, valeur: string): string {
  return n ? `${n.forme} ${valeur}` : valeur;
}
