/** Compteur plafonné par page (réinitialisé à chaque pageview/navigation SPA). */
export interface PageCap {
  /** Réserve un slot ; false si le plafond de la page est atteint. */
  take(): boolean;
  reset(): void;
  count(): number;
}

export function makeCap(limit: number): PageCap {
  let used = 0;
  return {
    take: () => (used < limit ? (used++, true) : false),
    reset: () => {
      used = 0;
    },
    count: () => used,
  };
}
