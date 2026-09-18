// Adaptateurs du runtime React Native — les points où le SDK touche la
// plateforme, et les SEULS.
//
// POURQUOI DES ADAPTATEURS EXPLICITES. Le package ne fait aucune découverte de
// capacités à l'exécution : pas de `global.require("react-native")` supposé
// fonctionnel sous Metro, pas de test d'existence d'un module natif. Une
// découverte implicite marche sur le poste du développeur et échoue sur un
// build de production, sans que rien ne le signale. L'application déclare ce
// qu'elle fournit ; ce qu'elle ne fournit pas est ABSENT, et le diagnostic le
// dit.
//
// Aucun de ces types n'importe `react-native` : l'application branche
// `AsyncStorage`, `MMKV`, `AppState` ou son propre objet, au choix.

/** État de cycle de vie observé par `lifecycle`. */
export type EtatCycleDeVie = "active" | "background" | "inactive";

/**
 * Stockage clef/valeur asynchrone (AsyncStorage, MMKV, expo-secure-store…).
 *
 * `capabilities.atomicWrite` déclare que `setItem` est atomique côté plateforme
 * (écriture temporaire + rename). Quand c'est vrai, la file est écrite en une
 * seule clef ; sinon le SDK sérialise lui-même deux emplacements et un
 * manifeste, parce qu'une écriture interrompue par un kill de l'OS laisserait
 * autrement un JSON tronqué à la place de la file précédente.
 */
export interface StorageAdapter {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
  capabilities?: { atomicWrite?: boolean };
}

/** Cycle de vie de l'application (AppState de React Native, ou équivalent). */
export interface LifecycleAdapter {
  subscribe(callback: (state: EtatCycleDeVie) => void): () => void;
}

/**
 * Écran observé par l'adaptateur de navigation.
 *
 * La CLEF DE ROUTE est ce qui distingue deux instances du même écran empilées
 * l'une sur l'autre — un détail de produit poussé depuis une liste de produits,
 * puis un autre. Quand le routeur en expose une, le dédoublonnage s'appuie
 * dessus ; sinon il retombe sur le nom, qui suffit à absorber les callbacks
 * répétés.
 */
export interface EcranObserve {
  name: string;
  key?: string | null;
}

/** Un routeur qui ne connaît qu'un nom passe une chaîne ; les autres, l'objet. */
export type EcranEntrant = string | EcranObserve;

/**
 * Navigation — branchée sur les callbacks PUBLICS du routeur de l'application.
 *
 * Le SDK ne résout aucun routeur : c'est l'application qui abonne, et qui rend
 * le désabonnement. `navigationDepuisRouteur()` fabrique cet adaptateur pour un
 * conteneur de type React Navigation ; `screen()` reste la voie manuelle pour
 * tous les autres.
 */
export interface NavigationAdapter {
  subscribeScreen(callback: (screen: EcranEntrant) => void): () => void;
}

/**
 * Rejets de promesses non gérés.
 *
 * Aucun moteur JS visé n'expose de mécanisme standard ET retirable : c'est
 * l'application qui branche celui de son runtime. Sans cet adaptateur et sans
 * mécanisme standard sur l'objet global, la capacité est déclarée ABSENTE — et
 * le diagnostic le dit, au lieu de laisser croire qu'aucun rejet n'a lieu.
 * Voir `rejetsDepuisTracker()`.
 */
export interface UnhandledRejectionAdapter {
  subscribe(callback: (reason: unknown) => void): () => void;
}

/** Source d'aléa. Sert au visiteur et aux identifiants de corrélation. */
export interface RandomAdapter {
  bytes(length: number): Uint8Array;
}

/**
 * Horloge MONOTONE, en millisecondes, d'origine arbitraire.
 *
 * Elle ne sert QU'AUX DURÉES : inactivité de session, retrait exponentiel,
 * timings de vue. Les horodatages d'événements restent en UTC mural, parce
 * qu'un serveur ne sait pas relire l'origine de l'horloge d'un téléphone.
 * Séparer les deux est ce qui empêche une horloge murale qui recule — changement
 * de fuseau, synchronisation NTP, utilisateur qui règle sa date — de produire
 * une durée négative.
 */
export interface ClockAdapter {
  nowMs(): number;
}

export interface Adapters {
  storage?: StorageAdapter;
  lifecycle?: LifecycleAdapter;
  navigation?: NavigationAdapter;
  unhandledRejection?: UnhandledRejectionAdapter;
  random?: RandomAdapter;
  monotonicClock?: ClockAdapter;
}

/**
 * Horloge monotone de repli, quand l'application n'en fournit pas.
 *
 * `performance.now()` quand il existe (Hermes l'expose), sinon un compteur
 * ancré sur `Date.now()` mais CLIQUETANT : il ne recule jamais, même si
 * l'horloge murale recule. Une durée mesurée avec lui peut être sous-estimée
 * après un recul de l'horloge ; elle ne sera jamais négative, et c'est la
 * propriété dont dépendent la session et le retrait exponentiel.
 */
export function horlogeMonotoneParDefaut(): ClockAdapter {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  if (typeof perf?.now === "function") {
    const origine = perf.now();
    return { nowMs: () => perf.now!() - origine };
  }
  let dernierMural = Date.now();
  let ecoule = 0;
  return {
    nowMs: () => {
      const mural = Date.now();
      // Un saut en avant est recopié tel quel (l'appareil a bien dormi ce
      // temps-là) ; un saut en arrière compte pour zéro.
      if (mural > dernierMural) ecoule += mural - dernierMural;
      dernierMural = mural;
      return ecoule;
    },
  };
}

/**
 * Aléa de repli. `crypto.getRandomValues` quand il existe, sinon `Math.random`.
 *
 * Ces identifiants ne sont pas des secrets : ce sont des clefs de corrélation
 * de télémétrie. Exiger une source cryptographique ferait échouer le SDK sous
 * les moteurs JS qui n'exposent pas `crypto`, pour une propriété dont personne
 * n'a besoin ici. En revanche l'application PEUT fournir sa propre source.
 */
export function aleaParDefaut(): RandomAdapter {
  // `typeof` et non une lecture directe : sous un moteur qui n'expose pas du
  // tout ce global, référencer `crypto` lèverait une ReferenceError au premier
  // événement, donc dans l'application hôte.
  const api = typeof crypto !== "undefined" ? crypto : undefined;
  return {
    bytes(length: number): Uint8Array {
      const out = new Uint8Array(length);
      if (typeof api?.getRandomValues === "function") {
        api.getRandomValues(out);
        return out;
      }
      for (let i = 0; i < length; i++) out[i] = Math.floor(Math.random() * 256);
      return out;
    },
  };
}

/** Hexadécimal issu de l'adaptateur d'aléa — jamais d'un identifiant d'appareil. */
export function hexDepuis(random: RandomAdapter, octets: number): string {
  let s = "";
  const bytes = random.bytes(octets);
  for (let i = 0; i < octets; i++) s += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  return s;
}
