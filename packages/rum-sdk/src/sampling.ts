// Échantillonnage biaisé vers les erreurs, décidé une fois par session et persisté :
//   - "full"         : tout est collecté (fraction `sampleRate`) ;
//   - "error-biased" : seules les erreurs passent, la première promeut la session
//                      en "full" pour garder la suite (fraction `errorSampleRate`) ;
//   - "off"          : rien (le reste, ou tout hors "full" si keepOnError:false).
// Sous `requireConsent`, le mode n'est décidé qu'à l'accord et appliqué au tampon
// d'un bloc (index.ts), le stockage étant inaccessible avant (finding 1.11).
import { accesTerminalAutorise, CLE_ECHANTILLONNAGE } from "./consent";
import type { MIPRumConfig } from "./types";

export type SampleMode = "full" | "error-biased" | "off";

const STORAGE_KEY = CLE_ECHANTILLONNAGE;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const isMode = (m: unknown): m is SampleMode =>
  m === "full" || m === "error-biased" || m === "off";

/** Décide le mode d'une session ; deux tirages indépendants, injectables pour les tests. */
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

/** Contrôleur d'émission ; `onPromote` est appelé une fois, au passage en "full". */
export function createSampler(initial: SampleMode, onPromote?: () => void): Sampler {
  let mode = initial;
  return {
    get mode() {
      return mode;
    },
    passes(spanName) {
      if (mode === "full") return true;
      if (mode === "off") return false;
      return spanName === "exception";
    },
    notifyError() {
      if (mode === "error-biased") {
        mode = "full";
        onPromote?.();
      }
    },
  };
}

/** Mode déjà décidé pour cette session, ou null (storage indispo / autre session). */
export function loadMode(sessionId: string): SampleMode | null {
  if (!accesTerminalAutorise()) return null;
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
  if (!accesTerminalAutorise()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sid: sessionId, mode }));
  } catch {
    /* mode privé : la décision vit le temps de la page */
  }
}
