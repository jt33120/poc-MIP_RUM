// Carte d'expérience — logique PURE (santé, tendance, mise en page du graphe),
// testée unitairement. Sépare le calcul (ici) de l'I/O (queries-map) et du rendu
// (components/map). Le graphe est le service front→back qu'on ingère déjà
// (rum_span corrélés par trace_id) : cartographie + flux + prévision, sans infra.

export type Health = "good" | "warn" | "bad";
export type TrendDir = "up" | "down" | "flat";

/** Santé d'un nœud API/backend d'après son taux d'erreur et sa latence p75. */
export function apiHealth(errorRate: number, latencyP75: number | null): Health {
  const lat = latencyP75 ?? 0;
  if (errorRate >= 0.1 || lat >= 3000) return "bad";
  if (errorRate >= 0.02 || lat >= 1000) return "warn";
  return "good";
}

/** Santé d'une page d'après son LCP p75 (repères Web Vitals 2026). */
export function pageHealth(lcpP75: number | null): Health {
  if (lcpP75 == null) return "good"; // pas de mesure : neutre
  if (lcpP75 >= 4000) return "bad";
  if (lcpP75 >= 2500) return "warn";
  return "good";
}

/** Tendance de volume : moitié récente vs moitié ancienne de la fenêtre. */
export function trend(recent: number, older: number): TrendDir {
  if (recent + older < 5) return "flat"; // trop peu de données pour conclure
  if (recent > older * 1.3 && recent - older >= 3) return "up";
  if (recent < older * 0.7) return "down";
  return "flat";
}

/** Un nœud « à risque » : volume en hausse ET santé dégradée (signal capacity). */
export function atRisk(dir: TrendDir, health: Health): boolean {
  return dir === "up" && health !== "good";
}

// --- Mise en page du graphe (2 colonnes : front | back) ----------------------

export interface GNode {
  id: string; // `${tier}:${route}`
  tier: "front" | "back";
  route: string;
  calls: number;
  health: Health;
  dir: TrendDir;
  risk: boolean;
}
export interface GEdge {
  from: string; // GNode.id (front)
  to: string; // GNode.id (back)
  calls: number;
}

export interface Placed extends GNode {
  x: number;
  y: number;
}
export interface PlacedEdge {
  from: string;
  to: string;
  calls: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
}
export interface Layout {
  width: number;
  height: number;
  nodes: Placed[];
  edges: PlacedEdge[];
}

const NODE_W = 190;
const ROW_H = 46;
const PAD_Y = 24;
const COL_GAP = 260;
const PAD_X = 20;

/** Place les nœuds en 2 colonnes et ne garde que les arêtes dont les 2 extrémités
 * sont visibles. Déterministe (aucune position aléatoire) -> testable et stable. */
export function layoutGraph(front: GNode[], back: GNode[], edges: GEdge[]): Layout {
  const frontX = PAD_X;
  const backX = PAD_X + NODE_W + COL_GAP;
  const placed = new Map<string, Placed>();
  const nodes: Placed[] = [];

  front.forEach((n, i) => {
    const p = { ...n, x: frontX, y: PAD_Y + i * ROW_H };
    placed.set(n.id, p);
    nodes.push(p);
  });
  back.forEach((n, i) => {
    const p = { ...n, x: backX, y: PAD_Y + i * ROW_H };
    placed.set(n.id, p);
    nodes.push(p);
  });

  const maxCalls = Math.max(1, ...edges.map((e) => e.calls));
  const pes: PlacedEdge[] = [];
  for (const e of edges) {
    const a = placed.get(e.from);
    const b = placed.get(e.to);
    if (!a || !b) continue; // extrémité hors des top-N affichés
    pes.push({
      from: e.from,
      to: e.to,
      calls: e.calls,
      x1: a.x + NODE_W,
      y1: a.y + ROW_H / 2 - PAD_Y / 2,
      x2: b.x,
      y2: b.y + ROW_H / 2 - PAD_Y / 2,
      width: 1 + (e.calls / maxCalls) * 5, // 1..6 px selon le volume
    });
  }

  const rows = Math.max(front.length, back.length);
  return {
    width: backX + NODE_W + PAD_X,
    height: PAD_Y * 2 + Math.max(1, rows) * ROW_H,
    nodes,
    edges: pes,
  };
}

export const NODE_WIDTH = NODE_W;
export const NODE_HEIGHT = ROW_H - 10;
