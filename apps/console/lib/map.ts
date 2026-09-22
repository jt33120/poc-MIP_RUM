// Carte d'expérience — logique PURE (santé, tendance, mise en page du graphe),
// testée unitairement. Sépare le calcul (ici) de l'I/O (queries-map) et du rendu
// (components/map). Le graphe est le service front→back qu'on ingère déjà
// (rum_span corrélés par trace_id) : cartographie + flux + prévision, sans infra.

import { rating2026 } from "./rating";

/**
 * `unknown` : la mesure qui décide manque. Ce n'est PAS « sain » (F40, V3) : une
 * pastille verte sur un nœud sans latence mesurée, ou sur une page sans LCP,
 * affirmait un état que rien n'a observé.
 */
export type Health = "good" | "warn" | "bad" | "unknown";
export type TrendDir = "up" | "down" | "flat";

/**
 * Règle de santé d'un nœud API/backend. Règle PROPRE à la console, sans source
 * publiée (aucun seuil de référence n'existe pour une latence d'API ou un taux
 * d'erreur HTTP, R-S) : l'écran l'écrit en toutes lettres à côté de la légende
 * (S6), et le texte est lu ici — jamais recopié.
 */
export const REGLE_SANTE_API = {
  /** Part d'appels en statut HTTP ≥ 400 à partir de laquelle un nœud est « dégradé ». */
  erreurDegrade: 0.1,
  /** … « à surveiller ». */
  erreurSurveiller: 0.02,
  /** Latence p75 (ms) à partir de laquelle un nœud est « dégradé ». */
  latenceDegradeMs: 3000,
  /** … « à surveiller ». */
  latenceSurveillerMs: 1000,
} as const;

/**
 * Santé d'un nœud API/backend d'après son taux d'erreur et sa latence p75.
 *
 * Latence inconnue (`null`) : elle ne vaut PAS 0 ms. Le taux d'erreur seul peut
 * encore conclure « dégradé » (la règle est un OU : un nœud à 15 % d'erreurs est
 * dégradé quelle que soit sa latence) ; sinon l'état est `unknown` — ni « sain »
 * ni même « à surveiller », puisque la latence manquante pourrait le rendre dégradé.
 */
export function apiHealth(errorRate: number, latencyP75: number | null): Health {
  const r = REGLE_SANTE_API;
  if (errorRate >= r.erreurDegrade) return "bad";
  if (latencyP75 == null) return "unknown";
  if (latencyP75 >= r.latenceDegradeMs) return "bad";
  if (errorRate >= r.erreurSurveiller || latencyP75 >= r.latenceSurveillerMs) return "warn";
  return "good";
}

/**
 * Santé d'une page d'après son LCP p75 : le verdict web.dev de `rating2026`, lu
 * dans `lib/rating.ts` (V8) — plus de bornes recopiées ici. Pas de mesure :
 * `unknown`, jamais « good ».
 */
export function pageHealth(lcpP75: number | null): Health {
  if (lcpP75 == null || !Number.isFinite(lcpP75)) return "unknown";
  const verdict = rating2026("LCP", lcpP75);
  return verdict === "good" ? "good" : verdict === "needs-improvement" ? "warn" : verdict === "poor" ? "bad" : "unknown";
}

/** « dégradé dès 10 % d'erreurs HTTP ≥ 400 ou un p75 ≥ 3 s ; à surveiller dès 2 % ou 1 s » (S6). */
export function texteRegleSanteApi(): string {
  const r = REGLE_SANTE_API;
  const pct = (v: number) => `${(v * 100).toLocaleString("fr-FR")}\u00a0%`;
  const s = (ms: number) => `${(ms / 1000).toLocaleString("fr-FR")}\u00a0s`;
  return (
    `dégradé dès ${pct(r.erreurDegrade)} d'appels en erreur HTTP (statut ≥ 400) ou une latence p75 ≥ ${s(r.latenceDegradeMs)} ; ` +
    `à surveiller dès ${pct(r.erreurSurveiller)} ou ${s(r.latenceSurveillerMs)} ; ` +
    "inconnu sans latence mesurée"
  );
}

/** Tendance de volume : moitié récente vs moitié ancienne de la fenêtre. */
export function trend(recent: number, older: number): TrendDir {
  if (recent + older < 5) return "flat"; // trop peu de données pour conclure
  if (recent > older * 1.3 && recent - older >= 3) return "up";
  if (recent < older * 0.7) return "down";
  return "flat";
}

/**
 * Un nœud « à risque » : volume en hausse ET santé dégradée (signal capacity).
 * Une santé `unknown` n'est pas une dégradation observée : pas « à risque ».
 */
export function atRisk(dir: TrendDir, health: Health): boolean {
  return dir === "up" && (health === "warn" || health === "bad");
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
