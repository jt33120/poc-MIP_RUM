// Classe d'appareil déclarée par le SDK (`mip.device_type`) — finding 2.13 de
// docs/AUDIT_RUM_EXTERNE.md.
//
// L'ingestion lit d'abord l'user-agent (packages/backend/shared/dimensions.mjs)
// et range déjà iPad et tablettes Android. Il reste UN terminal que l'user-agent
// ne peut pas désigner : l'iPad sous iPadOS 13 ou plus récent, dont Safari se
// présente en « Macintosh ». Seul le navigateur sait qu'il est tactile — aucun
// Mac n'a d'écran tactile —, d'où cet indice, que l'ingestion laisse l'emporter
// sur sa lecture « desktop » d'un user-agent Macintosh.
//
// Aucune collecte nouvelle : `maxTouchPoints` est une propriété publique, lue
// une fois, réduite à une classe parmi trois. Pas d'empreinte.

export type ClasseAppareil = "mobile" | "tablet" | "desktop";

/**
 * Classe d'un terminal, d'après son user-agent et son nombre de points tactiles.
 * PURE.
 *
 * - iPad déclaré, Kindle (Silk), ou user-agent Macintosh tactile : tablette ;
 * - Android sans « Mobile » : convention des tablettes (Chrome, Samsung Internet,
 *   Firefox « Tablet »), téléviseurs et boîtiers exclus — ils n'en sont pas ;
 * - « Mobi » : mobile ; tout le reste : ordinateur.
 */
export function classeAppareil(ua: string, pointsTactiles: number): ClasseAppareil {
  // Téléviseurs et boîtiers d'abord : un Fire TV est un Android à Silk, sans « Mobile ».
  const tele = /TV|AFT|CrKey|BRAVIA/.test(ua);
  if (!tele && (/iPad|Kindle|Silk\/|Android(?!.*Mobile)/.test(ua) || (/Macintosh/.test(ua) && pointsTactiles > 1))) {
    return "tablet";
  }
  return /Mobi/i.test(ua) ? "mobile" : "desktop";
}
