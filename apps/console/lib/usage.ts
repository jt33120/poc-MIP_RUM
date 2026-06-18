// Présentation de la consommation vs quota (P0 #5). Helper PUR (testable).
export interface QuotaView {
  pct: number | null; // % du quota consommé ; null si illimité
  over: boolean; // dépassement
  label: string; // "illimité" | "62%"
}

/** Vue quota pour l'affichage : pourcentage, dépassement, libellé. quota null/≤0 = illimité. */
export function quotaView(events: number, quota: number | null): QuotaView {
  if (quota == null || quota <= 0) return { pct: null, over: false, label: "illimité" };
  const pct = Math.round((events / quota) * 100);
  return { pct, over: events > quota, label: `${pct}%` };
}
