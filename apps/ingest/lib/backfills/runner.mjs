// P8.2 — l'exécution d'une reprise : lots courts, curseur atomique, reprise sûre.
//
// ══════════════════ 1. UN LOT = UNE TRANSACTION = UN CURSEUR ═════════════════
//
// Chaque lot ouvre UNE transaction, prend le verrou d'application de P8.1,
// RELIT les sources, écrit, puis avance le curseur — dans cette transaction-là.
// Ce n'est pas une élégance : si le curseur s'écrivait après le commit des
// lignes, une panne entre les deux rejouerait un lot déjà écrit (doublons pour
// tout ce qui n'a pas de clé unique) ; s'il s'écrivait avant, une panne sauterait
// un lot (trou). Atomique, il n'y a ni trou ni doublon — et le test qui tue le
// processus ENTRE l'écriture et le point de reprise le vérifie sur un vrai
// PostgreSQL.
//
// ══════════════ 2. RELECTURE À CHAQUE TRANSACTION, PAS UNE COPIE ═════════════
//
// Les sources sont relues DANS la transaction du lot. Une reprise qui écrirait
// depuis un tableau lu avant un effacement DSAR ressusciterait exactement ce que
// P8.1 vient de supprimer, et annulerait le lot précédent. Le verrou
// d'application garantit en plus qu'aucun effacement ne commit PENDANT la
// lecture-écriture du lot.
//
// ═══════════ 3. UN IDENTIFIANT DE SÉQUENCE N'EST PAS UN ORDRE DE COMMIT ══════
//
// `max(id)` relevé au plan n'est pas un instantané : une transaction ouverte
// avant ce relevé peut commiter APRÈS, avec un identifiant inférieur. Elle
// serait alors invisible au parcours borné, pour toujours. D'où DEUX phases :
//
//   · `fenetre` — parcours borné par les bornes hautes du plan ;
//   · `reconciliation` — second parcours de la MÊME fenêtre temporelle, SANS
//     borne d'identifiant. Il est fait sous le verrou d'application : le tenir
//     signifie qu'aucun writer n'est en cours d'écriture sur cette application,
//     donc que les écritures en vol au moment du plan ont TOUTES été validées et
//     sont visibles. C'est le drain, et c'est la seule preuve qu'on en ait.
//
// ══════════════════════ 4. CE QUI N'ENTRE PAS DANS LES LOGS ══════════════════
//
// Des compteurs et un identifiant d'exécution. Jamais un message, une pile, un
// identifiant de personne, une route, un secret. `error_code` est un code
// technique borné : une erreur PostgreSQL peut citer la valeur d'une ligne.
import { createLogger } from "../../supabase/functions/_shared/log.mjs";
import { withAppIngestTransaction } from "../privacy-barriere.mjs";
import { ErreurBackfill, fusionnerSkips } from "./commun.mjs";
import {
  KINDS,
  empreinteCode,
  empreintePlan,
  empreinteSchema,
} from "./planner.mjs";

const log = createLogger("backfill");

/** États du journal, et les transitions qu'on accepte. */
export const ETATS = Object.freeze(["planned", "running", "paused", "completed", "failed"]);

/** Colonnes rendues par `status`, dans un ordre stable. */
const COLONNES_ETAT = `id, kind, app_id, "from", "to", source_cutoffs_json, plan_sha, code_sha,
  state, checkpoint_json, scanned, written, skipped, failed, started_at, updated_at, ended_at, error_code`;

/**
 * Inscrit un plan au journal, en état `planned`.
 *
 * Le manifeste COMPLET n'est pas persisté : seules les données qui décident du
 * travail le sont (périmètre, bornes, empreintes). Les comptes et les durées
 * vivent dans le fichier de plan, hors base — et de toute façon ils changent à
 * chaque relevé.
 */
export async function inscrirePlan(pool, plan) {
  // FENÊTRE DE DÉPLOIEMENT. Le code part avant que le pré-déploiement
  // n'applique v83. Un dry-run, lui, n'a besoin d'aucune table nouvelle : il se
  // joue AVANT la migration, et c'est une propriété utile — on peut chiffrer un
  // périmètre avant d'avoir touché au schéma. Seule l'inscription exige le
  // journal, et elle le dit au lieu de rendre une erreur PostgreSQL brute.
  const { rows: schema } = await pool.query("select to_regclass('public.backfill_run') is not null as v83");
  if (!schema[0].v83) {
    throw new ErreurBackfill(
      "journal_absent",
      "migration-v83 n'est pas appliquée : le plan est lisible, son exécution non",
    );
  }
  try {
    const { rows } = await pool.query(
      `insert into backfill_run (kind, app_id, "from", "to", source_cutoffs_json, plan_sha, code_sha, state)
       values ($1, $2, $3::timestamptz, $4::timestamptz, $5::jsonb, $6, $7, 'planned')
       returning id`,
      [plan.kind, plan.app, plan.from, plan.to, JSON.stringify(plan.cutoffs), plan.plan_sha, plan.code_sha],
    );
    return rows[0].id;
  } catch (err) {
    if (err?.code === "23505") {
      throw new ErreurBackfill(
        "execution_deja_active",
        `une exécution est déjà vivante pour (${plan.app}, ${plan.kind}, ${plan.from} → ${plan.to}) : `
        + "la terminer, la mettre en échec ou attendre — deux curseurs sur la même fenêtre ne veulent rien dire",
      );
    }
    throw err;
  }
}

/** L'état d'une exécution, tel quel. Aucun payload n'y transite. */
export async function etat(pool, runId) {
  const { rows } = await pool.query(`select ${COLONNES_ETAT} from backfill_run where id = $1`, [runId]);
  if (!rows.length) throw new ErreurBackfill("run_inconnu", `exécution ${runId} introuvable`);
  return rows[0];
}

/**
 * Met une exécution en pause. Coopératif, et c'est voulu : le lot en cours va
 * AU BOUT (sa transaction est courte), puis le runner voit l'état et s'arrête
 * sur un curseur cohérent. Interrompre au milieu d'un lot n'apporterait rien —
 * la transaction serait annulée et le lot rejoué.
 */
export async function mettreEnPause(pool, runId) {
  const { rows } = await pool.query(
    `update backfill_run set state = 'paused', updated_at = now()
      where id = $1 and state in ('planned', 'running') returning state`,
    [runId],
  );
  if (!rows.length) {
    const courant = await etat(pool, runId);
    throw new ErreurBackfill("transition_refusee", `exécution en état « ${courant.state} » : rien à mettre en pause`);
  }
  log.info("pause demandée", { run: runId });
  return rows[0].state;
}

/**
 * Vérifie qu'une reprise rejoue LE MÊME plan avec LE MÊME code.
 *
 * Le plan n'est pas relu d'un fichier : il est RECALCULÉ depuis ce que le
 * journal a retenu (périmètre, bornes) plus les empreintes de code et de schéma
 * relevées maintenant. Si le code des reconstructions a changé, ou si une
 * colonne a été ajoutée entre-temps, l'empreinte diffère et la reprise est
 * refusée — plutôt que de traiter la seconde moitié d'une fenêtre autrement que
 * la première.
 */
export async function verifierEmpreintes(pool, run, { planSha = null } = {}) {
  const kind = KINDS[run.kind];
  const codeSha = empreinteCode();
  const tables = [...new Set([...kind.sources.map((s) => s.table), ...kind.cibles])];
  const schemaSha = await empreinteSchema(pool, tables);
  const recalcule = empreintePlan({
    kind: run.kind,
    app: run.app_id,
    from: isoUtc(run.from),
    to: isoUtc(run.to),
    taille_lot: run.source_cutoffs_json?._taille_lot ?? null,
    cutoffs: run.source_cutoffs_json,
    code_sha: codeSha,
    schema_sha: schemaSha,
  });
  if (codeSha !== run.code_sha) {
    throw new ErreurBackfill(
      "code_modifie",
      "le code des reconstructions a changé depuis le plan : nouveau dry-run explicite, "
      + "pas une reprise à mi-fenêtre",
    );
  }
  if (recalcule !== run.plan_sha) {
    throw new ErreurBackfill(
      "plan_modifie",
      "le plan recalculé ne correspond pas à celui du journal (schéma ou périmètre modifié) : "
      + "nouveau dry-run explicite",
    );
  }
  if (planSha != null && planSha !== run.plan_sha) {
    throw new ErreurBackfill("plan_sha_discordant", "--plan-sha ne correspond pas au plan inscrit au journal");
  }
  return { code_sha: codeSha, schema_sha: schemaSha, plan_sha: recalcule };
}

/** Horodatage rendu par `pg` (un `Date`) ramené à l'ISO UTC du plan. */
function isoUtc(valeur) {
  if (typeof valeur === "string") return valeur;
  // `toISOString` rend la milliseconde ; les bornes de fenêtre sont saisies à la
  // seconde ou à la milliseconde, jamais à la microseconde — et une borne qui en
  // porterait ferait échouer la comparaison d'empreinte, ce qui est le
  // comportement voulu (le périmètre ne serait plus le même).
  return valeur.toISOString().replace(/\.(\d{3})Z$/, (_, ms) => (ms === "000" ? "Z" : `.${ms}Z`));
}

/**
 * Curseur initial d'une exécution : celui du journal, ou le début.
 *
 * `segments` est recalculé par le `kind`, PUR : une reprise doit retrouver
 * exactement la même liste, dans le même ordre, sinon son index ne désigne plus
 * le même segment.
 */
function curseurInitial(run, kind) {
  const segments = kind.segments({ from: isoUtc(run.from), to: isoUtc(run.to) });
  const cp = run.checkpoint_json ?? {};
  return {
    segments,
    phase: cp.phase ?? "fenetre",
    i: Number.isInteger(cp.i) ? cp.i : 0,
    curseur: cp.curseur ?? null,
  };
}

/**
 * Exécute (ou reprend) une reprise jusqu'à son terme, sa pause ou son échec.
 *
 * @param {import('pg').Pool} pool
 * @param {string} runId
 * @param {{ planSha?: string|null, signal?: AbortSignal, maxLots?: number|null,
 *           surLot?: (bilan: object) => void|Promise<void> }} [opts]
 */
export async function executer(pool, runId, opts = {}) {
  const run = await etat(pool, runId);
  // `failed` se reprend : une panne — verrou indisponible, connexion coupée,
  // disque plein — n'invalide pas le travail déjà fait. Le point de reprise est
  // atomique, donc le curseur d'une exécution en échec désigne un état
  // cohérent, et les empreintes de plan et de code restent exigées. Ce qui ne
  // se reprend pas, c'est une exécution TERMINÉE (il n'y a rien à reprendre) ou
  // une exécution QUI TOURNE (deux curseurs sur la même fenêtre).
  if (!["planned", "paused", "failed"].includes(run.state)) {
    throw new ErreurBackfill(
      "transition_refusee",
      `exécution en état « ${run.state} » : seules « planned », « paused » et « failed » se (re)prennent`,
    );
  }
  const kind = KINDS[run.kind];
  if (!kind) throw new ErreurBackfill("kind_inconnu", `kind « ${run.kind} » inconnu`);
  await verifierEmpreintes(pool, run, { planSha: opts.planSha ?? null });

  try {
    await pool.query(
      `update backfill_run set state = 'running', started_at = coalesce(started_at, now()),
                               updated_at = now(), error_code = null
        where id = $1`,
      [runId],
    );
  } catch (err) {
    // `backfill_run_un_travailleur_v83` : un travailleur tourne déjà sur cette
    // application. Le refus vient de la BASE, pas d'une convention de code que
    // deux processus lancés à une seconde d'intervalle ne verraient pas.
    if (err?.code === "23505") {
      throw new ErreurBackfill(
        "travailleur_deja_actif",
        `une autre reprise tourne déjà sur l'application « ${run.app_id} » : un seul travailleur par application`,
      );
    }
    throw err;
  }
  log.info("reprise démarrée", { run: runId, kind: run.kind, app: run.app_id });

  let { segments, phase, i, curseur } = curseurInitial(run, kind);
  const taille = run.source_cutoffs_json?._taille_lot ?? 1_000;
  const plan = {
    kind: run.kind,
    app: run.app_id,
    from: isoUtc(run.from),
    to: isoUtc(run.to),
    taille_lot: taille,
    cutoffs: run.source_cutoffs_json,
    retention_jours: run.source_cutoffs_json?._retention_jours ?? 30,
  };
  // Les compteurs du journal sont des TOTAUX : ils additionnent les deux
  // passes, parce que « lignes examinées » veut dire ce qu'il dit. Le bilan
  // rendu, lui, sépare les phases — sans quoi une ligne au span invalide,
  // revue par la réconciliation, apparaîtrait deux fois sans qu'on sache
  // pourquoi.
  const cumul = {
    scanned: 0, written: 0, skips: {}, failed: 0, lots: 0,
    par_phase: { fenetre: { scanned: 0, written: 0, skips: {} }, reconciliation: { scanned: 0, written: 0, skips: {} } },
  };
  let arret = null;

  try {
    while (true) {
      if (opts.signal?.aborted) {
        arret = "signal";
        break;
      }
      if (opts.maxLots != null && cumul.lots >= opts.maxLots) {
        arret = "max_lots";
        break;
      }
      // La pause est lue ENTRE deux lots, jamais au milieu : une transaction
      // interrompue serait annulée et le lot rejoué — la pause ne gagnerait rien
      // et le journal perdrait un lot de compteurs.
      const { rows: vivant } = await pool.query("select state from backfill_run where id = $1", [runId]);
      if (vivant[0]?.state === "paused") {
        arret = "pause";
        break;
      }

      const segment = segments[i];
      // Préparation HORS transaction et hors verrou (symbolication, lectures
      // lourdes). Elle ne fait que lire ; ce qu'elle rapporte est réassocié par
      // identifiant, jamais par position.
      const contexte = kind.preparer ? await kind.preparer(pool, { ...plan, phase }, segment, curseur, taille) : null;

      const bilan = await withAppIngestTransaction(pool, plan.app, async (client) => {
        const lot = await kind.lire(client, { ...plan, phase }, segment, curseur, taille, contexte);
        const ecrit = await kind.ecrire(client, { ...plan, phase }, segment, lot.lignes, { ...contexte, ...lot });
        // LE POINT DE REPRISE, DANS LA MÊME TRANSACTION QUE LES ÉCRITURES.
        const suivant = lot.fini
          ? avancer({ segments, phase, i, curseur })
          : { phase, i, curseur: lot.curseur };
        await client.query(
          `update backfill_run
              set checkpoint_json = $2::jsonb, scanned = scanned + $3, written = written + $4,
                  skipped = skipped + $5, updated_at = now()
            where id = $1`,
          [
            runId,
            JSON.stringify({ phase: suivant.phase, i: suivant.i, curseur: suivant.curseur, segments: segments.map((s) => s.nom) }),
            lot.scanned,
            ecrit.written,
            totalDe(lot.skips) + totalDe(ecrit.skips),
          ],
        );
        return { lot, ecrit, suivant, termine: suivant.termine === true };
      });

      cumul.lots += 1;
      cumul.scanned += bilan.lot.scanned;
      cumul.written += bilan.ecrit.written;
      fusionnerSkips(cumul.skips, bilan.lot.skips);
      fusionnerSkips(cumul.skips, bilan.ecrit.skips);
      const vue = cumul.par_phase[phase];
      vue.scanned += bilan.lot.scanned;
      vue.written += bilan.ecrit.written;
      fusionnerSkips(vue.skips, bilan.lot.skips);
      fusionnerSkips(vue.skips, bilan.ecrit.skips);
      if (opts.surLot) await opts.surLot({ ...bilan, cumul });
      ({ phase, i, curseur } = bilan.suivant);
      if (bilan.termine) {
        arret = "termine";
        break;
      }
    }
  } catch (err) {
    const code = codeErreur(err);
    await pool.query(
      `update backfill_run set state = 'failed', error_code = $2, ended_at = now(), updated_at = now(),
                               failed = failed + 1
        where id = $1`,
      [runId, code],
    );
    // Le message n'entre PAS au journal ni dans le log : il peut citer la valeur
    // d'une ligne, donc une donnée de personne. Le code suffit à diagnostiquer.
    log.error("reprise en échec", { run: runId, code, lots: cumul.lots });
    throw err instanceof ErreurBackfill ? err : new ErreurBackfill(code, `échec du lot ${cumul.lots + 1}`);
  }

  if (arret === "termine") {
    await pool.query(
      "update backfill_run set state = 'completed', ended_at = now(), updated_at = now() where id = $1",
      [runId],
    );
  } else {
    await pool.query(
      "update backfill_run set state = 'paused', updated_at = now() where id = $1 and state <> 'paused'",
      [runId],
    );
  }
  log.info("reprise arrêtée", {
    run: runId, raison: arret, lots: cumul.lots,
    scanned: cumul.scanned, written: cumul.written, failed: cumul.failed,
  });
  return { arret, ...cumul, etat: (await etat(pool, runId)).state };
}

/**
 * Avance d'un segment, puis d'une phase.
 *
 * L'ordre est : tous les segments en phase `fenetre`, puis tous les segments en
 * phase `reconciliation`. La réconciliation n'est PAS facultative : sans elle,
 * une ligne validée après le relevé des bornes resterait invisible pour
 * toujours.
 */
export function avancer({ segments, phase, i }) {
  if (i + 1 < segments.length) return { phase, i: i + 1, curseur: null };
  if (phase === "fenetre") return { phase: "reconciliation", i: 0, curseur: null };
  return { phase, i, curseur: null, termine: true };
}

const totalDe = (skips) => Object.values(skips ?? {}).reduce((a, b) => a + b, 0);

/**
 * Code d'échec borné, dérivé d'une erreur quelconque.
 *
 * Un SQLSTATE est déjà un code ; une `ErreurBackfill` porte le sien. Tout le
 * reste devient `erreur_inattendue` : recopier un message PostgreSQL dans une
 * colonne de journal ferait entrer une valeur de ligne dans un objet
 * app-scopé que des lecteurs voient.
 */
export function codeErreur(err) {
  if (err instanceof ErreurBackfill) return err.code;
  if (typeof err?.code === "string" && /^[A-Za-z0-9]{5}$/.test(err.code)) return `sqlstate_${err.code.toLowerCase()}`;
  if (err?.name === "ErreurVerrouIngestion") return "verrou_ingestion_indisponible";
  if (err?.name === "ErreurPorteeApp") return "portee_app";
  return "erreur_inattendue";
}

/**
 * `verify` — INDÉPENDANT du runner.
 *
 * Il ne lit ni le curseur, ni les compteurs de l'exécution : il repose la
 * question aux tables, par anti-jointures app-scopées, sommes et contrôles
 * source contre projection. Un runner qui se tromperait de compte ne peut pas se
 * vérifier lui-même — c'est tout l'intérêt.
 */
export async function verifier(pool, runId) {
  const run = await etat(pool, runId);
  const kind = KINDS[run.kind];
  if (!kind) throw new ErreurBackfill("kind_inconnu", `kind « ${run.kind} » inconnu`);
  const plan = { kind: run.kind, app: run.app_id, from: isoUtc(run.from), to: isoUtc(run.to) };
  const rapport = await kind.verifier(pool, plan);
  return {
    run: run.id,
    kind: run.kind,
    app: run.app_id,
    from: plan.from,
    to: plan.to,
    etat: run.state,
    compteurs_du_runner: {
      scanned: Number(run.scanned), written: Number(run.written),
      skipped: Number(run.skipped), failed: Number(run.failed),
    },
    verification: rapport,
    independance:
      "Cette vérification n'a lu ni le curseur ni les compteurs ci-dessus : elle interroge les "
      + "tables. Les deux colonnes sont rendues côte à côte pour être comparées, pas pour se "
      + "confirmer l'une l'autre.",
  };
}
