// Interactions des séries temporelles (refonte monitoring, vague 2 — spec A2 § 5.4) :
// réticule partagé, pinceau (sélection de plage) et légende cliquable. Ce module ne
// garde que la LOGIQUE, pure et testable sans navigateur ; les gestes (souris,
// clavier, magasin du survol) vivent dans `components/charts/InteractionsSeries.tsx`.
import { estJour, isoSansMs, jourDans, type LignePreparee } from "./series";

/**
 * Un seul identifiant de synchronisation pour TOUS les graphiques temporels : une
 * seule page est montée à la fois, et le réticule doit se poser au même instant sur
 * chacune de ses figures (spec A2 § 5.4, « shared crosshair » de Grafana). Les paires
 * de panneaux empilés (`synchro`) n'ont plus besoin d'un nom propre.
 */
export const SYNCHRO_PAGE = "mip-page";

/** Sous deux seaux, un glisser n'est pas une plage : c'est un clic (zoom sur UN seau). */
export const PINCEAU_MIN_SEAUX = 2;

/** Opacité des séries non isolées (clic sur une entrée de légende). */
export const OPACITE_ESTOMPEE = 0.35;

/**
 * Le seau de `grille` qui contient `instant` (début de seau d'un AUTRE graphique) ;
 * -1 s'il tombe hors de la grille. Les seaux diffèrent d'un graphique à l'autre (1 h
 * ici, 6 h là) : la synchronisation par rang (`syncMethod="index"`) poserait le
 * réticule au mauvais instant, et celle par valeur exacte ne le poserait pas du tout.
 * Une grille de jours locaux compare des jours du fuseau d'affichage.
 */
export function indexSeauContenant(grille: readonly string[], seauSecondes: number, fuseau: string, instant: unknown): number {
  if (typeof instant !== "string" || grille.length === 0) return -1;
  const exact = grille.indexOf(instant);
  if (exact >= 0) return exact;
  if (estJour(grille[0])) {
    const ms = Date.parse(instant);
    if (estJour(instant) || !Number.isFinite(ms)) return -1;
    return grille.indexOf(jourDans(ms, fuseau));
  }
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) return -1;
  for (let i = 0; i < grille.length; i++) {
    const debut = Date.parse(grille[i]);
    // La fin d'un seau est le début du suivant quand il existe : les tranches de 6 h
    // alignées sur minuit local n'ont pas toutes six heures (changement d'heure).
    const fin = i + 1 < grille.length ? Date.parse(grille[i + 1]) : debut + seauSecondes * 1000;
    if (ms >= debut && ms < fin) return i;
  }
  return -1;
}

/** Plage retenue par le pinceau : instants ISO UTC et seaux couverts (bornes comprises). */
export interface PlagePinceau {
  from: string;
  to: string;
  /** Rang du premier et du dernier seau couverts. */
  debut: number;
  fin: number;
  seaux: number;
}

/**
 * La plage d'un glisser, du seau `a` au seau `b` (dans un sens ou dans l'autre) :
 * début du premier, fin du dernier — coupée à la minute passée, comme le zoom au clic
 * (`hrefZoom`), pour que le contrat ne la refuse pas (« fin dans le futur »). `null`
 * sous `PINCEAU_MIN_SEAUX` seaux, hors grille, ou sur une grille de jours locaux (ses
 * bornes UTC dépendent du fuseau : elle n'a déjà pas de zoom par gabarit).
 */
export function plagePinceau(
  grille: readonly string[],
  seauSecondes: number,
  a: string,
  b: string,
  maintenant: number,
): PlagePinceau | null {
  const ia = grille.indexOf(a);
  const ib = grille.indexOf(b);
  if (ia < 0 || ib < 0) return null;
  const debut = Math.min(ia, ib);
  const fin = Math.max(ia, ib);
  const seaux = fin - debut + 1;
  if (seaux < PINCEAU_MIN_SEAUX || estJour(grille[debut])) return null;
  const debutMs = Date.parse(grille[debut]);
  let finMs = fin + 1 < grille.length ? Date.parse(grille[fin + 1]) : Date.parse(grille[fin]) + seauSecondes * 1000;
  if (!Number.isFinite(debutMs) || !Number.isFinite(finMs)) return null;
  const minutePassee = Math.floor(maintenant / 60_000) * 60_000;
  if (finMs > minutePassee) finMs = minutePassee;
  if (finMs <= debutMs) return null;
  return { from: isoSansMs(debutMs), to: isoSansMs(finMs), debut, fin, seaux };
}

/**
 * Le geste du pinceau, en machine à états (le composant ne fait que brancher la
 * souris et le clavier dessus) :
 *   - `presser` sur un seau : la zone commence (un seul seau : rien n'est dessiné) ;
 *   - `glisser` : la zone s'étend jusqu'au seau sous la souris ;
 *   - `echap` : la zone disparaît, et le clic qui suivra le relâchement est ABSORBÉ
 *     (il zoomerait sinon sur le seau sous la souris) ;
 *   - `relacher` : la plage est retenue si elle couvre au moins `PINCEAU_MIN_SEAUX`
 *     seaux — le clic qui suit est alors absorbé ; sur un seul seau, c'était un clic,
 *     et le zoom au clic garde la main.
 */
export interface EtatPinceau {
  zone: { debut: string; fin: string } | null;
  /** Le prochain clic sur le graphique ne zoome pas. */
  absorbe: boolean;
}

export type GestePinceau =
  | { type: "presser"; seau: string }
  | { type: "glisser"; seau: string }
  | { type: "echap" }
  | { type: "relacher"; maintenant: number };

export const PINCEAU_REPOS: EtatPinceau = { zone: null, absorbe: false };

export function gestePinceau(
  etat: EtatPinceau,
  geste: GestePinceau,
  grille: readonly string[],
  seauSecondes: number,
): { etat: EtatPinceau; plage: PlagePinceau | null } {
  switch (geste.type) {
    case "presser":
      return { etat: { zone: { debut: geste.seau, fin: geste.seau }, absorbe: false }, plage: null };
    case "glisser":
      if (!etat.zone || etat.zone.fin === geste.seau) return { etat, plage: null };
      return { etat: { ...etat, zone: { ...etat.zone, fin: geste.seau } }, plage: null };
    case "echap":
      if (!etat.zone) return { etat, plage: null };
      return { etat: { zone: null, absorbe: true }, plage: null };
    case "relacher": {
      if (!etat.zone) return { etat, plage: null };
      const plage = plagePinceau(grille, seauSecondes, etat.zone.debut, etat.zone.fin, geste.maintenant);
      return { etat: { zone: null, absorbe: plage !== null }, plage };
    }
  }
}

/** Le gabarit de zoom de l'écran (`gabaritZoom`, {from} {to}) rempli par la plage du pinceau. */
export function hrefPlage(gabarit: string, plage: Pick<PlagePinceau, "from" | "to">): string {
  return gabarit
    .replace(/\{from\}|%7Bfrom%7D/gi, encodeURIComponent(plage.from))
    .replace(/\{to\}|%7Bto%7D/gi, encodeURIComponent(plage.to));
}

// ─────────────────────────────── Légende ───────────────────────────────

/** État de la légende d'un graphique : une série isolée, ou des séries masquées. */
export interface EtatLegende {
  isolee: string | null;
  masquees: readonly string[];
}

export const LEGENDE_INITIALE: EtatLegende = { isolee: null, masquees: [] };

/**
 * Un clic sur une entrée de légende (spec A2 § 5.4) :
 *   - clic = isoler (les autres passent à 35 %) ; un second clic sur la série isolée
 *     rétablit tout ;
 *   - Alt-clic = masquer (ou démasquer) ; il lève l'isolement.
 * Un clic simple lève aussi les masques : il y a toujours un geste qui ramène à une
 * figure lisible, même quand on a tout masqué.
 */
export function basculerLegende(etat: EtatLegende, cle: string, masquer: boolean): EtatLegende {
  if (masquer) {
    const deja = etat.masquees.includes(cle);
    return { isolee: null, masquees: deja ? etat.masquees.filter((c) => c !== cle) : [...etat.masquees, cle] };
  }
  if (etat.isolee === cle) return LEGENDE_INITIALE;
  return { isolee: cle, masquees: [] };
}

export type AspectSerie = "normale" | "isolee" | "estompee" | "masquee";

export function aspectSerie(etat: EtatLegende, cle: string): AspectSerie {
  if (etat.masquees.includes(cle)) return "masquee";
  if (etat.isolee === null) return "normale";
  return etat.isolee === cle ? "isolee" : "estompee";
}

/**
 * La valeur qu'une entrée de légende affiche : celle du seau survolé (sur ce
 * graphique ou, par le réticule partagé, sur un autre), sinon la dernière valeur
 * connue de la série. Un seau survolé sans mesure rend `null` (« — ») : on ne
 * remplace pas un trou par la valeur d'à côté.
 */
export function valeurLegende(
  lignes: readonly LignePreparee[],
  cle: string,
  indexSurvole: number | null,
): { valeur: number | null; index: number | null } {
  const lire = (i: number) => {
    const v = lignes[i]?.[cle];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  if (indexSurvole !== null && indexSurvole >= 0 && indexSurvole < lignes.length) {
    return { valeur: lire(indexSurvole), index: indexSurvole };
  }
  for (let i = lignes.length - 1; i >= 0; i--) {
    const v = lire(i);
    if (v !== null) return { valeur: v, index: i };
  }
  return { valeur: null, index: null };
}
