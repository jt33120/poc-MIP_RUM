// LES ADAPTATEURS DE SOURCE SYNTHÉTIQUE — la partie PURE, sans base ni réseau.
//
// Séparée de sync.mjs pour une raison précise : c'est ici que se joue la perte
// d'information, et une transformation qu'on ne peut pas tester sans PostgreSQL
// ne se teste jamais.
//
// ══════════════ CE QU'ON NE JETTE PLUS, ET POURQUOI ═══════════════════════════
//
// Les exécutions réelles (data/mippoc-sample.json, sondées le 2026-06-10)
// portent six métriques :
//
//   completion_time  durée du scénario robot complet — 10001 à 10015 ms sur les
//                    neuf exécutions, soit une CONSTANTE à 14 ms près, parce
//                    qu'elle mesure surtout les temporisations du script. Elle
//                    n'est comparable à rien côté RUM, et on le dit plutôt que
//                    de la faire passer pour une durée de chargement.
//   first_load_time  le vécu de chargement — LA grandeur comparable au LCP.
//   dns_time         résolution DNS.
//   nb_requests      nombre de requêtes de la page.
//   nb_requests_ko   celles en échec.
//   http_status      le statut du document.
//
// L'adaptateur d'origine n'en projetait QU'UNE (first_load_time → latency_ms) et
// jetait les cinq autres. On conserve désormais le bloc entier, TEL QUEL, sans
// l'interpréter : on ne corrèle pas ce qu'on n'a pas gardé, et on ne sait pas
// aujourd'hui laquelle de ces cinq servira demain.
//
// `latency_ms` reste la projection EXPLICITE de first_load_time — c'est la seule
// grandeur dont les deux côtés mesurent la même chose.

/** Ce que la source dit, ramené à ce que la base attend. Aucune invention. */
export const ETATS_CONNUS = { OK: "ok", WARNING: "warn", KO: "incident", ERROR: "incident" };

/**
 * Normalise un état de la source.
 *
 * Une valeur INCONNUE ne devient pas « incident ». L'ancien code écrivait
 * `state === 'OK' ? 'ok' : state === 'WARNING' ? 'warn' : 'incident'`, ce qui
 * transformait n'importe quel état non prévu — un « SKIPPED », un « PENDING », un
 * champ vide — en panne déclarée. On rend `null`, l'appelant le compte, et
 * `state_source` garde le mot d'origine pour qu'on puisse le déclarer un jour.
 */
export function normaliserEtat(brut) {
  if (typeof brut !== "string") return null;
  return ETATS_CONNUS[brut.trim().toUpperCase()] ?? null;
}

/** Nombre, ou null — jamais NaN, qui traverserait jusqu'à la base. */
export function nombreOuNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Score de 0 à 100 dérivé de l'état.
 *
 * DÉRIVÉ, donc redondant avec `state` — et c'est assumé : la colonne existe déjà
 * et des vues la lisent. Ce qui change, c'est qu'un état inconnu ne vaut plus 0 :
 * zéro se lirait « pire note possible » alors que la vérité est « on ne sait pas ».
 */
export function scoreDepuisEtat(etat) {
  return etat === "ok" ? 100 : etat === "warn" ? 50 : etat === "incident" ? 0 : null;
}

/**
 * Une exécution de la source → une ligne syn_snapshot.
 *
 * @param {object} exec       une entrée de `executions`
 * @param {string} measureName nom de la mesure (porté par l'enveloppe, pas par l'exécution)
 * @param {{app_id: string, site?: string, route_hint?: string}} rattachement
 */
export function ligneDepuisExecution(exec, measureName, rattachement) {
  const d = exec?.details ?? {};
  const metrics = d.metrics ?? {};
  const etat = normaliserEtat(d.state);
  return {
    app_id: rattachement.app_id,
    site: rattachement.site ?? null,
    // `id` EST L'IDENTIFIANT DE LA MESURE, PAS DU PASSAGE — mesuré, pas supposé :
    // il vaut 483 sur les neuf exécutions du fichier d'exemple. La source ne
    // fournit AUCUN identifiant de passage ; ce qui distingue deux exécutions est
    // leur horodatage, et rien d'autre. C'est pour ça que la clé d'unicité en
    // base porte sur (app_id, measure_id, captured_at).
    measure_id: exec?.id == null ? measureName : String(exec.id),
    measure_name: measureName,
    execution_id: null,
    measure_type: exec?.type ?? null,
    route_hint: rattachement.route_hint ?? null,
    score: scoreDepuisEtat(etat),
    state: etat,
    state_source: typeof d.state === "string" ? d.state : null,
    // La projection explicite, et la seule.
    latency_ms: nombreOuNull(metrics.first_load_time),
    // Le bloc entier, non interprété.
    metrics,
    captured_at: d.time ? new Date(d.time) : null,
  };
}

/**
 * Toutes les lignes d'un export, avec le compte de ce qui n'a PAS été retenu.
 *
 * REND LES REJETS PLUTÔT QUE DE LEVER. Une exécution sans horodatage ne doit pas
 * annuler l'import des huit autres — mais elle ne doit pas non plus disparaître
 * en silence, sinon un format qui change se lit « le robot s'est arrêté ».
 */
export function lignesDepuisExport(exportJson, rattachement) {
  const measureName = exportJson?.measure_name ?? null;
  const executions = Array.isArray(exportJson?.executions) ? exportJson.executions : [];
  const lignes = [];
  const rejets = [];
  for (const e of executions) {
    if (!measureName) {
      rejets.push({ id: e?.id ?? null, motif: "export sans measure_name" });
      continue;
    }
    const l = ligneDepuisExecution(e, measureName, rattachement);
    if (!l.captured_at || Number.isNaN(l.captured_at.getTime())) {
      rejets.push({ id: l.execution_id, motif: `horodatage illisible : ${JSON.stringify(e?.details?.time)}` });
      continue;
    }
    lignes.push(l);
  }
  return { lignes, rejets, measureName, vues: executions.length };
}
