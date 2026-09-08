/** Durées : 245 -> "245 ms", 2340 -> "2,34 s". CLS (sans unité) : 3 décimales. */
export function fmtVital(name: string, value: number | null): string {
  if (value == null) return "—";
  if (name === "CLS") return value.toFixed(3);
  if (value >= 1000) return (value / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(value) + " ms";
}

/** Latence en ms : 245 -> "245 ms", 2340 -> "2,34 s". (sans nom de vital) */
export function fmtLatency(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1000) return (v / 1000).toFixed(2).replace(".", ",") + " s";
  return Math.round(v) + " ms";
}

/** Taux 0..1 -> "3,2 %". */
export function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return (v * 100).toFixed(1).replace(".", ",") + " %";
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

/**
 * Version MAJEURE du navigateur — le seul chiffre qui porte une décision
 * (« ce parc est-il au-dessus de Chrome 111, minimum requis par l'injection en
 * MAIN world ? »). Edge se déclare AUSSI « Chrome/… » : son `Edg/` est donc lu
 * en premier, sinon tout Edge serait compté comme Chrome.
 */
export function browserMajorFromUA(ua: string | null): number | null {
  if (!ua) return null;
  for (const re of [/edg\/(\d+)/i, /firefox\/(\d+)/i, /chrome\/(\d+)/i, /version\/(\d+).*safari/i]) {
    const m = re.exec(ua);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Système du poste, lu dans l'User-Agent. Windows 11 est INDISCERNABLE de
 * Windows 10 dans l'UA (les deux annoncent « Windows NT 10.0 ») : on s'arrête donc
 * à « Windows », plutôt que d'afficher une version fausse une fois sur deux.
 */
export function platformFromUA(ua: string | null): string | null {
  if (!ua) return null;
  if (/windows/i.test(ua)) return "Windows";
  if (/android/i.test(ua)) return "Android";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/mac os x|macintosh/i.test(ua)) return "macOS";
  if (/cros/i.test(ua)) return "ChromeOS";
  if (/linux/i.test(ua)) return "Linux";
  return null;
}
