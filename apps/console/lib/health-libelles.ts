// Le score de santé tel qu'on l'AFFICHE — libellés, classes, facteurs dominants —,
// SANS la base.
//
// Séparé de `health.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : le bandeau de santé reçoit un score
// déjà calculé ; il n'a pas à importer le pool de la console pour le colorer. Le
// CALCUL (`healthScore`, ses requêtes) reste dans `health.ts`.

export type HealthLabel = "Excellent" | "Bon" | "Dégradé" | "Critique";

export function healthLabel(score: number): HealthLabel {
  return score >= 90 ? "Excellent" : score >= 75 ? "Bon" : score >= 50 ? "Dégradé" : "Critique";
}

export const HEALTH_CLASS: Record<HealthLabel, string> = {
  Excellent:
    "bg-good/10 text-good-ink border-good/30",
  // « Bon » sans être le vert d'un seuil web.dev : le bleu perf, qui suit le thème.
  // TEXTE en `perf-ink` (#1d4ed8, jeton F01) : `text-perf` (#2563eb) sur la teinte
  // `bg-perf/10` ne tient que 4,48:1 en clair, sous le seuil de 4,5:1 (axe, F01). En
  // sombre, `perf` est déjà éclairci et tient : la variante `dark:` le garde.
  Bon: "bg-perf/10 text-perf-ink dark:text-perf border-perf/30",
  Dégradé:
    "bg-warn/10 text-warn-ink border-warn/30",
  Critique: "bg-bad/10 text-bad-ink border-bad/30",
};

/** Couleur d'accent (anneau de score, texte) par libellé santé. */
export const HEALTH_ACCENT: Record<HealthLabel, string> = {
  Excellent: "text-good-ink",
  Bon: "text-perf-ink dark:text-perf",
  Dégradé: "text-warn-ink",
  Critique: "text-bad-ink",
};

export interface HealthFactor {
  key: "vitals" | "errors" | "stability" | "anomalies";
  label: string;
  detail: string; // valeurs brutes lisibles (ex : "112/122 mesures good")
  earned: number | null; // points obtenus ; null = pas de donnée (composante exclue)
  max: number;
  /** Ce que la jauge écrit quand `earned` est null (« non testable »), à la place de « n/a ». */
  raisonNull?: string;
}

export interface AnomalyRow {
  app_id: string;
  route: string | null;
  bucket: Date | string;
  p75: number;
  mean_7d: number;
  z_score: number;
}

export interface Health {
  score: number | null; // null = données insuffisantes
  label: HealthLabel | null;
  factors: HealthFactor[];
  anomalies: AnomalyRow[];
}

/** Facteurs qui coûtent le plus de points (>= 1 pt perdu), pour le bandeau. */
export function dominantFactors(h: Health): HealthFactor[] {
  return h.factors
    .filter((x) => x.earned != null && x.max - x.earned >= 1)
    .sort((a, b) => b.max - b.earned! - (a.max - a.earned!))
    .slice(0, 3);
}
