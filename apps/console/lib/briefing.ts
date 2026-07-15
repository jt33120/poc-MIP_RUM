// Briefing d'accueil — logique PURE (aucune I/O), testée. À partir de signaux
// AGRÉGÉS (zéro PII), produit un résumé structuré de l'état de l'app depuis la
// dernière connexion : statut global + points clés + où regarder. Deux sources :
// un repli déterministe (toujours disponible) et un enrichissement LLM (parsé
// ici). La couche I/O (queries-briefing, /api/briefing) fournit les signaux et
// appelle le LLM ; cette couche décide et met en forme.

export type BriefingStatus = "ok" | "watch" | "critical";

export interface BriefingSignals {
  app: string;
  /** Libellé de la fenêtre observée (ex. « depuis votre dernière connexion »). */
  windowLabel: string;
  sessions: number;
  pageviews: number;
  errors: number;
  /** Groupes d'erreurs apparus DANS la fenêtre (régressions). */
  newErrorGroups: number;
  topErrors: { type: string; message: string; count: number }[];
  /** Alertes déclenchées dans la fenêtre. */
  alerts: number;
  criticalAlerts: number;
  /** SLO en dépassement de budget. */
  sloBreached: number;
  /** Score de santé 0..100 (null si pas de mesure). */
  healthScore: number | null;
  worstVital: { name: string; p75: number } | null;
  /** Nombre de mesures (rum_metric) sur la fenêtre — sert à juger la fiabilité. */
  measures?: number;
  /** Échantillon suffisant pour des conclusions de performance fiables ?
   *  Non défini = considéré fiable (rétro-compat). Voir assessReliability. */
  reliable?: boolean;
}

// Seuils de fiabilité : en-dessous, un p75 est statistiquement instable et on ne
// tire AUCUNE conclusion de performance (on le dit à l'utilisateur). Ordre de
// grandeur RUM : un p75 se stabilise vers quelques centaines de mesures.
export const RELIABILITY_MIN_SESSIONS = 25;
export const RELIABILITY_MIN_MEASURES = 150;

/** Échantillon suffisant pour des conclusions de perf fiables ? */
export function assessReliability(sessions: number, measures: number): boolean {
  return sessions >= RELIABILITY_MIN_SESSIONS && measures >= RELIABILITY_MIN_MEASURES;
}

/** true si les signaux permettent des conclusions de perf (défaut : oui). */
function isReliable(s: BriefingSignals): boolean {
  return s.reliable !== false;
}

export interface BriefingResult {
  status: BriefingStatus;
  headline: string;
  bullets: string[];
  focus: string | null;
  source: "ai" | "deterministic";
}

/** Statut global déduit des signaux (règles explicites, sans LLM).
 *  Les seuils basés sur le score de santé ne s'appliquent QUE si l'échantillon
 *  est fiable — sur peu de trafic, un p75 dégradé n'est pas concluant. Les
 *  alertes / SLO / nouvelles erreurs restent des faits durs, quel que soit le volume. */
export function deriveStatus(s: BriefingSignals): BriefingStatus {
  const rel = isReliable(s);
  if (s.criticalAlerts > 0 || s.sloBreached > 0 || (rel && s.healthScore != null && s.healthScore < 50)) {
    return "critical";
  }
  if (s.alerts > 0 || s.newErrorGroups > 0 || (rel && s.healthScore != null && s.healthScore < 80)) {
    return "watch";
  }
  return "ok";
}

const HEADLINE: Record<BriefingStatus, string> = {
  ok: "Tout est au vert",
  watch: "Quelques points à surveiller",
  critical: "Attention requise",
};

/** Briefing déterministe (repli sans LLM, ou base de l'enrichissement). */
export function deterministicBriefing(s: BriefingSignals): BriefingResult {
  const status = deriveStatus(s);
  const rel = isReliable(s);
  const bullets: string[] = [];

  // Fiabilité en premier : sur peu de trafic, on l'annonce et on ne conclut pas
  // sur la performance (mais les erreurs/alertes ci-dessous restent affichées).
  if (!rel) {
    const m = s.measures ?? 0;
    bullets.push(
      `Trafic insuffisant pour des conclusions fiables (${s.sessions.toLocaleString("fr-FR")} session(s), ${m.toLocaleString("fr-FR")} mesure(s)) — les indicateurs de performance sont à prendre avec prudence.`,
    );
  }

  if (s.criticalAlerts > 0) bullets.push(`${s.criticalAlerts} alerte(s) critique(s) déclenchée(s).`);
  else if (s.alerts > 0) bullets.push(`${s.alerts} alerte(s) déclenchée(s).`);
  if (s.sloBreached > 0) bullets.push(`${s.sloBreached} SLO en dépassement de budget d'erreur.`);
  if (s.newErrorGroups > 0) {
    const top = s.topErrors[0];
    bullets.push(
      `${s.newErrorGroups} nouveau(x) groupe(s) d'erreur${top ? ` — dont ${top.type} (${top.count}×)` : ""}.`,
    );
  }
  // Le score de santé n'est cité que si l'échantillon est fiable.
  if (rel && s.healthScore != null && s.healthScore < 80) {
    bullets.push(`Score de santé à ${s.healthScore}/100${s.worstVital ? ` (${s.worstVital.name} dégradé)` : ""}.`);
  }
  if (status === "ok" && rel) {
    bullets.push(
      s.sessions > 0
        ? `${s.sessions.toLocaleString("fr-FR")} session(s), aucune anomalie notable.`
        : "Aucune activité ni anomalie sur la fenêtre.",
    );
  }

  const focus =
    s.criticalAlerts > 0 || s.alerts > 0
      ? "Alertes"
      : s.sloBreached > 0
        ? "SLO"
        : s.newErrorGroups > 0
          ? "Erreurs JS"
          : s.healthScore != null && s.healthScore < 80
            ? "Vue d'ensemble"
            : null;

  // Sur trafic insuffisant sans incident dur, ne pas clamer « Tout est au vert ».
  const headline = !rel && status === "ok" ? "Trop peu de trafic pour conclure" : HEADLINE[status];
  return { status, headline, bullets, focus, source: "deterministic" };
}

export const BRIEFING_SYSTEM = `Tu es l'assistant de supervision de MIP RUM (Real User Monitoring souverain UE).
À partir de SIGNAUX AGRÉGÉS (aucune donnée personnelle), tu produis pour l'utilisateur qui se connecte un briefing d'accueil : l'état de son application depuis sa dernière connexion.
Réponds UNIQUEMENT par un objet JSON strict, sans texte autour, de la forme :
{"status":"ok|watch|critical","headline":"<phrase courte>","bullets":["<point factuel actionnable>", ...],"focus":"<où regarder en priorité, ou null>"}
Règles : français, concis. 2 à 4 bullets. status="critical" si alertes critiques / SLO dépassé / santé très basse ; "watch" si alertes, nouvelles erreurs ou santé moyenne ; sinon "ok". N'invente JAMAIS de chiffre absent des signaux ; ne cite pas de donnée personnelle. Si tout va bien, dis-le simplement.
IMPORTANT — fiabilité : si les signaux indiquent un échantillon FAIBLE (trafic insuffisant), dis-le explicitement en premier, ne tire AUCUNE conclusion de performance (un p75 sur peu de mesures n'est pas fiable), et suggère d'attendre plus de trafic. Les erreurs et alertes, elles, restent factuelles quel que soit le volume.`;

/** Contenu utilisateur pour le LLM : les signaux sérialisés + le statut calculé. */
export function briefingUserPrompt(s: BriefingSignals): string {
  return [
    `Application : ${s.app}`,
    `Fenêtre : ${s.windowLabel}`,
    `Statut calculé (indicatif) : ${deriveStatus(s)}`,
    `Fiabilité de l'échantillon : ${
      isReliable(s)
        ? "suffisant"
        : `FAIBLE — ${s.measures ?? 0} mesure(s), conclusions de performance NON fiables`
    }`,
    `Sessions : ${s.sessions} · pages vues : ${s.pageviews} · erreurs : ${s.errors}`,
    `Nouveaux groupes d'erreur : ${s.newErrorGroups}`,
    s.topErrors.length
      ? `Top erreurs : ${s.topErrors.map((e) => `${e.type} (${e.count}×)`).join(", ")}`
      : "Top erreurs : aucune",
    `Alertes déclenchées : ${s.alerts} (dont critiques : ${s.criticalAlerts})`,
    `SLO en dépassement : ${s.sloBreached}`,
    `Score de santé : ${s.healthScore ?? "n/d"}${s.worstVital ? ` · pire vital : ${s.worstVital.name} p75 ${s.worstVital.p75}` : ""}`,
  ].join("\n");
}

/** Parse la réponse LLM en BriefingResult, ou null si inexploitable. Tolérant :
 *  extrait le 1er bloc {...}. Le statut/headline sont bornés/complétés. */
export function parseBriefing(raw: string): BriefingResult | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const status: BriefingStatus =
    o.status === "critical" || o.status === "watch" ? o.status : o.status === "ok" ? "ok" : "watch";
  const bullets = Array.isArray(o.bullets)
    ? o.bullets.filter((b): b is string => typeof b === "string" && b.trim().length > 0).slice(0, 4)
    : [];
  if (!bullets.length) return null;
  const headline = typeof o.headline === "string" && o.headline.trim() ? o.headline.trim() : HEADLINE[status];
  const focus = typeof o.focus === "string" && o.focus.trim() ? o.focus.trim() : null;
  return { status, headline, bullets, focus, source: "ai" };
}
