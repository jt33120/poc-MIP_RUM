// Carte d'expérience — logique PURE (santé, tendance, mise en page du graphe),
// testée unitairement. Sépare le calcul (ici) de l'I/O (queries-map) et du rendu
// (components/map). Le graphe est le service front→back qu'on ingère déjà
// (rum_span corrélés par trace_id) : cartographie + flux + prévision, sans infra.

import { rating2026 } from "./rating";
import { formater } from "./fmt-ids";

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

/**
 * Effectif minimal (récent + ancien) sous lequel aucune tendance n'est conclue :
 * le seuil anti-bruit de l'écran, partagé par `trend` et `tendancePct`.
 */
export const SEUIL_TENDANCE = 5;

/** Tendance de volume : moitié récente vs moitié ancienne de la fenêtre. */
export function trend(recent: number, older: number): TrendDir {
  if (recent + older < SEUIL_TENDANCE) return "flat"; // trop peu de données pour conclure
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
  /**
   * La santé ÉCRITE dans le nœud, en plus de la couleur : « 2,4 % err · p75 1,2 s »
   * (F52, § 5.10.4). Absente sur un nœud d'agrégation, qui n'a pas de santé propre.
   */
  sante?: string;
  /** Tendance CHIFFRÉE (« +32 % ») ; absente sous le seuil anti-bruit ou sans base. */
  tendance?: string;
  /**
   * Nombre de routes regroupées dans « Autres routes (N) ». Un nœud d'agrégation
   * n'a ni santé ni tendance (ni p75 moyennable, V5) : il existe pour RECEVOIR les
   * arêtes des routes masquées, qui étaient jusqu'ici jetées.
   */
  agrege?: number;
  /**
   * Panneau du nœud (`panel=noeud:<tier>:<route>`) ; `null` = non cliquable. Une
   * chaîne, jamais une fonction : le nœud traverse la frontière serveur → client.
   */
  href?: string | null;
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

// Trois lignes par nœud depuis F52 (route, volume et tendance, santé écrite) :
// la boîte gagne 14 px, l'interligne autant.
const NODE_W = 210;
const ROW_H = 62;
const NODE_H = ROW_H - 10;
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
      y1: a.y + NODE_H / 2,
      x2: b.x,
      y2: b.y + NODE_H / 2,
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
export const NODE_HEIGHT = NODE_H;

// --- F52 : santé écrite, tendance chiffrée, nœud « Autres routes (N) » ------

/**
 * Tendance de volume CHIFFRÉE : variation en % de la moitié récente sur la moitié
 * ancienne. `null` quand elle ne se calcule pas honnêtement — sous le seuil
 * anti-bruit (même que `trend`), ou sans base ancienne : « +∞ % » n'est pas une
 * mesure, c'est une division par zéro (V3).
 */
export function tendancePct(recent: number, older: number): number | null {
  if (recent + older < SEUIL_TENDANCE) return null;
  if (older <= 0) return null;
  return ((recent - older) / older) * 100;
}

/** « +32 % », « −18 % », ou `undefined` quand la tendance n'est pas chiffrable. */
export function texteTendance(recent: number, older: number): string | undefined {
  const pct = tendancePct(recent, older);
  if (pct === null) return undefined;
  const arrondi = Math.round(pct);
  return `${arrondi > 0 ? "+" : arrondi < 0 ? "\u2212" : ""}${Math.abs(arrondi)}\u00a0%`;
}

/**
 * La santé ÉCRITE dans le nœud : « 2,4 % err · p75 1,2 s » (§ 5.10.4). La couleur
 * seule ne porte jamais l'information (§ 3.9) — et une latence non mesurée s'écrit
 * « — », jamais « 0 ms ».
 */
export function texteSanteNoeud(errorRate: number | null, latencyP75: number | null): string {
  return `${formater("pct", errorRate)} err · p75 ${formater("ms", latencyP75)}`;
}

/** Nœuds affichés par colonne avant regroupement dans « Autres routes (N) ». */
export const CAP_COLONNE = 10;

/** Identifiant du nœud d'agrégation d'une colonne (aucune route ne peut le porter). */
export function idAutres(tier: "front" | "back"): string {
  return `${tier}:\u0000autres`;
}

export interface CarteAffichee {
  front: GNode[];
  back: GNode[];
  edges: GEdge[];
  /** Routes regroupées par colonne (0 = colonne entièrement affichée). */
  masquees: { front: number; back: number };
}

/** Le nœud d'agrégation d'une colonne : il porte un volume, jamais une santé. */
function noeudAutres(tier: "front" | "back", masques: GNode[]): GNode {
  return {
    id: idAutres(tier),
    tier,
    route: `Autres routes (${masques.length.toLocaleString("fr-FR")})`,
    calls: masques.reduce((s, n) => s + n.calls, 0),
    // Plusieurs routes n'ont pas de santé commune, et un p75 ne se moyenne pas (V5).
    health: "unknown",
    dir: "flat",
    risk: false,
    agrege: masques.length,
    href: null,
  };
}

/**
 * Ce que la carte AFFICHE : les `cap` premières routes de chaque colonne, plus un
 * nœud « Autres routes (N) » qui REÇOIT les arêtes des routes masquées.
 *
 * Avant F52, `layoutGraph` jetait toute arête dont une extrémité sortait du top-N
 * (`if (!a || !b) continue`) : le graphe montrait alors moins d'appels qu'il n'y en
 * avait, sans le dire — une page très active pouvait perdre son lien vers un service
 * lent simplement parce que ce service était onzième. Les arêtes sont désormais
 * redirigées vers le nœud d'agrégation et FUSIONNÉES (les volumes s'additionnent :
 * un compte d'appels est additif, contrairement à un p75).
 */
export function carteAffichee(
  front: GNode[],
  back: GNode[],
  edges: GEdge[],
  cap: number = CAP_COLONNE,
): CarteAffichee {
  const colonne = (tier: "front" | "back", tous: GNode[]) => {
    const visibles = tous.slice(0, cap);
    const masques = tous.slice(cap);
    return { visibles: masques.length > 0 ? [...visibles, noeudAutres(tier, masques)] : visibles, masques };
  };
  const f = colonne("front", front);
  const b = colonne("back", back);

  // Où va chaque identifiant reçu : lui-même s'il est visible, le nœud d'agrégation
  // de sa colonne s'il est masqué, rien s'il n'a jamais été lu (arête orpheline).
  const destination = new Map<string, string>();
  for (const n of [...f.visibles, ...b.visibles]) destination.set(n.id, n.id);
  for (const n of f.masques) destination.set(n.id, idAutres("front"));
  for (const n of b.masques) destination.set(n.id, idAutres("back"));

  const fusion = new Map<string, GEdge>();
  for (const e of edges) {
    const from = destination.get(e.from);
    const to = destination.get(e.to);
    if (!from || !to) continue; // extrémité jamais lue (hors des 40 nœuds)
    const cle = `${from}\u0000${to}`;
    const deja = fusion.get(cle);
    if (deja) deja.calls += e.calls;
    else fusion.set(cle, { from, to, calls: e.calls });
  }

  return {
    front: f.visibles,
    back: b.visibles,
    edges: [...fusion.values()].sort((x, y) => y.calls - x.calls),
    masquees: { front: f.masques.length, back: b.masques.length },
  };
}
