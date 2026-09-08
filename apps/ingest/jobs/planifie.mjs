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
 * Sonde les checks actifs et enregistre le résultat.
 *
 * `record_uptime_result` gère l'alerte sur bascule UP -> DOWN : rien de cette
 * logique ne vit ici. On juge le statut FINAL (redirections suivies), et on
 * draine le corps même inutilisé — sans ça les sockets fuient, et un service
 * long finit par ne plus pouvoir sonder du tout.
 */
export async function sonderUptime(pool, log = console) {
  const { rows: checks } = await pool.query(
    "select id, url, method, expect_status, timeout_ms from uptime_check where enabled",
  );

  let lances = 0;
  let tombes = 0;
  await Promise.all(
    checks.map(async (c) => {
      const debut = Date.now();
      let ok = false;
      let statut = null;
      let erreur = null;
      try {
        const res = await fetch(c.url, {
          method: c.method ?? "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(c.timeout_ms ?? 10_000),
        });
        await res.arrayBuffer().catch(() => {});
        statut = res.status;
        ok = res.status === (c.expect_status ?? 200);
        if (!ok) erreur = `HTTP ${res.status}`;
      } catch (e) {
        erreur = String(e?.message ?? e).slice(0, 200);
      }
      lances++;
      if (!ok) tombes++;
      await pool
        .query("select record_uptime_result($1, $2, $3, $4, $5)", [
          c.id,
          ok,
          statut,
          Date.now() - debut,
          erreur,
        ])
        .catch((err) => log.error?.("record_uptime_result failed", { check_id: c.id, err: String(err) }));
    }),
  );
  return { ran: lances, down: tombes };
}

/**
 * Les trois cadences. `dispatch` est injecté plutôt qu'importé : le dispatcher
 * de webhooks est le seul morceau qui sort vers l'extérieur, et un appelant
 * (un test, un environnement sans réseau sortant) doit pouvoir le neutraliser.
 */
export function travaux(pool, { log = console, dispatch = null } = {}) {
  const fn = (nom) => () => appelerFn(pool, nom);

  return {
    /** Toutes les 5 minutes : ce qui doit réagir vite. */
    tick: () =>
      executerEtapes(
        [
          // Évaluation des règles : insère les alert_event + livraisons 'queued'.
          { name: "check_alerts", run: fn("check_alerts()") },
          { name: "check_slo_burn", run: fn("check_slo_burn()") },
          { name: "uptime", run: () => sonderUptime(pool, log) },
          // Livraison effective des webhooks en attente (remplace pg_net).
          ...(dispatch ? [{ name: "dispatch_alerts", run: () => dispatch(pool) }] : []),
          // Réconciliation des livraisons 'sent' héritées de l'ère pg_net :
          // sans pg_net la fonction ne trouve rien, mais elle reste correcte et
          // bon marché — la garder évite des lignes 'sent' éternelles.
          { name: "reconcile_deliveries", run: fn("reconcile_alert_deliveries()") },
        ],
        log,
      ),

    /** Toutes les heures : pré-agrégats et détections moins urgentes. */
    horaire: () =>
      executerEtapes(
        [
          { name: "refresh_rum_rollups", run: fn("refresh_rum_rollups(26)") },
          { name: "check_new_errors", run: fn("check_new_errors()") },
          { name: "check_ai_op_anomalies", run: fn("check_ai_op_anomalies()") },
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
