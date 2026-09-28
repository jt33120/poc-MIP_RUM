// Corps d'une requête OTLP/HTTP (traces, logs) → l'objet OTLP que `otlp.mjs`
// aplatit, et, dans l'autre sens, le corps de la réponse.
//
// POURQUOI ICI, UNE FOIS. Les deux ports d'ingestion (routes Next de la console,
// receveur du collector) doivent rendre le MÊME statut pour les mêmes octets —
// c'est le contrat de parité (`tests/contract/ingest-parity.test.ts`). L'aiguillage
// par `content-type`, la décompression et le décodage vivent donc ici, et les deux
// ports n'en sont que les appelants.
//
// CE QUI EST ACCEPTÉ :
//   - `content-type: application/json` (le SDK web, l'extension, le mobile, l'agent
//     Node, le middleware FastAPI) → `JSON.parse`, comme avant ;
//   - `content-type: application/x-protobuf` (les agents OpenTelemetry officiels,
//     `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`) → `otlp-protobuf.mjs` ;
//   - AUCUN `content-type` → JSON. Aucune route ne lisait cet en-tête avant ; un
//     client maison qui l'omettait (un `fetch` sans en-têtes) marchait, et ce
//     changement ne doit casser personne ;
//   - tout autre type → 415 : deviner l'encodage d'un corps serait écrire des
//     lignes fausses, ou rendre un 400 qui ferait croire à un lot corrompu.
//   - `content-encoding: gzip` (ou `deflate`, ce qu'offre l'exportateur Python)
//     → décompressé AVANT le décodage, JSON comme protobuf. Autre encodage → 415.
//
// BORNE DE DÉCOMPRESSION. Le plafond d'entrée (2 Mo, `MAX_BODY_BYTES`) ne borne
// pas la sortie : 2 Mo de gzip peuvent rendre 2 Go, décompressés SYNCHRONEMENT —
// la même attaque que celle que le rejeu borne déjà (`MAX_REPLAY_INFLATED_BYTES`,
// `maxOutputLength`). Ici, la borne de sortie est le MÊME plafond que pour un
// corps non compressé : compresser ne doit pas permettre de faire entrer dans le
// pipeline un lot qu'on refuserait en clair. Au-delà : 413, comme en clair.
import { gunzipSync, inflateSync } from "node:zlib";
import { MAX_BODY_BYTES } from "./limits.mjs";
import { decoderLogsProtobuf, decoderTracesProtobuf, encoderStatusProtobuf, ErreurProtobuf } from "./otlp-protobuf.mjs";

export const TYPE_JSON = "application/json";
export const TYPE_PROTOBUF = "application/x-protobuf";

/**
 * Refus d'un corps OTLP, avec son statut HTTP (400, 413 ou 415) et le message
 * rendu au client. Jamais un 5xx : le rejouer à l'identique ne changera rien.
 */
export class RefusCorpsOtlp extends Error {
  constructor(statut, message) {
    super(message);
    this.name = "RefusCorpsOtlp";
    this.statut = statut;
  }
}

/**
 * Format d'une requête OTLP d'après son `content-type` : `json`, `protobuf`, ou
 * null (non pris en charge → 415). Paramètres (`; charset=utf-8`) et casse ignorés.
 * @param {string | null | undefined} contentType
 * @returns {"json" | "protobuf" | null}
 */
export function formatOtlp(contentType) {
  const type = String(contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "" || type === TYPE_JSON) return "json";
  if (type === TYPE_PROTOBUF) return "protobuf";
  return null;
}

/**
 * Décompresse selon `content-encoding`, sortie bornée à `max` octets.
 * @param {Buffer} brut
 * @param {string | null | undefined} contentEncoding
 * @param {number} max
 * @returns {Buffer}
 */
export function decompresserOtlp(brut, contentEncoding, max = MAX_BODY_BYTES) {
  const encodage = String(contentEncoding ?? "").trim().toLowerCase();
  if (encodage === "" || encodage === "identity") return brut;
  const inflater = encodage === "gzip" ? gunzipSync : encodage === "deflate" ? inflateSync : null;
  if (!inflater) throw new RefusCorpsOtlp(415, "unsupported content-encoding (expected gzip, deflate or none)");
  try {
    return inflater(brut, { maxOutputLength: max });
  } catch (err) {
    // `maxOutputLength` franchi : RangeError (ERR_BUFFER_TOO_LARGE).
    if (err instanceof RangeError || err?.code === "ERR_BUFFER_TOO_LARGE") {
      throw new RefusCorpsOtlp(413, "payload too large");
    }
    throw new RefusCorpsOtlp(400, `invalid ${encodage} body`);
  }
}

/**
 * Corps brut (déjà lu, borné) → objet OTLP, prêt pour `secureOtlpIdentities` puis
 * `flattenOtlp` / `flattenOtlpLogs`. Rien d'autre ne change en aval.
 * @param {Buffer} brut
 * @param {{ signal: "traces" | "logs", contentType?: string | null, contentEncoding?: string | null, max?: number }} opts
 * @returns {{ format: "json" | "protobuf", payload: unknown }}
 * @throws {RefusCorpsOtlp}
 */
export function decoderCorpsOtlp(brut, { signal, contentType, contentEncoding, max = MAX_BODY_BYTES }) {
  const format = formatOtlp(contentType);
  if (!format) {
    // Le type reçu n'est PAS recopié dans la réponse : rien de ce que le client
    // envoie ne doit revenir tel quel sous l'origine de la console.
    throw new RefusCorpsOtlp(415, `unsupported content-type (expected ${TYPE_JSON} or ${TYPE_PROTOBUF})`);
  }
  const octets = decompresserOtlp(brut, contentEncoding, max);
  if (format === "json") {
    try {
      return { format, payload: JSON.parse(octets.toString("utf8")) };
    } catch {
      throw new RefusCorpsOtlp(400, "invalid json body");
    }
  }
  try {
    return { format, payload: signal === "logs" ? decoderLogsProtobuf(octets) : decoderTracesProtobuf(octets) };
  } catch (err) {
    if (err instanceof ErreurProtobuf) throw new RefusCorpsOtlp(400, "invalid protobuf body");
    throw err;
  }
}

/**
 * Corps de la réponse à une requête OTLP, dans le format de la requête (la spec
 * OTLP/HTTP : « le serveur DOIT répondre avec le même Content-Type »).
 *   - JSON : l'objet tel quel (`{ partialSuccess: {} }`, `{ error }`…) ;
 *   - protobuf, 2xx : corps VIDE — un `Export*ServiceResponse` sans
 *     `partial_success`, que les exportateurs officiels lisent comme un succès
 *     complet (Go et JS décodent le corps s'il n'est pas vide) ;
 *   - protobuf, 4xx/5xx : un `google.rpc.Status` portant le message d'erreur.
 * @param {"json" | "protobuf"} format
 * @param {number} statut
 * @param {unknown} corps
 * @returns {{ contentType: string, octets: Buffer }}
 */
export function corpsReponseOtlp(format, statut, corps) {
  if (format !== "protobuf") return { contentType: TYPE_JSON, octets: Buffer.from(JSON.stringify(corps)) };
  if (statut >= 200 && statut < 300) return { contentType: TYPE_PROTOBUF, octets: Buffer.alloc(0) };
  const message = corps && typeof corps === "object" && typeof corps.error === "string" ? corps.error : "";
  return { contentType: TYPE_PROTOBUF, octets: encoderStatusProtobuf(message) };
}
