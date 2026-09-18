// Ce que ce SDK DÉCLARE collecter (P7.5) — logique pure, sans plateforme.
//
// POURQUOI DÉCLARER PLUTÔT QUE LAISSER DEVINER. Une console qui ne reçoit aucun
// crash natif ne peut pas distinguer « cette application ne plante pas » de
// « rien ne mesure ses plantages ». Les deux rendent zéro. Le premier mérite
// d'être annoncé, le second est un angle mort — celui que P7 laisse ouvert, en
// entier, pour tout ce qui est natif. La déclaration est ce qui permet à l'écran
// d'afficher « Non collecté » au lieu de « 0 ».
//
// UNE DÉCLARATION N'EST PAS UNE PREUVE. Ce fichier dit ce que le SDK a INSTALLÉ,
// sur la foi de son propre code. Il ne dit pas qu'un signal a été reçu, écrit,
// symbolisé et affiché — cela s'établit par une recette d'opérateur, qui seule
// écrit `verified_at` côté serveur. Aucun booléen produit ici ne peut y toucher.
//
// COPIE ASSUMÉE DU VOCABULAIRE SERVEUR. La liste et les états vivent aussi dans
// `apps/ingest/supabase/functions/_shared/mobile-capabilities.mjs`, qui fait
// autorité à réception. Ce paquet ne peut pas importer un module Node ; comme
// pour `ERROR_SOURCES` (otlp.mjs / queries-errors.ts), les deux listes sont
// comparées par `tests/unit/rum-mobile-p75.test.ts` — une divergence devient un
// échec de test, pas une capacité silencieusement ignorée à l'ingestion.

/** Vocabulaire FERMÉ des capacités. Même ordre et mêmes noms que le serveur. */
export const CAPACITES_MOBILES = [
  "js_errors",
  "native_crashes",
  "anr",
  "native_start",
  "offline_persistence",
  "screen_tracking",
] as const;

export type CapaciteMobile = (typeof CAPACITES_MOBILES)[number];

/**
 * `active` : installée et observée. `unavailable` : le SDK a REGARDÉ et n'a rien
 * pu installer. Il n'existe pas de troisième état ici — « personne n'a rien
 * dit » se traduit par l'ABSENCE de déclaration, pas par une valeur.
 */
export type EtatCapaciteMobile = "active" | "unavailable";

/** Les trois capacités que seul un module NATIF pourrait observer. */
export const CAPACITES_NATIVES: readonly CapaciteMobile[] = [
  "native_crashes",
  "anr",
  "native_start",
];

/**
 * Pourquoi les capacités natives sont toutes indisponibles dans ce paquet.
 *
 * Ce n'est pas une omission : aucun module natif MIP n'existe, ni pour iOS ni
 * pour Android. Un crash natif — signal POSIX, exception Objective-C, `SIGABRT`,
 * `ANR` du watchdog Android — n'est pas observable depuis le runtime JavaScript,
 * qui est lui-même la première victime de ces événements. Les rendre
 * configurables par une option d'`init` ne les rendrait pas observables : cela
 * donnerait seulement à une application le moyen de déclarer une collecte qui
 * n'a pas lieu, et à la console d'afficher « 100 % sans crash » sur un silence.
 */
export const RAISON_CAPACITES_NATIVES =
  "aucun module natif MIP n'est livré : crashes natifs, ANR et démarrage natif appartiennent à P8.5";

/** Ce que la couche JS a réellement pu installer, tel que le runtime le sait. */
export interface EtatObserve {
  /** `ErrorUtils` enchaîné : erreurs JS non interceptées. */
  errorHandler: EtatCapaciteMobile;
  /** Un adaptateur de navigation est abonné (et non `screen()` manuel seul). */
  navigation: EtatCapaciteMobile;
  /** La file durable est activée ET le stockage répond. */
  offlinePersistence: EtatCapaciteMobile;
}

/**
 * Déclaration complète : les six capacités, chacune avec son état.
 *
 * `js_errors` suit `errorHandler` SEUL, et non la conjonction avec les rejets de
 * promesses. Une application qui a `ErrorUtils` mais pas d'adaptateur de rejets
 * collecte bel et bien ses erreurs JS ; annoncer « non collecté » pour elle
 * serait un faux négatif, et un faux négatif fait chercher une panne qui
 * n'existe pas. Le grain plus fin — rejets branchés ou non — n'a pas de nom dans
 * le vocabulaire fermé : il reste dans `getDiagnostics().jsCapabilities`.
 *
 * `screen_tracking` suit l'adaptateur de navigation. « unavailable » ne veut pas
 * dire « aucune page vue » : `screen()` manuel alimente toujours la table. Cela
 * veut dire « aucune garantie de COUVERTURE » — et c'est ce que la console doit
 * écrire, plutôt qu'un zéro.
 */
export function declarationCapacites(etat: EtatObserve): Record<CapaciteMobile, EtatCapaciteMobile> {
  return {
    js_errors: etat.errorHandler,
    native_crashes: "unavailable",
    anr: "unavailable",
    native_start: "unavailable",
    offline_persistence: etat.offlinePersistence,
    screen_tracking: etat.navigation,
  };
}

/**
 * Sérialise la déclaration pour l'attribut de resource `mip.capabilities`.
 *
 * Forme `nom:état`, virgules, ordre du vocabulaire — donc STABLE d'un lot à
 * l'autre. Un ordre instable ferait varier l'octet envoyé sans que rien ne
 * change, et rendrait toute comparaison de payload illisible en recette.
 */
export function serialiserCapacites(declaration: Record<CapaciteMobile, EtatCapaciteMobile>): string {
  return CAPACITES_MOBILES.map((nom) => `${nom}:${declaration[nom]}`).join(",");
}

/** Les capacités NATIVES actives. Vide — et c'est un fait connu, pas une inconnue. */
export function capacitesNativesActives(
  declaration: Record<CapaciteMobile, EtatCapaciteMobile>,
): CapaciteMobile[] {
  return CAPACITES_NATIVES.filter((nom) => declaration[nom] === "active");
}
