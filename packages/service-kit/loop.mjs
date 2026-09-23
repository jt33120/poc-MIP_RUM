// Boucle de travail à intervalle : drain de l'ingestion différée, livraison de
// l'outbox, travaux du scheduler.
//
// JAMAIS DEUX TOURS EN PARALLÈLE. La minuterie suivante n'est armée qu'APRÈS la
// fin du tour en cours — le motif que `worker.mjs` et `server.mjs` écrivaient
// déjà à la main (« ré-armé APRÈS coup : un travail lent ne s'empile pas sur
// lui-même »). Un `setInterval` aurait lancé un deuxième tour pendant qu'un
// premier, ralenti par la base, tenait encore ses verrous. Ce garde vaut DANS
// le processus ; entre répliques, c'est le bail ou `skip locked` du travail
// lui-même (contrat de service, point 7).
//
// JITTER. Deux répliques démarrées ensemble tapent la base à la même
// milliseconde, à chaque tour, pour toujours. Un décalage aléatoire de ±10 %
// de l'intervalle les désynchronise dès le premier tour.
//
// UN TOUR QUI ÉCHOUE NE TUE PAS LA BOUCLE. L'erreur est journalisée avec sa
// pile et comptée, et le tour suivant part à l'heure. Un travailleur qui meurt
// à la première coupure réseau est pire que pas de travailleur du tout : il
// donne l'illusion d'avoir tourné.
//
// ARRÊT PROPRE. `stop()` désarme la minuterie et attend la fin du tour en
// cours ; il ne l'interrompt pas. Le `signal` remis au tour n'avorte que si le
// délai de drainage du cycle de vie est atteint : un tour coopératif peut
// alors s'arrêter entre deux étapes plutôt qu'être coupé en pleine
// transaction par la sortie du processus.
//
// CADENCE ALIGNÉE SUR L'HORLOGE (`nextDelay`). Le scheduler ne tourne pas « toutes
// les 5 minutes après le démarrage » mais à :00, :05, :10… et à 03:17 UTC : un
// redéploiement ne doit pas décaler la grille, sinon deux instances qui se
// relaient n'ont pas les mêmes fenêtres de calcul. `nextDelay()` est alors
// appelée à chaque armement et remplace intervalMs ET le jitter — une grille
// fixe n'a rien à désynchroniser, c'est le bail qui exclut entre répliques.
//
// Chaque tour s'exécute sous un `run_id` (context.mjs) : toutes les lignes de
// journal qu'il émet, même au fond du noyau, le portent.
import { randomUUID } from "node:crypto";
import { withContext } from "./context.mjs";

/**
 * @typedef {object} LoopOptions
 * @property {string} name
 * @property {number} [intervalMs]        délai entre la FIN d'un tour et le début du suivant
 *   (obligatoire sans `nextDelay`)
 * @property {() => number} [nextDelay]   délai avant le prochain tour, recalculé à chaque
 *   armement (cadence alignée sur l'horloge) ; remplace `intervalMs` et `jitter`
 * @property {(ctx: { signal: AbortSignal, runId: string }) => unknown} run
 * @property {import("./log.mjs").Logger} log
 * @property {number} [jitter]            fraction de l'intervalle, ± (défaut 0,1)
 * @property {boolean} [immediate]        premier tour tout de suite (défaut : après un intervalle)
 * @property {boolean} [keepAlive]        défaut vrai : la minuterie maintient le processus en vie.
 *   `false` pour une boucle d'appoint dans un processus que le serveur HTTP
 *   maintient déjà (l'ancien drain de `server.mjs` était `unref`). Un worker
 *   SANS serveur doit garder `true` : sinon il sort juste après son premier tour.
 * @property {() => number} [random]      injectable pour les tests
 * @property {ReturnType<import("./metrics.mjs").createMetrics>} [metrics]
 * @property {ReturnType<import("./lifecycle.mjs").installLifecycle>} [lifecycle]
 */

/**
 * @param {LoopOptions} options
 */
export function startLoop(options) {
  const {
    name,
    intervalMs,
    nextDelay,
    run,
    log,
    jitter = 0.1,
    immediate = false,
    keepAlive = true,
    random = Math.random,
    metrics,
    lifecycle,
  } = options ?? {};
  if (!name) throw new TypeError("startLoop : name obligatoire");
  if (typeof run !== "function") throw new TypeError("startLoop : run obligatoire");
  if (!log) throw new TypeError("startLoop : log obligatoire");
  if (nextDelay !== undefined && typeof nextDelay !== "function") {
    throw new TypeError("startLoop : nextDelay doit être une fonction");
  }
  if (!nextDelay && !(intervalMs > 0)) throw new RangeError("startLoop : intervalMs doit être > 0");
  if (!(jitter >= 0 && jitter < 1)) throw new RangeError("startLoop : jitter dans [0, 1)");

  const tours = metrics?.counter("loop_runs_total", "Tours de boucle, par issue.", { labels: ["loop", "result"] });
  const dernierSucces = metrics?.gauge("loop_last_success_timestamp_seconds", "Fin du dernier tour réussi (epoch).", {
    labels: ["loop"],
  });
  const derniereDuree = metrics?.gauge("loop_last_duration_seconds", "Durée du dernier tour.", { labels: ["loop"] });

  const avorteur = new AbortController();
  let minuterie = null;
  let tourEnCours = null;
  let arretee = false;
  const stats = { runs: 0, failures: 0, lastRunAt: null, lastSuccessAt: null, lastDurationMs: null, lastError: null };

  function delaiSuivant() {
    if (nextDelay) {
      // Plancher à 0 et valeur finie : un calcul d'horloge qui rend NaN ou un
      // négatif ne doit pas armer une minuterie absurde (NaN vaut 1 ms pour
      // setTimeout : une boucle serrée).
      const d = Number(nextDelay());
      if (!Number.isFinite(d)) throw new RangeError(`startLoop ${name} : nextDelay a rendu ${d}`);
      return Math.max(0, Math.round(d));
    }
    const amplitude = intervalMs * jitter;
    return Math.max(0, Math.round(intervalMs + (random() * 2 - 1) * amplitude));
  }

  function armer(delai) {
    if (arretee) return;
    minuterie = setTimeout(() => {
      minuterie = null;
      tour();
    }, delai);
    if (!keepAlive) minuterie.unref();
  }

  /** Lance un tour, sauf s'il y en a déjà un : on rend alors celui-là. */
  function tour() {
    if (tourEnCours) return tourEnCours;
    if (arretee) return Promise.resolve();
    if (minuterie) {
      clearTimeout(minuterie);
      minuterie = null;
    }
    const runId = randomUUID();
    const debut = Date.now();
    stats.lastRunAt = new Date(debut).toISOString();
    tourEnCours = withContext({ run_id: runId, loop: name }, async () => {
      try {
        await run({ signal: avorteur.signal, runId });
        stats.runs += 1;
        stats.lastSuccessAt = new Date().toISOString();
        tours?.inc({ loop: name, result: "ok" });
        dernierSucces?.set({ loop: name }, Date.now() / 1000);
      } catch (err) {
        stats.runs += 1;
        stats.failures += 1;
        stats.lastError = String(err?.message ?? err);
        tours?.inc({ loop: name, result: "error" });
        log.error("tour de boucle en échec", { loop: name, err, ms: Date.now() - debut });
      } finally {
        stats.lastDurationMs = Date.now() - debut;
        derniereDuree?.set({ loop: name }, stats.lastDurationMs / 1000);
      }
    }).finally(() => {
      tourEnCours = null;
      armer(delaiSuivant());
    });
    return tourEnCours;
  }

  /**
   * Désarme la boucle et attend la fin du tour en cours.
   * @param {{ signal?: AbortSignal }} [o]  s'il avorte, le tour en cours en est prévenu
   */
  async function stop({ signal } = {}) {
    arretee = true;
    if (minuterie) {
      clearTimeout(minuterie);
      minuterie = null;
    }
    if (signal?.aborted) avorteur.abort(signal.reason);
    else signal?.addEventListener("abort", () => avorteur.abort(signal.reason), { once: true });
    await tourEnCours;
  }

  if (lifecycle?.draining) arretee = true; // arrêt déjà en cours : ne rien lancer
  else if (immediate) queueMicrotask(tour);
  else armer(delaiSuivant());
  lifecycle?.onDrain(`loop:${name}`, ({ signal }) => stop({ signal }));

  return {
    /** Lance un tour maintenant, ou rend celui en cours (jamais deux). */
    runNow: () => tour(),
    stop,
    get running() {
      return tourEnCours !== null;
    },
    get stopped() {
      return arretee;
    },
    /** Pour /ready : dernier succès, échecs, dernière erreur. */
    stats: () => ({ ...stats }),
  };
}
