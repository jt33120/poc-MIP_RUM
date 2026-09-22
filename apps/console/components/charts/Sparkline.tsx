// Sparkline — tendance miniature d'une tuile ou d'une ligne de liste (F03, § 4.2).
// SVG déterministe, rendu serveur, zéro JS client.
//
// TROIS RÈGLES DE VÉRITÉ.
//   1. `null` est un TROU : la ligne s'interrompt, elle ne plonge pas à zéro. Un
//      seau sans mesure n'est pas un seau à 0 ms — le relier ou le poser au sol
//      dessinerait une amélioration qui n'a pas eu lieu.
//   2. L'axe y part de 0. Une sparkline qui zoome sur [min, max] fait d'un écart de
//      2 % une falaise : à cette taille, on ne lit pas les graduations.
//   3. Moins de deux points mesurés : rien n'est tracé, et le libellé le dit. Un
//      point seul n'est pas une tendance.
//
// `max` fixe l'échelle d'une LISTE (une sparkline par groupe d'erreurs) : deux
// lignes à la même valeur ont alors la même hauteur, et la plus haute se voit.
import { SERIE } from "@/lib/palette";

const MARGE = 1.5; // demi-épaisseur du trait : un point au bord reste entier

export interface GeometrieSparkline {
  /** Un tracé par suite continue de valeurs mesurées. */
  segments: string[];
  /** Ordonnée (px) de chaque valeur, `null` pour un trou. */
  ys: (number | null)[];
  /** Haut de l'échelle y (valeur au sommet du cadre). */
  sommet: number;
  /** Hauteur (px) de la bande « Bon » depuis le bas, ou null. */
  bandeBon: number | null;
  assezDePoints: boolean;
}

/**
 * Géométrie pure (exportée pour les tests) : échelle, points, segments. Une
 * valeur au-delà de `max` est plafonnée au sommet (l'échelle commune prime).
 */
export function geometrieSparkline(
  valeurs: (number | null)[],
  { largeur, hauteur, max, seuils }: { largeur: number; hauteur: number; max?: number; seuils?: [number, number] },
): GeometrieSparkline {
  const mesurees = valeurs.filter((v): v is number => v != null && Number.isFinite(v));
  const assezDePoints = mesurees.length >= 2;
  const maxDonnees = mesurees.length ? Math.max(...mesurees, 0) : 0;
  // Avec des seuils, la borne « Bon » reste dans le cadre : sinon sa bande
  // disparaîtrait dès que toutes les valeurs sont bonnes.
  const sommetBrut = max ?? Math.max(maxDonnees, seuils ? seuils[0] * 1.1 : 0);
  const sommet = sommetBrut > 0 ? sommetBrut : 1;
  const utile = hauteur - 2 * MARGE;
  const y = (v: number) => MARGE + utile - (Math.min(Math.max(v, 0), sommet) / sommet) * utile;
  const pas = valeurs.length > 1 ? (largeur - 2 * MARGE) / (valeurs.length - 1) : 0;
  const x = (i: number) => MARGE + i * pas;

  const ys = valeurs.map((v) => (v != null && Number.isFinite(v) ? y(v) : null));
  const segments: string[] = [];
  if (assezDePoints) {
    let courant: string[] = [];
    ys.forEach((yi, i) => {
      if (yi == null) {
        if (courant.length) segments.push(courant.join(" "));
        courant = [];
        return;
      }
      const px = x(i).toFixed(1);
      const py = yi.toFixed(1);
      // Un point isolé entre deux trous : un tracé de longueur nulle, que le
      // bout de trait arrondi rend comme un point.
      courant.push(courant.length ? `L ${px} ${py}` : `M ${px} ${py} L ${px} ${py}`);
    });
    if (courant.length) segments.push(courant.join(" "));
  }
  const bandeBon = seuils ? Math.min(seuils[0], sommet) / sommet * utile + MARGE : null;
  return { segments, ys, sommet, bandeBon, assezDePoints };
}

export function Sparkline({
  valeurs,
  label,
  seuils,
  max,
  largeur = 96,
  hauteur = 24,
}: {
  /** Un point par seau, ordre chronologique, déjà aligné sur la grille. */
  valeurs: (number | null)[];
  /** aria-label : « LCP p75, 24 seaux d'une heure ». */
  label: string;
  /** Dessine la bande « Bon » en fond si fourni. */
  seuils?: [number, number];
  /** Échelle commune d'une liste : l'axe y va de 0 à max. */
  max?: number;
  largeur?: number;
  hauteur?: number;
}) {
  const g = geometrieSparkline(valeurs, { largeur, hauteur, max, seuils });
  const aria = [
    label,
    max != null ? `échelle commune, max ${max.toLocaleString("fr-FR")}` : null,
    g.assezDePoints ? null : "pas assez de points",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <svg
      width={largeur}
      height={hauteur}
      viewBox={`0 0 ${largeur} ${hauteur}`}
      role="img"
      aria-label={aria}
      data-testid="sparkline"
      className="shrink-0 overflow-visible"
    >
      <title>{aria}</title>
      {g.bandeBon != null && (
        <rect
          x={0}
          y={(hauteur - g.bandeBon).toFixed(1)}
          width={largeur}
          height={g.bandeBon.toFixed(1)}
          className="fill-good"
          fillOpacity={0.14}
          data-bande="bon"
        />
      )}
      {g.segments.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke={SERIE.principale}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          data-segment=""
        />
      ))}
    </svg>
  );
}
