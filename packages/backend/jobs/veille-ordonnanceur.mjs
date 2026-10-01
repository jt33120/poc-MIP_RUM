// LA VEILLE DE L'ORDONNANCEUR — le notifier alerte quand les travaux planifiés
// se taisent.
//
// POURQUOI LE NOTIFIER. Le scheduler ne peut pas dire qu'il s'est tu : ses sondes
// meurent avec lui. Le dead-man's switch externe (`DEADMAN_URL`, `ordonnanceur.mjs`)
// le dirait, mais rien ne le pose en production : ni l'IaC, ni une variable. Le
// notifier est l'autre processus qui lit la même base ET qui sait livrer : à chaque
// passe, il lit le battement du tick (`scheduler_lease`, ligne `tick` : son
// `expires_at` est l'heure du dernier tick ABOUTI, `bail.mjs`), et l'alerte qu'il
// lève part dans la même passe — la veille passe AVANT la livraison.
//
// AUCUN RÉVEIL DE PLUS. Une requête, dans la passe, quand la base est déjà éveillée
// par elle ; au plus une par minute (`VEILLE_MIN_MS`) quand les passes tombent
// toutes les 15 s. Sur la grille de 15 min, la passe tombe 45 s après le tick.
//
// LA RÈGLE, celle du reste de la plateforme : au-delà de `2 × cadence + 5 min` sans
// tick abouti, les travaux planifiés sont tenus pour arrêtés (`planReconstitution`
// et `sonde_reconstituer_uptime` pour le passé, la carte « Santé de la chaîne de
// mesure » pour le présent). Un tick manqué — un redéploiement, un bail tenu par
// l'instance sortante, des migrations au pré-déploiement — ne suffit pas. Deux non
// plus, en production : tick et passes au quart d'heure, la passe qui suit le
// deuxième tick manqué voit 30 min 45 s de silence, moins la durée du dernier tick :
// sous les 35 min. L'alerte part à la passe qui suit le TROISIÈME, vers 46 min après
// le dernier tick abouti (vers 35 min avec des passes de 15 s, non alignées). La
// cadence est celle que le scheduler PUBLIE (`platform_flag.scheduler_tick_min`) ;
// non publiée, celle d'un déploiement sans réglage (`TICK_DEFAUT_MIN`, 15 min), et
// l'alerte le dit.
//
// UN ÉPISODE = UNE FENÊTRE = UNE ALERTE. Le silence ouvre une fenêtre du registre
// (`collecte_fenetre`, portée `'*'`, étage `ordonnanceur`, état `interrompue`), datée
// du dernier tick abouti ; `sonde_alerter` (migration-v103) lui attache UNE alerte,
// critique, routée vers les seuls canaux GLOBAUX (`route_alert` sans application :
// la panne est celle de la plateforme). La fenêtre ouverte est unique
// (`collecte_fenetre_une_ouverte`) et `sonde_alerter` verrouille sa ligne : deux
// notifiers ne doublent ni la fenêtre ni l'alerte. La fenêtre se ferme au tick
// revenu, datée de lui. Pas d'alerte de retour : la fenêtre close le dit.
//
// HORS DE LA COLLECTE. L'étage `ordonnanceur` n'est lu ni par les graphiques
// (`etage = 'chaine'`, `apps/console/lib/queries-collecte.ts`) ni par
// `check_alerts` (« hors collecte », migration-v105) : la collecte ne passe pas par
// le scheduler, et la fenêtre de la veille ne retire aucune mesure. Ce qui s'arrête,
// ce sont les décisions : alertes, SLO, sondes de disponibilité, canari. La carte de
// `/admin/health` la liste avec les autres, étiquetée « travaux planifiés, pas la
// collecte ». MAIS au premier tick revenu, le scheduler reconstitue son propre
// silence en fenêtre `interrompue` de la chaîne (`planReconstitution`, `sondes.mjs`,
// source `reconstitution`) : sans canari, la collecte n'y est pas prouvée. Celle-là
// est hachurée sur les graphiques, et `check_alerts` ne calcule aucune règle dont la
// fenêtre d'évaluation la recoupe. Le même épisode figure alors deux fois sur la carte.
//
// CE QU'ELLE NE COUVRE PAS. La panne du notifier lui-même (plus personne ne livre),
// celle de la base, ni celle de tout Railway : l'astreinte de MIP reste à brancher.
// Ni l'heure exacte d'un scheduler mort EN PLEIN tick : son bail n'est pas rendu, et
// l'échéance (prise + `DUREES.tick`, 10 min) tient lieu de dernier battement
// (`bail.mjs`, « limite connue ») : la fenêtre en est datée, l'alerte part jusqu'à
// 10 min plus tard, et sa preuve le dit.
import { TICKS_ADMIS_MIN, TICK_DEFAUT_MIN } from "./cadence.mjs";

/** L'étage du registre que la veille tient. */
export const ETAGE_VEILLE = "ordonnanceur";
/** Marge au-delà de deux cadences, en minutes : la même que `planReconstitution`. */
export const MARGE_SILENCE_MIN = 5;
/** Écart minimal entre deux veilles, compté depuis la dernière tentative. */
export const VEILLE_MIN_MS = 60_000;
/** Sans tick abouti, plus rien ne garantit que les alertes soient évaluées : la plus haute sévérité. */
export const SEVERITE_VEILLE = "critical";
/** SQLSTATE d'un schéma incomplet (v87 ou v103 absentes) : la veille attend, sans bruit de pile. */
const SCHEMA_INCOMPLET = new Set(["42P01", "42703", "42883"]);

/** La cadence publiée, si elle est sur la grille ; sinon `null` (jamais une valeur inventée). */
export function cadenceDuDrapeau(valeur) {
  if (valeur == null || String(valeur).trim() === "") return null;
  const n = Number(valeur);
  return TICKS_ADMIS_MIN.includes(n) ? n : null;
}

/** Le silence, en minutes, au-delà duquel les travaux planifiés sont tenus pour arrêtés. */
export function seuilSilenceMin(cadenceMin) {
  return 2 * cadenceMin + MARGE_SILENCE_MIN;
}

/**
 * LA DÉCISION, pure : que faire de la fenêtre `ordonnanceur`, sachant le bail du tick.
 *
 *   pas de ligne de bail ................ rien : aucun tick jamais abouti sur cette
 *                                         base (un battement jamais reçu n'est pas
 *                                         une panne, il n'a pas de début à dater)
 *   échéance future ..................... rien : un tick est en cours
 *   silence ≤ seuil, fenêtre ouverte .... fermer, datée du tick revenu
 *   silence ≤ seuil ..................... rien
 *   silence > seuil, pas de fenêtre ..... ouvrir (et alerter)
 *   silence > seuil, fenêtre sans alerte  alerter (une passe interrompue entre les deux)
 *   silence > seuil, alerte levée ....... rien : une alerte par épisode
 *
 * @param {{ maintenant: Date|number|string, bail: { expiresAt: Date|string } | null,
 *           cadenceMin: number | null, ouverte: { id: number|string, debut: Date|string, alerte: number|string|null } | null }} p
 * @returns {{ action: "ouvrir"|"alerter"|"fermer"|"rien", raison?: string, silenceMin: number | null,
 *             seuilMin: number, cadenceMin: number, cadencePubliee: boolean, dernierTick: Date | null }}
 */
export function decisionVeille({ maintenant, bail, cadenceMin, ouverte }) {
  const cadence = cadenceMin ?? TICK_DEFAUT_MIN;
  const seuilMin = seuilSilenceMin(cadence);
  const commun = { seuilMin, cadenceMin: cadence, cadencePubliee: cadenceMin != null };
  const t = new Date(maintenant).getTime();
  if (!bail) return { action: "rien", raison: "aucun tick abouti en base", silenceMin: null, dernierTick: null, ...commun };
  const echeance = new Date(bail.expiresAt).getTime();
  if (echeance > t) return { action: "rien", raison: "tick en cours", silenceMin: 0, dernierTick: null, ...commun };
  const dernierTick = new Date(echeance);
  const silenceMs = t - echeance;
  const silenceMin = Math.floor(silenceMs / 60_000);
  if (silenceMs <= seuilMin * 60_000) {
    return { action: ouverte ? "fermer" : "rien", silenceMin, dernierTick, ...commun };
  }
  if (!ouverte) return { action: "ouvrir", silenceMin, dernierTick, ...commun };
  if (ouverte.alerte == null) return { action: "alerter", silenceMin, dernierTick, ...commun };
  return { action: "rien", raison: "épisode en cours", silenceMin, dernierTick, ...commun };
}

/** « 01/10/2026 08:00 » : les dates des documents et des alertes, en UTC. */
function dateUtc(instant) {
  const iso = new Date(instant).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} ${iso.slice(11, 16)}`;
}

/** Ce que porte la fenêtre (`cause` ≤ 120, `preuve` ≤ 300) et l'alerte, en clair. */
export function textesVeille({ dernierTick, silenceMin, seuilMin, cadenceMin, cadencePubliee }) {
  const cadence = cadencePubliee ? `tick de ${cadenceMin} min` : `tick de ${cadenceMin} min supposé (cadence non publiée)`;
  const message =
    `Travaux planifiés muets : aucun tick abouti depuis ${silenceMin} min ` +
    `(dernier le ${dateUtc(dernierTick)} UTC, ${cadence}, seuil ${seuilMin} min). ` +
    "Le tick ne tourne plus ou échoue : alertes, SLO, sondes de disponibilité et canari ne sont plus garantis.";
  return {
    cause: `travaux planifiés muets : aucun tick abouti au-delà de ${seuilMin} min`.slice(0, 120),
    preuve: `dernier battement du tick le ${dateUtc(dernierTick)} UTC (scheduler_lease : fin du dernier tick abouti, ou échéance d'un bail abandonné en plein tick) ; ${cadence} ; seuil 2 × ${cadenceMin} + ${MARGE_SILENCE_MIN} = ${seuilMin} min ; constaté par le notifier`.slice(0, 300),
    message,
  };
}

/**
 * Les faits en UNE requête, à l'heure de la BASE (celle qui a écrit le bail) : le
 * bail du tick, la cadence publiée, la fenêtre ouverte et son alerte. Le bail est
 * lu deux fois : en date pour décider, en texte pour dater la fenêtre à la
 * microseconde (une `Date` JS s'arrête à la milliseconde).
 */
export const SQL_ETAT_VEILLE = `select now() as maintenant,
  (select expires_at from scheduler_lease where job = 'tick') as tick,
  (select expires_at::text from scheduler_lease where job = 'tick') as tick_brut,
  (select value from platform_flag where key = 'scheduler_tick_min') as cadence,
  (select json_build_object('id', f.id, 'debut', f.debut, 'alerte', f.alerte_event_id)
     from collecte_fenetre f
    where f.portee = '*' and f.etage = '${ETAGE_VEILLE}' and f.fin is null
    limit 1) as ouverte`;

const SQL_OUVRIR = `insert into collecte_fenetre (portee, etage, etat, debut, cause, preuve, source)
values ('*', '${ETAGE_VEILLE}', 'interrompue', $1, $2, $3, 'sonde')
on conflict (portee, etage) where fin is null do nothing
returning id`;

const SQL_OUVERTE = `select id from collecte_fenetre where portee = '*' and etage = '${ETAGE_VEILLE}' and fin is null`;

// `null` pour l'application : `route_alert` ne retient alors que les canaux globaux.
const SQL_ALERTER = `select sonde_alerter($1, null::text, '${SEVERITE_VEILLE}', $2, $3::jsonb) as id`;

const SQL_FERMER = `update collecte_fenetre
   set fin = greatest($2::timestamptz, debut + interval '1 millisecond'), updated_at = now()
 where id = $1 and fin is null`;

/**
 * La veille, telle que la passe du notifier l'appelle (`livreur.mjs`). `veiller()`
 * ne lève JAMAIS : une veille en échec ne fait pas échouer la livraison, elle le
 * journalise et retente à la passe suivante (au plus une fois par `veilleMinMs`).
 *
 * @param {{ pool: { query: Function }, log: any, metrics?: any, maintenant?: () => number,
 *           veilleMinMs?: number, delaiMs?: number }} options
 */
export function creerVeilleOrdonnanceur({ pool, log, metrics, maintenant = Date.now, veilleMinMs = VEILLE_MIN_MS, delaiMs = 2_000 }) {
  /** Instant (processus) de la dernière veille TENTÉE ; `null` avant la première. */
  let tenteeA = null;
  /** Le dernier bilan, pour /ready. */
  let dernier = null;
  const decisions = metrics?.counter(
    "notifier_scheduler_watch_total",
    "Veilles de l'ordonnanceur, par décision (rien, ouvrir, alerter, fermer, erreur).",
    { labels: ["action"] },
  );

  const requete = (text, values) => pool.query({ text, values, query_timeout: delaiMs });

  async function alerter(fenetreId, d) {
    const t = textesVeille(d);
    const { rows } = await requete(SQL_ALERTER, [
      fenetreId,
      t.message,
      JSON.stringify({
        kind: "ordonnanceur_muet",
        dernier_tick: d.dernierTick.toISOString(),
        silence_min: d.silenceMin,
        seuil_min: d.seuilMin,
        cadence_min: d.cadenceMin,
        text: t.message,
      }),
    ]);
    return rows[0]?.id ?? null;
  }

  /** Une veille. Rend son bilan, ou `null` si la précédente a moins de `veilleMinMs`. */
  async function veiller() {
    const t = maintenant();
    if (tenteeA !== null && t - tenteeA < veilleMinMs) return null;
    tenteeA = t;
    try {
      const { rows } = await requete(SQL_ETAT_VEILLE, []);
      const r = rows[0] ?? {};
      const ouverte = typeof r.ouverte === "string" ? JSON.parse(r.ouverte) : (r.ouverte ?? null);
      const d = decisionVeille({
        maintenant: r.maintenant ? new Date(r.maintenant) : new Date(t),
        bail: r.tick ? { expiresAt: r.tick } : null,
        cadenceMin: cadenceDuDrapeau(r.cadence),
        ouverte,
      });
      let fenetre = ouverte?.id ?? null;
      let alerte = null;
      if (d.action === "ouvrir") {
        const t2 = textesVeille(d);
        const { rows: ouv } = await requete(SQL_OUVRIR, [r.tick_brut ?? d.dernierTick, t2.cause, t2.preuve]);
        // Rien d'inséré : un autre notifier vient de l'ouvrir. On reprend la sienne ;
        // `sonde_alerter` n'alertera pas deux fois.
        fenetre = ouv[0]?.id ?? (await requete(SQL_OUVERTE, [])).rows[0]?.id ?? null;
        if (fenetre != null) alerte = await alerter(fenetre, d);
      } else if (d.action === "alerter") {
        alerte = await alerter(fenetre, d);
      } else if (d.action === "fermer") {
        await requete(SQL_FERMER, [fenetre, r.tick_brut ?? d.dernierTick]);
      }
      decisions?.inc({ action: d.action });
      dernier = {
        a: new Date(t).toISOString(),
        action: d.action,
        ...(d.raison ? { raison: d.raison } : {}),
        dernier_tick: d.dernierTick?.toISOString() ?? null,
        silence_min: d.silenceMin,
        seuil_min: d.seuilMin,
        cadence_min: d.cadenceMin,
        cadence_publiee: d.cadencePubliee,
        fenetre_id: fenetre == null || d.action === "fermer" ? null : Number(fenetre),
        ...(alerte != null ? { alerte_id: Number(alerte) } : {}),
      };
      if (d.action === "ouvrir" || d.action === "alerter") {
        log.error?.("travaux planifiés muets — alerte levée", { silence_min: d.silenceMin, seuil_min: d.seuilMin, fenetre_id: dernier.fenetre_id, alerte_id: dernier.alerte_id ?? null });
      } else if (d.action === "fermer") {
        log.info?.("travaux planifiés revenus — fenêtre fermée", { fenetre_id: Number(fenetre), dernier_tick: dernier.dernier_tick });
      }
      return dernier;
    } catch (err) {
      decisions?.inc({ action: "erreur" });
      const schema = SCHEMA_INCOMPLET.has(err?.code);
      log.warn?.(
        schema
          ? "veille de l'ordonnanceur en attente du schéma (migrations v87 et v103)"
          : "veille de l'ordonnanceur en échec — nouvel essai à la passe suivante",
        { code: err?.code ?? null, err: String(err?.message ?? err) },
      );
      dernier = { a: new Date(t).toISOString(), action: "erreur", code: err?.code ?? null };
      return dernier;
    }
  }

  return { veiller, etat: () => dernier };
}
