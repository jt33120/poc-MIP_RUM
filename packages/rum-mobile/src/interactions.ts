// Interactions Pressable / Button — OPT-IN, et nommées par l'application.
//
// POURQUOI AUCUNE EXTRACTION DU TEXTE AFFICHÉ. Le SDK web lit le libellé d'un
// bouton parce qu'un nœud DOM expose un nom accessible dont le contenu est déjà
// public dans la page. React Native n'a pas cet équivalent : le seul texte
// atteignable est celui des `children`, c'est-à-dire ce que l'utilisateur voit
// à l'écran. Or sur mobile, ce texte est très souvent une DONNÉE : « Payer
// 128,40 € », « Appeler Marie D. », « Supprimer mon compte ». Le lire
// exfiltrerait un montant, un nom ou une intention dans un champ de télémétrie
// que personne ne relit avant l'envoi. Le nom est donc DÉCLARÉ, ou il n'y a pas
// d'action.
//
// POURQUOI UNE TRANSFORMATION DE PROPS, ET NON UN COMPOSANT. Ce paquet ne
// dépend ni de React ni de React Native — ni en dépendance, ni en peer
// obligatoire. Fournir un `<MipPressable>` imposerait les deux. Une fonction
// qui reçoit des props et en rend d'autres s'applique à `Pressable`,
// `TouchableOpacity`, `Button` ou n'importe quel composant maison, sans que le
// SDK connaisse aucun d'eux.
//
// CE QUI EST PRÉSERVÉ, MOT POUR MOT : toutes les autres props, l'accessibilité
// comprise (`accessibilityLabel`, `accessibilityRole`, `accessibilityState`,
// `accessibilityHint`, `testID`…), la valeur rendue par le gestionnaire
// d'origine, son `this`, et ses exceptions — une erreur levée dans un `onPress`
// doit continuer de remonter exactement comme sans nous.

import { boundedName } from "@mip/rum-core";

/**
 * Props reconnues. `mipActionName` est le seul ajout, et il est RETIRÉ de
 * l'objet rendu : le composant cible ne doit pas recevoir une prop qu'il ne
 * connaît pas.
 */
export interface PropsPressable {
  /** Nom EXPLICITE de l'action. Sans lui, rien n'est instrumenté. */
  mipActionName?: string;
  onPress?: unknown;
}

export interface CrochetsInteraction {
  /** Ouvre la racine causale. Rend l'identifiant, ou `null` si elle est refusée. */
  ouvrir(nom: string): string | null;
  /** Rattache la valeur rendue par le gestionnaire (promesse comprise). */
  suivre(resultat: unknown): void;
}

export type Instrumentation = <P extends PropsPressable>(props: P) => Omit<P, "mipActionName">;

/**
 * Fabrique l'instrumentation liée à une fenêtre causale.
 *
 * Séparée du runtime pour être testable sans SDK : les crochets sont deux
 * fonctions, et tout le comportement observable (préservation, ordre des
 * appels, stabilité du gestionnaire) s'éprouve sans réseau ni horloge.
 */
export function creerInstrumentation(crochets: CrochetsInteraction): Instrumentation {
  // Un gestionnaire enveloppé est MÉMORISÉ par gestionnaire d'origine et par
  // nom. Sans cela, chaque rendu produirait une nouvelle fonction, React verrait
  // une prop changée et re-rendrait le composant à chaque fois : instrumenter un
  // bouton coûterait un rendu par frame à l'application hôte.
  const cache = new WeakMap<object, Map<string, (...args: unknown[]) => unknown>>();

  function envelopper(
    original: (...args: unknown[]) => unknown,
    nom: string,
  ): (...args: unknown[]) => unknown {
    let parNom = cache.get(original);
    if (!parNom) {
      parNom = new Map();
      cache.set(original, parNom);
    }
    const connu = parNom.get(nom);
    if (connu) return connu;

    function enveloppe(this: unknown, ...args: unknown[]): unknown {
      // L'action est ouverte AVANT l'appel : un signal émis SYNCHRONEMENT par
      // le gestionnaire (une erreur déclarée, un `track`, une requête) doit
      // porter l'identifiant de l'appui qui l'a causé.
      try {
        crochets.ouvrir(nom);
      } catch {
        /* notre instrumentation ne casse jamais un appui */
      }
      // Hors try : une exception du gestionnaire d'origine doit remonter telle
      // quelle. La fenêtre causale reste alors ouverte, ce qui est exactement ce
      // qu'il faut pour que l'erreur qui suit porte l'action.
      const resultat = original.apply(this, args);
      try {
        crochets.suivre(resultat);
      } catch {
        /* ignore */
      }
      return resultat;
    }

    parNom.set(nom, enveloppe);
    return enveloppe;
  }

  return function instrumentPressable<P extends PropsPressable>(props: P): Omit<P, "mipActionName"> {
    // Opt-in strict : sans nom valide, l'objet rendu est l'objet reçu, à
    // l'identique. Rien n'est copié, rien n'est enveloppé, aucun rendu n'est
    // provoqué.
    const nom = boundedName(props?.mipActionName);
    const original = props?.onPress;
    if (!nom || typeof original !== "function") return props as Omit<P, "mipActionName">;

    // COPIE PAR DESCRIPTEURS, et non par `{...props}`. Un spread ÉVALUE chaque
    // prop, `children` compris : sur un bouton dont le libellé est calculé
    // (« Payer 128,40 € »), le SDK lirait donc la donnée qu'il s'interdit de
    // lire, et un getter applicatif s'exécuterait une fois de plus par rendu.
    // Les descripteurs se recopient sans être évalués : ce que nous ne lisons
    // pas, nous ne le touchons pas.
    const descripteurs = Object.getOwnPropertyDescriptors(props);
    delete (descripteurs as Record<string, unknown>).mipActionName;
    const sortie = Object.defineProperties({}, descripteurs) as Record<string, unknown>;
    sortie.onPress = envelopper(original as (...args: unknown[]) => unknown, nom);
    return sortie as Omit<P, "mipActionName">;
  };
}
