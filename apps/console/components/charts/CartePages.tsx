// CartePages — la carte des pages (recette du 30/09/2026, d'après l'écran « Summary » des
// références) : un rectangle par route, SURFACE proportionnelle aux pages vues, COULEUR
// selon le verdict de la mesure choisie (LCP p75 par défaut, seuils web.dev). Une image
// qui dit d'un coup d'œil où va le trafic et où il souffre. Rendu serveur, SVG pur.
//
// CE QU'ELLE NE FAIT PAS : colorer une route sans verdict établi (effectif faible,
// intervalle à cheval sur un seuil) — elle reste grise, comme partout ailleurs (R-V).
// Chaque rectangle est un lien vers le panneau de sa route ; l'alternative textuelle
// reprend les mêmes lignes.
import type { Rating } from "@/lib/rating";

export interface ElementCarte {
  cle: string;
  /** La route normalisée (« /checkout/:id »). */
  libelle: string;
  /** Pages vues : la surface. */
  volume: number;
  /** La mesure écrite dans le rectangle (« 2,4 s »), déjà formatée. */
  texteValeur: string;
  /** Verdict ÉTABLI, ou null (gris). */
  verdict: Rating | null;
  href?: string;
}

export interface Rectangle {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Pire rapport d'aspect d'une rangée posée sur un côté de longueur `cote`. */
function pireRapport(rangee: number[], cote: number): number {
  const somme = rangee.reduce((a, b) => a + b, 0);
  if (somme === 0) return Infinity;
  const max = Math.max(...rangee);
  const min = Math.min(...rangee);
  const s2 = somme * somme;
  const c2 = cote * cote;
  return Math.max((c2 * max) / s2, s2 / (c2 * min));
}

/**
 * Découpage « squarified » (Bruls, Huizing, van Wijk, 2000) : des rectangles aussi carrés
 * que possible, dans l'ordre décroissant des volumes. Logique pure, exportée pour les
 * tests. Les aires sont proportionnelles aux volumes ; un volume nul n'a pas de place.
 */
export function decouper(volumes: number[], largeur: number, hauteur: number): Rectangle[] {
  const total = volumes.reduce((a, b) => a + Math.max(0, b), 0);
  const sortie: Rectangle[] = volumes.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  if (total <= 0 || largeur <= 0 || hauteur <= 0) return sortie;
  const echelle = (largeur * hauteur) / total;
  const ordre = volumes
    .map((v, i) => ({ i, aire: Math.max(0, v) * echelle }))
    .filter((e) => e.aire > 0)
    .sort((a, b) => b.aire - a.aire);

  let x = 0;
  let y = 0;
  let w = largeur;
  let h = hauteur;
  let k = 0;
  while (k < ordre.length) {
    const cote = Math.min(w, h);
    const rangee = [ordre[k]];
    k++;
    while (k < ordre.length && pireRapport([...rangee, ordre[k]].map((e) => e.aire), cote) <= pireRapport(rangee.map((e) => e.aire), cote)) {
      rangee.push(ordre[k]);
      k++;
    }
    const somme = rangee.reduce((a, e) => a + e.aire, 0);
    if (w >= h) {
      // Colonne à gauche, de largeur somme / h.
      const lw = somme / h;
      let yy = y;
      for (const e of rangee) {
        const eh = e.aire / lw;
        sortie[e.i] = { x, y: yy, w: lw, h: eh };
        yy += eh;
      }
      x += lw;
      w -= lw;
    } else {
      // Rangée en haut, de hauteur somme / w.
      const lh = somme / w;
      let xx = x;
      for (const e of rangee) {
        const ew = e.aire / lh;
        sortie[e.i] = { x: xx, y, w: ew, h: lh };
        xx += ew;
      }
      y += lh;
      h -= lh;
    }
  }
  return sortie;
}

const FOND: Record<Rating | "aucun", string> = {
  good: "fill-good/60 hover:fill-good/80",
  "needs-improvement": "fill-warn/60 hover:fill-warn/80",
  poor: "fill-bad/60 hover:fill-bad/80",
  aucun: "fill-ink-faint/25 hover:fill-ink-faint/40",
};

/** Largeur approximative d'un texte de 11 px (pour couper un libellé qui déborde). */
const couper = (texte: string, largeur: number) => {
  const max = Math.max(0, Math.floor((largeur - 12) / 6.2));
  return texte.length <= max ? texte : max > 2 ? `${texte.slice(0, max - 1)}…` : "";
};

export function CartePages({
  elements,
  mesure = "LCP p75",
  largeur = 1000,
  hauteur = 260,
}: {
  elements: ElementCarte[];
  /** La mesure qui colore (« LCP p75 ») : écrite dans la légende. */
  mesure?: string;
  largeur?: number;
  hauteur?: number;
}) {
  const rects = decouper(
    elements.map((e) => e.volume),
    largeur,
    hauteur,
  );
  const total = elements.reduce((a, e) => a + e.volume, 0);
  return (
    <figure className="m-0" data-testid="carte-pages">
      <svg
        viewBox={`0 0 ${largeur} ${hauteur}`}
        className="h-auto w-full overflow-hidden rounded-lg"
        role="img"
        aria-label={`Carte des pages : surface = pages vues (${total} au total), couleur = verdict ${mesure}`}
      >
        {elements.map((e, i) => {
          const r = rects[i];
          if (r.w < 1 || r.h < 1) return null;
          const assez = r.w > 64 && r.h > 34;
          const titre = `${e.libelle} — ${e.volume} pages vues — ${mesure} ${e.texteValeur}`;
          const bloc = (
            <g>
              <title>{titre}</title>
              <rect
                x={r.x + 1}
                y={r.y + 1}
                width={Math.max(0, r.w - 2)}
                height={Math.max(0, r.h - 2)}
                rx={4}
                className={`${FOND[e.verdict ?? "aucun"]} transition-colors`}
              />
              {assez && (
                <>
                  <text x={r.x + 8} y={r.y + 18} className="fill-ink text-[11px] font-medium">
                    {couper(e.libelle, r.w)}
                  </text>
                  <text x={r.x + 8} y={r.y + 34} className="fill-ink text-[13px] font-semibold tabular-nums">
                    {e.texteValeur}
                  </text>
                  {r.h > 52 && (
                    <text x={r.x + 8} y={r.y + 50} className="fill-ink-soft text-[10px] tabular-nums">
                      {e.volume.toLocaleString("fr-FR")} vues
                    </text>
                  )}
                </>
              )}
            </g>
          );
          // Un <a> SVG simple : un lien Next dans un SVG n'est pas un élément fiable.
          return e.href ? (
            <a key={e.cle} href={e.href} aria-label={titre}>
              {bloc}
            </a>
          ) : (
            <g key={e.cle}>{bloc}</g>
          );
        })}
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-ink-soft">
        <span>Surface : pages vues</span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-good/60" /> Bon
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-warn/60" /> À améliorer
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-bad/60" /> Mauvais
        </span>
        <span className="flex items-center gap-1">
          <span aria-hidden className="h-2 w-2 rounded-sm bg-ink-faint/25" /> verdict non établi
        </span>
        <span className="text-ink-faint">Couleur : {mesure}, seuils web.dev</span>
      </figcaption>
    </figure>
  );
}
