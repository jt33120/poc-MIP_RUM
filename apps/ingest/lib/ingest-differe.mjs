// L'ingestion DIFFÉRÉE : débarquer le lot, drainer plus tard.
//
// Finding 2.9 de docs/AUDIT_RUM_EXTERNE.md. Le receveur écrit une ligne dans
// `ingest_raw` (UNLOGGED) et rend la main ; ce travailleur écrit les tables
// finales. Le lot est stocké DÉJÀ APLATI : le contrôle de clé d'API et le
// rate-limit restent dans le chemin de la requête, où ils doivent être — une
// file d'attente derrière une porte ouverte ne serait pas un découplage, ce
// serait un amplificateur.
//
// LE MODE EST OPTIONNEL, ET PAR DÉFAUT ÉTEINT. La table est UNLOGGED : un lot
// acquitté mais non drainé disparaît si PostgreSQL redémarre brutalement. Ce
// compromis se choisit, il ne se subit pas — cf. migration-v63.
import { writeRows } from "./pg-ingest.mjs";
import { buildEventIndex } from "../supabase/functions/_shared/otlp.mjs";

/** Au-delà, un lot cesse d'être repris et garde son erreur. */
export const MAX_TENTATIVES = 5;

/** Écrit le lot aplati dans la table de débarquement. Une insertion, un aller. */
export async function deposerLot(pool, appId, rows) {
  await pool.query("insert into ingest_raw (app_id, lot) values ($1, $2::jsonb)", [
    appId,
    JSON.stringify(rows),
  ]);
}

/**
 * Vide les tableaux absents d'un lot relu depuis jsonb.
 *
 * `writeRows` déstructure douze collections ; une seule absente (un lot d'avant
 * l'ajout d'un signal, par exemple) ferait échouer le drain avec un « undefined
 * n'est pas itérable » qui ne dit rien de la cause.
 */
function completer(lot) {
  const vide = [];
  return {
    sessions: lot.sessions ?? vide,
    pageviews: lot.pageviews ?? vide,
    metrics: lot.metrics ?? vide,
    errors: lot.errors ?? vide,
    resources: lot.resources ?? vide,
    longtasks: lot.longtasks ?? vide,
    breadcrumbs: lot.breadcrumbs ?? vide,
    events: lot.events ?? vide,
    actions: lot.actions ?? vide,
    spans: lot.spans ?? vide,
    // Les lots déjà déposés avant v65 ne portent pas la projection. Ils
    // contiennent néanmoins les collections normalisées : la reconstruire ici
    // est sûre, et évite de réserver la nouvelle API aux seuls lots récents.
    eventIndex: lot.eventIndex ?? buildEventIndex(lot),
    sviCalls: lot.sviCalls ?? vide,
    sviSteps: lot.sviSteps ?? vide,
    sviLegs: lot.sviLegs ?? vide,
    // P7.5 : sans cette ligne, `completer` reconstruit un lot SANS ses capacités
    // déclarées, et le chemin différé les perdrait en silence — l'écran /mobile
    // afficherait « Inconnu » pour une application qui déclare bien les siennes.
    capabilities: lot.capabilities ?? vide,
  };
}

/**
 * Draine jusqu'à `max` lots.
 *
 * `for update skip locked` : deux travailleurs peuvent drainer en parallèle sans
 * traiter deux fois le même lot ni s'attendre l'un l'autre.
 *
 * UN LOT EN ÉCHEC NE BLOQUE PAS LA FILE. Son compteur de tentatives monte et il
 * est relâché ; les suivants passent. Au-delà de MAX_TENTATIVES il est laissé en
 * place avec son erreur, visible plutôt que rejoué sans fin — une file qui
 * rejoue indéfiniment un lot empoisonné n'avance plus, et le silence ressemble à
 * du travail.
 *
 * @returns {Promise<{drains: number, echecs: number}>}
 */
export async function drainerIngestRaw(pool, { max = 100, log = console } = {}) {
  let drains = 0;
  let echecs = 0;

  for (;;) {
    const client = await pool.connect();
    let ligne = null;
    try {
      await client.query("begin");
      const { rows } = await client.query(
        // `reprendre_a <= now()` : un lot qui vient d'échouer SORT de la file
        // le temps de son recul. Sans ce filtre, une même passe de drain
        // réessaie le lot empoisonné cinq fois de suite — les cinq tentatives
        // sont brûlées en quelques millisecondes, et une coupure d'une seconde
        // devient une perte définitive. C'est un test qui l'a montré, pas une
        // relecture.
        `select id, app_id, lot, tentatives from ingest_raw
          where tentatives < $1 and reprendre_a <= now()
          order by id limit 1 for update skip locked`,
        [MAX_TENTATIVES],
      );
      ligne = rows[0] ?? null;
      if (!ligne) {
        await client.query("commit");
        break;
      }
      try {
        await writeRows(pool, completer(ligne.lot));
        await client.query("delete from ingest_raw where id = $1", [ligne.id]);
        drains++;
      } catch (err) {
        // L'échec est enregistré DANS la même transaction que le verrou : sans
        // ça, deux travailleurs se repasseraient le lot sans jamais compter.
        // Recul exponentiel : 1, 2, 4, 8, 16 secondes. Même esprit que la file
        // de rejeu du SDK (packages/rum-sdk/src/retry.ts) — un réessai immédiat
        // n'est pas un réessai, c'est une boucle.
        await client.query(
          `update ingest_raw
              set tentatives = tentatives + 1,
                  erreur = $2,
                  reprendre_a = now() + make_interval(secs => power(2, tentatives)::int)
            where id = $1`,
          [ligne.id, String(err?.message ?? err).slice(0, 500)],
        );
        echecs++;
        log.error?.("drain en échec", { id: ligne.id, tentatives: ligne.tentatives + 1, err: String(err?.message ?? err) });
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      log.error?.("drain interrompu", { err: String(err?.message ?? err) });
      break;
    } finally {
      client.release();
    }
    if (drains + echecs >= max) break;
  }
  return { drains, echecs };
}

/** Ce qui attend, et ce qui est bloqué. Pour /admin/health et /api/metrics. */
export async function etatIngestRaw(pool) {
  const { rows } = await pool.query(
    `select count(*) filter (where tentatives < $1)::int as en_attente,
            count(*) filter (where tentatives >= $1)::int as bloques,
            coalesce(extract(epoch from (now() - min(recu_at) filter (where tentatives < $1))), 0)::float as age_max_s
       from ingest_raw`,
    [MAX_TENTATIVES],
  );
  return rows[0];
}
