// Helpers purs (testables) de l'alerting mature (P1). Pas d'accès base ici.

/**
 * Modes d'évaluation de `check_alerts`. `release` (B52, migration-v86) : p75 d'un Web
 * Vital de la release la plus récente contre la précédente, même fenêtre. La console
 * ne l'écrit que si la base porte v86 (`releaseRegressionDisponible`) : sans elle, le
 * check_alerts de v73 lirait la règle comme un seuil fixe.
 */
export const ALERT_MODES = ["threshold", "baseline", "release"] as const;

/** Métriques d'une règle de release : le p75 n'a de sens que pour les Web Vitals. */
export const RELEASE_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

/**
 * Hausse tolérée par défaut d'une règle de release, EN POUR CENT (§ 3.2) : +20 %,
 * la règle de `assessRegression` (ratio 1,2, `lib/queries-deploys.ts`). Stockée
 * telle quelle dans `alert_rule.threshold`.
 */
export const SEUIL_REGRESSION_DEFAUT = 20;

/**
 * Mesures exigées de CHAQUE release avant tout verdict (migration-v86) : le seuil
 * sous lequel la console refuse déjà un écart entre deux p75 (`KpiTile`,
 * `FAIBLE_SOUS_DEFAUT`, § 3.12). Recopié en SQL ; un test unitaire lie les trois.
 */
export const MESURES_MIN_RELEASE = 100;
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
  return mode === "baseline" ? "anomalie (baseline)" : mode === "release" ? "régression de release" : "seuil";
}

// ─── Bornes des lectures de l'écran /alerts (F62) : lues par son chargeur. ───

/** Fenêtre fixe du hero (barres par jour et frise), en jours calendaires UTC. */
export const JOURS_DECLENCHEMENTS = 30;

/** Plafond de lecture de `alertFirings` : au-delà, la frise le dit (état `partiel`). */
export const PLAFOND_DECLENCHEMENTS = 2000;

/** Nombre d'événements rendus par `alertEvents` : le flux le dit quand il est atteint. */
export const PLAFOND_FLUX = 100;
