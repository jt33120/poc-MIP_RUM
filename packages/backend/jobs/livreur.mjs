// LE LIVREUR — ce que le service `notifier` exécute : sortir vers l'extérieur ce
// que la plateforme a décidé de dire (P5).
//
// POURQUOI UN SERVICE À PART. Le scheduler DÉCIDE (alertes, SLO, uptime) toutes les
// 5 minutes ; livrer au même rythme donnait jusqu'à 5 minutes de retard à une
// alerte déjà décidée — et à une nouvelle erreur, que l'ingestion met dans l'outbox
// à la seconde. Le notifier livre toutes les 15 s. Il est aussi le SEUL à détenir
// les secrets sortants (clé Resend, secret de signature des webhooks) : un
// processus qui décide n'a aucune raison de pouvoir écrire à un tiers.
//
// UNE PASSE = la veille de l'ordonnanceur, puis deux étapes, dans cet ordre,
// celles du tick du scheduler (`etapesLivraison`, `planifie.mjs`) :
//   veille de l'ordonnanceur          le tick s'est-il tu ? (`veille-ordonnanceur.mjs`,
//                                     une fois par minute au plus, jamais bloquante)
//   route_error_issue_notifications   l'outbox des issues → alert_event + livraisons
//   dispatch_alerts                   webhooks signés, e-mails Resend
// puis, si les deux étapes ont abouti, le battement (`sonde_battement`, une fois
// par minute au plus). La veille passe EN PREMIER : l'alerte qu'elle lève est mise
// en file avant la livraison, et part dans la même passe. La réconciliation des
// livraisons héritées de pg_net tourne à l'heure.
//
// LA SEULE DÉCISION DU NOTIFIER. Il livre ce que d'autres décident, sauf ceci : le
// scheduler ne peut pas dire qu'il s'est tu, ses sondes meurent avec lui. Le
// notifier, qui lit la même base et sait livrer, le dit à sa place.
//
// PAS DE BAIL. Chaque étape réserve ses lignes par `for update skip locked` : deux
// répliques, ou le scheduler et le notifier pendant la bascule, se partagent les
// lignes sans jamais en livrer une deux fois. Un bail n'ajouterait rien.
//
// LE COÛT, À CONNAÎTRE. Quatre passes par minute, chacune interroge la base : le
// compute Neon ne s'endort plus (veille après 5 min sans requête). À 0,25 CU,
// c'est ~180 CU-h par mois — au-delà des 100 du plan Free à lui seul, ~19 $ par
// mois sur Launch. `NOTIFIER_INTERVAL_MS` règle ce compromis.
//
// SUR LA BASE GRATUITE (décision du 24/09/2026) : même intervalle que le tick du
// scheduler (15 min), et passes ALIGNÉES sur sa grille, 45 s après lui. Le tick
// réveille la base à :00, décide, met les livraisons en file ; le notifier les
// envoie à :00:45, dans la même fenêtre d'éveil. Deux services, un seul réveil.
// Sans alignement, deux cadences de 15 min décalées réveilleraient la base deux
// fois plus souvent. Dès 5 min d'intervalle, l'alignement s'applique.
import { dispatchOnce } from "../lib/dispatch-alerts.mjs";
import { etapesLivraison, executerEtapes } from "./planifie.mjs";
import { creerVeilleOrdonnanceur } from "./veille-ordonnanceur.mjs";

export const INTERVALLE_DEFAUT_MS = 15_000;
/**
 * Échéance des sorties réseau d'une passe : aucune nouvelle livraison n'est
 * entamée au-delà. Courte à dessein : une passe revient 15 s plus tard, et le
 * drainage d'un redéploiement (20 s) doit couvrir la passe en cours.
 */
export const BUDGET_PASSE_MS = 10_000;
/**
 * Écart minimal entre deux battements écrits dans `sonde_battement` (v103). Le
 * battement part DANS la passe, quand la base est déjà éveillée par elle : il ne
 * coûte aucun réveil de Neon. Une passe toutes les 15 s n'en écrit qu'une sur
 * quatre ; une passe alignée toutes les 15 min, à chaque fois.
 */
export const BATTEMENT_MIN_MS = 60_000;
/** Le service, tel que la carte « Santé de la chaîne de mesure » le cherche (`SanteChaine.tsx`). */
export const SERVICE_BATTEMENT = "notifier";

/**
 * L'upsert du battement : `dernier_ok` à l'heure de la BASE (celle que lit la
 * console), jamais à celle du processus.
 */
export const SQL_BATTEMENT = `insert into sonde_battement (service, dernier_ok, detail)
values ($1, now(), $2)
on conflict (service) do update set dernier_ok = excluded.dernier_ok, detail = excluded.detail`;
/**
 * Au-delà, une livraison `queued` ne partira pas toute seule : /ready le dit.
 * Deux intervalles au moins : sur la base gratuite, une livraison mise en file
 * juste après une passe attend légitimement la suivante, 15 min plus tard.
 */
export const ARRIERE_BLOQUE_S = 15 * 60;
/** À partir de cet intervalle, les passes s'alignent sur la grille de l'horloge. */
export const SEUIL_ALIGNEMENT_MS = 300_000;
/** Décalage derrière le tick du scheduler : le temps qu'il décide et mette en file. */
export const DECALAGE_ALIGNEMENT_MS = 45_000;

/**
 * Délai avant la prochaine passe ALIGNÉE : le prochain multiple de l'intervalle
 * (depuis l'époque, donc sur :00, :15, :30, :45 pour 15 min) plus le décalage.
 * Pure, comme `prochainDelai` du scheduler ; jamais moins d'une seconde.
 */
export function prochainePasseAlignee(intervalleMs, maintenant, decalageMs = DECALAGE_ALIGNEMENT_MS) {
  const t = Number(maintenant);
  const prochaine = Math.floor((t - decalageMs) / intervalleMs) * intervalleMs + intervalleMs + decalageMs;
  return Math.max(1_000, prochaine - t);
}

/** Un intervalle qui s'aligne doit diviser l'heure, comme le tick du scheduler. */
export function erreurIntervalle(intervalleMs) {
  if (intervalleMs >= SEUIL_ALIGNEMENT_MS && 3_600_000 % intervalleMs !== 0) {
    return "à partir de 300000, un diviseur de l'heure (300000, 600000, 900000, 1200000, 1800000, 3600000) : les passes s'alignent sur la grille du scheduler";
  }
  return null;
}

/**
 * @param {{ pool: { query: Function, connect: Function }, log: any, metrics?: any,
 *           dispatch?: typeof dispatchOnce, email?: object | null, secretSignature?: string | null,
 *           intervalleMs?: number, budgetMs?: number, battementMinMs?: number,
 *           veille?: boolean, maintenant?: () => number }} options
 *   `veille` : la veille de l'ordonnanceur dans chaque passe (vrai par défaut).
 */
export function creerLivreur({
  pool,
  log,
  metrics,
  dispatch = dispatchOnce,
  email = null,
  secretSignature = null,
  intervalleMs = INTERVALLE_DEFAUT_MS,
  budgetMs = BUDGET_PASSE_MS,
  battementMinMs = BATTEMENT_MIN_MS,
  veille = true,
  maintenant = Date.now,
}) {
  const demarrage = maintenant();
  /** Dernière passe et dernière réconciliation DANS CE PROCESSUS. */
  const local = { passe: null, reconciliation: null };
  const veilleOrdonnanceur = veille ? creerVeilleOrdonnanceur({ pool, log, metrics, maintenant }) : null;

  const livraisons = metrics?.counter("notifier_deliveries_total", "Livraisons soldées, par canal et par statut.", {
    labels: ["canal", "status"],
  });
  const echecsEtapes = metrics?.counter("notifier_step_failures_total", "Étapes de livraison en échec.", {
    labels: ["step"],
  });

  // Un dispatcher lié à la configuration du livreur : e-mail, signature, compteurs.
  const dispatchConfigure = (p, { echeance }) =>
    dispatch(p, {
      echeance,
      email,
      secretSignature,
      onLivraison: ({ canal, status }) => livraisons?.inc({ canal, status }),
    });

  function retenir(nom, debut, bilan) {
    const precedent = local[nom] ?? {};
    const enEchec = Object.keys(bilan.resultats).filter((k) => bilan.resultats[k]?.ok === false);
    for (const etape of enEchec) echecsEtapes?.inc({ step: etape });
    local[nom] = {
      lance_a: new Date(debut).toISOString(),
      statut: bilan.ok ? "fait" : "echec",
      ms: maintenant() - debut,
      dernier_succes: bilan.ok ? new Date(maintenant()).toISOString() : (precedent.dernier_succes ?? null),
      ...(enEchec.length ? { etapes_en_echec: enEchec } : {}),
    };
    return bilan;
  }

  /** Instant (processus) du dernier battement TENTÉ ; `null` avant le premier. */
  let battementA = null;

  /**
   * Le battement du notifier (`sonde_battement`, v103), lu par la carte « Santé de
   * la chaîne de mesure » de `/admin/health` : le notifier n'a pas de bail, c'est
   * sa seule trace en base. Écrit après une passe ABOUTIE seulement — `dernier_ok`
   * dit la dernière passe qui a livré, et une passe en échec le laisse vieillir,
   * c'est le signal. Au plus une fois par `battementMinMs`, compté depuis la
   * dernière TENTATIVE : une table absente (v103 pas encore appliquée) ne se
   * retente pas à chaque passe. Un échec ne fait jamais échouer la passe.
   */
  async function battre() {
    const t = maintenant();
    if (battementA !== null && t - battementA < battementMinMs) return false;
    battementA = t;
    try {
      await pool.query({
        text: SQL_BATTEMENT,
        values: [SERVICE_BATTEMENT, `passe toutes les ${Math.round(intervalleMs / 1000)} s`],
        query_timeout: 2_000,
      });
      return true;
    } catch (err) {
      log.warn?.("battement du notifier non écrit", { err: String(err) });
      return false;
    }
  }

  /** Une passe de livraison. Ne lève pas : une étape en échec n'annule pas les suivantes. */
  async function passe() {
    const debut = maintenant();
    // Avant la livraison : l'alerte d'un tick muet part dans CETTE passe. Jamais
    // bloquante (elle ne lève pas), et comptée dans l'échéance de la passe.
    await veilleOrdonnanceur?.veiller();
    const l = etapesLivraison(pool, { log, dispatch: dispatchConfigure, echeance: debut + budgetMs });
    const bilan = await executerEtapes([l.route, l.dispatch], log, { job: "livraison" });
    if (bilan.ok) await battre();
    return retenir("passe", debut, bilan);
  }

  /** La réconciliation des livraisons `sent` de l'ère pg_net, à l'heure. */
  async function reconcilier() {
    const debut = maintenant();
    const l = etapesLivraison(pool, { log, echeance: debut + budgetMs });
    return retenir("reconciliation", debut, await executerEtapes([l.reconcile], log, { job: "reconciliation" }));
  }

  /**
   * L'arriéré, lu en BASE (la vérité, quel que soit le livreur qui a tourné).
   * Au rendu de /ready et /metrics seulement : jamais dans la boucle.
   */
  let lecture = null;
  let lueA = 0;
  function arriere() {
    if (!lecture || maintenant() - lueA > 1_000) {
      lueA = maintenant();
      lecture = pool
        .query({
          text: `select count(*)::int as en_attente,
                        extract(epoch from now() - min(attempted_at))::float8 as plus_ancienne_s
                   from alert_delivery where status = 'queued'`,
          query_timeout: 2_000,
        })
        .then(({ rows }) => ({ en_attente: rows[0]?.en_attente ?? 0, plus_ancienne_s: rows[0]?.plus_ancienne_s ?? null }));
      lecture.catch(() => {});
    }
    return lecture;
  }
  metrics?.gauge("notifier_backlog_deliveries", "Livraisons d'alerte en attente (queued).", {
    collect: async () => (await arriere()).en_attente,
  });
  metrics?.gauge("notifier_backlog_oldest_seconds", "Âge de la plus ancienne livraison en attente.", {
    collect: async () => (await arriere()).plus_ancienne_s ?? 0,
  });

  /**
   * Verdict de /ready. Frais si une passe a ABOUTI depuis moins de quatre
   * intervalles (ou, jamais aboutie, si le démarrage est plus récent que ça) ; et
   * aucune livraison en attente depuis plus de 15 min ou deux intervalles.
   */
  async function etat() {
    const a = await arriere();
    const t = maintenant();
    const reference = Math.max(Date.parse(local.passe?.dernier_succes ?? "") || 0, demarrage);
    const silenceS = Math.round((t - reference) / 1000);
    const toleranceS = Math.round(Math.max(60_000, 4 * intervalleMs) / 1000);
    const bloque = (a.plus_ancienne_s ?? 0) > Math.max(ARRIERE_BLOQUE_S, (2 * intervalleMs) / 1000);
    return {
      ok: silenceS <= toleranceS && !bloque,
      depuis: new Date(demarrage).toISOString(),
      email: Boolean(email),
      signature: Boolean(secretSignature),
      passe: { ...(local.passe ?? {}), silence_s: silenceS, tolerance_s: toleranceS },
      reconciliation: local.reconciliation,
      backlog: { livraisons_en_attente: a.en_attente, plus_ancienne_s: a.plus_ancienne_s, bloque },
      // Le dernier bilan de la veille, pour lire : il ne décide pas du verdict (un
      // scheduler muet n'empêche pas le notifier de livrer).
      veille_ordonnanceur: veilleOrdonnanceur?.etat() ?? null,
    };
  }

  return { passe, reconcilier, etat };
}
