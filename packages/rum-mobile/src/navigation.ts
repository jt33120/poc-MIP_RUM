// Suivi d'écrans — dédoublonnage, et adaptateur pour le routeur pris en charge.
//
// LE PROBLÈME QUE CE MODULE RÉSOUT. Un routeur React Native notifie son état
// plusieurs fois pour UNE seule transition : une fois pour le conteneur racine,
// une fois par pile imbriquée, parfois une troisième pour l'animation. Brancher
// naïvement un callback sur ces notifications produit deux à quatre pages vues
// pour un écran réellement affiché une fois — et toutes les métriques par écran
// deviennent fausses dans le même rapport.
//
// LA RÈGLE. Un écran n'ouvre une vue que s'il n'est pas DÉJÀ l'écran courant.
// L'identité comparée est la clef de route quand le routeur en fournit une
// (elle distingue deux instances du même écran dans une pile), sinon le nom.
//
// CE QUE LA RÈGLE PRÉSERVE VOLONTAIREMENT. A → B → A produit bien TROIS vues :
// revenir sur un écran est une nouvelle consultation, et le dédoublonnage ne
// compare qu'à l'écran COURANT, jamais à l'historique. Confondre les deux
// effacerait les allers-retours, qui sont exactement ce qu'un entonnoir mesure.

import { boundedName } from "@mip/rum-core";
import type { EcranEntrant, NavigationAdapter } from "./adapters";

/** Écran retenu par le suivi, une fois borné et dédoublonné. */
export interface EcranRetenu {
  name: string;
  key: string | null;
}

function normaliser(ecran: EcranEntrant): EcranRetenu | null {
  const brut = typeof ecran === "string" ? { name: ecran, key: null } : ecran;
  const name = boundedName(brut?.name);
  if (!name) return null;
  const key = typeof brut?.key === "string" && brut.key.trim() ? brut.key.trim().slice(0, 200) : null;
  return { name, key };
}

/**
 * Mémoire de l'écran courant. Volontairement minuscule : tout le reste du suivi
 * (émission, enveloppe, fenêtre causale) appartient au runtime, et un état
 * d'écran dupliqué entre deux modules finirait par diverger.
 */
export class SuiviNavigation {
  private identiteCourante: string | null = null;

  /**
   * Rend l'écran à émettre, ou `null` s'il s'agit d'une répétition.
   *
   * Un écran invalide (nom vide, non textuel, hors limites) est refusé sans
   * modifier l'écran courant : une notification malformée ne doit pas faire
   * croire qu'on a quitté l'écran précédent.
   */
  accepte(ecran: EcranEntrant): EcranRetenu | null {
    const retenu = normaliser(ecran);
    if (!retenu) return null;
    const identite = retenu.key ?? `nom:${retenu.name}`;
    if (identite === this.identiteCourante) return null;
    this.identiteCourante = identite;
    return retenu;
  }

  /** Oublie l'écran courant — après `shutdown`, ou sur rotation de session. */
  reinitialise(): void {
    this.identiteCourante = null;
  }
}

// ───────────────────────── adaptateur du routeur ─────────────────────────────

/**
 * Surface PUBLIQUE consommée sur la référence de conteneur de React Navigation.
 *
 * Aucun `import` de la bibliothèque, aucune découverte à l'exécution : c'est
 * l'application qui passe sa propre référence. On ne lit que trois membres
 * publics et stables de son API : `addListener("state")`, `getCurrentRoute()`
 * et `isReady()`.
 *
 * `getCurrentRoute()` rend la route ACTIVE LA PLUS PROFONDE, clef comprise.
 * C'est précisément ce qu'il faut pour les piles imbriquées : les notifications
 * du conteneur et de chaque pile résolvent toutes vers la même route finale, et
 * le dédoublonnage n'en garde qu'une.
 */
export interface RefRouteur {
  addListener(type: "state", callback: () => void): unknown;
  getCurrentRoute?(): { name?: unknown; key?: unknown } | null | undefined;
  isReady?(): boolean;
}

/** Désabonnement, quelle que soit la forme rendue par `addListener`. */
function desabonner(retour: unknown): void {
  if (typeof retour === "function") {
    (retour as () => void)();
    return;
  }
  const remove = (retour as { remove?: unknown } | null | undefined)?.remove;
  if (typeof remove === "function") remove.call(retour);
}

/**
 * Adaptateur de navigation fondé sur les callbacks publics du routeur.
 *
 * Testé contre un double conforme à cette surface publique ; AUCUNE version
 * réelle de routeur, de React Native ou de moteur JS n'a été exercée dans ce
 * lot — la matrice de compatibilité appartient à P7.5 et à la recette sur
 * appareil de P8.5. Ce qui est garanti ici est le contrat : trois membres lus,
 * un désabonnement rendu, aucune exception remontée dans l'application.
 */
export function navigationDepuisRouteur(ref: RefRouteur): NavigationAdapter {
  return {
    subscribeScreen(callback: (ecran: EcranEntrant) => void): () => void {
      const emettre = () => {
        try {
          const route = ref.getCurrentRoute?.();
          const name = typeof route?.name === "string" ? route.name : null;
          if (!name) return;
          callback({ name, key: typeof route?.key === "string" ? route.key : null });
        } catch {
          /* un routeur qui lève pendant une transition ne casse pas l'app hôte */
        }
      };
      let abonnement: unknown = null;
      try {
        abonnement = ref.addListener("state", emettre);
      } catch {
        /* abonnement refusé : le suivi reste manuel via screen() */
      }
      // L'écran d'ouverture n'émet aucun changement d'état : sans cette
      // émission initiale, la première consultation de l'application ne serait
      // jamais comptée.
      try {
        if (ref.isReady?.() !== false) emettre();
      } catch {
        /* ignore */
      }
      return () => {
        try {
          desabonner(abonnement);
        } catch {
          /* ignore */
        }
      };
    },
  };
}
