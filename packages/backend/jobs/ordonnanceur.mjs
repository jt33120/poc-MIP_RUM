// L'ORDONNANCEUR : ce qui entoure une cadence planifiée — le bail, le battement,
// l'état lu par la supervision, le signal vers l'extérieur. Tout ce que
// `services/scheduler/worker.mjs` faisait à la main, sorti du point d'entrée
// pour que celui-ci ne soit plus que du câblage, et pour que `run-once.mjs`
// prenne le bail EXACTEMENT comme le worker (une copie aurait divergé).
//
// CE QUI CHANGE PAR RAPPORT À L'ANCIEN WORKER, ET POURQUOI :
//
//   - Le BATTEMENT n'est écrit que sur SUCCÈS. `rendreBail` fait expirer la ligne
//     à `now()`, et la vitrine lit `max(expires_at)` comme « dernier passage
//     abouti » (`dernierTickScheduler`). L'ancien worker rendait le bail dans un
//     `finally` : une cadence qui échouait à chaque passage restait « fraîche ».
//     Un échec rend désormais le bail par `abandonnerBail`, qui remet l'ancien
//     battement : le bail est libre, le mensonge n'est pas écrit.
//
//   - Le bail se prend et se rend par `pool.query`, sans client EMPRUNTÉ pour
//     toute la durée du travail. L'emprunt datait du verrou consultatif de
//     session (première version) ; avec un bail en ligne il ne servait plus à
//     rien, sinon à immobiliser une connexion — et à exposer le processus : un
//     `pg_terminate_backend` sur ce client prêté et inactif le faisait émettre
//     'error' sans écouteur, donc tomber.
//
//   - Le TITULAIRE est `${RAILWAY_DEPLOYMENT_ID}:${RAILWAY_REPLICA_ID}`. Avec le
//     seul identifiant de déploiement, deux répliques d'un même déploiement
//     portaient le même nom : la seconde pouvait rendre le bail de la première
//     (`rendreBail` filtre sur le titulaire), et ouvrir la porte à une troisième.
//
//   - Un DEAD-MAN'S SWITCH externe (`DEADMAN_URL`, facultatif) reçoit un signal
//     après chaque tick ABOUTI. Il sonne quand le signal cesse : scheduler
//     arrêté, bloqué, en échec à chaque passage, ou redéployé en boucle — tout
//     ce qu'aucune sonde interne ne voit, puisqu'elle meurt avec le processus.
import { randomUUID } from "node:crypto";
import { DUREES, SQL_TABLE, abandonnerBail, prendreBailDetaille, rendreBail } from "./bail.mjs";
import { TOLERANCES_MS } from "./cadence.mjs";
import { safeFetch } from "../lib/net/safe-fetch.mjs";

/** Les cadences, dans l'ordre où le worker les arme. */
export const CADENCES_PLANIFIEES = Object.freeze(["tick", "horaire", "quotidien"]);

/**
 * Qui tient le bail : UNE identité par processus.
 *
 * `${RAILWAY_DEPLOYMENT_ID}:${RAILWAY_REPLICA_ID}` sur Railway : lisible dans
 * `scheduler_lease.holder`, et distincte d'une réplique à l'autre. Si Railway
 * ne fournit pas la réplique, un UUID la remplace — deux processus ne doivent
 * JAMAIS partager un titulaire. Hors Railway, `local-<uuid>`.
 *
 * @param {Record<string, string|undefined>} [env]
 * @param {{ uuid?: () => string }} [options]
 */
export function titulaireBail(env = process.env, { uuid = randomUUID } = {}) {
  const deploiement = env.RAILWAY_DEPLOYMENT_ID?.trim();
  const replique = env.RAILWAY_REPLICA_ID?.trim();
  if (deploiement) return `${deploiement}:${replique || uuid()}`;
  return `local-${uuid()}`;
}

/**
 * Exécute une cadence sous bail. Partagé par le worker et `run-once.mjs`.
 *
 *   bail tenu ailleurs  → rien n'est fait, `statut: "bail_ailleurs"` (c'est SAIN :
 *                         l'instance sortante d'un redéploiement, une autre
 *                         réplique, un déclenchement manuel) ;
 *   travail abouti      → `rendreBail` : la ligne expire à now(), c'est le battement ;
 *   travail en échec    → `abandonnerBail` : bail libéré, ANCIEN battement remis.
 *
 * Lève si la base est injoignable à la prise du bail : l'appelant décide (le
 * worker journalise et attend le passage suivant ; run-once sort en 1). Un
 * échec à la REDDITION n'est pas un échec du travail : il est tracé, et le bail
 * expirera de lui-même (DUREES).
 *
 * @param {{ pool: { query: Function }, job: string, porteur: string,
 *           executer: () => Promise<{ ok: boolean, echecs: number, resultats: object }>,
 *           log: import("@mip/service-kit/log.mjs").Logger, secondes?: number }} options
 * @returns {Promise<{ statut: "fait"|"echec"|"bail_ailleurs", bilan?: object, ms: number }>}
 */
export async function executerSousBail({ pool, job, porteur, executer, log, secondes = DUREES[job] }) {
  // Ceinture : depuis migration-v54 la table vient du schéma. `if not exists`,
  // donc gratuit, et le scheduler reste déployable seul sur une base non migrée.
  await pool.query(SQL_TABLE);
  const { tenu, battementPrecedent } = await prendreBailDetaille(pool, { job, porteur, secondes });
  if (!tenu) {
    log.info("bail tenu ailleurs — passage sauté", { job });
    return { statut: "bail_ailleurs", ms: 0 };
  }

  const debut = Date.now();
  let bilan;
  try {
    bilan = await executer();
  } catch (err) {
    // `executerEtapes` attrape chaque étape : on n'arrive ici que sur une faute
    // de programmation. Pas de battement, bail libéré, erreur remontée.
    await abandonnerBail(pool, { job, porteur, battement: battementPrecedent }).catch(() => {});
    throw err;
  }
  const ms = Date.now() - debut;

  try {
    if (bilan.ok) await rendreBail(pool, { job, porteur });
    else await abandonnerBail(pool, { job, porteur, battement: battementPrecedent });
  } catch (err) {
    log.warn("bail non rendu — il expirera de lui-même", { job, expire_dans_s: secondes, err });
  }

  log[bilan.ok ? "info" : "error"]("travail terminé", {
    job,
    ok: bilan.ok,
    echecs: bilan.echecs,
    ms,
    resultats: bilan.resultats,
  });
  return { statut: bilan.ok ? "fait" : "echec", bilan, ms };
}

/**
 * Le signal vers un dead-man's switch externe (Healthchecks.io, Cronitor,
 * Better Stack… : tous acceptent un GET sur l'URL du contrôle).
 *
 * Par `safeFetch`, comme toute requête sortante du scheduler : l'URL vient de
 * la configuration et non d'un client, mais la politique de sortie ne se
 * négocie pas au cas par cas. Borné (5 s), et ne lève JAMAIS : un service de
 * surveillance en panne ne doit pas faire échouer le tick qu'il surveille.
 *
 * L'URL n'est jamais journalisée : chez ces services, l'URL EST le secret
 * (n'importe qui la connaissant peut simuler un battement).
 *
 * @param {string | undefined} url  absente : pas de signal, `null` rendu
 * @returns {null | (() => Promise<boolean>)}
 */
export function creerSignalDeadman(url, { log, fetchImpl = safeFetch, timeoutMs = 5_000 } = {}) {
  if (!url) return null;
  return async () => {
    try {
      const res = await fetchImpl(url, { method: "GET", timeoutMs });
      await res.body?.cancel().catch(() => {});
      if (!res.ok) log?.warn("dead-man's switch : réponse inattendue", { status: res.status });
      return res.ok;
    } catch (err) {
      log?.warn("dead-man's switch injoignable — le signal de ce passage est perdu", { err });
      return false;
    }
  };
}

/**
 * Ce que la base dit des cadences, en UNE requête : les baux (donc les
 * battements) et l'arriéré de livraisons. Lu sur l'horloge de la BASE (`now()`),
 * celle qui a écrit les battements : aucun décalage d'horloge à corriger.
 */
export async function lireEtatBase(pool, { timeoutMs = 2_000 } = {}) {
  const { rows } = await pool.query({
    text: `select
             (select coalesce(json_agg(json_build_object('job', job, 'holder', holder, 'expires_at', expires_at)), '[]'::json)
                from scheduler_lease) as baux,
             (select count(*)::int from alert_delivery where status = 'queued') as livraisons_en_attente,
             (select extract(epoch from now() - min(attempted_at))::float8
                from alert_delivery where status = 'queued') as plus_ancienne_s,
             now() as maintenant`,
    query_timeout: timeoutMs,
  });
  const r = rows[0] ?? {};
  const baux = (typeof r.baux === "string" ? JSON.parse(r.baux) : (r.baux ?? [])).map((b) => ({
    job: b.job,
    holder: b.holder,
    expiresAt: new Date(b.expires_at),
  }));
  return {
    maintenant: new Date(r.maintenant ?? Date.now()),
    baux,
    backlog: { livraisons_en_attente: r.livraisons_en_attente ?? 0, plus_ancienne_s: r.plus_ancienne_s ?? null },
  };
}

/**
 * Le verdict de fraîcheur d'une cadence, à partir de sa ligne de bail.
 *
 *   ligne dont l'échéance est FUTURE → passage en cours (ici ou ailleurs) : frais ;
 *   sinon `expires_at` est le battement, l'heure du dernier passage abouti ;
 *   pas de ligne                     → jamais abouti.
 *
 * « Jamais exécuté » n'est pas un retard en soi : le retard se compte depuis
 * le plus récent du battement et du DÉMARRAGE de ce processus. Un scheduler
 * neuf a une tolérance entière pour faire son premier passage.
 */
export function verdictCadence(job, bail, { maintenant, demarrage, tolerances = TOLERANCES_MS }) {
  const tolerance = tolerances[job];
  const enCours = Boolean(bail && bail.expiresAt.getTime() > maintenant.getTime());
  const battement = bail && !enCours ? bail.expiresAt : null;
  const reference = Math.max(battement?.getTime() ?? 0, demarrage);
  const silenceMs = Math.max(0, maintenant.getTime() - reference);
  return {
    battement: battement?.toISOString() ?? null,
    en_cours: enCours,
    tenu_par: enCours ? bail.holder : null,
    silence_s: Math.round(silenceMs / 1000),
    tolerance_s: Math.round(tolerance / 1000),
    retard: !enCours && silenceMs > tolerance,
  };
}

/**
 * L'ordonnanceur du worker : exécute une cadence (sans jamais lever), tient
 * l'état local, les métriques, et rend le verdict de /ready.
 *
 * @param {{ pool: { query: Function }, jobs: Record<string, () => Promise<any>>, porteur: string,
 *           log: import("@mip/service-kit/log.mjs").Logger,
 *           metrics?: ReturnType<import("@mip/service-kit/metrics.mjs").createMetrics>,
 *           signalDeadman?: null | (() => Promise<boolean>), maintenant?: () => number }} options
 */
export function creerOrdonnanceur({ pool, jobs, porteur, log, metrics, signalDeadman = null, maintenant = Date.now }) {
  const demarrage = maintenant();
  /** Dernier passage de chaque cadence DANS CE PROCESSUS. */
  const local = {};

  const passages = metrics?.counter("scheduler_job_runs_total", "Passages des cadences, par issue (fait, echec, bail_ailleurs, erreur).", {
    labels: ["job", "result"],
  });
  const echecsEtapes = metrics?.counter("scheduler_step_failures_total", "Étapes planifiées en échec.", {
    labels: ["job", "step"],
  });
  const dureeDernier = metrics?.gauge("scheduler_job_last_duration_seconds", "Durée du dernier passage exécuté ici.", {
    labels: ["job"],
  });

  // Fraîcheur et arriéré, lus en BASE au rendu : c'est la vérité quel que soit
  // le processus qui a tourné (une autre réplique, l'instance sortante). Une
  // lecture pour les deux jauges d'un même rendu.
  let lecture = null;
  let lueA = 0;
  function etatBase() {
    if (!lecture || maintenant() - lueA > 1_000) {
      lueA = maintenant();
      lecture = lireEtatBase(pool);
      lecture.catch(() => {});
    }
    return lecture;
  }
  metrics?.gauge("scheduler_heartbeat_age_seconds", "Secondes depuis le dernier passage ABOUTI (battement en base), par cadence.", {
    labels: ["job"],
    collect: async () => {
      const e = await etatBase();
      return e.baux
        .filter((b) => b.expiresAt <= e.maintenant)
        .map((b) => ({ labels: { job: b.job }, value: (e.maintenant - b.expiresAt) / 1000 }));
    },
  });
  metrics?.gauge("scheduler_backlog_deliveries", "Livraisons d'alerte en attente (queued).", {
    collect: async () => (await etatBase()).backlog.livraisons_en_attente,
  });

  /** Exécute une cadence. Ne lève JAMAIS : la boucle doit continuer. */
  async function executer(job) {
    const debut = maintenant();
    let r;
    try {
      r = await executerSousBail({ pool, job, porteur, executer: jobs[job], log });
    } catch (err) {
      // Base injoignable, connexion coupée : le passage suivant retentera. Un
      // scheduler qui meurt à la première coupure réseau donne l'illusion
      // d'avoir tourné.
      local[job] = { lance_a: new Date(debut).toISOString(), statut: "erreur", erreur: String(err?.message ?? err) };
      passages?.inc({ job, result: "erreur" });
      log.error("travail en échec — passage suivant à l'heure", { job, err });
      return { statut: "erreur" };
    }
    passages?.inc({ job, result: r.statut });
    if (r.statut === "bail_ailleurs") return r;

    const precedent = local[job] ?? {};
    local[job] = {
      lance_a: new Date(debut).toISOString(),
      statut: r.statut,
      ms: r.ms,
      dernier_succes: r.statut === "fait" ? new Date(maintenant()).toISOString() : (precedent.dernier_succes ?? null),
      ...(r.statut === "echec"
        ? { etapes_en_echec: Object.keys(r.bilan.resultats).filter((k) => r.bilan.resultats[k]?.ok === false) }
        : {}),
    };
    dureeDernier?.set({ job }, r.ms / 1000);
    for (const etape of local[job].etapes_en_echec ?? []) echecsEtapes?.inc({ job, step: etape });

    // Le dead-man's switch ne connaît que le TICK : c'est la cadence qu'il
    // surveille (5 min + sa marge). Un tick en échec n'envoie rien : c'est le
    // silence qui alerte.
    if (r.statut === "fait" && job === "tick" && signalDeadman) await signalDeadman();
    return r;
  }

  /** Verdict de /ready : fraîcheur de chaque cadence et arriéré de livraisons. */
  async function etat() {
    const e = await etatBase();
    const cadences = {};
    for (const job of CADENCES_PLANIFIEES) {
      const bail = e.baux.find((b) => b.job === job) ?? null;
      cadences[job] = { ...verdictCadence(job, bail, { maintenant: e.maintenant, demarrage }), local: local[job] ?? null };
    }
    // Une livraison en attente depuis plus longtemps que la tolérance du tick
    // ne partira pas toute seule : le tick tourne, mais ne livre plus.
    const livraisonsBloquees = (e.backlog.plus_ancienne_s ?? 0) * 1000 > TOLERANCES_MS.tick;
    const ok = !Object.values(cadences).some((c) => c.retard) && !livraisonsBloquees;
    return {
      ok,
      porteur,
      depuis: new Date(demarrage).toISOString(),
      cadences,
      backlog: { ...e.backlog, bloque: livraisonsBloquees },
    };
  }

  return { executer, etat, porteur };
}
