// LES TRAVAUX PLANIFIÉS — alertes, SLO, sondes uptime, rollups, purge, comptage.
//
// POURQUOI ILS SONT ICI. Ils vivaient dans des route handlers Next
// (`app/api/cron/*`), donc ils n'étaient déclenchables que par une requête HTTP
// authentifiée, depuis un planificateur externe. Ce détour a coûté cher :
//
//   pg_cron       refusé sur Neon (l'extension ne s'installe que dans `postgres`,
//                 pas dans `neondb`) — les blocs `cron.schedule` des migrations
//                 sont silencieusement sautés ;
//   pg_net        refusé sur Neon : la livraison des webhooks devait sortir de
//                 la base ;
//   Vercel Cron   le plan Hobby n'accepte QUE des crons quotidiens — déclarer
//                 `*/5 * * * *` fait échouer le déploiement entier ;
//   GitHub Actions  le repli, mais facturé à la minute entamée sur un dépôt
//                 privé : la cadence a dû tomber de 5 min à 1 h, sinon le quota
//                 du mois partait en une semaine et emportait la CI avec lui.
//
// D'où la ligne « Latence d'alerte : 5 min visées, 60 réelles » de la vitrine.
// Un processus long qui tourne en continu n'a aucune de ces contraintes : c'est
// pour ça que ce module est du code appelable, pas une route.
//
// Les fonctions SQL, elles, ne bougent pas. Ce qui change est le DÉCLENCHEUR.
//
// UN SEUL DÉCLENCHEUR depuis le 23/09/2026 : le service `scheduler`, qui prend un
// bail par cadence. Le cron GitHub et Vercel Cron passaient par `/api/cron/*`,
// sans bail, et pouvaient lancer la même cadence au même instant ; ces routes
// ont rendu 410 (23/09/2026) puis ont été supprimées (25/09/2026, préparation de C12), et le
// rejeu manuel passe par `services/scheduler/run-once.mjs`, qui prend le même bail.
//
// L'idempotence des étapes reste exigée — un redéploiement qui chevauche, une
// montée à deux répliques — avec des verrous de TRANSACTION seulement, puisque le
// pooler Neon perd un verrou de session.
import { importerNotesHistoriques } from "../lib/error-issue-workflow.mjs";
import { ErreurCibleRefusee, safeFetch } from "../lib/net/safe-fetch.mjs";

/**
 * Exécute une série d'étapes SANS qu'un échec annule les suivantes : une purge
 * qui casse ne doit pas emporter le comptage du même tick. Chaque résultat est
 * rapporté séparément.
 *
 * LA PILE COMPLÈTE part au journal. Jusqu'en P1, l'erreur y était réduite à
 * `String(err)` : « Connection terminated unexpectedly » ou « canceling
 * statement due to statement timeout », sans dire quelle requête, depuis quel
 * appel. L'objet Error est désormais remis au journal, qui en sérialise la pile
 * et la cause (`@mip/service-kit/log.mjs`) ; le bilan, lui, garde le message
 * court — il est journalisé en entier à chaque passage.
 *
 * @param {{name: string, run: () => unknown, delaiMs?: number}[]} etapes
 * @param {{error?: Function}} [log]
 * @param {{ job?: string }} [contexte]  nom de la cadence, repris dans le journal
 * @returns {Promise<{ok: boolean, echecs: number, resultats: Record<string, unknown>}>}
 */
export async function executerEtapes(etapes, log = console, { job } = {}) {
  const resultats = {};
  let echecs = 0;
  for (const etape of etapes) {
    const debut = Date.now();
    try {
      resultats[etape.name] = { ok: true, result: await etape.run(), ms: Date.now() - debut };
    } catch (err) {
      echecs++;
      resultats[etape.name] = { ok: false, error: String(err), ms: Date.now() - debut };
      log.error?.("étape planifiée en échec", {
        ...(job ? { job } : {}),
        step: etape.name,
        ms: Date.now() - debut,
        ...(etape.delaiMs ? { delai_ms: etape.delaiMs } : {}),
        err,
      });
    }
  }
  return { ok: echecs === 0, echecs, resultats };
}

/**
 * DÉLAI PAR ÉTAPE (`statement_timeout`), en ms. Sans lui, une fonction SQL qui
 * dérape (un plan qui bascule en parcours séquentiel, un verrou attendu)
 * tiendrait sa connexion, puis le bail, jusqu'à l'expiration de celui-ci — et
 * les passages suivants avec. Les valeurs sont prises LARGES devant le temps
 * observé (un tick complet prend ~20 ms en production) : le délai coupe un
 * dérapage, il ne doit jamais couper un passage normal.
 *
 * La somme des délais d'une cadence reste sous la durée de son bail
 * (`bail.mjs:DUREES`) : un travail qui atteint tous ses délais rend encore son
 * bail avant l'expiration, donc avant qu'une autre instance ne démarre la même
 * cadence. Un test le vérifie.
 *
 * Seules les étapes qui appellent UNE fonction SQL portent ce délai. Celles qui
 * sortent sur le réseau (uptime, dispatch_alerts, dispatch_tickets) ont déjà
 * les leurs — délai par sonde, échéance de livraison ; comme
 * import_legacy_issue_notes, elles enchaînent des requêtes courtes, chacune
 * bornée par le `query_timeout` du pool (30 s, `@mip/service-kit/pg.mjs`).
 */
export const DELAI_ETAPE_DEFAUT_MS = 60_000;
export const DELAIS_ETAPES_MS = Object.freeze({
  refresh_rum_rollups: 5 * 60_000,
  refresh_metric_histogram: 5 * 60_000,
  meter_tenant_usage: 5 * 60_000,
  // La purge efface des jours entiers de lignes brutes, client par client :
  // c'est l'étape longue par nature. 30 min, la moitié du bail quotidien.
  purge_rum_tenants: 30 * 60_000,
});

/** Le délai d'une étape SQL, par son nom. */
export function delaiEtape(nom) {
  return DELAIS_ETAPES_MS[nom] ?? DELAI_ETAPE_DEFAUT_MS;
}

/**
 * Marge du délai CÔTÉ CLIENT (`query_timeout`) sur le délai serveur : c'est
 * Postgres qui doit couper le premier — il annule la requête proprement et rend
 * un 57014 lisible. Le délai client n'est qu'un filet, pour le cas où le réseau
 * avale la réponse.
 */
export const MARGE_CLIENT_MS = 5_000;

/**
 * Appelle une fonction SQL sans argument et renvoie sa valeur.
 *
 * Avec `delaiMs`, l'appel est borné côté serveur : `set_config('statement_timeout',
 * …, true)` puis l'appel, dans UNE chaîne multi-instructions. Postgres exécute
 * une telle chaîne en une seule transaction implicite : le réglage LOCAL vaut
 * pour l'appel qui suit, puis disparaît avec la transaction — rien ne reste sur
 * la connexion rendue au pool (vérifié sur Postgres 17 : 57014 au délai, puis
 * `statement_timeout` revenu à 0). C'est la forme qu'exige le pooler Neon en
 * mode transaction, où un `SET` de session serait perdu ou laissé à la requête
 * d'un autre ; et elle ne coûte qu'un aller-retour, sans BEGIN/COMMIT ni client
 * emprunté. La fonction s'exécute dans une transaction, exactement comme avant
 * (une instruction seule en est une aussi).
 *
 * Le délai est interpolé dans le texte (une chaîne multi-instructions passe par
 * le protocole simple, qui n'accepte pas de paramètres) : c'est un ENTIER
 * validé ici, jamais une entrée extérieure. `fn` est une constante du code.
 */
export async function appelerFn(pool, fn, { delaiMs } = {}) {
  if (delaiMs == null) {
    const { rows } = await pool.query(`select ${fn} as result`);
    return rows[0]?.result ?? null;
  }
  if (!Number.isSafeInteger(delaiMs) || delaiMs <= 0) {
    throw new RangeError(`appelerFn : délai invalide (${delaiMs})`);
  }
  const res = await pool.query({
    text: `select set_config('statement_timeout', '${delaiMs}', true); select ${fn} as result`,
    query_timeout: delaiMs + MARGE_CLIENT_MS,
  });
  // `pg` rend un tableau de résultats pour une chaîne multi-instructions ; le
  // dernier est celui de l'appel.
  const dernier = Array.isArray(res) ? res[res.length - 1] : res;
  return dernier?.rows?.[0]?.result ?? null;
}

/**
 * Appelle une fonction SQL apportée par une migration récente, si elle existe.
 * Le code peut précéder sa migration sur un déploiement : l'étape rend alors la
 * raison de son absence au lieu d'échouer — un 207 à chaque tick masquerait les
 * vrais échecs. `signature` est la forme regprocedure, `fn` l'appel, `options`
 * celles d'`appelerFn` (le délai).
 */
export async function appelerFnSiPresente(pool, signature, fn, migration, options) {
  const { rows } = await pool.query("select to_regprocedure($1) is not null as present", [signature]);
  if (!rows[0]?.present) return { absent: `${migration} non appliquée` };
  return appelerFn(pool, fn, options);
}

/** Sondes uptime menées de front, au plus. */
export const CONCURRENCE_UPTIME = 10;
/** Pause avant l'essai de confirmation d'une sonde en échec. */
export const PAUSE_CONFIRMATION_MS = 1_000;

/**
 * Un essai de sonde. Ne lève jamais : rend le verdict et la raison.
 *
 * Par `safeFetch` : l'URL d'un check est saisie dans la console, et une sonde
 * est une requête que le réseau du scheduler émet pour le compte de celui qui
 * l'a saisie (cf. `lib/net/safe-fetch.mjs`). On juge le statut FINAL, après au
 * plus 3 redirections revalidées. Le corps n'est pas lu : il est annulé, ce qui
 * ferme la socket — sans connexion réutilisée, rien ne reste ouvert.
 *
 * `definitif` : un refus de politique ne change pas en une seconde, le
 * confirmer serait un second refus identique.
 */
export async function sonderUneFois(check, { fetchImpl = safeFetch } = {}) {
  const debut = Date.now();
  try {
    const res = await fetchImpl(check.url, {
      method: check.method ?? "GET",
      timeoutMs: check.timeout_ms ?? 10_000,
    });
    await res.body?.cancel().catch(() => {});
    const ok = res.status === (check.expect_status ?? 200);
    return { ok, statut: res.status, erreur: ok ? null : `HTTP ${res.status}`, ms: Date.now() - debut, definitif: false };
  } catch (e) {
    return {
      ok: false,
      statut: null,
      erreur: String(e?.message ?? e).slice(0, 200),
      ms: Date.now() - debut,
      definitif: e instanceof ErreurCibleRefusee,
    };
  }
}

/** Applique `travail` à chaque élément, `limite` à la fois au plus. */
async function enParallele(elements, limite, travail) {
  let suivant = 0;
  const ouvrier = async () => {
    while (suivant < elements.length) {
      const i = suivant++;
      await travail(elements[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, elements.length) }, ouvrier));
}

/**
 * Sonde les checks actifs et enregistre le résultat.
 *
 * `record_uptime_result` gère l'alerte sur bascule UP -> DOWN : rien de cette
 * logique ne vit ici.
 *
 * CONCURRENCE BORNÉE (10). Le `Promise.all` d'origine lançait toutes les sondes
 * d'un coup : autant de sockets et de résolutions DNS simultanées que de checks
 * configurés, sans plafond — un tenant qui en déclare mille ouvre mille
 * connexions depuis le scheduler, toutes les 5 minutes.
 *
 * CONFIRMATION AVANT DOWN. Un échec isolé (paquet perdu, redémarrage du serveur
 * sondé, délai de 10 s dépassé une fois) déclenchait une alerte `critical`, puis
 * une remontée au tick suivant : du bruit, et une disponibilité 24 h qui mentait.
 * Une sonde en échec est donc rejouée une fois, après une courte pause ; seul le
 * SECOND verdict est enregistré. Coût dans le pire cas : deux délais par check
 * en panne, soit ~21 s par vague de 10 checks muets — avant la livraison des
 * webhooks du même tick, dont l'échéance se mesure depuis le début du tick.
 *
 * `sonder` et `pauseMs` sont injectables pour les tests.
 */
export async function sonderUptime(
  pool,
  log = console,
  { sonder = sonderUneFois, concurrence = CONCURRENCE_UPTIME, pauseMs = PAUSE_CONFIRMATION_MS } = {},
) {
  const { rows: checks } = await pool.query(
    "select id, url, method, expect_status, timeout_ms from uptime_check where enabled",
  );

  let lances = 0;
  let tombes = 0;
  let rattrapes = 0;
  await enParallele(checks, concurrence, async (c) => {
    let r = await sonder(c);
    if (!r.ok && !r.definitif) {
      await new Promise((fin) => setTimeout(fin, pauseMs));
      const confirmation = await sonder(c);
      if (confirmation.ok) {
        rattrapes++;
        log.info?.("uptime : échec non confirmé", { check_id: c.id, premier: r.erreur });
      }
      r = confirmation;
    }
    lances++;
    if (!r.ok) tombes++;
    await pool
      .query("select record_uptime_result($1, $2, $3, $4, $5)", [c.id, r.ok, r.statut, r.ms, r.erreur])
      .catch((err) => log.error?.("record_uptime_result failed", { check_id: c.id, err: String(err) }));
  });
  return { ran: lances, down: tombes, rattrapes };
}

/**
 * La route cron coupe le tick à 60 s. Passé ce délai depuis le DÉBUT du tick, le
 * dispatcher n'entame plus de livraison, quel que soit le temps pris avant lui
 * (check_alerts qui attend l'autre déclencheur, sondes uptime lentes) : ce qui
 * reste part au tick suivant, et chaque POST est borné par le temps restant.
 */
export const ECHEANCE_LIVRAISON_MS = 45_000;

/**
 * Les étapes de LIVRAISON — ce qui sort vers l'extérieur ou y prépare : routage des
 * notifications d'issue, webhooks et e-mails, tickets, réconciliation. Le tick du
 * scheduler les exécute tant que sa livraison n'est pas coupée ; le notifier (P5)
 * les exécute seul ensuite, toutes les 15 s, avec la réconciliation à l'heure.
 *
 * `dispatch` est injecté plutôt qu'importé : c'est le morceau qui sort vers
 * l'extérieur, et un appelant (un test, un environnement sans réseau sortant)
 * doit pouvoir le neutraliser. `echeance` borne les sorties réseau de la passe.
 *
 * @returns {{ route: object, dispatch: object | null, tickets: object, reconcile: object }}
 */
export function etapesLivraison(pool, { log = console, dispatch = null, echeance }) {
  const delaiRoutage = delaiEtape("route_error_issue_notifications");
  const delaiReconciliation = delaiEtape("reconcile_deliveries");
  return {
    // Notifications d'issue (nouvelle, régression, pic) remises à route_alert :
    // alert_event + livraisons `queued`, AVANT la livraison de la même passe.
    route: {
      name: "route_error_issue_notifications",
      delaiMs: delaiRoutage,
      run: () =>
        appelerFnSiPresente(
          pool,
          "route_error_issue_notifications(integer)",
          "route_error_issue_notifications()",
          "migration-v73",
          { delaiMs: delaiRoutage },
        ),
    },
    // Livraison effective des webhooks et e-mails en attente (remplace pg_net).
    dispatch: dispatch ? { name: "dispatch_alerts", run: () => dispatch(pool, { echeance }) } : null,
    // P8.6 : la file de sortie des tickets suit la MÊME passe que l'outbox de
    // notifications, à dessein — un second planificateur aurait sa propre
    // cadence, son propre verrou et ses propres régressions.
    // Chargé à la demande : ce module sort vers l'extérieur.
    tickets: {
      name: "dispatch_tickets",
      run: async () => {
        const { livrerTickets } = await import("../lib/integrations/tickets/dispatcher.mjs");
        return livrerTickets(pool, { echeance, log });
      },
    },
    // Réconciliation des livraisons 'sent' héritées de l'ère pg_net : sans pg_net
    // la fonction ne trouve rien, mais elle reste correcte et bon marché — la
    // garder évite des lignes 'sent' éternelles.
    reconcile: {
      name: "reconcile_deliveries",
      delaiMs: delaiReconciliation,
      run: () => appelerFn(pool, "reconcile_alert_deliveries()", { delaiMs: delaiReconciliation }),
    },
  };
}

/**
 * Les trois cadences.
 *
 * `livraison` (défaut vrai) : le tick exécute aussi les étapes de livraison. Le
 * scheduler la coupe (`SCHEDULER_DELIVERY=off`) quand le notifier prend le relais ;
 * le tick ne fait plus alors que DÉCIDER (alertes, SLO, uptime) — il écrit des
 * livraisons `queued`, le notifier les envoie.
 */
export function travaux(pool, { log = console, dispatch = null, livraison = true } = {}) {
  /** Une étape SQL : l'appel `appel`, borné par le délai de l'étape `nom`. */
  const sql = (nom, appel) => {
    const delaiMs = delaiEtape(nom);
    return { name: nom, delaiMs, run: () => appelerFn(pool, appel, { delaiMs }) };
  };

  return {
    /** Toutes les 5 minutes : ce qui doit réagir vite. */
    tick: () => {
      const echeance = Date.now() + ECHEANCE_LIVRAISON_MS;
      const l = etapesLivraison(pool, { log, dispatch, echeance });
      return executerEtapes(
        [
          // Évaluation des règles : insère les alert_event + livraisons 'queued'.
          sql("check_alerts", "check_alerts()"),
          ...(livraison ? [l.route] : []),
          sql("check_slo_burn", "check_slo_burn()"),
          { name: "uptime", run: () => sonderUptime(pool, log) },
          ...(livraison ? [l.dispatch, l.tickets, l.reconcile].filter(Boolean) : []),
        ],
        log,
        { job: "tick" },
      );
    },

    /** Toutes les heures : pré-agrégats et détections moins urgentes. */
    horaire: () =>
      executerEtapes(
        [
          sql("refresh_rum_rollups", "refresh_rum_rollups(26)"),
          // 26 h comme les rollups, et pour la même raison : une heure en cours
          // est incomplète, et un passage manqué doit être rattrapé au suivant
          // sans double-compter (`on conflict do update`, pas `+=`).
          sql("refresh_metric_histogram", "refresh_metric_histogram(26)"),
          sql("check_new_errors", "check_new_errors()"),
          sql("check_ai_op_anomalies", "check_ai_op_anomalies()"),
          // Notes de triage des groupes historiques devenus alias d'une issue,
          // importées une fois en activité (clé d'événement unique).
          { name: "import_legacy_issue_notes", run: () => importerNotesHistoriques(pool) },
        ],
        log,
        { job: "horaire" },
      ),

    /**
     * Une fois par jour. `purge_rum_tenants` et non `purge_rum` : la première
     * respecte la rétention PAR CLIENT (app_registry.retention_days), la
     * seconde applique un délai global. `meter_tenant_usage()` porte sur la
     * veille, complète à 03:17 UTC contrairement au jour courant.
     * `purge_console_sessions()` (migration-v90) efface les sessions de la
     * console expirées ou révoquées depuis 7 jours, et les compteurs d'échecs
     * de connexion éteints.
     */
    quotidien: () =>
      executerEtapes(
        [
          sql("purge_rum_tenants", "purge_rum_tenants(30)"),
          sql("meter_tenant_usage", "meter_tenant_usage()"),
          sql("purge_console_sessions", "purge_console_sessions()"),
        ],
        log,
        { job: "quotidien" },
      ),
  };
}
