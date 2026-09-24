import { createHash, createHmac } from "node:crypto";

export const IDENTITY_HASH_ENV = "IDENTITY_HASH_SECRET";
export const IDENTITY_FINGERPRINT_ENV = "IDENTITY_HASH_FINGERPRINT";

// ═════════════════════ L'EMPREINTE DU SECRET D'IDENTITÉ (P2) ═════════════════
//
// POURQUOI. `user_id_hash` n'a de valeur que s'il est STABLE : la même personne
// doit donner le même HMAC aujourd'hui et dans six mois, sinon les écrans qui
// comptent des personnes et la recherche RGPD par identité se brisent en deux
// populations. Changer `IDENTITY_HASH_SECRET` — par erreur, par un copier-coller
// tronqué, par une variable partagée Railway écrasée — casse cette continuité
// EN SILENCE : rien n'échoue, les HMAC sont simplement différents.
//
// L'empreinte est la valeur déclarée à côté du secret (`IDENTITY_HASH_FINGERPRINT`)
// qui rend ce changement bruyant : le collector la recalcule au démarrage, et
// un écart refuse la readiness avec une erreur claire. Tant que l'écart dure,
// l'identité est RETIRÉE au lieu d'être hachée : une donnée manquante, jamais
// une donnée incohérente (même règle que le repli local de la console).
//
// SÉPARATION DE DOMAINE. L'empreinte est `sha256("mip-identity-fp/v1\0" + secret)`,
// pas le sha256 nu du secret : elle part sur `/health`, publique, et ne doit
// servir à rien d'autre qu'à se comparer à elle-même. 12 caractères hex (48
// bits) suffisent à distinguer deux secrets ; le secret, lui, fait au moins 32
// caractères aléatoires, donc l'empreinte ne permet pas de le retrouver.
// Outil : `scripts/ops/empreinte-identite.mjs` (lit le secret sur stdin).
const DOMAINE_EMPREINTE = "mip-identity-fp/v1\0";
export const IDENTITY_FINGERPRINT_PATTERN = /^[0-9a-f]{12}$/;

/** Empreinte courte d'un secret d'identité, ou `null` sans secret. */
export function empreinteIdentite(secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;
  return createHash("sha256").update(DOMAINE_EMPREINTE).update(secret).digest("hex").slice(0, 12);
}

/**
 * État de l'identité d'un receveur, tiré du secret et de l'empreinte déclarée.
 *
 *   `absente`      pas de secret : l'identité est retirée (comportement actuel).
 *   `active`       secret ET empreinte concordante : l'identité est hachée.
 *   `non_verifiee` secret SANS empreinte : réservé aux serveurs de développement
 *                  et aux tests ; le service `collector` refuse de démarrer
 *                  dans ce cas (`verifierConfigIdentite`).
 *   `discordante`  l'empreinte ne correspond pas : identité RETIRÉE, readiness
 *                  refusée.
 *
 * `secret` n'est rendu que s'il doit servir au hachage ; `id_fp` est
 * l'empreinte du secret EN PLACE (jamais le secret), `attendue` celle déclarée.
 * @param {string|null|undefined} secret
 * @param {string|null|undefined} declaree
 */
export function etatIdentite(secret, declaree) {
  const idFp = empreinteIdentite(secret);
  if (!idFp) return { etat: "absente", id_fp: null, attendue: declaree ?? null, secret: null };
  if (declaree == null || declaree === "") return { etat: "non_verifiee", id_fp: idFp, attendue: null, secret };
  if (declaree !== idFp) return { etat: "discordante", id_fp: idFp, attendue: declaree, secret: null };
  return { etat: "active", id_fp: idFp, attendue: declaree, secret };
}

/**
 * Règle de configuration du service : un secret sans empreinte déclarée est un
 * refus de démarrer. Rend le message, ou `null`.
 */
export function verifierConfigIdentite({ secret, empreinte }) {
  if (secret && !empreinte) {
    return `${IDENTITY_FINGERPRINT_ENV} est obligatoire dès que ${IDENTITY_HASH_ENV} est posé ` +
      "(calcul : node scripts/ops/empreinte-identite.mjs, le secret sur l'entrée standard)";
  }
  return null;
}
const RAW_USER = "mip.identity.user_id";
const RAW_ACCOUNT = "mip.identity.account_id";
const HASH_USER = "mip.user_id_hash";
const HASH_ACCOUNT = "mip.account_id_hash";
const RAW_KEYS = new Set([RAW_USER, RAW_ACCOUNT]);
const HASH_KEYS = new Set([HASH_USER, HASH_ACCOUNT]);

function scalar(attribute) {
  const value = attribute?.value;
  return typeof value?.stringValue === "string" ? value.stringValue : null;
}

function appIdOf(resource) {
  if (!Array.isArray(resource?.attributes)) return { appId: null, valid: false };
  const values = resource.attributes
    .filter((entry) => entry?.key === "mip.app_id")
    .map(scalar)
    .filter((value) => typeof value === "string" && value.length > 0 && value.length <= 200);
  const uniques = new Set(values);
  return { appId: uniques.size === 1 ? values[0] : null, valid: uniques.size === 1 };
}

/** HMAC app-scopé : un même identifiant ne peut pas être joint entre tenants. */
export function hashIdentity(secret, appId, kind, raw) {
  if (typeof secret !== "string" || !secret || typeof appId !== "string" || !appId) return null;
  if (typeof raw !== "string" || !raw || raw.length > 500) return null;
  return createHmac("sha256", secret)
    .update(appId).update("\0").update(kind).update("\0").update(raw).digest("hex");
}

function secureAttributes(attributes, appId, secret, state) {
  if (!Array.isArray(attributes)) return [];
  const out = attributes.filter((attribute) => !RAW_KEYS.has(attribute?.key) && !HASH_KEYS.has(attribute?.key));
  for (const attribute of attributes) {
    if (!RAW_KEYS.has(attribute?.key)) continue;
    state.identities++;
    const kind = attribute.key === RAW_USER ? "user" : "account";
    const hash = hashIdentity(secret, appId, kind, scalar(attribute));
    if (!hash) {
      state.degraded = true;
      continue;
    }
    out.push({ key: kind === "user" ? HASH_USER : HASH_ACCOUNT, value: { stringValue: hash } });
  }
  return out;
}

/**
 * Remplace les identités brutes dans le document OTLP, en mémoire, avant tout
 * parseur, tampon E2E ou stockage différé. Le cœur partagé ne lit aucun env.
 */
export function secureOtlpIdentities(payload, secret) {
  const state = { identities: 0, degraded: false };
  for (const group of [
    { resources: payload?.resourceSpans, scopes: "scopeSpans", records: "spans" },
    { resources: payload?.resourceLogs, scopes: "scopeLogs", records: "logRecords" },
  ]) {
    for (const resourceItem of Array.isArray(group.resources) ? group.resources : []) {
      const { appId, valid } = appIdOf(resourceItem?.resource);
      resourceItem.resource ??= {};
      resourceItem.resource.attributes = secureAttributes(resourceItem.resource.attributes, valid ? appId : null, secret, state);
      for (const scope of Array.isArray(resourceItem?.[group.scopes]) ? resourceItem[group.scopes] : []) {
        for (const record of Array.isArray(scope?.[group.records]) ? scope[group.records] : []) {
          record.attributes = secureAttributes(record?.attributes, valid ? appId : null, secret, state);
        }
      }
    }
  }
  return { payload, identities: state.identities, degraded: state.degraded };
}
