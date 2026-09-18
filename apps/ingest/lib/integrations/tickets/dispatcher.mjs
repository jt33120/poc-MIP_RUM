// File de sortie des tickets (P8.6) : ce qui prend une demande en base et la
// transforme en ticket chez le fournisseur, ou en refus qualifié.
//
// POURQUOI UNE OUTBOX ET PAS UN APPEL DANS LA REQUÊTE HTTP. Un `POST` de console
// qui appellerait GitHub en ligne rendrait 502 quand GitHub est lent, perdrait la
// demande quand la fonction serverless est coupée à 10 s, et ne saurait pas
// rejouer. La demande est donc écrite en base dans la transaction de la console
// (202 + identifiant de travail), et livrée ici. C'est le MÊME mécanisme que
// l'outbox de notifications de P5.6 — état, tentatives, `next_attempt_at`,
// réservation par `for update skip locked`, étape du tick planifié — et
// délibérément pas un second planificateur : deux boucles de livraison
// divergeraient, et la seconde n'aurait pas les dix ans de cicatrices de la
// première (pooler, verrous de session, passes concurrentes, échéance).
//
// LE CAS QUI COMMANDE TOUT LE RESTE : un délai dépassé APRÈS l'envoi et AVANT
// l'accusé. Le ticket existe peut-être. Rejouer crée un doublon chez le client ;
// abandonner perd la demande. On marque donc la ligne « incertaine » AVANT
// l'appel, on cherche le ticket par sa référence MIP avant tout nouvel envoi, et
// si cette recherche n'est pas concluante on s'arrête en `delivery_uncertain` :
// un opérateur tranche. AUCUN chemin de ce fichier ne recrée un ticket après une
// incertitude.
//
// CE QUE LA LIVRAISON NE FAIT JAMAIS : bloquer la collecte RUM. Un jeton révoqué
// met l'intégration en `degraded` et laisse les lignes en file ; l'ingestion, la
// console et les alertes n'en savent rien.
import {
  CODES,
  ErreurTicket,
  construireCharge,
  mappingStatut,
  prochaineTentative,
  statutPropose,
  STRATEGIE,
} from "./adapter.mjs";
import { adaptateur as github } from "./github.mjs";
import { ErreurSecret, resoudre } from "./secrets.mjs";
import { referenceResolution } from "../../error-issue-workflow.mjs";

/** Registre des adaptateurs. Y ajouter une entrée est un choix de produit, pas un détail. */
const ADAPTATEURS = { github };

/** L'adaptateur d'un fournisseur, ou `null` si personne ne l'implémente. */
export function adaptateurDe(provider) {
  return Object.hasOwn(ADAPTATEURS, provider) ? ADAPTATEURS[provider] : null;
}

/** Lignes réservées par passe, et budget de temps (route cron : une minute). */
const LOT = Number(process.env.TICKETS_DISPATCH_BATCH || 10);
const BUDGET_MS = Number(process.env.TICKETS_DISPATCH_BUDGET_MS || 40_000);
const TIMEOUT_MS = Number(process.env.TICKETS_DISPATCH_TIMEOUT_MS || 10_000);

const SELECTION = `
  select o.id, o.app_id, o.issue_id, o.integration_id, o.payload, o.attempts, o.uncertain,
         o.created_at, o.requested_by_user_id,
         i.provider, i.target, i.credential_ref, i.config
    from ticket_outbox o
    join ticket_integration i on i.id = o.integration_id
   where o.state = 'pending' and o.next_attempt_at <= now()
     and i.enabled and i.state = 'active'
   order by o.next_attempt_at, o.id
   limit 1
   for update of o skip locked`;

/** Le schéma P8.6 est-il en place ? Sondé à chaque passe, comme les autres étapes. */
export async function schemaPresent(pool) {
  const { rows } = await pool.query("select to_regclass('public.ticket_outbox') is not null as v84");
  return rows[0]?.v84 === true;
}

/**
 * Réserve UNE ligne et arme d'avance sa prochaine tentative.
 *
 * L'incrément de tentative et le recul sont écrits AVANT l'appel réseau, et
 * validés : si le processus meurt pendant l'appel, la ligne revient d'elle-même
 * après le recul, avec `uncertain` déjà posé. Armer après coup laisserait une
 * ligne rejouée en boucle par la passe suivante.
 */
async function reserver(pool, maintenant) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows } = await client.query(SELECTION);
    const ligne = rows[0];
    if (!ligne) {
      await client.query("rollback");
      return null;
    }
    const tentatives = ligne.attempts + 1;
    await client.query(
      `update ticket_outbox
          set attempts = $2, uncertain = true, next_attempt_at = $3, updated_at = now()
        where id = $1`,
      [ligne.id, tentatives, new Date(prochaineTentative(tentatives, { maintenant }))],
    );
    await client.query("commit");
    return { ...ligne, attempts: tentatives };
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Fin de vie d'une ligne, hors succès. */
async function marquer(pool, id, { state, code, attendreSec = null, tentatives, maintenant }) {
  await pool.query(
    `update ticket_outbox
        set state = $2, last_error = $3, uncertain = $4,
            next_attempt_at = $5, updated_at = now()
      where id = $1`,
    [
      id,
      state,
      code,
      state === "delivery_uncertain",
      state === "pending" ? new Date(prochaineTentative(tentatives, { attendreSec, maintenant })) : new Date(maintenant),
    ],
  );
}

/**
 * Succès : la ligne, le lien de ticket P5 enrichi, l'activité de l'issue et la
 * révision, dans UNE transaction. Un lien sans activité ferait disparaître le
 * ticket de l'historique ; une activité sans lien pointerait dans le vide.
 *
 * Le lien réutilise `error_issue_ticket` — la table du lien MANUEL de P5.6 — au
 * lieu d'une seconde table de liens « automatiques ». L'écran d'issue n'a donc
 * qu'une liste de tickets, et un lien collé à la main continue d'y vivre.
 */
async function reussir(pool, ligne, ticket) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update ticket_outbox
          set state = 'sent', external_id = $2, external_url = $3, sent_at = now(),
              uncertain = false, last_error = null, updated_at = now()
        where id = $1`,
      [ligne.id, ticket.externalId, ticket.url],
    );
    const libelle = `${ligne.provider === "github" ? "GitHub" : ligne.provider} #${ticket.externalId}`;
    const { rows: [lien] } = await client.query(
      `insert into error_issue_ticket
         (app_id, issue_id, url, label, created_by_user_id, provider, external_id, integration_id,
          origin, provider_state, provider_synced_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, 'connector', $9, now())
       on conflict (app_id, issue_id, url) do nothing
       returning id::text as id`,
      [
        ligne.app_id, ligne.issue_id, ticket.url, libelle, ligne.requested_by_user_id,
        ligne.provider, ticket.externalId, ligne.integration_id, ticket.etat,
      ],
    );
    if (lien) {
      await client.query(
        `insert into error_issue_activity
           (app_id, issue_id, kind, actor_kind, actor_user_id, ticket_id, event_key)
         values ($1, $2, 'link', $3, $4, $5, $6)
         on conflict (app_id, issue_id, event_key) where event_key is not null do nothing`,
        [
          ligne.app_id, ligne.issue_id,
          ligne.requested_by_user_id ? "user" : "system",
          ligne.requested_by_user_id, lien.id,
          `ticket_cree:${ligne.integration_id}:${ticket.externalId}`,
        ],
      );
      await client.query(
        "update error_issue set revision = revision + 1, updated_at = now() where app_id = $1 and id = $2",
        [ligne.app_id, ligne.issue_id],
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Passe l'intégration en `degraded`. La collecte RUM, elle, ne change pas d'un iota. */
async function degrader(pool, integrationId, code) {
  await pool.query(
    "update ticket_integration set state = 'degraded', last_error = $2, updated_at = now() where id = $1",
    [integrationId, code],
  );
}

/**
 * Livre UNE ligne déjà réservée. Rend le bilan de la ligne ; ne lève que sur une
 * panne de base (l'appelant l'attrape et arrête la passe).
 */
async function livrerUne(pool, ligne, { fetchImpl, env, maintenant, timeoutMs }) {
  // UN DÉLAI PAR APPEL, pas un pour la ligne entière. Un seul signal partagé
  // serait déjà expiré au moment de chercher le ticket après un envoi trop long
  // — et la recherche qui doit empêcher le doublon n'aurait jamais lieu.
  const minuteur = () => AbortSignal.timeout(timeoutMs);
  const adaptateur = adaptateurDe(ligne.provider);
  if (!adaptateur) {
    await marquer(pool, ligne.id, { state: "failed", code: "fournisseur_inconnu", tentatives: ligne.attempts, maintenant });
    return { id: ligne.id, etat: "failed", code: "fournisseur_inconnu" };
  }

  let secret;
  try {
    secret = resoudre(ligne.credential_ref, env);
  } catch (err) {
    const code = err instanceof ErreurSecret ? err.code : "secret_indisponible";
    // Un secret introuvable n'est pas un échec de charge : l'intégration est
    // cassée, pas la demande. On dégrade, la ligne reste rejouable après
    // correction, et rien d'autre ne s'arrête.
    await degrader(pool, ligne.integration_id, code);
    await marquer(pool, ligne.id, { state: "pending", code, tentatives: ligne.attempts, maintenant });
    return { id: ligne.id, etat: "pending", code };
  }

  const commun = { cible: ligne.target, secret, fetchImpl };
  const reference = ligne.payload?.reference;

  // 1. Une tentative précédente a pu créer le ticket : on cherche AVANT d'envoyer.
  if (ligne.attempts > 1 && ligne.uncertain) {
    const trouvaille = await adaptateur.chercherParReference({
      ...commun, reference, depuis: ligne.created_at, signal: minuteur(),
    });
    if (!trouvaille.concluante) {
      await marquer(pool, ligne.id, {
        state: "delivery_uncertain", code: CODES.incertain, tentatives: ligne.attempts, maintenant,
      });
      return { id: ligne.id, etat: "delivery_uncertain", code: CODES.incertain };
    }
    if (trouvaille.trouve) {
      await reussir(pool, ligne, trouvaille.trouve);
      return { id: ligne.id, etat: "sent", adopte: true };
    }
    // Absence PROUVÉE : la fenêtre relue couvre la demande. On peut envoyer.
  }

  // 2. Création.
  try {
    const ticket = await adaptateur.createIssue({ ...commun, charge: ligne.payload, signal: minuteur() });
    await reussir(pool, ligne, ticket);
    return { id: ligne.id, etat: "sent" };
  } catch (err) {
    if (!(err instanceof ErreurTicket)) throw err;
    if (err.degrade) await degrader(pool, ligne.integration_id, err.code);

    // 3. Incertitude : on cherche immédiatement, on ne rejoue jamais à l'aveugle.
    if (err.incertain) {
      let trouvaille = { concluante: false, raison: "non_tentee" };
      try {
        trouvaille = await adaptateur.chercherParReference({
          ...commun, reference, depuis: ligne.created_at, signal: minuteur(),
        });
      } catch {
        /* la recherche elle-même a échoué : l'incertitude demeure */
      }
      if (trouvaille.concluante && trouvaille.trouve) {
        await reussir(pool, ligne, trouvaille.trouve);
        return { id: ligne.id, etat: "sent", adopte: true };
      }
      if (trouvaille.concluante) {
        // Absence prouvée : la demande peut repartir sans risque de doublon.
        await marquer(pool, ligne.id, { state: "pending", code: err.code, tentatives: ligne.attempts, maintenant });
        return { id: ligne.id, etat: "pending", code: err.code };
      }
      await marquer(pool, ligne.id, {
        state: "delivery_uncertain", code: CODES.incertain, tentatives: ligne.attempts, maintenant,
      });
      return { id: ligne.id, etat: "delivery_uncertain", code: CODES.incertain };
    }

    const epuisee = ligne.attempts >= STRATEGIE.tentativesMax;
    const etat = err.rejouable && !epuisee && !err.degrade ? "pending" : "failed";
    await marquer(pool, ligne.id, {
      state: etat, code: err.code, attendreSec: err.attendreSec, tentatives: ligne.attempts, maintenant,
    });
    return { id: ligne.id, etat, code: err.code };
  }
}

/**
 * Une passe de livraison : réserve et livre jusqu'à `limite` lignes, sans
 * dépasser `echeance`. Appelée par le tick planifié (scheduler Railway et route
 * cron), exactement comme le dispatcher d'alertes.
 *
 * @param {import('pg').Pool} pool
 * @param {{limite?: number, echeance?: number, fetchImpl?: typeof fetch,
 *          env?: NodeJS.ProcessEnv, maintenant?: number, timeoutMs?: number,
 *          log?: Console}} [options]
 */
export async function livrerTickets(pool, options = {}) {
  const {
    limite = LOT,
    echeance = Date.now() + BUDGET_MS,
    fetchImpl = fetch,
    env = process.env,
    timeoutMs = TIMEOUT_MS,
    log = console,
  } = options;
  if (!(await schemaPresent(pool))) return { absent: "migration-v84 non appliquée" };

  const bilan = { reservees: 0, envoyes: 0, rejouables: 0, echecs: 0, incertaines: 0 };
  for (let i = 0; i < limite; i++) {
    if (Date.now() >= echeance) break;
    const maintenant = options.maintenant ?? Date.now();
    const ligne = await reserver(pool, maintenant);
    if (!ligne) break;
    bilan.reservees++;
    try {
      // Le délai d'attente est porté par un signal, pas par une course de
      // promesses : une promesse perdante laisserait la requête HTTP vivre et
      // écrire plus tard. `livrerUne` en mint un par appel.
      const r = await livrerUne(pool, ligne, { fetchImpl, env, maintenant, timeoutMs });
      if (r.etat === "sent") bilan.envoyes++;
      else if (r.etat === "pending") bilan.rejouables++;
      else if (r.etat === "delivery_uncertain") bilan.incertaines++;
      else bilan.echecs++;
    } catch (err) {
      // Panne de base : on arrête la passe. La ligne est déjà armée pour revenir.
      log.error?.("livraison de ticket interrompue", { err: String(err?.message ?? err) });
      bilan.echecs++;
      break;
    }
  }
  return bilan;
}

/**
 * Applique un événement de fournisseur déjà VÉRIFIÉ et normalisé.
 *
 * Deux garde-fous, et ils sont le cœur du sujet :
 *
 *   · MIP est source de vérité pour `ignored`. Une issue ignorée l'a été par
 *     quelqu'un qui a regardé la donnée ; le fournisseur, lui, ne sait rien de
 *     cette décision et ne doit pas la défaire.
 *   · PAS DE BOUCLE. MIP n'écrit chez le fournisseur qu'à la CRÉATION du ticket ;
 *     aucun changement de statut MIP n'est poussé vers lui. Il n'existe donc
 *     aucun cycle possible dans ce lot. Et si un jour on en pousse un, la ligne
 *     d'activité porte déjà la clé de livraison : un événement rejoué n'écrit
 *     rien, et un événement qui propose l'état COURANT ne déclenche rien.
 *
 * @returns {Promise<{status: string, issueId?: string, statut?: string}>}
 */
export async function appliquerEvenement(client, { integration, evenement, deliveryId }) {
  const { rows: [lien] } = await client.query(
    `select t.id, t.app_id, t.issue_id, i.status
       from error_issue_ticket t
       join error_issue i on i.app_id = t.app_id and i.id = t.issue_id
      where t.integration_id = $1 and t.external_id = $2
      for update of i`,
    [integration.id, evenement.externalId],
  );
  if (!lien) return { status: "unknown_ticket" };

  await client.query(
    "update error_issue_ticket set provider_state = $2, provider_synced_at = now() where id = $1",
    [lien.id, evenement.etat],
  );

  const propose = statutPropose(evenement, mappingStatut(integration.config), lien.status);
  if (!propose.statut) {
    return {
      status: propose.raison === "mip_source_de_verite" || propose.raison === "deja_a_cet_etat" ? "ignored" : "unmapped",
      issueId: lien.issue_id,
    };
  }

  // La référence de résolution est calculée par la MÊME requête que pour une
  // résolution humaine : sans quoi une issue fermée depuis le fournisseur et une
  // issue fermée dans la console n'auraient pas le même verdict de régression.
  const reference =
    propose.statut === "resolved" ? await referenceResolution(client, lien.app_id, lien.issue_id) : null;

  const cle = `ticket_webhook:${deliveryId}`;
  const { rowCount } = await client.query(
    `insert into error_issue_activity
       (app_id, issue_id, kind, actor_kind, old_status, new_status, release, env, event_key)
     values ($1, $2, 'status', 'system', $3, $4, $5, $6, $7)
     on conflict (app_id, issue_id, event_key) where event_key is not null do nothing`,
    [lien.app_id, lien.issue_id, lien.status, propose.statut, reference?.release ?? null, reference?.env ?? null, cle],
  );
  // Livraison déjà appliquée (rejeu) : ne pas retoucher l'issue.
  if (!rowCount) return { status: "duplicate", issueId: lien.issue_id };

  await client.query(
    `update error_issue
        set status = $3, status_source = 'system', revision = revision + 1, updated_at = now(),
            resolved_at = case when $3 = 'resolved' then clock_timestamp() end,
            resolved_by_user_id = null,
            resolved_release = $4, resolved_env = $5
      where app_id = $1 and id = $2`,
    [lien.app_id, lien.issue_id, propose.statut, reference?.release ?? null, reference?.env ?? null],
  );
  return { status: "applied", issueId: lien.issue_id, statut: propose.statut };
}

export { construireCharge };
