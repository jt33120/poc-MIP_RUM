// SIGNATURE DES WEBHOOKS D'ALERTE — ce qui permet au destinataire de savoir que
// l'alerte vient de MIP RUM, et de jeter un rejeu.
//
// Un webhook est une URL : quiconque la connaît peut y poster une fausse alerte,
// et une vraie alerte capturée peut être rejouée. D'où trois en-têtes :
//
//   x-mip-delivery-id   l'identifiant de la livraison. TOUJOURS posé, signé ou
//                       non : une réponse perdue fait rejouer la livraison, et le
//                       destinataire dédoublonne sur cet identifiant ;
//   x-mip-timestamp     secondes depuis l'époque, au moment de l'envoi ;
//   x-mip-signature     `sha256=<hex>` = HMAC-SHA256(secret, `${timestamp}.${corps}`).
//
// L'horodatage est DANS la signature : un corps capturé ne se rejoue pas plus
// tard avec un horodatage frais. Le destinataire refuse un écart de plus de cinq
// minutes (`verifierSignature`, la référence à lui donner).
//
// DEUX SECRETS POUR LA ROTATION. `WEBHOOK_SIGNING_SECRET` porte une ou deux
// valeurs séparées par une virgule : le notifier signe avec la PREMIÈRE et
// `verifierSignature` accepte les deux. On pose « nouveau,ancien », on prévient
// les destinataires, puis on retire l'ancien.
//
// LIMITE, À DIRE : un secret unique pour tous les canaux. Le communiquer à un
// destinataire lui permet de signer pour les autres. Tant qu'un seul client reçoit
// des webhooks, c'est tenable ; un secret par canal (en base, affiché une fois)
// relève de C8.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Écart d'horloge admis par le destinataire. */
export const TOLERANCE_S = 300;

/** Les valeurs du secret, dans l'ordre (la première signe). */
export function secretsDeSignature(brut) {
  return String(brut ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hmac(secret, horodatage, corps) {
  return createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex");
}

/**
 * Les en-têtes d'une livraison. Sans secret : l'identifiant seul.
 * @param {{ id: number|string, corps: string, secret?: string|null, maintenantMs?: number }} p
 * @returns {Record<string, string>}
 */
export function entetesDeLivraison({ id, corps, secret = null, maintenantMs = Date.now() }) {
  const entetes = { "x-mip-delivery-id": String(id) };
  if (!secret) return entetes;
  const horodatage = String(Math.floor(maintenantMs / 1000));
  entetes["x-mip-timestamp"] = horodatage;
  entetes["x-mip-signature"] = `sha256=${hmac(secret, horodatage, corps)}`;
  return entetes;
}

/**
 * Vérification côté DESTINATAIRE — la référence de la documentation, et ce que
 * les tests opposent à `entetesDeLivraison`. Comparaison à temps constant.
 *
 * @param {{ secrets: string[], entetes: Record<string, string|undefined>, corps: string,
 *           maintenantMs?: number, toleranceS?: number }} p
 * @returns {{ ok: true } | { ok: false, raison: "absente"|"horodatage"|"signature" }}
 */
export function verifierSignature({ secrets, entetes, corps, maintenantMs = Date.now(), toleranceS = TOLERANCE_S }) {
  const horodatage = entetes["x-mip-timestamp"];
  const signature = entetes["x-mip-signature"];
  if (!horodatage || !signature?.startsWith("sha256=")) return { ok: false, raison: "absente" };
  const t = Number(horodatage);
  if (!Number.isSafeInteger(t) || Math.abs(maintenantMs / 1000 - t) > toleranceS) {
    return { ok: false, raison: "horodatage" };
  }
  const recue = Buffer.from(signature.slice("sha256=".length), "hex");
  for (const secret of secrets) {
    const attendue = Buffer.from(hmac(secret, horodatage, corps), "hex");
    if (recue.length === attendue.length && timingSafeEqual(recue, attendue)) return { ok: true };
  }
  return { ok: false, raison: "signature" };
}
