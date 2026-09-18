// Rejets de promesses non gérés — et « capacité absente » quand le moteur n'en
// expose aucun mécanisme retirable.
//
// L'ÉTAT DU MONDE, ET POURQUOI IL DICTE CE CODE. Il n'existe pas de mécanisme
// unique. Hermes et JavaScriptCore ne publient aucune API standard et RETIRABLE
// pour observer les rejets non gérés : React Native s'appuie sur le module de
// suivi livré avec son polyfill de promesses, dont l'activation est GLOBALE et
// remplace celle de l'application. Nous refusons de la poser nous-mêmes : la
// règle d'arrêt du SDK est de ne retirer que ce qu'on a posé, et un mécanisme
// qu'on ne peut pas retirer sans écraser celui de l'application n'est pas
// retirable du tout.
//
// D'OÙ DEUX CHEMINS, DANS CET ORDRE :
//   1. un ADAPTATEUR fourni par l'application — la voie recommandée en React
//      Native, une ligne à écrire, et l'application garde la main sur le module
//      qu'elle possède déjà (`rejetsDepuisTracker` la réduit à un appel) ;
//   2. l'événement WHATWG `unhandledrejection` quand le moteur l'expose sur son
//      objet global, avec `removeEventListener` pour le retirer. Aucun
//      `preventDefault` : le comportement d'origine du moteur reste visible.
//
// ET PAS `process.on("unhandledRejection")`, MÊME SOUS NODE. Ce n'est pas un
// oubli : sous Node, la SEULE PRÉSENCE d'un écouteur sur cet événement supprime
// le comportement par défaut du runtime — l'avertissement, et depuis Node 15 la
// terminaison du processus. Y poser un écouteur de télémétrie ferait donc
// SURVIVRE un processus que l'exploitant voulait voir mourir, parce que MIP est
// installé. La règle du lot est de ne jamais masquer la redbox ni la
// terminaison ; elle s'applique aussi ici.
//
// Aucun de ces chemins ne passe par une résolution de module : pas de
// `global.require`, pas de test d'existence d'un paquet. Quand aucun ne
// s'applique, l'état est `unavailable` et `getDiagnostics()` le dit — un
// silence ne doit jamais se lire comme « aucun rejet ».

import type { UnhandledRejectionAdapter } from "./adapters";

/** Capacité JS observable par le SDK. `unavailable` n'est pas `0` rejet. */
export type EtatCapacite = "active" | "unavailable";

/** Source réellement retenue — consignée pour le diagnostic et pour P7.5. */
export type SourceRejets = "adapter" | "events" | "none";

export interface InstallationRejets {
  etat: EtatCapacite;
  source: SourceRejets;
  desinstaller(): void;
}

/** Objet global minimal réellement consulté. Injectable pour les tests. */
export interface GlobalRejets {
  addEventListener?: unknown;
  removeEventListener?: unknown;
}

const EVENEMENT = "unhandledrejection";

/**
 * Installe l'observation des rejets non gérés.
 *
 * Le callback reçoit la RAISON brute du rejet. Elle n'est jamais convertie ici :
 * le runtime sait seul comment en tirer un message, un type et une pile bornés,
 * et le faire deux fois produirait deux formes d'erreur pour un même incident.
 */
export function installerRejets(
  adapter: UnhandledRejectionAdapter | undefined,
  cible: GlobalRejets,
  callback: (reason: unknown) => void,
): InstallationRejets {
  if (adapter && typeof adapter.subscribe === "function") {
    try {
      const desabonner = adapter.subscribe(callback);
      if (typeof desabonner === "function") {
        return { etat: "active", source: "adapter", desinstaller: () => { try { desabonner(); } catch { /* ignore */ } } };
      }
      // Un adaptateur qui ne rend pas de désabonnement laisserait un écouteur
      // survivre à `shutdown()`. On le refuse plutôt que de mentir sur l'arrêt.
    } catch {
      /* adaptateur défaillant : on tente les mécanismes standards */
    }
  }

  const ajouter = cible.addEventListener;
  const retirer = cible.removeEventListener;
  if (typeof ajouter === "function" && typeof retirer === "function") {
    const ecouteur = (evenement: unknown) => {
      // `reason` est la propriété normalisée de PromiseRejectionEvent. Certains
      // moteurs passent directement la raison : les deux formes sont acceptées.
      const raison = (evenement as { reason?: unknown } | null | undefined);
      callback(raison && typeof raison === "object" && "reason" in raison ? raison.reason : evenement);
      // Aucun `preventDefault` : le comportement d'origine du moteur — trace en
      // console, avertissement de développement — doit rester visible.
    };
    try {
      (ajouter as (t: string, l: unknown) => void).call(cible, EVENEMENT, ecouteur);
      return {
        etat: "active",
        source: "events",
        desinstaller: () => {
          try {
            (retirer as (t: string, l: unknown) => void).call(cible, EVENEMENT, ecouteur);
          } catch {
            /* ignore */
          }
        },
      };
    } catch {
      /* ignore : la capacité sera déclarée absente */
    }
  }

  return { etat: "unavailable", source: "none", desinstaller: () => {} };
}

/**
 * Surface du module de suivi de rejets livré avec le polyfill de promesses de
 * React Native. L'APPLICATION le résout elle-même — c'est SA dépendance — et
 * passe l'objet obtenu ; le SDK n'en connaît que ces deux méthodes.
 */
export interface TrackerRejets {
  enable(options: {
    allRejections?: boolean;
    onUnhandled?: (id: unknown, error: unknown) => void;
    onHandled?: (id: unknown) => void;
  }): void;
  disable?(): void;
}

/**
 * Adaptateur prêt à brancher sur ce module.
 *
 * ATTENTION, ET C'EST LA RAISON POUR LAQUELLE CE N'EST PAS AUTOMATIQUE :
 * l'activation de ce suivi est GLOBALE au processus. Si l'application avait sa
 * propre configuration, celle-ci la remplace ; le désabonnement rend un état
 * DÉSACTIVÉ, pas l'état antérieur, que le module n'expose pas. C'est à
 * l'application de décider — d'où un appel explicite, dans son code.
 *
 * Testé contre un double conforme à cette surface ; aucune version réelle du
 * module n'a été exercée dans ce lot.
 */
export function rejetsDepuisTracker(tracker: TrackerRejets): UnhandledRejectionAdapter {
  return {
    subscribe(callback: (reason: unknown) => void): () => void {
      let actif = true;
      tracker.enable({
        allRejections: true,
        onUnhandled: (_id: unknown, error: unknown) => {
          if (actif) callback(error);
        },
        onHandled: () => {},
      });
      return () => {
        actif = false;
        try {
          tracker.disable?.();
        } catch {
          /* ignore */
        }
      };
    },
  };
}
