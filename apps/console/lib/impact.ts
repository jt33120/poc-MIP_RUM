// Classement de segments par GRAVITÉ (F05, plan P3 et § 4.4) — logique PURE, testée.
//
// IP-Label classe ses « top offenders » du plus dégradé au moins dégradé ; la
// console classait par volume, ce qui met en tête ce qui est fréquent, pas ce qui
// va mal. Trois règles tiennent tout le classement :
//
//   1. LA GRAVITÉ D'ABORD, L'EFFECTIF ENSUITE. Une ligne est rangée selon sa valeur
//      pilote (le p75 du vital piloté), du plus dégradé au moins dégradé.
//   2. UN PETIT ÉCHANTILLON NE PASSE PAS DEVANT. Sous `seuilFaible` mesures (30 par
//      défaut), un p75 est trop instable pour être classé : la ligne va en fin de
//      liste, marquée « échantillon faible », quelle que soit sa valeur — une route
//      vue 12 fois à 6 s ne passe pas devant une route vue 400 fois à 3 s.
//   3. L'INCONNU EN DERNIER. Une ligne sans valeur pilote (« — ») n'est jamais
//      classée comme si elle valait 0 : elle ferme la liste.
//
// Et une absence : le classement ne produit AUCUNE ligne de synthèse. Pas de
// « Autres », pas de total : additionner ou moyenner des p75 n'a pas de sens (V5).
// La référence « Ensemble » est lue à part, sur toute la population.

/** Effectif sous lequel une ligne est un « échantillon faible » (P3). */
export const SEUIL_ECHANTILLON_FAIBLE = 30;

/**
 * Ordre d'un classement. `impact` (mesures « Mauvais » du groupe) attend le backend
 * B2 ; `fourni` garde l'ordre reçu (chronologie des releases, `/mobile`) et n'est
 * jamais une valeur d'URL.
 */
export type TriClassement = "gravite" | "volume" | "impact" | "fourni";

export interface OptionsClassement<T> {
  /** Valeur qui classe en gravité : plus elle est haute, plus la ligne est dégradée. */
  pilote: (ligne: T) => number | null;
  /** Effectif de la ligne (mesures du vital piloté) : décide de l'échantillon faible. */
  effectif: (ligne: T) => number | null;
  /** Défaut : `SEUIL_ECHANTILLON_FAIBLE`. */
  seuilFaible?: number;
  tri: TriClassement;
  /** Volume du tri « volume » (mesures, sessions, appels) ; défaut : `effectif`. */
  volume?: (ligne: T) => number | null;
  /** Mesures « Mauvais » du groupe, pour le tri « impact » (B2). */
  impact?: (ligne: T) => number | null;
}

/** Nombre utilisable pour classer : `null`, `NaN` et l'infini sont des inconnus. */
function connu(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Un effectif inconnu est faible : on ne se porte pas garant d'un p75 sans effectif. */
export function estFaible(effectif: number | null, seuil: number = SEUIL_ECHANTILLON_FAIBLE): boolean {
  return !connu(effectif) || effectif < seuil;
}

/**
 * Trie `lignes` selon `tri` et compte les échantillons faibles. Le tri est STABLE :
 * deux lignes à égalité gardent l'ordre reçu (celui de la lecture SQL).
 *
 *   - `gravite` : pilote décroissant pour les lignes non faibles, puis les faibles
 *     (pilote décroissant), puis les lignes sans pilote ;
 *   - `volume` : volume décroissant, volume inconnu en dernier ;
 *   - `impact` : mesures « Mauvais » décroissantes, inconnu en dernier — exige
 *     l'accesseur `impact` (B2) ;
 *   - `fourni` : l'ordre reçu, tel quel.
 *
 * Aucune ligne n'est ajoutée ni retirée : la sortie a exactement les lignes reçues.
 */
export function classerParGravite<T>(
  lignes: readonly T[],
  options: OptionsClassement<T>,
): { lignes: T[]; faibles: number } {
  const seuil = options.seuilFaible ?? SEUIL_ECHANTILLON_FAIBLE;
  const faibles = lignes.filter((l) => estFaible(options.effectif(l), seuil)).length;
  if (options.tri === "fourni") return { lignes: [...lignes], faibles };

  // Une clé de tri par ligne : [rang, valeur] ; rang croissant, puis valeur décroissante.
  let cle: (l: T) => [number, number];
  if (options.tri === "gravite") {
    cle = (l) => {
      const p = options.pilote(l);
      if (!connu(p)) return [2, 0];
      return [estFaible(options.effectif(l), seuil) ? 1 : 0, p];
    };
  } else {
    const accesseur = options.tri === "volume" ? (options.volume ?? options.effectif) : options.impact;
    if (!accesseur) {
      // Un tri « impact » sans le compte des mesures « Mauvais » trierait au hasard :
      // l'écran ne doit pas le proposer (`lireTri` le refuse tant que B2 manque).
      throw new Error("classerParGravite : tri « impact » sans accesseur `impact` (backend B2)");
    }
    cle = (l) => {
      const v = accesseur(l);
      return connu(v) ? [0, v] : [1, 0];
    };
  }

  const classees = lignes
    .map((ligne, index) => ({ ligne, index, cle: cle(ligne) }))
    .sort((a, b) => a.cle[0] - b.cle[0] || b.cle[1] - a.cle[1] || a.index - b.index)
    .map((x) => x.ligne);
  return { lignes: classees, faibles };
}

/**
 * Écart d'une ligne à la référence « Ensemble » : un ÉCART de p75 (valeur − référence),
 * jamais une contribution au total. Inconnu d'un côté → `null`.
 */
export function ecartALaReference(valeur: number | null, reference: number | null): number | null {
  return connu(valeur) && connu(reference) ? valeur - reference : null;
}
