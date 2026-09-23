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
// répondent 410 et le rejeu manuel passe par `services/scheduler/run-once.mjs`,
// qui prend le même bail.
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
 * @returns {Promise<{ok: boolean, echecs: number, resultats: Record<string, unknown>}>}
 */
export async function executerEtapes(etapes, log = console) {
  const resultats = {};
  let echecs = 0;
  for (const etape of etapes) {
    const debut = Date.now();
    try {
      resultats[etape.name] = { ok: true, result: await etape.run(), ms: Date.now() - debut };
    } catch (err) {
      echecs++;
      resultats[etape.name] = { ok: false, error: String(err), ms: Date.now() - debut };
      log.error?.("étape planifiée en échec", { step: etape.name, err: String(err) });
    }
  }
  return { ok: echecs === 0, echecs, resultats };
}

/** Appelle une fonction SQL sans argument et renvoie sa valeur. */
export async function appelerFn(pool, fn) {
  const { rows } = await pool.query(`select ${fn} as result`);
  return rows[0]?.result ?? null;
}

/**
 * Appelle une fonction SQL apportée par une migration récente, si elle existe.
 * Le code peut précéder sa migration sur un déploiement : l'étape rend alors la
 * raison de son absence au lieu d'échouer — un 207 à chaque tick masquerait les
 * vrais échecs. `signature` est la forme regprocedure, `fn` l'appel.
 */
export async function appelerFnSiPresente(pool, signature, fn, migration) {
  const { rows } = await pool.query("select to_regprocedure($1) is not null as present", [signature]);
  if (!rows[0]?.present) return { absent: `${migration} non appliquée` };
  return appelerFn(pool, fn);
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
 * Les trois cadences. `dispatch` est injecté plutôt qu'importé : le dispatcher
 * de webhooks est le seul morceau qui sort vers l'extérieur, et un appelant
 * (un test, un environnement sans réseau sortant) doit pouvoir le neutraliser.
 */
export function travaux(pool, { log = console, dispatch = null } = {}) {
  const fn = (nom) => () => appelerFn(pool, nom);

  return {
    /** Toutes les 5 minutes : ce qui doit réagir vite. */
    tick: () => {
      const echeance = Date.now() + ECHEANCE_LIVRAISON_MS;
      return executerEtapes(
        [
          // Évaluation des règles : insère les alert_event + livraisons 'queued'.
          { name: "check_alerts", run: fn("check_alerts()") },
          // Notifications d'issue (nouvelle, régression, pic de l'évaluation
          // ci-dessus) remises à route_alert, AVANT la livraison du même tick.
          {
            name: "route_error_issue_notifications",
            run: () =>
              appelerFnSiPresente(
                pool,
                "route_error_issue_notifications(integer)",
                "route_error_issue_notifications()",
                "migration-v73",
              ),
          },
          { name: "check_slo_burn", run: fn("check_slo_burn()") },
          { name: "uptime", run: () => sonderUptime(pool, log) },
          // Livraison effective des webhooks en attente (remplace pg_net).
          ...(dispatch ? [{ name: "dispatch_alerts", run: () => dispatch(pool, { echeance }) }] : []),
          // P8.6 : la file de sortie des tickets suit le MÊME tick que l'outbox
          // de notifications, à dessein — un second planificateur aurait sa
          // propre cadence, son propre verrou et ses propres régressions.
          // Chargé à la demande : ce module sort vers l'extérieur.
          {
            name: "dispatch_tickets",
            run: async () => {
              const { livrerTickets } = await import("../lib/integrations/tickets/dispatcher.mjs");
              return livrerTickets(pool, { echeance, log });
            },
          },
          // Réconciliation des livraisons 'sent' héritées de l'ère pg_net :
          // sans pg_net la fonction ne trouve rien, mais elle reste correcte et
          // bon marché — la garder évite des lignes 'sent' éternelles.
          { name: "reconcile_deliveries", run: fn("reconcile_alert_deliveries()") },
        ],
        log,
      );
    },

    /** Toutes les heures : pré-agrégats et détections moins urgentes. */
    horaire: () =>
      executerEtapes(
        [
          { name: "refresh_rum_rollups", run: fn("refresh_rum_rollups(26)") },
          // 26 h comme les rollups, et pour la même raison : une heure en cours
          // est incomplète, et un passage manqué doit être rattrapé au suivant
          // sans double-compter (`on conflict do update`, pas `+=`).
          { name: "refresh_metric_histogram", run: fn("refresh_metric_histogram(26)") },
          { name: "check_new_errors", run: fn("check_new_errors()") },
          { name: "check_ai_op_anomalies", run: fn("check_ai_op_anomalies()") },
          // Notes de triage des groupes historiques devenus alias d'une issue,
          // importées une fois en activité (clé d'événement unique).
          { name: "import_legacy_issue_notes", run: () => importerNotesHistoriques(pool) },
        ],
        log,
      ),

    /**
     * Une fois par jour. `purge_rum_tenants` et non `purge_rum` : la première
     * respecte la rétention PAR CLIENT (app_registry.retention_days), la
     * seconde applique un délai global. `meter_tenant_usage()` porte sur la
     * veille, complète à 03:17 UTC contrairement au jour courant.
     */
    quotidien: () =>
      executerEtapes(
        [
          { name: "purge_rum_tenants", run: fn("purge_rum_tenants(30)") },
          { name: "meter_tenant_usage", run: fn("meter_tenant_usage()") },
        ],
        log,
      ),
  };
}
