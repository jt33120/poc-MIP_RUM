// Helpers de formatage propres à la feature « Performance IA ».
// Séparés de lib/format.ts (vitals) car sémantique différente : coût USD,
// tokens compacts, taux d'erreur en %.

/** Coût USD : sous 1 $, on montre 4 décimales ($0.0042) ; au-delà, 2 ($12.30). */
export function fmtCost(v: number | null): string {
  if (v == null) return "—";
  return v > 0 && v < 1 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

/** Tokens compacts : 1 234 -> "1,2k", 1 200 000 -> "1,2M". */
export function fmtTokens(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1).replace(".", ",") + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1).replace(".", ",") + "k";
  return String(v);
}

/** Latence en ms : 245 -> "245 ms", 2340 -> "2,34 s". */
export function fmtLatency(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return (v / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(v) + " ms";
}

/** Taux d'erreur 0..1 -> "3,2 %". */
export function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1).replace(".", ",") + " %";
}
