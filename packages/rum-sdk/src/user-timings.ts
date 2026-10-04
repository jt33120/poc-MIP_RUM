// Repères posés par l'app avec performance.mark / performance.measure : relevés
// sans code de plus, ils deviennent des timings comme ceux de MIPRum.addTiming().
// Un mark vaut son instant depuis le début de la vue, un measure sa durée.
import { makeCap, type PageCap } from "./caps";
import type { Emit } from "./errors";

/** Repères relevés par vue : une boucle qui pose un mark par image ne noie pas le lot. */
export const USER_TIMINGS_PAR_VUE = 30;
/** Longueur maximale d'un nom d'événement à l'ingestion, préfixe compris. */
const NOM_MAX = 100;

/**
 * Repères des outils (React, Next.js, webpack, le SDK lui-même…), pas de l'app :
 * ils rempliraient le plafond avec ce que l'équipe n'a pas choisi de mesurer.
 */
const REPERES_OUTILS = /^(mip|⚛|next\.js|next-|__|webpack|react-|beforerender|afterhydrate|nuxt|vite|sentry|dd[_-])/i;

export function estRepereOutil(nom: string): boolean {
  return REPERES_OUTILS.test(nom);
}

export interface UserTimings {
  /** Nouvelle vue : plafond remis à zéro, marks comptés depuis `debut` (temps `performance`). */
  nouvelleVue(debut: number): void;
}

export function initUserTimings(emit: Emit): UserTimings | null {
  if (typeof PerformanceObserver === "undefined") return null;
  const cap: PageCap = makeCap(USER_TIMINGS_PAR_VUE);
  let debut = 0;
  const origine = () =>
    Number.isFinite(performance.timeOrigin) ? performance.timeOrigin : Date.now() - performance.now();

  const relever = (list: PerformanceObserverEntryList) => {
    for (const entry of list.getEntries()) {
      const type = entry.entryType === "mark" ? "mark" : entry.entryType === "measure" ? "measure" : null;
      if (!type || typeof entry.name !== "string") continue;
      const nom = entry.name.trim();
      if (!nom || estRepereOutil(nom)) continue;
      // Un repère fini avant la vue (vue SPA, tampon) appartient à la précédente.
      if (entry.startTime + entry.duration < debut) continue;
      const valeur = type === "mark" ? entry.startTime - debut : entry.duration;
      if (!Number.isFinite(valeur) || valeur < 0) continue;
      if (!cap.take()) continue;
      emit(
        "rum.timing",
        {
          "mip.event_type": "timing",
          "mip.event_name": `${type}:${nom}`.slice(0, NOM_MAX),
          "mip.timing_ms": Math.round(valeur),
        },
        Math.round(origine() + entry.startTime),
      );
    }
  };

  for (const type of ["mark", "measure"]) {
    try {
      new PerformanceObserver(relever).observe({ type, buffered: true });
    } catch {
      /* type non supporté : l'autre suffit */
    }
  }

  return {
    nouvelleVue(prochainDebut) {
      debut = prochainDebut;
      cap.reset();
    },
  };
}
