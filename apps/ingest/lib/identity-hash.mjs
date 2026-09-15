import { createHmac } from "node:crypto";

export const IDENTITY_HASH_ENV = "IDENTITY_HASH_SECRET";
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
