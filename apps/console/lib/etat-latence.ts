// La ligne « Latence d'alerte » de la vitrine, DÉDUITE d'une preuve.
//
// POURQUOI ELLE N'EST PLUS ÉCRITE EN DUR. Elle a longtemps dit « 5 minutes
// visées, 60 réelles » — et c'était vrai : la cadence était plafonnée par les
// planificateurs disponibles (Vercel Cron n'accepte que du quotidien sur le plan
// Hobby, GitHub Actions est facturé à la minute entamée). Un déclencheur dédié
// est arrivé, la phrase est devenue fausse, et rien dans le code ne l'aurait
// signalé. C'est exactement ce qui s'était produit pour la purge de rétention,
// qui a annoncé « jamais exécutée » des semaines après avoir repris.
//
// La règle qu'on en tire : une affirmation qui peut changer SANS qu'on touche au
// code ne doit pas vivre dans le code. Elle se relit à chaque rendu.
//
// Logique PURE — ni base, ni horloge implicite : `maintenant` est un paramètre,
// sinon le comportement aux frontières ne serait pas testable.

/** Cadence visée par le tick : évaluation des alertes, SLO et sondes uptime. */
export const CADENCE_TICK_MIN = 5;

/**
 * Au-delà de ce délai sans passage, on cesse de dire que la latence est tenue.
 *
 * Trois cadences ratées, pas une : un redéploiement, une coupure réseau ou un
 * builder lent décalent un tick sans que rien ne soit cassé. Annoncer « à
 * l'arrêt » au premier retard ferait clignoter la vitrine pour du bruit.
 */
export const TOLERANCE_MIN = CADENCE_TICK_MIN * 3;

export type StatutLatence = "atteint" | "partiel" | "manque";

export interface LigneLatence {
  reel: string;
  s: StatutLatence;
  /** Minutes écoulées depuis le dernier passage, ou null si aucun. */
  depuisMin: number | null;
}

/**
 * @param dernierTick fin du dernier tick abouti (scheduler_lease), ou null
 * @param maintenant  horloge, injectée
 */
export function ligneLatence(dernierTick: Date | null, maintenant: number): LigneLatence {
  if (dernierTick == null) {
    // Aucune trace : soit le scheduler n'a jamais tourné, soit la base est
    // injoignable. Dans les deux cas on ne peut RIEN prouver, donc on n'affirme
    // pas que ça marche — la vitrine dit ce qu'elle sait, pas ce qu'elle espère.
    return {
      reel: "Déclencheur dédié déployé ; aucun passage constaté en production",
      s: "manque",
      depuisMin: null,
    };
  }

  const depuisMin = Math.max(0, Math.round((maintenant - dernierTick.getTime()) / 60_000));

  if (depuisMin <= TOLERANCE_MIN) {
    return {
      reel: `${CADENCE_TICK_MIN} minutes — déclencheur dédié, dernier passage il y a ${depuisMin} min`,
      s: "atteint",
      depuisMin,
    };
  }

  return {
    reel: `Déclencheur dédié, mais aucun passage depuis ${depuisMin} min — alertes et SLO à l'arrêt`,
    s: "partiel",
    depuisMin,
  };
}
