// Garde-fous de charge — runtime-agnostic (Node + Deno).
//
// Pourquoi : `await req.json()` / la concaténation du corps lisent par défaut
// un body de taille arbitraire. Un client (ou un attaquant) qui poste 200 Mo
// fait exploser la mémoire de l'isolat avant même le parsing. On rejette tôt
// (HTTP 413) sur le Content-Length, et on borne le nombre de spans réellement
// traités pour qu'un corps « valide mais énorme » ne monopolise pas le CPU.

/** Taille max du corps OTLP accepté (octets). Surchargable par env. */
export const MAX_BODY_BYTES = numEnv("MAX_BODY_BYTES", 2_000_000); // 2 Mo

/** Nombre max de spans traités par requête (au-delà : comptés `rejected`). */
export const MAX_SPANS_PER_REQUEST = numEnv("MAX_SPANS_PER_REQUEST", 20_000);

/**
 * Borne de SORTIE de la décompression d'un chunk de rejeu (octets).
 *
 * POURQUOI ELLE EXISTE. Le plafond d'ENTRÉE (2 Mo) ne borne pas la sortie : un
 * gzip de 2 Mo peut rendre ~2 Go, et les trois sites qui décompriment un chunk le
 * font SYNCHRONEMENT (`gunzipSync`). Sans borne, un seul corps bien formé bloque
 * la boucle d'événements le temps de l'inflation, ou tue le processus sur la
 * mémoire. La clé d'API n'est pas une barrière : elle est publique par
 * construction, puisqu'elle est dans le snippet.
 *
 * 32 Mo laisse passer très largement un enregistrement réel — le SDK plafonne un
 * chunk à 1 Mo gzip — tout en gardant l'inflation bornée. Au-delà, `gunzipSync`
 * lève un `RangeError`, que les appelants traitent comme un corps invalide (400).
 */
export const MAX_REPLAY_INFLATED_BYTES = numEnv("MAX_REPLAY_INFLATED_BYTES", 32 * 1024 * 1024);

/**
 * Plafond d'un chunk de rejeu reçu (octets gzip) : > au plafond du SDK (1 Mo
 * par chunk). Ici, UNE fois : la console et le collector en avaient chacun
 * une copie.
 */
export const MAX_REPLAY_BYTES = 2 * 1024 * 1024;

/** Plus grand `seq` stockable : `replay_chunk.seq` est un `int` (int4). */
const SEQ_MAX = 2_147_483_647;

/**
 * `x-mip-seq` d'un chunk de rejeu → entier ≥ 0, ou null (→ 400).
 *
 * POURQUOI PAS `Number(v)`. `Number(null) === 0` et `Number("") === 0` : un
 * chunk SANS séquence partait en séquence 0 sur les deux ports, et
 * `on conflict (session_id, seq) do nothing` jetait alors en silence le vrai
 * chunk 0 arrivé après. `Number` acceptait aussi « 1e3 », « 0x10 », « 5 » avec
 * espaces, et des entiers au-delà de l'int4 de la colonne (erreur SQL, 500).
 * Seuls des chiffres décimaux, dans la plage de la colonne. Le SDK envoie
 * `String(chunk.seq)`.
 * @param {string | null | undefined} brut
 * @returns {number | null}
 */
export function lireSequenceReplay(brut) {
  if (typeof brut !== "string" || !/^\d{1,10}$/.test(brut)) return null;
  const n = Number(brut);
  return n <= SEQ_MAX ? n : null;
}

function numEnv(name, fallback) {
  const raw = readEnv(name);
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readEnv(name) {
  try {
    if (typeof Deno !== "undefined" && Deno?.env) return Deno.env.get(name) ?? undefined;
  } catch {
    /* env inaccessible */
  }
  if (typeof process !== "undefined" && process?.env) return process.env[name];
  return undefined;
}

/**
 * Le Content-Length annoncé dépasse-t-il la limite ? (null/absent : on laisse
 * passer — le garde mémoire en aval prend le relais selon le runtime).
 * @param {string|number|null|undefined} contentLength
 */
export function bodyTooLarge(contentLength, max = MAX_BODY_BYTES) {
  if (contentLength == null) return false;
  const n = Number(contentLength);
  return Number.isFinite(n) && n > max;
}

/**
 * Lit un corps en BORNANT la mémoire : rend null dès que `max` est franchi, le
 * Buffer complet sinon (vide si le corps est absent).
 *
 * POURQUOI ICI, ET PAS DANS CHAQUE PORT. `bodyTooLarge` ne regarde que la
 * longueur ANNONCÉE ; un client en transfert par morceaux n'en annonce aucune.
 * Le receveur du collector bornait sa lecture ; les routes Next, elles, lisaient
 * par `req.json()`, sans borne — si bien qu'un même lot OTLP de 3 Mo sans
 * `content-length` rendait 413 sur le collector et 200 sur la console (jusqu'au
 * plafond de la plateforme, 4,5 Mo sur Vercel). Relevé par le contrat de parité
 * (`tests/contract/ingest-parity.test.ts`) : la lecture vit désormais ici, une
 * fois, pour les deux ports.
 *
 * On arrête de concaténer AU MOMENT du dépassement plutôt que d'accumuler puis
 * de mesurer, ce qui laisserait passer l'attaque. Le flux est n'importe quel
 * itérable asynchrone d'octets : `IncomingMessage` de node:http comme
 * `ReadableStream` web (Next, runtime Node). Rend un `Buffer` : Node seulement,
 * les deux ports l'étant.
 * @param {AsyncIterable<Uint8Array> | null | undefined} flux
 * @param {number} max
 * @returns {Promise<Buffer | null>}
 */
export async function lireCorpsBorne(flux, max = MAX_BODY_BYTES) {
  if (flux == null) return Buffer.alloc(0);
  const morceaux = [];
  let total = 0;
  for await (const morceau of flux) {
    total += morceau.length;
    if (total > max) return null;
    morceaux.push(morceau);
  }
  return Buffer.concat(morceaux);
}
