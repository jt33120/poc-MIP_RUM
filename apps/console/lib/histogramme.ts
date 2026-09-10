// Découpage en seaux pour les percentiles pré-agrégés.
//
// ══════════════════ CE QUE CE FICHIER FIGE, ET POUR COMBIEN DE TEMPS ══════════
//
// Les constantes ci-dessous définissent l'index de seau de chaque valeur. Une
// fois qu'une ligne de `metric_histogram_hourly` est écrite, elle porte cet
// index et RIEN d'autre : la valeur d'origine n'est plus là. Changer GAMMA ou
// VALEUR_MIN ne « recalcule » donc pas l'historique — il le rend ININTERPRÉTABLE,
// silencieusement, en mélangeant deux échelles dans la même colonne.
//
// C'est la raison pour laquelle ce chantier avait été différé : on ne fige pas un
// format définitif sans avoir mesuré ce qu'il coûte en exactitude. C'est fait —
// tests/unit/histogramme.test.ts compare le p75 par seaux au p75 exact sur des
// distributions réalistes, et l'écart tient dans la borne annoncée ci-dessous.
//
// SI CES CONSTANTES DOIVENT CHANGER UN JOUR : il faut une nouvelle table, ou une
// colonne de version dans celle-ci, jamais une modification en place.

/**
 * Rapport entre deux bornes de seaux successives.
 *
 * 1,02 = seaux de 2 % de large. L'erreur relative sur un percentile est donc
 * bornée par ~1 % (on rend le milieu géométrique du seau, pas sa borne). Sur un
 * LCP de 2 500 ms cela fait ±25 ms — très en dessous de ce qu'un seuil Core Web
 * Vitals distingue, et très en dessous du bruit d'échantillonnage d'une journée
 * de trafic réel.
 */
export const GAMMA = 1.02;

/**
 * Plancher : en dessous, tout tombe dans le seau 0.
 *
 * 0,001 couvre les deux extrêmes du produit dans une seule échelle — un CLS de
 * 0,005 comme un TTFB de 30 000 ms — sans qu'aucune des deux ne soit écrasée.
 * Un plancher plus bas ne servirait qu'à créer des seaux vides sous la
 * résolution de ce qu'on mesure.
 */
export const VALEUR_MIN = 0.001;

const LN_GAMMA = Math.log(GAMMA);

/**
 * Index de seau d'une valeur. Croissant, donc les seaux se somment dans l'ordre
 * pour donner une distribution cumulée.
 *
 * NaN, valeurs négatives et zéro tombent dans le seau 0 plutôt que de propager
 * une erreur : un histogramme est un agrégat, et une ligne aberrante ne doit pas
 * emporter la lecture de toute une heure.
 */
export function seau(valeur: number): number {
  if (!Number.isFinite(valeur) || valeur <= VALEUR_MIN) return 0;
  return 1 + Math.floor(Math.log(valeur / VALEUR_MIN) / LN_GAMMA);
}

/** Borne haute d'un seau — la plus grande valeur qu'il peut contenir. */
export function borneHaute(index: number): number {
  return index <= 0 ? VALEUR_MIN : VALEUR_MIN * GAMMA ** index;
}

/**
 * Valeur représentative d'un seau : le MILIEU GÉOMÉTRIQUE de ses bornes.
 *
 * Rendre la borne haute biaiserait tous les percentiles vers le haut de la
 * largeur d'un seau ; le milieu géométrique divise l'erreur maximale par deux et
 * la rend symétrique — un percentile n'est alors ni systématiquement optimiste
 * ni systématiquement pessimiste, ce qui est la seule forme d'erreur acceptable
 * sur une mesure de qualité.
 */
export function valeurDuSeau(index: number): number {
  if (index <= 0) return VALEUR_MIN / 2;
  return Math.sqrt(borneHaute(index - 1) * borneHaute(index));
}

/** Un seau et le poids qu'il porte. */
export interface SeauPondere {
  bucket: number;
  weighted_count: number;
}

/**
 * Percentile lu sur une distribution en seaux.
 *
 * PONDÉRÉ PAR CONSTRUCTION : les poids sont déjà dans les seaux, donc ce calcul
 * résout la moitié que le lot 3 avait dû déclarer non corrigée — PostgreSQL n'a
 * pas de `percentile_cont` pondéré, mais une somme cumulée n'en a pas besoin.
 *
 * Rend `null` sur une distribution vide, jamais 0 : « aucune mesure » et « une
 * mesure à zéro » ne doivent pas s'écrire pareil.
 */
export function percentileDepuisSeaux(seaux: SeauPondere[], p: number): number | null {
  const total = seaux.reduce((s, b) => s + b.weighted_count, 0);
  if (total <= 0) return null;
  const cible = total * p;
  let cumul = 0;
  for (const b of [...seaux].sort((a, z) => a.bucket - z.bucket)) {
    cumul += b.weighted_count;
    if (cumul >= cible) return valeurDuSeau(b.bucket);
  }
  // Atteignable uniquement par accumulation d'erreurs de virgule flottante sur
  // p très proche de 1 : on rend le dernier seau, qui est la bonne réponse.
  const dernier = seaux.reduce((a, z) => (z.bucket > a.bucket ? z : a));
  return valeurDuSeau(dernier.bucket);
}

/** Bornes lisibles d'un seau, pour une infobulle ou un débogage. */
export function libelleSeau(index: number): string {
  const bas = index <= 0 ? 0 : borneHaute(index - 1);
  return `]${bas.toPrecision(3)} … ${borneHaute(index).toPrecision(3)}]`;
}
