// Échantillonnage intelligent biaisé-erreurs (A1).
//
// Avant : `if (Math.random() >= sampleRate) return;` — une session non
// échantillonnée ne renvoyait RIEN, erreurs comprises. On perdait donc des
// sessions à incident, justement les plus précieuses.
//
// Maintenant, trois modes décidés une fois par session (persistés, donc stables
// au fil des pageviews/reloads dans la fenêtre de session) :
//   - "full"         : session entièrement collectée (fraction `sampleRate`).
//   - "error-biased" : télémétrie de routine supprimée (vitals, pageviews,
//                      resources, longtasks, breadcrumbs, track, spans API),
//                      MAIS les erreurs passent toujours ; la 1re erreur
//                      « promeut » la session en "full" pour la suite (on
//                      capture le contexte post-erreur). Fraction
//                      `errorSampleRate` des sessions non « full ».
//   - "off"          : rien n'est collecté (comportement historique, opt-in via
//                      keepOnError:false).
//
// Résultat : on garde 100 % (configurable) des sessions à erreur tout en
// échantillonnant le trafic nominal — volume maîtrisé, zéro incident perdu.
//
// Module pur + persistance résiliente : la décision (decideMode) et le
// contrôleur (createSampler) sont testés unitairement sans navigateur.
import type { MIPRumConfig } from "./types";

export type SampleMode = "full" | "error-biased" | "off";

const STORAGE_KEY = "mip_rum_sampling";

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const isMode = (m: unknown): m is SampleMode =>
  m === "full" || m === "error-biased" || m === "off";

/**
 * Décide le mode d'échantillonnage d'une session. Pur : `rand`/`rand2` sont
 * injectables pour les tests (deux tirages indépendants : appartenance à la
 * fraction `full`, puis à la fraction `errorSampleRate`).
 */
export function decideMode(
  cfg: Pick<MIPRumConfig, "sampleRate" | "errorSampleRate" | "keepOnError">,
  rand: number = Math.random(),
  rand2: number = Math.random(),
): SampleMode {
  if (rand < clamp01(cfg.sampleRate ?? 1)) return "full";
  if ((cfg.keepOnError ?? true) === false) return "off";
  return rand2 < clamp01(cfg.errorSampleRate ?? 1) ? "error-biased" : "off";
}

export interface Sampler {
  /** Mode courant ; peut passer de "error-biased" à "full" après une erreur. */
  readonly mode: SampleMode;
  /** Le span de ce nom doit-il être émis dans le mode courant ? */
  passes(spanName: string): boolean;
  /** À appeler sur chaque erreur : promeut une session "error-biased" en "full". */
  notifyError(): void;
}

/**
 * Contrôleur d'émission. `onPromote` est appelé une seule fois, au passage
 * "error-biased" -> "full" (utile pour persister la promotion).
 */
export function createSampler(initial: SampleMode, onPromote?: () => void): Sampler {
  let mode = initial;
  return {
    get mode() {
      return mode;
    },
    passes(spanName) {
      if (mode === "full") return true;
      if (mode === "off") return false;
      return spanName === "exception"; // error-biased : seules les erreurs passent
    },
    notifyError() {
      if (mode === "error-biased") {
        mode = "full";
        onPromote?.();
      }
    },
  };
}

// --- persistance (stabilité du mode sur la durée de vie de la session) -------

/** Mode déjà décidé pour cette session, ou null (storage indispo / autre session). */
export function loadMode(sessionId: string): SampleMode | null {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (raw && raw.sid === sessionId && isMode(raw.mode)) return raw.mode;
  } catch {
    /* storage indisponible ou corrompu */
  }
  return null;
}

/** Mémorise le mode de la session (best-effort ; ignoré en navigation privée). */
export function storeMode(sessionId: string, mode: SampleMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid: sessionId, mode }));
  } catch {
    /* mode privé : la décision vit le temps de la page */
  }
}
