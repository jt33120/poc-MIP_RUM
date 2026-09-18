// Adaptateur GitHub Issues (P8.6) — le premier, et le seul de ce lot.
//
// POURQUOI GITHUB, ET CE QUE ÇA NE VEUT PAS DIRE. Le dépôt du produit y est
// déjà, l'authentification existe, aucun compte ni coût nouveau n'est à ouvrir,
// et c'est le seul fournisseur qu'on puisse éprouver de bout en bout
// aujourd'hui. La cible reste l'outil ITSM de MIP — ServiceNow, sous réserve de
// confirmation. Rien ici n'est écrit pour rester : `adapter.mjs` porte le
// contrat, ce fichier n'en est qu'une réalisation.
//
// AUCUNE DÉPENDANCE NPM. L'API REST v3 suffit avec `fetch` : Octokit apporterait
// 40 paquets transitifs pour trois requêtes.
//
// LA SIGNATURE DES WEBHOOKS EST CELLE DE GITHUB, PAS UNE INVENTION. GitHub signe
// le corps BRUT en HMAC-SHA256 et l'annonce dans `X-Hub-Signature-256` sous la
// forme `sha256=<hex>`. On vérifie ce mécanisme-là, sur les octets reçus, en
// comparaison à temps constant. Réencoder le JSON avant de vérifier casserait la
// signature au premier caractère d'espacement différent.
//
// PAS DE DÉPÔT DÉDUIT. `cible` est un `owner/repo` confirmé à la configuration.
// Rien ne lit le remote git de MIP : ouvrir les tickets d'un client dans le
// dépôt du produit serait une fuite, et un défaut « pratique » est exactement
// ainsi qu'elle arriverait.
import { createHmac } from "node:crypto";
import {
  CODES,
  ErreurTicket,
  egalTempsConstant,
  octetsHex,
  referenceMip,
} from "./adapter.mjs";

export const PROVIDER = "github";
const API = "https://api.github.com";
const VERSION = "2022-11-28";
/** Un corps de webhook GitHub tient très en dessous ; au-delà, on refuse sans lire. */
export const WEBHOOK_MAX_OCTETS = 1024 * 1024;
/** Fenêtre de recherche par référence, en nombre de tickets récents relus. */
const RECHERCHE_PAGES = 3;
const RECHERCHE_PAR_PAGE = 100;

function entetes(secret) {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": VERSION,
    "user-agent": "mip-rum-tickets/1.0",
    authorization: `Bearer ${secret}`,
  };
}

/**
 * Attente demandée par GitHub : `Retry-After` en secondes, sinon l'instant de
 * réarmement du quota.
 *
 * L'en-tête est lu en DEUX temps — présence, puis valeur — parce que
 * `Number(null)` vaut `0`, un nombre fini et positif : la première version de ce
 * code lisait « attends 0 seconde » sur une réponse SANS en-tête, et en
 * déduisait une limite de débit là où il n'y avait qu'un droit manquant.
 */
function attenteDe(reponse, maintenant = Date.now()) {
  const brutRetry = reponse.headers.get("retry-after");
  if (brutRetry !== null && brutRetry.trim() !== "") {
    const retry = Number(brutRetry);
    if (Number.isFinite(retry) && retry >= 0) return Math.min(retry, 3600);
  }
  const brutReset = reponse.headers.get("x-ratelimit-reset");
  if (brutReset !== null && brutReset.trim() !== "") {
    const reset = Number(brutReset);
    if (Number.isFinite(reset) && reset > 0) {
      return Math.min(Math.max(0, Math.ceil(reset - maintenant / 1000)), 3600);
    }
  }
  return null;
}

/**
 * Traduit un statut HTTP en refus qualifié. Deux distinctions comptent plus que
 * les autres : `auth` fait passer l'intégration en `degraded` (et rien d'autre —
 * la collecte RUM n'est jamais bloquée pour un jeton révoqué), et `rejouable`
 * décide si la file retentera. Un 422 de GitHub est définitif : rejouer la même
 * charge refusée cent fois n'en changerait pas le verdict.
 */
function refusHttp(reponse) {
  const s = reponse.status;
  const attendreSec = attenteDe(reponse);
  if (s === 401) return new ErreurTicket(CODES.auth, { degrade: true });
  // 403 sans en-tête de débit = droit manquant ; avec, c'est une limite secondaire.
  if (s === 403) {
    const restant = reponse.headers.get("x-ratelimit-remaining");
    if (restant === "0" || attendreSec !== null) {
      return new ErreurTicket(CODES.debit, { rejouable: true, attendreSec });
    }
    return new ErreurTicket(CODES.auth, { degrade: true });
  }
  if (s === 404 || s === 410) return new ErreurTicket(CODES.cible, { degrade: true });
  if (s === 422 || s === 400) return new ErreurTicket(CODES.invalide);
  if (s === 429) return new ErreurTicket(CODES.debit, { rejouable: true, attendreSec });
  if (s >= 500) return new ErreurTicket(CODES.distant, { rejouable: true, attendreSec });
  return new ErreurTicket(CODES.distant, { rejouable: true, attendreSec });
}

/**
 * Une panne de transport sur une ÉCRITURE est incertaine par nature : la requête
 * a pu arriver, être traitée, et seule la réponse s'être perdue. Sur une LECTURE,
 * elle est seulement rejouable — une lecture ne crée rien.
 */
function refusTransport(err, { ecriture }) {
  return ecriture
    ? new ErreurTicket(CODES.incertain, { incertain: true })
    : new ErreurTicket(CODES.distant, { rejouable: true, cause: err });
}

function ticketDe(json) {
  const numero = json?.number;
  const url = json?.html_url;
  if (!Number.isInteger(numero) || typeof url !== "string" || !url.startsWith("https://")) {
    throw new ErreurTicket(CODES.reponse);
  }
  return {
    externalId: String(numero),
    url,
    etat: json?.state === "closed" ? "closed" : json?.state === "open" ? "open" : "unknown",
  };
}

/**
 * Crée le ticket. `charge` est l'objet FIGÉ par la file de sortie : rien n'est
 * recomposé ici, sans quoi l'aperçu montré à l'opérateur et le ticket réellement
 * ouvert seraient deux calculs différents.
 *
 * @param {{cible: string, secret: string, charge: {titre: string, description: string},
 *          labels?: string[], fetchImpl?: typeof fetch, signal?: AbortSignal}} params
 */
export async function createIssue({ cible, secret, charge, labels = [], fetchImpl = fetch, signal }) {
  let reponse;
  try {
    reponse = await fetchImpl(`${API}/repos/${cible}/issues`, {
      method: "POST",
      headers: { ...entetes(secret), "content-type": "application/json" },
      body: JSON.stringify({
        title: charge.titre,
        body: charge.description,
        ...(labels.length ? { labels } : {}),
      }),
      signal,
    });
  } catch (err) {
    throw refusTransport(err, { ecriture: true });
  }
  if (!reponse.ok) throw refusHttp(reponse);
  let json;
  try {
    json = await reponse.json();
  } catch {
    // 2xx dont le corps est illisible : le ticket EXISTE presque sûrement, et on
    // n'a pas son identifiant. C'est le cas incertain, pas une erreur ordinaire.
    throw new ErreurTicket(CODES.incertain, { incertain: true });
  }
  return ticketDe(json);
}

/** Relit un ticket : existence, URL, état. */
export async function getIssue({ cible, secret, externalId, fetchImpl = fetch, signal }) {
  if (!/^[1-9]\d{0,17}$/.test(String(externalId))) throw new ErreurTicket(CODES.invalide);
  let reponse;
  try {
    reponse = await fetchImpl(`${API}/repos/${cible}/issues/${externalId}`, {
      method: "GET",
      headers: entetes(secret),
      signal,
    });
  } catch (err) {
    throw refusTransport(err, { ecriture: false });
  }
  if (!reponse.ok) throw refusHttp(reponse);
  try {
    return ticketDe(await reponse.json());
  } catch (err) {
    if (err instanceof ErreurTicket) throw err;
    throw new ErreurTicket(CODES.reponse);
  }
}

/**
 * « Ce ticket existe-t-il déjà ? », après une livraison incertaine.
 *
 * ON N'UTILISE PAS `/search/issues`. Son index est à cohérence DIFFÉRÉE : un
 * ticket créé il y a dix secondes peut n'y être pas encore. Une absence y est
 * donc une non-réponse, et la prendre pour une preuve d'absence recréerait le
 * ticket — exactement le doublon que tout ce mécanisme existe pour empêcher.
 * On relit la LISTE du dépôt, qui est la donnée primaire, bornée à quelques
 * pages récentes, et on cherche la référence MIP dans les corps.
 *
 * Rend `concluante: false` dès que la fenêtre relue ne couvre pas, de façon
 * certaine, l'instant de la demande : mieux vaut appeler un opérateur que
 * conclure trop vite.
 */
export async function chercherParReference({
  cible,
  secret,
  reference,
  depuis = null,
  fetchImpl = fetch,
  signal,
}) {
  const marqueur = String(reference ?? "");
  if (!marqueur) return { concluante: false, raison: "reference_absente" };
  const since = depuis ? new Date(depuis) : null;
  let complete = false;
  for (let page = 1; page <= RECHERCHE_PAGES; page++) {
    const params = new URLSearchParams({
      state: "all",
      sort: "created",
      direction: "desc",
      per_page: String(RECHERCHE_PAR_PAGE),
      page: String(page),
    });
    let reponse;
    try {
      reponse = await fetchImpl(`${API}/repos/${cible}/issues?${params}`, {
        method: "GET",
        headers: entetes(secret),
        signal,
      });
    } catch {
      return { concluante: false, raison: "transport" };
    }
    if (!reponse.ok) return { concluante: false, raison: `http_${reponse.status}` };
    let lot;
    try {
      lot = await reponse.json();
    } catch {
      return { concluante: false, raison: "reponse_illisible" };
    }
    if (!Array.isArray(lot)) return { concluante: false, raison: "reponse_illisible" };
    for (const brut of lot) {
      if (typeof brut?.body === "string" && brut.body.includes(marqueur)) {
        try {
          return { concluante: true, trouve: ticketDe(brut) };
        } catch {
          return { concluante: false, raison: "reponse_illisible" };
        }
      }
    }
    if (lot.length < RECHERCHE_PAR_PAGE) {
      complete = true;
      break;
    }
    // La page est pleine : si la plus ancienne ligne lue est ANTÉRIEURE à la
    // demande, la fenêtre couvre déjà tout ce qui aurait pu être créé.
    const derniere = lot.at(-1)?.created_at;
    if (since && derniere && new Date(derniere) < since) {
      complete = true;
      break;
    }
  }
  return complete
    ? { concluante: true, trouve: null }
    : { concluante: false, raison: "fenetre_insuffisante" };
}

/**
 * Vérifie la signature officielle de GitHub sur le corps BRUT.
 *
 * `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 du corps avec le secret du
 * webhook, comparé à temps constant. GitHub ne fournit ni horodatage signé ni
 * nonce : la protection contre le rejeu ne vient donc PAS d'ici, mais de
 * l'unicité de `X-GitHub-Delivery` en base (table `ticket_webhook_event`). On le
 * dit plutôt que d'inventer un horodatage que le protocole n'a pas.
 *
 * @param {{secret: string, entetes: Headers|Record<string,string>, corps: Uint8Array}} params
 */
export function validateWebhook({ secret, entetes: recus, corps }) {
  const lire = (nom) =>
    typeof recus?.get === "function" ? recus.get(nom) : (recus?.[nom] ?? recus?.[nom.toLowerCase()] ?? null);
  if (typeof secret !== "string" || secret.length === 0) return { ok: false, raison: "secret_absent" };
  if (!(corps instanceof Uint8Array)) return { ok: false, raison: "corps_absent" };
  if (corps.length > WEBHOOK_MAX_OCTETS) return { ok: false, raison: "corps_trop_grand" };

  const deliveryId = (lire("x-github-delivery") ?? "").trim();
  if (!deliveryId || deliveryId.length > 200 || !/^[!-~]+$/.test(deliveryId)) {
    return { ok: false, raison: "livraison_sans_identifiant" };
  }
  const type = (lire("x-github-event") ?? "").trim().toLowerCase();
  if (!type || !/^[a-z][a-z0-9_.-]{0,99}$/.test(type)) return { ok: false, raison: "type_absent" };

  const annoncee = (lire("x-hub-signature-256") ?? "").trim();
  if (!annoncee.startsWith("sha256=")) return { ok: false, raison: "signature_absente" };
  const recue = octetsHex(annoncee.slice("sha256=".length));
  if (!recue) return { ok: false, raison: "signature_malformee" };
  const attendue = new Uint8Array(createHmac("sha256", secret).update(corps).digest());
  if (!egalTempsConstant(recue, attendue)) return { ok: false, raison: "signature_invalide" };
  return { ok: true, deliveryId, type };
}

/**
 * Traduit un corps GitHub en vocabulaire MIP. Ne décide RIEN : c'est l'appelant
 * qui confronte l'action au mapping configuré et au statut courant.
 *
 * `etat` est l'état du ticket tel que GitHub le rend ; `action` est ce qui vient
 * de se passer. Les deux servent : une issue `closed` dont l'action est `edited`
 * ne doit rien déclencher.
 */
export function normalizeWebhook({ entetes: recus, corps }) {
  const lire = (nom) =>
    typeof recus?.get === "function" ? recus.get(nom) : (recus?.[nom] ?? recus?.[nom.toLowerCase()] ?? null);
  const type = (lire("x-github-event") ?? "").trim().toLowerCase();
  const deliveryId = (lire("x-github-delivery") ?? "").trim();
  const numero = corps?.issue?.number;
  const etatBrut = corps?.issue?.state;
  return {
    provider: PROVIDER,
    deliveryId,
    type,
    action: typeof corps?.action === "string" ? corps.action : "",
    externalId: Number.isInteger(numero) ? String(numero) : null,
    etat: etatBrut === "closed" ? "closed" : etatBrut === "open" ? "open" : "unknown",
    /** Le dépôt annoncé par la charge ; comparé à la cible configurée par l'appelant. */
    cible: typeof corps?.repository?.full_name === "string" ? corps.repository.full_name : null,
  };
}

/** Référence MIP attendue dans le corps d'un ticket de cette issue. */
export const reference = referenceMip;

export const adaptateur = {
  provider: PROVIDER,
  createIssue,
  getIssue,
  chercherParReference,
  validateWebhook,
  normalizeWebhook,
};

export default adaptateur;
