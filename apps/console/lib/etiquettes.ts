// Placement d'étiquettes sans chevauchement (recette du 26/09/2026). Logique pure,
// sans React ni DOM : les composants estiment la largeur d'un texte et reçoivent des
// positions.
//
// POURQUOI. Les étiquettes d'un graphique étaient posées chacune pour soi : trois
// alertes à 14:14 écrivaient « Alerte eAlerte log_errors… », les repères p50 et p75
// d'un histogramme se superposaient, l'étiquette du point le plus haut d'un nuage
// sortait du cadre. Une étiquette qui ne trouve pas de place n'est pas dessinée :
// son texte reste dans l'infobulle, la légende et l'alternative textuelle.

/** Largeur approchée (px) d'un texte : ~0,56 em par caractère dans la police de l'interface. */
export function largeurTexte(texte: string, taillePolice: number): number {
  return texte.length * taillePolice * 0.56;
}

/** Un intervalle horizontal occupé par une étiquette. */
export interface Etendue {
  debut: number;
  fin: number;
}

/**
 * Range des étiquettes sur des rangées superposées : chacune prend la PREMIÈRE
 * rangée où elle ne touche aucune autre (marge `ecart` px). Rend l'indice de rangée
 * de chaque étiquette, dans l'ordre reçu, ou -1 si les `rangees` sont toutes
 * occupées à cet endroit (l'étiquette n'est alors pas dessinée).
 */
export function rangerEtiquettes(etendues: readonly Etendue[], rangees: number, ecart = 4): number[] {
  const occupees: Etendue[][] = Array.from({ length: Math.max(rangees, 0) }, () => []);
  return etendues.map((e) => {
    for (let r = 0; r < occupees.length; r++) {
      const libre = occupees[r].every((o) => e.fin + ecart <= o.debut || e.debut >= o.fin + ecart);
      if (libre) {
        occupees[r].push(e);
        return r;
      }
    }
    return -1;
  });
}

/**
 * Étendue d'une étiquette ancrée sur `x`, gardée dans [min ; max] : centrée si elle
 * le peut, collée au bord sinon (une étiquette au bord n'est jamais coupée).
 */
export function etendueCentree(x: number, largeur: number, min: number, max: number): Etendue & { centre: number } {
  let debut = x - largeur / 2;
  if (debut < min) debut = min;
  if (debut + largeur > max) debut = Math.max(min, max - largeur);
  return { debut, fin: debut + largeur, centre: debut + largeur / 2 };
}

/**
 * Garde les étiquettes d'un axe qui ne se chevauchent pas : la première et la
 * dernière toujours, celles du milieu seulement si elles ont la place. Rend les
 * indices conservés. C'est ce qui évitait « 0,000,100 » sous un histogramme CLS
 * (deux graduations posées au même endroit).
 */
export function etiquettesAxeLisibles(etendues: readonly Etendue[], ecart = 4): number[] {
  if (etendues.length <= 1) return etendues.map((_e, i) => i);
  const dernier = etendues.length - 1;
  const gardes = [0];
  for (let i = 1; i < dernier; i++) {
    const precedente = etendues[gardes[gardes.length - 1]];
    if (etendues[i].debut >= precedente.fin + ecart && etendues[i].fin + ecart <= etendues[dernier].debut) gardes.push(i);
  }
  gardes.push(dernier);
  return gardes;
}

/** Une étiquette à poser près d'un point (nuage) : son centre et sa taille. */
export interface EtiquettePoint {
  x: number;
  y: number;
  /** Rayon du point : l'étiquette ne le recouvre pas. */
  rayon: number;
  largeur: number;
  hauteur: number;
}

export interface EtiquettePlacee {
  /** Abscisse d'ancrage du texte. */
  x: number;
  /** Ligne de base du texte. */
  y: number;
  ancre: "start" | "middle" | "end";
}

interface Boite {
  g: number;
  h: number;
  d: number;
  b: number;
}

function seRecouvrent(a: Boite, b: Boite): boolean {
  return a.g < b.d && b.g < a.d && a.h < b.b && b.h < a.b;
}

/**
 * Place les étiquettes d'un nuage de points, dans l'ordre reçu (le plus important
 * d'abord) : au-dessus du point, sinon à droite, à gauche, en dessous — la première
 * position qui reste dans le `cadre` et ne recouvre ni une étiquette déjà posée, ni
 * un autre point. `null` : aucune place, l'étiquette n'est pas dessinée.
 */
export function placerEtiquettesNuage(
  etiquettes: readonly EtiquettePoint[],
  cadre: { gauche: number; haut: number; droite: number; bas: number },
): (EtiquettePlacee | null)[] {
  const posees: Boite[] = [];
  const points: Boite[] = etiquettes.map((e) => ({ g: e.x - e.rayon, h: e.y - e.rayon, d: e.x + e.rayon, b: e.y + e.rayon }));
  return etiquettes.map((e, i) => {
    const m = 3;
    const essais: (EtiquettePlacee & { boite: Boite })[] = [
      { x: e.x, y: e.y - e.rayon - m, ancre: "middle", boite: { g: e.x - e.largeur / 2, h: e.y - e.rayon - m - e.hauteur, d: e.x + e.largeur / 2, b: e.y - e.rayon - m } },
      { x: e.x + e.rayon + m, y: e.y + e.hauteur / 3, ancre: "start", boite: { g: e.x + e.rayon + m, h: e.y - e.hauteur / 2, d: e.x + e.rayon + m + e.largeur, b: e.y + e.hauteur / 2 } },
      { x: e.x - e.rayon - m, y: e.y + e.hauteur / 3, ancre: "end", boite: { g: e.x - e.rayon - m - e.largeur, h: e.y - e.hauteur / 2, d: e.x - e.rayon - m, b: e.y + e.hauteur / 2 } },
      { x: e.x, y: e.y + e.rayon + m + e.hauteur, ancre: "middle", boite: { g: e.x - e.largeur / 2, h: e.y + e.rayon + m, d: e.x + e.largeur / 2, b: e.y + e.rayon + m + e.hauteur } },
    ];
    for (const essai of essais) {
      const b = essai.boite;
      const dansCadre = b.g >= cadre.gauche && b.d <= cadre.droite && b.h >= cadre.haut && b.b <= cadre.bas;
      if (!dansCadre) continue;
      if (posees.some((p) => seRecouvrent(p, b))) continue;
      if (points.some((p, j) => j !== i && seRecouvrent(p, b))) continue;
      posees.push(b);
      return { x: essai.x, y: essai.y, ancre: essai.ancre };
    }
    return null;
  });
}
