/** Durées : 245 -> "245 ms", 2340 -> "2,34 s". CLS (sans unité) : 3 décimales. */
export function fmtVital(name: string, value: number | null): string {
  if (value == null) return "—";
  if (name === "CLS") return value.toFixed(3);
  if (value >= 1000) return (value / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(value) + " ms";
}

export function fmtDate(d: Date | string): string {
  return new Date(d).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Détection navigateur grossière pour l'affichage (pas d'analytics fine au POC). */
export function browserFromUA(ua: string | null): string {
  if (!ua) return "—";
  if (/edg\//i.test(ua)) return "Edge";
  if (/firefox/i.test(ua)) return "Firefox";
  if (/chrome|chromium/i.test(ua)) return "Chrome";
  if (/safari/i.test(ua)) return "Safari";
  return "Autre";
}
