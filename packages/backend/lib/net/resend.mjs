// E-MAIL DES ALERTES PAR RESEND — depuis le notifier, seul détenteur de la clé.
//
// D'OÙ ÇA VIENT. L'e-mail partait de Postgres (`route_alert`, migration-v50) par
// pg_net, soit directement chez Resend avec une clé au coffre Supabase, soit en
// relais par la console (`POST /api/alerts/email`, clé sur Vercel). Sur Neon, ni
// pg_net ni le coffre n'existent : les deux chemins étaient morts, et chaque
// livraison e-mail finissait `skipped`. Depuis migration-v88, `route_alert` laisse
// la ligne `queued` et c'est le livreur (`dispatch-alerts.mjs`) qui l'envoie ici.
// Le code vient de `apps/console/lib/alert-email.ts`, retiré avec sa route :
// Vercel ne détient plus aucun secret sortant.
//
// CE QUI DÉCIDE DU STATUT DE LA LIVRAISON. Un succès (2xx) seulement quand Resend
// a accepté le message, et son identifiant va dans `alert_delivery.response`. Un
// refus 4xx est TERMINAL : rejouer cinq fois une clé révoquée ou une adresse
// invalide donne cinq fois le même refus. Deux exceptions, rejouables : 429 (débit)
// et 409 `concurrent_idempotent_requests` (le même envoi est encore en cours chez
// Resend). Une panne réseau ou un 5xx, rejouables aussi.
//
// L'IDEMPOTENCE, POUR NE PAS ENVOYER DEUX FOIS. Une réponse perdue en route (délai
// dépassé APRÈS l'envoi) rend la livraison `failed`, donc rejouée. Chaque envoi
// porte `Idempotency-Key: mip-delivery-<id>` : Resend rend alors la réponse du
// premier envoi sans renvoyer le message, pendant 24 h — au-delà du dernier rejeu
// possible (5 tentatives, recul de 30 s × 2^n). La clé suppose un corps IDENTIQUE
// d'un essai à l'autre (sinon 409 `invalid_idempotent_request`) : le message est
// donc construit à partir de la ligne seule, jamais de l'heure ou de l'état.
//
// MODE TEST. Tant que le domaine d'envoi n'est pas vérifié chez Resend,
// l'expéditeur est `onboarding@resend.dev`, qui ne sait écrire qu'au titulaire du
// compte. `ALERT_EMAIL_TEST_RECIPIENTS` liste les destinataires admis ; tout autre
// est soldé `skipped` AVANT l'appel, avec la raison — plutôt qu'un 403 de Resend
// compté comme une panne.
import { safeFetch } from "./safe-fetch.mjs";

export const RESEND_URL = "https://api.resend.com/emails";
/** Délai d'un envoi, borné en plus par l'échéance de la passe. */
export const DELAI_ENVOI_MS = 10_000;

// Permissive sur la forme, stricte sur la présence d'un @ et l'absence d'espaces :
// écarter une valeur manifestement fausse, pas rejouer la RFC 5322 (dont une
// implémentation naïve rejette des adresses valides). Ni `:` ni `/` : une URL à
// identifiants (`https://user@hote/x`) passerait sinon pour une adresse, et
// partirait chez Resend au lieu d'être refusée comme webhook.
const RE_MAIL = /^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/;
const SEVERITES = ["info", "warning", "critical"];

/** La cible d'une livraison est-elle une adresse e-mail (canal `email`) ? */
export function estAdresseMail(cible) {
  return typeof cible === "string" && RE_MAIL.test(cible.trim());
}

function premiereLigne(texte, max) {
  const ligne = texte.split("\n", 1)[0] ?? texte;
  return ligne.length > max ? `${ligne.slice(0, max - 1)}…` : ligne;
}

/**
 * Le message d'une alerte, ou `null` si l'entrée est inexploitable : on préfère
 * un échec visible à un e-mail vide.
 *
 * Le sujet porte la sévérité et l'essentiel — une alerte se lit dans la liste des
 * messages, pas seulement ouverte. Le préfixe « [MIP RUM] » que portent les
 * textes d'alerte n'y est pas répété.
 *
 * @param {{ to: unknown, severity?: unknown, text?: unknown, payload?: unknown }} entree
 * @returns {{ to: string, subject: string, text: string } | null}
 */
export function construireMail({ to, severity, text, payload } = {}) {
  const destinataire = typeof to === "string" ? to.trim() : "";
  if (!RE_MAIL.test(destinataire)) return null;
  const texte = typeof text === "string" ? text.trim() : "";
  if (!texte) return null;
  const sev = SEVERITES.includes(severity) ? severity : "warning";

  const sujet = `[MIP RUM ${sev.toUpperCase()}] ${premiereLigne(texte.replace(/^\[MIP RUM\]\s*/, ""), 120)}`;
  const lignes = [texte, "", `Sévérité : ${sev}`];
  if (payload && typeof payload === "object") {
    // Le détail, sans répéter le texte déjà en tête du message.
    const { text: _texte, ...detail } = /** @type {Record<string, unknown>} */ (payload);
    if (Object.keys(detail).length) lignes.push("", "Détail :", JSON.stringify(detail, null, 2));
  }
  lignes.push("", "— MIP RUM, supervision automatique.");
  return { to: destinataire, subject: sujet, text: lignes.join("\n") };
}

/**
 * La configuration d'envoi, lue sur le service qui livre. `null` si la clé ou
 * l'expéditeur manque : jamais de valeur par défaut.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ apiKey: string, from: string, destinatairesTest: Set<string> | null } | null}
 */
export function configEmail(env = process.env) {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.ALERT_EMAIL_FROM?.trim();
  if (!apiKey || !from) return null;
  const liste = (env.ALERT_EMAIL_TEST_RECIPIENTS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return { apiKey, from, destinatairesTest: liste.length ? new Set(liste) : null };
}

/**
 * Les règles croisées de la configuration, pour un refus de démarrer lisible :
 * chaque erreur nomme la variable à corriger. Jamais une valeur secrète.
 * @returns {{ variable: string, erreur: string }[]}
 */
export function erreursConfigEmail(env = process.env) {
  const cle = Boolean(env.RESEND_API_KEY?.trim());
  const from = env.ALERT_EMAIL_FROM?.trim() ?? "";
  const test = Boolean(env.ALERT_EMAIL_TEST_RECIPIENTS?.trim());
  const erreurs = [];
  const refus = (variable, erreur) => erreurs.push({ variable, erreur });
  if (cle && !from) refus("RESEND_API_KEY", "posée sans ALERT_EMAIL_FROM : aucun e-mail ne pourrait partir");
  if (from && !cle) refus("ALERT_EMAIL_FROM", "posée sans RESEND_API_KEY : aucun e-mail ne pourrait partir");
  if (from && !RE_MAIL.test(from)) refus("ALERT_EMAIL_FROM", "pas une adresse e-mail");
  // L'expéditeur de test de Resend n'écrit qu'au titulaire du compte : sans liste,
  // chaque alerte vers un autre destinataire deviendrait un 403 terminal.
  if (/@resend\.dev$/i.test(from) && !test) {
    refus("ALERT_EMAIL_FROM", "un expéditeur @resend.dev exige ALERT_EMAIL_TEST_RECIPIENTS (domaine d'envoi non vérifié)");
  }
  return erreurs;
}

/**
 * Le destinataire est-il admis ? Rend `null` s'il l'est, sinon la raison du refus.
 * @param {string} destinataire
 * @param {{ destinatairesTest: Set<string> | null }} cfg
 */
export function refusDestinataire(destinataire, cfg) {
  if (!cfg.destinatairesTest) return null;
  if (cfg.destinatairesTest.has(destinataire.trim().toLowerCase())) return null;
  return "destinataire hors de ALERT_EMAIL_TEST_RECIPIENTS : domaine d'envoi non vérifié chez Resend, seuls les destinataires de test sont servis";
}

/**
 * Ce que vaut une réponse de Resend pour la livraison.
 * @param {number} statut
 * @param {string | undefined} nom  champ `name` du corps d'erreur de Resend
 * @returns {"livre" | "rejouable" | "terminal"}
 */
export function issueResend(statut, nom) {
  if (statut >= 200 && statut < 300) return "livre";
  if (statut === 429 || statut >= 500) return "rejouable";
  if (statut === 409 && nom === "concurrent_idempotent_requests") return "rejouable";
  return "terminal";
}

/**
 * Envoie un message. Ne lève JAMAIS : le livreur doit pouvoir écrire un statut
 * fidèle dans tous les cas.
 *
 * @param {{ to: string, subject: string, text: string }} mail
 * @param {{ apiKey: string, from: string }} cfg
 * @param {{ cleIdempotence: string, delaiMs?: number, fetchImpl?: typeof safeFetch }} options
 * @returns {Promise<{ issue: "livre"|"rejouable"|"terminal", reponse: string }>}
 *   `reponse` : ce qui va dans `alert_delivery.response` (≤ 200 caractères, jamais la clé)
 */
export async function envoyerMail(mail, cfg, { cleIdempotence, delaiMs = DELAI_ENVOI_MS, fetchImpl = safeFetch }) {
  let res;
  try {
    res = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": cleIdempotence,
      },
      body: JSON.stringify({ from: cfg.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      signal: AbortSignal.timeout(delaiMs),
      timeoutMs: delaiMs,
    });
  } catch (err) {
    // `fetch` range le code système dans `cause`, `node:http` sur l'erreur même.
    return { issue: "rejouable", reponse: `resend : ${String(err?.cause?.code ?? err?.code ?? err?.message ?? err)}`.slice(0, 200) };
  }
  let corps = {};
  try {
    corps = JSON.parse(await res.text());
  } catch {
    // Corps illisible : le statut suffit à décider.
  }
  const issue = issueResend(res.status, corps?.name);
  if (issue === "livre") return { issue, reponse: `resend ${corps?.id ?? "(sans id)"}`.slice(0, 200) };
  const detail = [corps?.name, corps?.message].filter(Boolean).join(" : ");
  return { issue, reponse: `resend http ${res.status}${detail ? ` ${detail}` : ""}`.slice(0, 200) };
}
