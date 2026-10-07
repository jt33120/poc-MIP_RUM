// Classe d'appareil (`mip.device_type`, finding 2.13 de l'audit RUM externe).
// Pour l'iPad sous iPadOS 13+, dont Safari se dit « Macintosh » : seul le
// navigateur sait qu'il est tactile (aucun Mac ne l'est), et l'ingestion fait
// primer cet indice. `maxTouchPoints` réduit à trois classes : pas d'empreinte.

export type ClasseAppareil = "mobile" | "tablet" | "desktop";

/**
 * Classe d'un terminal d'après son user-agent et ses points tactiles. Tablette :
 * iPad, Kindle (Silk), Macintosh tactile, Android sans « Mobile » hors
 * téléviseurs ; mobile : « Mobi » ; sinon ordinateur.
 */
export function classeAppareil(ua: string, pointsTactiles: number): ClasseAppareil {
  // Téléviseurs et boîtiers d'abord : un Fire TV est un Android à Silk, sans « Mobile ».
  const tele = /TV|AFT|CrKey|BRAVIA/.test(ua);
  if (!tele && (/iPad|Kindle|Silk\/|Android(?!.*Mobile)/.test(ua) || (/Macintosh/.test(ua) && pointsTactiles > 1))) {
    return "tablet";
  }
  return /Mobi/i.test(ua) ? "mobile" : "desktop";
}
