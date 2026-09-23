// Cycle de vie d'un service : arrêt propre sur SIGTERM, et gardes de processus.
//
// L'ORDRE, ET POURQUOI CET ORDRE :
//
//   SIGTERM
//     → `draining` passe à vrai : /ready répond 503, les réponses portent
//       `Connection: close` (les clients en keep-alive se reconnectent ailleurs)
//     → délai de RETRAIT (`unreadyDelayMs`, 0 par défaut) : le serveur accepte
//       encore, le temps qu'un répartiteur qui interroge /ready (auto-
//       hébergement) retire l'instance. Sur Railway, 0 : le proxy a déjà
//       basculé le trafic sur le nouveau déploiement AVANT d'envoyer SIGTERM.
//     → phase DRAIN : chaque source de travail cesse d'en accepter et finit le
//       sien — le serveur HTTP ferme l'écoute et attend ses requêtes en vol, la
//       boucle termine son tour en cours et ne se ré-arme pas. Bornée par
//       `drainTimeoutMs` : passé ce délai, on abandonne ce qui traîne (le
//       signal remis aux crochets est alors avorté, le serveur coupe ses
//       connexions).
//     → phase CLOSE : les ressources que ce travail utilisait — `pool.end()`.
//       APRÈS le drainage, jamais avant : fermer le pool pendant qu'une requête
//       l'utilise, c'est lui faire échouer sa dernière écriture.
//     → sortie 0.
//   Une minuterie de SORTIE FORCÉE (`forceExitMs`) couvre le tout : si une
//   fermeture pend (une connexion Postgres qui ne rend pas la main), le
//   processus sort en 1 avant que Railway n'envoie SIGKILL — et le dit dans
//   le journal, ce que SIGKILL ne ferait pas.
//
// LE BUDGET vient de RAILWAY_DEPLOYMENT_DRAINING_SECONDS : le temps que Railway
// laisse entre SIGTERM et SIGKILL. Son défaut Railway est 0 — SIGKILL aussitôt,
// aucun arrêt propre possible —, d'où l'avertissement au démarrage quand il
// n'est pas posé sur Railway. Le contrat de service le veut explicite, 15 à 30 s.
// Hors Railway, 10 s : le délai de grâce par défaut de `docker stop`.
//
// À INSTALLER AVANT TOUT `await` DE PREMIER NIVEAU. Un SIGTERM qui arrive pendant
// un `await` de démarrage (migration, première requête) doit trouver son
// gestionnaire en place : sans lui, Node applique le comportement par défaut
// (mort immédiate) — c'est le défaut relevé sur l'ancien `worker.mjs:159-171`
// (réécrit sur le kit en P1), dont les gestionnaires s'enregistraient APRÈS
// `await sousVerrou(...)`. `installLifecycle`
// est donc synchrone, et les ressources s'enregistrent après coup : un pool
// créé APRÈS le début de l'arrêt est fermé aussitôt.
//
// GARDES. `unhandledRejection` et `uncaughtException` sont journalisés AVEC LA
// PILE, puis déclenchent le même arrêt propre, en code 1. Ni « on ignore et on
// continue » (l'état du processus n'est plus sûr, et l'erreur se perd), ni
// « on meurt sur place » (les requêtes en vol et le pool partent avec) :
// Railway (redémarrage ALWAYS) relance un processus sain, et le crash se voit.

const INSTALLES = new WeakSet();

/**
 * @typedef {object} Lifecycle
 * @property {boolean} draining   vrai dès le signal reçu (/ready → 503)
 * @property {"running"|"draining"|"closing"|"stopped"} state
 * @property {(nom: string, fn: (ctx: {signal: AbortSignal}) => unknown) => void} onDrain
 *   cesser d'accepter du travail et finir le sien ; `signal` avorte au délai
 * @property {(nom: string, fn: () => unknown) => void} onClose
 *   libérer une ressource (pool) ; appelé après le drainage, dans l'ordre
 *   INVERSE d'enregistrement (dernier ouvert, premier fermé)
 * @property {(raison: string, code?: number) => Promise<void>} shutdown
 * @property {() => void} uninstall  retire les écouteurs (tests)
 */

/**
 * Installe les gestionnaires de signaux et les gardes. SYNCHRONE.
 *
 * @param {{
 *   log: import("./log.mjs").Logger,
 *   env?: Record<string, string|undefined>,
 *   proc?: { on: Function, off: Function },
 *   exit?: (code: number) => void,
 *   signals?: string[],
 *   drainSeconds?: number,
 *   forceExitMs?: number,
 *   drainTimeoutMs?: number,
 *   unreadyDelayMs?: number,
 * }} options
 *   `drainTimeoutMs` compte depuis le signal, délai de retrait compris.
 * @returns {Lifecycle}
 */
export function installLifecycle(options) {
  const {
    log,
    env = process.env,
    proc = process,
    exit = (code) => process.exit(code),
    signals = ["SIGTERM", "SIGINT"],
  } = options ?? {};
  if (!log) throw new TypeError("installLifecycle : log obligatoire");
  if (INSTALLES.has(proc)) {
    // Deux installations = deux arrêts concurrents, dont l'un ferme le pool
    // pendant que l'autre draine encore. Une erreur de câblage, pas un cas.
    throw new Error("installLifecycle : déjà installé sur ce processus");
  }

  // --- Budget ------------------------------------------------------------------
  const brut = env.RAILWAY_DEPLOYMENT_DRAINING_SECONDS;
  const surRailway = Boolean(env.RAILWAY_DEPLOYMENT_ID);
  const lu = brut != null && /^\d+$/.test(String(brut).trim()) ? Number(brut) : undefined;
  const budgetS = options.drainSeconds ?? lu ?? 10;
  const forceExitMs = options.forceExitMs ?? Math.max(budgetS * 1000 - 1000, 1000);
  const drainTimeoutMs = options.drainTimeoutMs ?? Math.max(forceExitMs - 2000, Math.floor(forceExitMs / 2));
  const unreadyDelayMs = Math.min(options.unreadyDelayMs ?? 0, drainTimeoutMs);
  if (surRailway && !lu) {
    log.warn("drainage non configuré : Railway enverra SIGKILL sans délai après SIGTERM", {
      variable: "RAILWAY_DEPLOYMENT_DRAINING_SECONDS",
      recommande: "15 à 30",
    });
  }

  // --- État ----------------------------------------------------------------------
  /** @type {"running"|"draining"|"closing"|"stopped"} */
  let etat = "running";
  let codeSortie = 0;
  let arret = null;
  let drainLance = false;
  const crochetsDrain = [];
  const crochetsClose = [];
  const enVol = new Set(); // drainages lancés et pas encore finis
  const avorteur = new AbortController();

  function lancerDrain({ nom, fn }) {
    const p = Promise.resolve()
      .then(() => fn({ signal: avorteur.signal }))
      .catch((err) => log.error("drainage en échec", { etape: nom, err }))
      .finally(() => enVol.delete(p));
    enVol.add(p);
  }

  async function fermer({ nom, fn }) {
    try {
      await fn();
      log.info("ressource fermée", { etape: nom });
    } catch (err) {
      codeSortie = Math.max(codeSortie, 1);
      log.error("fermeture en échec", { etape: nom, err });
    }
  }

  function shutdown(raison, code = 0) {
    codeSortie = Math.max(codeSortie, code);
    if (arret) return arret;
    etat = "draining";
    const debut = Date.now();
    log.info("arrêt demandé — /ready à 503, drainage", {
      raison,
      drainage_ms: drainTimeoutMs,
      sortie_forcee_ms: forceExitMs,
      retrait_ms: unreadyDelayMs,
    });

    const forcee = setTimeout(() => {
      log.error("sortie forcée : l'arrêt propre a dépassé son délai", {
        raison,
        etat,
        ms: Date.now() - debut,
      });
      exit(1);
    }, forceExitMs);
    forcee.unref?.();

    arret = (async () => {
      let delaiAtteint = false;
      const minuterieDrain = setTimeout(() => {
        delaiAtteint = true;
        avorteur.abort(new Error("délai de drainage atteint"));
      }, drainTimeoutMs);
      minuterieDrain.unref?.();
      const surAvortement = new Promise((r) => avorteur.signal.addEventListener("abort", r, { once: true }));

      // Retrait : /ready dit déjà 503, le serveur accepte encore.
      if (unreadyDelayMs > 0) await new Promise((r) => setTimeout(r, unreadyDelayMs));

      // Phase DRAIN : tous en parallèle — le serveur et la boucle n'ont pas à
      // s'attendre l'un l'autre.
      drainLance = true;
      for (const c of crochetsDrain) lancerDrain(c);
      // Tant qu'il reste du travail en vol et que le délai court. Une boucle, et
      // pas un seul `allSettled` : un crochet enregistré PENDANT le drainage
      // (un serveur démarré au milieu d'un `await` de boot) s'ajoute à `enVol`.
      while (enVol.size && !delaiAtteint) {
        await Promise.race([Promise.allSettled([...enVol]), surAvortement]);
      }
      clearTimeout(minuterieDrain);
      if (delaiAtteint) {
        log.warn("drainage incomplet : délai atteint, travail en vol abandonné", { en_vol: enVol.size });
      }

      // Phase CLOSE : une à une, dernier ouvert premier fermé.
      etat = "closing";
      for (const c of [...crochetsClose].reverse()) await fermer(c);

      etat = "stopped";
      clearTimeout(forcee);
      log.info("arrêt terminé", { raison, ms: Date.now() - debut, code: codeSortie });
      exit(codeSortie);
    })();
    return arret;
  }

  // --- Écouteurs ----------------------------------------------------------------
  let sigintRecus = 0;
  const surSignal = (signal) => () => {
    if (signal === "SIGINT" && ++sigintRecus >= 2) {
      // Ctrl-C deux fois en local : l'utilisateur veut sortir, tout de suite.
      exit(130);
      return;
    }
    if (arret) {
      log.warn("signal reçu pendant l'arrêt — ignoré", { signal });
      return;
    }
    shutdown(signal, 0);
  };
  const ecouteurs = signals.map((s) => [s, surSignal(s)]);

  const surRejet = (raison) => {
    log.error("rejet de promesse non capturé — arrêt propre", { err: raison });
    shutdown("unhandledRejection", 1);
  };
  const surException = (err, origine) => {
    log.error("exception non capturée — arrêt propre", { err, origine });
    shutdown("uncaughtException", 1);
  };
  ecouteurs.push(["unhandledRejection", surRejet], ["uncaughtException", surException]);

  for (const [evenement, fn] of ecouteurs) proc.on(evenement, fn);
  INSTALLES.add(proc);

  return {
    get draining() {
      return etat !== "running";
    },
    get state() {
      return etat;
    },
    onDrain(nom, fn) {
      const c = { nom, fn };
      if (!drainLance) crochetsDrain.push(c); // partira avec les autres
      else lancerDrain(c); // arrêt déjà en cours : drainer tout de suite
    },
    onClose(nom, fn) {
      const c = { nom, fn };
      if (etat === "running" || etat === "draining") crochetsClose.push(c);
      else fermer(c); // fermeture déjà passée : fermer tout de suite
    },
    shutdown,
    uninstall() {
      for (const [evenement, fn] of ecouteurs) proc.off(evenement, fn);
      INSTALLES.delete(proc);
    },
  };
}
