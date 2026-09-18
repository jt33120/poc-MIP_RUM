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
//
// ════════════════ CE QUE P8.1 A CHANGÉ ICI, ET POURQUOI ═════════════════════
//
// Le drain tenait un verrou de ligne de file sur SA connexion, puis appelait
// `writeRows(pool, …)` — qui ouvrait sa PROPRE transaction sur une AUTRE
// connexion. Les tables finales étaient donc écrites hors de la transaction qui
// protégeait la file : un effacement concurrent pouvait supprimer les lignes
// entre les deux, et le drain les recréait sans que rien ne le signale.
//
// Désormais : verrou d'APPLICATION d'abord, file ensuite, écriture par LE MÊME
// client, retrait du lot dans la même transaction. L'ordre des verrous n'est pas
// négociable — l'effacement prend l'app puis la file, et l'inverse ici
// produirait un interblocage.
//
// UN LOT EST SCINDÉ PAR APPLICATION AU DÉPÔT. Sans cela, une ligne de file
// portant l'app A pouvait contenir des collections de B : le drain aurait
// verrouillé A et écrit dans B, c'est-à-dire écrit sans verrou. Le découpage se
// fait sur les applications DÉJÀ authentifiées par le receveur, jamais sur un
// `app_id` que le seul client prétend.
import { appsDuLot, filtrerParBarrieres, withAppIngestTransaction } from "./privacy-barriere.mjs";
import { writeRows } from "./pg-ingest.mjs";
import { buildEventIndex } from "../supabase/functions/_shared/otlp.mjs";

/** Au-delà, un lot cesse d'être repris et garde son erreur. */
export const MAX_TENTATIVES = 5;

/** Collections de TÉLÉMÉTRIE d'un lot — `apiKeys` et `rejected` n'en sont pas. */
const COLLECTIONS = [
  "sessions", "pageviews", "metrics", "errors", "resources", "longtasks",
  "breadcrumbs", "events", "actions", "spans", "eventIndex",
  "sviCalls", "sviSteps", "sviLegs",
];

/** Le lot porte-t-il encore quelque chose à écrire ? */
function porteDeLaTelemetrie(lot) {
  return COLLECTIONS.some((cle) => Array.isArray(lot?.[cle]) && lot[cle].length > 0);
}

/**
 * Scinde un lot aplati en un sous-lot par application.
 *
 * Les clés hors collections (`rejected`, par exemple) sont recopiées telles
 * quelles : ce sont des compteurs de parsing, pas de la donnée d'une personne.
 */
export function scinderParApp(rows, appParDefaut) {
  const apps = appsDuLot(rows);
  if (apps.length <= 1) return [[apps[0] ?? appParDefaut, rows]];
  return apps.map((app) => {
    const sousLot = {};
    for (const [nom, valeur] of Object.entries(rows)) {
      sousLot[nom] = Array.isArray(valeur)
        ? valeur.filter((l) => l?.app_id === app)
        : valeur;
    }
    return [app, sousLot];
  });
}

/**
 * Écrit le lot aplati dans la table de débarquement, SOUS LE VERROU DE SON APP
 * et après filtrage par les barrières.
 *
 * On ne dépose pas un lot interdit en espérant que le drain fera le ménage : le
 * lot resterait lisible dans `ingest_raw` — une table de production —, et un
 * drain d'une version antérieure l'écrirait tel quel.
 *
 * @returns {Promise<{deposes: number, refuses: number}>}
 */
export async function deposerLot(pool, appId, rows) {
  let deposes = 0;
  let refuses = 0;
  for (const [app, sousLot] of scinderParApp(rows, appId)) {
    await withAppIngestTransaction(pool, app, async (client) => {
      const filtre = await filtrerParBarrieres(client, sousLot);
      refuses += filtre.total;
      // Rien de refusé, ou rien à refuser : on dépose comme avant. Refusé en
      // entier : on ne dépose pas. Refusé en partie : on dépose le reste — un
      // lot qui porte deux personnes ne doit pas emporter celle qui n'a rien
      // demandé.
      if (filtre.total > 0 && !porteDeLaTelemetrie(filtre.rows)) return;
      await client.query("insert into ingest_raw (app_id, lot) values ($1, $2::jsonb)", [
        app,
        JSON.stringify(filtre.rows),
      ]);
      deposes++;
    });
  }
  return { deposes, refuses };
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
 * Pré-relève UN candidat, SANS aucun verrou.
 *
 * C'est ce pré-relevé qui rend possible l'ordre « app d'abord, file ensuite » :
 * on ne peut pas savoir quelle application verrouiller avant d'avoir vu une
 * ligne, et on ne peut pas verrouiller la ligne avant l'application. On lit donc
 * sans verrou, puis on revérifie l'éligibilité SOUS le verrou — le candidat peut
 * avoir disparu entre-temps, et c'est un cas normal, pas une erreur.
 */
async function lireCandidat(pool, ignores) {
  // Hors transaction, donc hors verrou : la connexion est prise et rendue
  // immédiatement. C'est une lecture d'orientation, pas une réservation.
  const client = await pool.connect();
  try {
    const { rows } = await client.query(
      `select id, app_id from ingest_raw
        where tentatives < $1 and reprendre_a <= now()
          and ($2::bigint[] is null or id <> all($2::bigint[]))
        order by id limit 1`,
      [MAX_TENTATIVES, ignores.size ? [...ignores] : null],
    );
    return rows[0] ?? null;
  } finally {
    client.release();
  }
}

/**
 * Traite UN candidat : verrou d'app → reprise de CETTE ligne en
 * `for update skip locked` → barrières → écriture par le même client → retrait.
 *
 * SAVEPOINT. Une transaction PostgreSQL en échec refuse tout ordre suivant, y
 * compris un simple UPDATE de compteur : l'ancien code écrivait le compteur
 * d'échec dans la transaction que l'erreur venait d'avorter, et cet UPDATE
 * échouait à son tour (25P02). Le compteur ne montait donc jamais, et le lot
 * empoisonné revenait indéfiniment. Le point de reprise rend la transaction
 * utilisable après l'échec, sans relâcher le verrou d'application — qui a été
 * pris AVANT lui, et survit donc au retour arrière partiel.
 *
 * @returns {Promise<"drain"|"echec"|"absent">}
 */
async function traiterCandidat(pool, candidat, log) {
  return withAppIngestTransaction(pool, candidat.app_id, async (client) => {
    const { rows } = await client.query(
      // Revérification d'éligibilité SOUS le verrou : entre le pré-relevé et
      // ici, un effacement a pu retirer le lot, un autre travailleur a pu le
      // drainer, ou son recul a pu être repoussé.
      `select id, app_id, lot, tentatives from ingest_raw
        where id = $1 and tentatives < $2 and reprendre_a <= now()
        for update skip locked`,
      [candidat.id, MAX_TENTATIVES],
    );
    const ligne = rows[0];
    if (!ligne) return "absent";

    await client.query("savepoint avant_ecriture");
    try {
      const filtre = await filtrerParBarrieres(client, completer(ligne.lot));
      // MÊME CLIENT, donc même transaction et même verrou : l'écriture des
      // tables finales et le retrait du lot sont indissociables. Un arrêt brutal
      // entre les deux annule les DEUX, et la reprise rejoue un lot intact.
      await writeRows(pool, filtre.rows, { client });
      await client.query("delete from ingest_raw where id = $1", [ligne.id]);
      return "drain";
    } catch (err) {
      // Recul exponentiel : 1, 2, 4, 8, 16 secondes. Même esprit que la file de
      // rejeu du SDK (packages/rum-sdk/src/retry.ts) — un réessai immédiat n'est
      // pas un réessai, c'est une boucle.
      await client.query("rollback to savepoint avant_ecriture");
      await client.query(
        `update ingest_raw
            set tentatives = tentatives + 1,
                erreur = $2,
                reprendre_a = now() + make_interval(secs => power(2, tentatives)::int)
          where id = $1`,
        [ligne.id, String(err?.message ?? err).slice(0, 500)],
      );
      log.error?.("drain en échec", {
        id: ligne.id,
        tentatives: ligne.tentatives + 1,
        err: String(err?.message ?? err),
      });
      return "echec";
    }
  });
}

/**
 * Draine jusqu'à `max` lots.
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
  // Candidats qu'un autre travailleur tient déjà, ou qui ont disparu sous le
  // verrou : on passe au suivant au lieu de boucler sur le même identifiant.
  const ignores = new Set();

  for (;;) {
    let candidat;
    try {
      candidat = await lireCandidat(pool, ignores);
    } catch (err) {
      log.error?.("drain interrompu", { err: String(err?.message ?? err) });
      break;
    }
    if (!candidat) break;

    let issue;
    try {
      issue = await traiterCandidat(pool, candidat, log);
    } catch (err) {
      // Échec de la transaction elle-même (verrou indisponible, connexion
      // coupée) : rien n'a été écrit, le lot reste en file, on s'arrête.
      log.error?.("drain interrompu", { err: String(err?.message ?? err) });
      break;
    }
    if (issue === "absent") {
      ignores.add(candidat.id);
      continue;
    }
    if (issue === "drain") drains++;
    else echecs++;
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
