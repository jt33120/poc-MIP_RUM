// Long Animation Frames (LoAF) — POURQUOI une tâche a bloqué, pas seulement
// qu'elle a bloqué.
//
// CE QUE LES LONG TASKS NE DISENT PAS. `longtask` rapporte « le fil principal a
// été bloqué 180 ms ». C'est le symptôme. Aucune attribution : ni le script, ni
// la fonction, ni ce qui l'a déclenchée. Devant un INP mauvais, on savait qu'il
// y avait un blocage et on ne pouvait rien en faire — la seule voie restante
// était de reproduire le problème dans un profileur, sur un poste qui n'est pas
// celui du visiteur.
//
// CE QUE LoAF AJOUTE. Une « frame d'animation longue » est un cycle de rendu que
// le navigateur n'a pas pu boucler à temps. L'entrée porte la ventilation du
// cycle (travail des scripts, puis style et mise en page) ET la liste des
// scripts exécutés, chacun avec son URL, son nom de fonction et ce qui l'a
// invoqué. C'est la ligne qui manque entre « INP à 900 ms » et un correctif.
//
// LoAF REMPLACE Long Tasks quand il est disponible, il ne s'y ajoute pas : le
// même blocage produit les deux entrées, et les compter tous les deux doublerait
// le nombre de blocages affiché. Le choix est fait une fois, à l'init (cf.
// index.ts), et la colonne `source` en base dit laquelle des deux API a parlé.
//
// L'API est CHROMIUM SEULEMENT. Sur Safari et Firefox, `initLoaf` ne pose aucun
// observateur et rend `null` — le SDK retombe alors sur les Long Tasks, qui y
// sont eux aussi absents de Safari. Sur ces navigateurs, le blocage du fil
// principal n'est pas mesurable ; on ne le mesure donc pas, plutôt que de
// l'estimer.
import { makeCap, type PageCap } from "./caps";
import { scrubUrl } from "./context";
import type { Emit } from "./errors";

/** Plafond par page vue. Une page qui rame produit des dizaines de frames. */
export const LOAF_CAP_PER_PAGE = 20;

/** Type d'entrée de l'API. Sert aussi de test de disponibilité. */
export const LOAF_ENTRY_TYPE = "long-animation-frame";

/**
 * Un script exécuté pendant la frame. Champs de `PerformanceScriptTiming`, tous
 * optionnels : la spec est récente et l'implémentation peut n'en remplir aucun.
 */
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

/**
 * Le script le PLUS LONG de la frame.
 *
 * Un seul, et pas la liste entière : c'est celui qu'on corrige. Transporter les
 * dix scripts d'une frame multiplierait le volume par dix pour une information
 * que personne ne lit — et le neuvième script d'une frame n'a jamais fait
 * l'objet d'un correctif.
 */
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
 * Attributs d'un span `loaf`. Fonction PURE : c'est ce qui la rend vérifiable
 * sans navigateur, et c'est là que se jouent les pièges de bornes.
 *
 * Trois précautions :
 *
 *  - `renderStart` vaut 0 quand la frame n'a rien rendu. Soustraire aveuglément
 *    donnerait une phase de rendu de la taille de l'horodatage.
 *  - une durée négative ou non finie ne doit jamais atteindre la base : elle
 *    contaminerait des moyennes que plus personne ne saurait expliquer.
 *  - `sourceURL` est une URL, donc passible de contenir un jeton en query
 *    string. Elle passe par le même nettoyage que toutes les autres URL du SDK.
 */
export function attributsLoaf(entry: LoafEntry): Record<string, string | number> {
  const attrs: Record<string, string | number> = {
    "loaf.duration_ms": ms(entry.duration),
  };

  if (typeof entry.blockingDuration === "number" && entry.blockingDuration >= 0)
    attrs["loaf.blocking_ms"] = ms(entry.blockingDuration);

  // Rendu = ce qui reste de la frame une fois le travail des scripts terminé.
  // `renderStart` à 0 (ou hors de la frame) = aucun rendu : on n'invente pas.
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
    // `scrubUrl` attend une chaîne : l'appeler sur un sourceURL absent jetait —
    // et une exception dans le callback d'un PerformanceObserver ne remonte
    // nulle part, elle tue l'observateur. La mesure aurait cessé en silence.
    if (script.sourceURL) attrs["loaf.script_url"] = scrubUrl(script.sourceURL);
    if (script.sourceFunctionName)
      attrs["loaf.script_function"] = String(script.sourceFunctionName).slice(0, MAX_LIBELLE);
    // `invoker` dit CE QUI a lancé le script : 'BUTTON#payer.onclick',
    // 'Window.requestAnimationFrame'… C'est souvent plus parlant que le nom de
    // la fonction, qui est minifié en production.
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

/**
 * Pose l'observateur. Rend le compteur de plafond, et `null` si l'API est
 * absente — l'appelant sait alors qu'il doit retomber sur les Long Tasks.
 */
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
    // `buffered` : les frames longues du CHARGEMENT — les plus intéressantes —
    // ont lieu avant que ce code ne s'exécute.
    observer.observe({ type: LOAF_ENTRY_TYPE, buffered: true });
  } catch {
    // supportedEntryTypes annonçait le type mais observe() refuse : on rend
    // quand même le cap, l'appelant a déjà renoncé aux Long Tasks.
  }
  return cap;
}
