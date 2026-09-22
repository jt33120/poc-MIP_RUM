// Helpers purs (testables) de l'alerting mature (P1). Pas d'accès base ici.

export const ALERT_MODES = ["threshold", "baseline"] as const;
export const ALERT_SEVERITIES = ["info", "warning", "critical"] as const;
export const CHANNEL_KINDS = ["webhook", "slack", "email"] as const;

export type Severity = (typeof ALERT_SEVERITIES)[number];

/** Ordre de sévérité (miroir de severity_rank() SQL) : info<warning<critical. */
export function severityRank(s: string): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : s === "info" ? 1 : 0;
}

export interface SloView {
  budget: number; // part d'erreur tolérée (1 - objectif)
  burnedPct: number | null; // % du budget consommé (null si budget nul)
  status: "ok" | "at_risk" | "breached";
}

/**
 * Vue error-budget d'un SLO. attainment & objective dans [0,1].
 *  - breached : objectif manqué (budget > 100 % consommé) ;
 *  - at_risk  : ≥ 75 % du budget consommé ;
 *  - ok       : sinon.
 */
export function sloView(attainment: number, objective: number): SloView {
  const budget = Math.max(0, 1 - objective);
  if (budget <= 0) {
    // objectif à 100 % : tout manquement = breach
    return { budget: 0, burnedPct: attainment >= 1 ? 0 : null, status: attainment >= 1 ? "ok" : "breached" };
  }
  const burnedPct = Math.min(999, Math.max(0, (1 - attainment) / budget) * 100);
  const status = burnedPct >= 100 ? "breached" : burnedPct >= 75 ? "at_risk" : "ok";
  return { budget, burnedPct, status };
}

/** Libellé court d'une règle selon son mode (pour l'UI). */
/**
 * État affichable d'un SLO. `non_mesurable` quand sa fenêtre ne porte aucune
 * mesure : le SQL rend alors `attainment = null`, que `sloView` lisait comme
 * 0 % — « objectif manqué » — alors que rien n'a été mesuré.
 */
export function etatSlo(attainment: number | null, objective: number): SloView | { status: "non_mesurable" } {
  return attainment == null ? { status: "non_mesurable" } : sloView(attainment, objective);
}

export function ruleModeLabel(mode: string): string {
  return mode === "baseline" ? "anomalie (baseline)" : "seuil";
}
