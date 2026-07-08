// Flux Sankey biparti — layout PUR et testé (Lot 6b). À partir des transitions
// route->route (lib/paths / queries-paths), on place à GAUCHE les routes source et
// à DROITE les routes cible, reliées par des rubans dont l'épaisseur ∝ au volume.
// Coordonnées NORMALISÉES (y, h dans [0,1]) : le composant SVG les met à l'échelle.
// Aucune dépendance graphique — géométrie calculée ici, déterministe.
import type { Transition } from "./paths";

export interface SankeyNode {
  route: string;
  total: number;
  y: number; // haut du nœud (0..1)
  h: number; // hauteur (0..1)
}

export interface SankeyLink {
  from: string;
  to: string;
  count: number;
  sy0: number; // bande côté source (haut/bas)
  sy1: number;
  ty0: number; // bande côté cible
  ty1: number;
}

export interface SankeyModel {
  left: SankeyNode[];
  right: SankeyNode[];
  links: SankeyLink[];
  shownFlow: number; // volume représenté (somme des liens gardés)
  totalFlow: number; // volume total des transitions fournies
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Construit le modèle de Sankey. `maxNodes` borne le nombre de nœuds par côté
 * (les routes hors top sont ignorées, ainsi que leurs liens — `shownFlow` vs
 * `totalFlow` mesure la couverture). `gap` = espace normalisé entre nœuds.
 */
export function buildSankey(
  transitions: Transition[],
  opts: { maxNodes?: number; gap?: number } = {},
): SankeyModel {
  const maxNodes = opts.maxNodes ?? 8;
  const gap = opts.gap ?? 0.02;
  const totalFlow = transitions.reduce((a, t) => a + t.count, 0);

  // Totaux par source / cible sur l'ensemble, pour choisir les top nœuds.
  const leftAll = new Map<string, number>();
  const rightAll = new Map<string, number>();
  for (const t of transitions) {
    leftAll.set(t.from, (leftAll.get(t.from) ?? 0) + t.count);
    rightAll.set(t.to, (rightAll.get(t.to) ?? 0) + t.count);
  }
  const topRoutes = (m: Map<string, number>) =>
    new Set(
      [...m.entries()]
        .sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))
        .slice(0, maxNodes)
        .map(([r]) => r),
    );
  const leftSet = topRoutes(leftAll);
  const rightSet = topRoutes(rightAll);

  // Liens gardés (deux extrémités dans le top), triés stable.
  const links = transitions
    .filter((t) => leftSet.has(t.from) && rightSet.has(t.to))
    .sort((a, b) => b.count - a.count || cmp(a.from, b.from) || cmp(a.to, b.to))
    .map((t) => ({ ...t, sy0: 0, sy1: 0, ty0: 0, ty1: 0 }));

  // Totaux recalculés sur les liens gardés (cohérence des hauteurs).
  const leftTot = new Map<string, number>();
  const rightTot = new Map<string, number>();
  for (const l of links) {
    leftTot.set(l.from, (leftTot.get(l.from) ?? 0) + l.count);
    rightTot.set(l.to, (rightTot.get(l.to) ?? 0) + l.count);
  }
  const shownFlow = links.reduce((a, l) => a + l.count, 0);

  const left = layoutColumn(leftTot, gap);
  const right = layoutColumn(rightTot, gap);
  const leftBy = new Map(left.map((n) => [n.route, n]));
  const rightBy = new Map(right.map((n) => [n.route, n]));

  // Bandes source : pour chaque nœud gauche, empile ses liens par y du nœud cible
  // (réduit les croisements). Idem à droite par y du nœud source.
  assignBands(
    links,
    leftBy,
    rightBy,
    (l) => l.from,
    (l) => rightBy.get(l.to)?.y ?? 0,
    (l, y0, y1) => {
      l.sy0 = y0;
      l.sy1 = y1;
    },
  );
  assignBands(
    links,
    rightBy,
    leftBy,
    (l) => l.to,
    (l) => leftBy.get(l.from)?.y ?? 0,
    (l, y0, y1) => {
      l.ty0 = y0;
      l.ty1 = y1;
    },
  );

  return { left, right, links, shownFlow, totalFlow };
}

/** Empile les nœuds d'une colonne (tri par total décroissant) sur [0,1] avec gaps. */
function layoutColumn(totals: Map<string, number>, gap: number): SankeyNode[] {
  const nodes = [...totals.entries()].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]));
  const sum = nodes.reduce((a, [, v]) => a + v, 0);
  const n = nodes.length;
  if (!n || sum <= 0) return [];
  const avail = Math.max(0, 1 - gap * (n - 1));
  let y = 0;
  return nodes.map(([route, total]) => {
    const h = (total / sum) * avail;
    const node = { route, total, y, h };
    y += h + gap;
    return node;
  });
}

/** Assigne à chaque lien sa bande (haut/bas) sur le nœud `keyOf`, ordonnée par `orderBy`. */
function assignBands(
  links: SankeyLink[],
  nodesBy: Map<string, SankeyNode>,
  _otherBy: Map<string, SankeyNode>,
  keyOf: (l: SankeyLink) => string,
  orderBy: (l: SankeyLink) => number,
  set: (l: SankeyLink, y0: number, y1: number) => void,
): void {
  const groups = new Map<string, SankeyLink[]>();
  for (const l of links) {
    const k = keyOf(l);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(l);
  }
  for (const [route, group] of groups) {
    const node = nodesBy.get(route);
    if (!node) continue;
    const nodeTotal = group.reduce((a, l) => a + l.count, 0);
    group.sort((a, b) => orderBy(a) - orderBy(b) || b.count - a.count);
    let off = 0;
    for (const l of group) {
      const bandH = nodeTotal > 0 ? node.h * (l.count / nodeTotal) : 0;
      set(l, node.y + off, node.y + off + bandH);
      off += bandH;
    }
  }
}
