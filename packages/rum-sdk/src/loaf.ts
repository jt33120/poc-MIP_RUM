// Long Animation Frames : contrairement aux Long Tasks, elles disent QUI a bloqué
// (script, fonction, invocateur) et ventilent scripts et rendu.
// LoAF remplace Long Tasks quand il existe (choix à l'init, index.ts) : le même
// blocage produit les deux entrées, les compter doublerait les blocages.
// Chromium seulement ; ailleurs, repli sur Long Tasks (eux aussi absents de Safari).
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import type { Emit } from "./errors";

/** Plafond par page vue : une page qui rame produit des dizaines de frames. */
export const LOAF_CAP_PER_PAGE = 20;

/** Type d'entrée de l'API. Sert aussi de test de disponibilité. */
export const LOAF_ENTRY_TYPE = "long-animation-frame";

/** `PerformanceScriptTiming` : tout optionnel, la spec est récente. */
export interface ScriptTiming {
  duration?: number;
  sourceURL?: string;
  sourceFunctionName?: string;
  invoker?: string;
}

/** Entrée `PerformanceLongAnimationFrameTiming`, réduite à ce qu'on lit. */
export interface LoafEntry {
  startTime: number;
  duration: number;
  blockingDuration?: number;
  renderStart?: number;
  scripts?: ScriptTiming[];
}

/** Longueur maximale d'un libellé libre (nom de fonction, invocateur). */
const MAX_LIBELLE = 120;

/** Arrondi au dixième de milliseconde — la précision réelle de l'API. */
function ms(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Le script le plus long de la frame, seul : c'est celui qu'on corrige, et la liste décuplerait le volume. */
export function scriptDominant(scripts: ScriptTiming[] | undefined): ScriptTiming | null {
  if (!scripts || !scripts.length) return null;
  let meilleur: ScriptTiming | null = null;
  for (const s of scripts) {
    const d = typeof s?.duration === "number" ? s.duration : -1;
    if (d < 0) continue;
    if (!meilleur || d > (meilleur.duration ?? -1)) meilleur = s;
  }
  return meilleur;
}

/**
 * Attributs d'un span `loaf` (pure). Une durée négative n'atteint jamais la base,
 * et `sourceURL` est nettoyée comme toute URL (jeton possible en query string).
 */
export function attributsLoaf(entry: LoafEntry): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    "loaf.duration_ms": ms(entry.duration),
  };

  if (typeof entry.blockingDuration === "number" && entry.blockingDuration >= 0)
    attrs["loaf.blocking_ms"] = ms(entry.blockingDuration);

  // `renderStart` vaut 0 quand la frame n'a rien rendu : ne pas le soustraire.
  const fin = entry.startTime + entry.duration;
  if (
    typeof entry.renderStart === "number" &&
    entry.renderStart > 0 &&
    entry.renderStart <= fin &&
    entry.renderStart >= entry.startTime
  ) {
    attrs["loaf.render_ms"] = ms(fin - entry.renderStart);
  }

  const script = scriptDominant(entry.scripts);
  if (script) {
    if (typeof script.duration === "number" && script.duration >= 0)
      attrs["loaf.script_ms"] = ms(script.duration);
    // Une exception dans un PerformanceObserver tue l'observateur sans bruit :
    // `scrubUrl` ne reçoit jamais un sourceURL absent.
    if (script.sourceURL) attrs["loaf.script_url"] = scrubUrl(script.sourceURL);
    if (script.sourceFunctionName)
      attrs["loaf.script_function"] = String(script.sourceFunctionName).slice(0, MAX_LIBELLE);
    // `invoker` ('BUTTON#payer.onclick'…) parle plus qu'un nom de fonction minifié.
    if (script.invoker) attrs["loaf.invoker"] = String(script.invoker).slice(0, MAX_LIBELLE);
  }

  return attrs;
}

/** L'API est-elle disponible dans ce navigateur ? */
export function loafDisponible(): boolean {
  return (
    typeof PerformanceObserver !== "undefined" &&
    Array.isArray(PerformanceObserver.supportedEntryTypes) &&
    PerformanceObserver.supportedEntryTypes.includes(LOAF_ENTRY_TYPE)
  );
}

/** Pose l'observateur ; `null` si l'API est absente (repli sur les Long Tasks). */
export function initLoaf(emit: Emit): PageCap | null {
  if (!loafDisponible()) return null;
  const cap = makeCap(LOAF_CAP_PER_PAGE);
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as LoafEntry[]) {
        if (!cap.take()) continue;
        emit("loaf", attributsLoaf(entry));
      }
    });
    // `buffered` : les frames du chargement précèdent ce code.
    observer.observe({ type: LOAF_ENTRY_TYPE, buffered: true });
  } catch {
    // observe() refuse un type annoncé : le cap est rendu quand même.
  }
  return cap;
}
