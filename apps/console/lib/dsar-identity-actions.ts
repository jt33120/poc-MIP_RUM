import { hashIdentity } from "@mip/backend/lib/identity-hash.mjs";
import type { DsarIdentityKind } from "./dsar";

export type IdentityActionError = "app" | "kind" | "empty" | "secret" | "confirm";

type SafeIdentityRequest = {
  ok: true;
  app: string;
  kind: DsarIdentityKind;
  hash: string;
  auditDetail: string;
  redirectTo: string;
};

type RejectedIdentityRequest = { ok: false; error: IdentityActionError; redirectTo: string };

function kindOf(value: string): DsarIdentityKind | null {
  return value === "user" || value === "account" ? value : null;
}

/**
 * Frontière pure du POST de recherche. L'identifiant brut entre comme argument
 * et n'existe dans aucune propriété de sortie : URL et audit ne reçoivent que
 * le HMAC app-scopé.
 */
export function prepareIdentitySearch(
  appValue: string,
  kindValue: string,
  rawValue: string,
  secret: string | undefined,
): SafeIdentityRequest | RejectedIdentityRequest {
  const app = appValue.trim();
  const kind = kindOf(kindValue);
  const raw = rawValue.trim();
  if (!app || app === "all") return { ok: false, error: "app", redirectTo: "/admin/privacy?error=app" };
  if (!kind) return { ok: false, error: "kind", redirectTo: "/admin/privacy?error=kind" };
  if (!raw) return { ok: false, error: "empty", redirectTo: "/admin/privacy?error=empty" };
  const hash = hashIdentity(secret, app, kind, raw);
  if (!hash) return { ok: false, error: "secret", redirectTo: "/admin/privacy?error=secret" };
  return {
    ok: true,
    app,
    kind,
    hash,
    auditDetail: `kind=${kind} app=${app} hash_prefix=${hash.slice(0, 12)}`,
    redirectTo: `/admin/privacy?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${hash}`,
  };
}

/** Même garantie pour la confirmation d'effacement : aucun brut ne ressort. */
export function prepareIdentityErase(
  appValue: string,
  kindValue: string,
  hashValue: string,
  confirmRawValue: string,
  secret: string | undefined,
): SafeIdentityRequest | RejectedIdentityRequest {
  const app = appValue.trim();
  const kind = kindOf(kindValue);
  const hash = hashValue.trim();
  const confirmRaw = confirmRawValue.trim();
  if (!app || app === "all") return { ok: false, error: "app", redirectTo: "/admin/privacy?error=app" };
  if (!kind) return { ok: false, error: "kind", redirectTo: "/admin/privacy?error=kind" };
  const back = `/admin/privacy?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${hash}`;
  if (!/^[0-9a-f]{64}$/.test(hash) || !confirmRaw) {
    return { ok: false, error: "confirm", redirectTo: `${back}&error=confirm` };
  }
  const confirmedHash = hashIdentity(secret, app, kind, confirmRaw);
  if (!confirmedHash) return { ok: false, error: "secret", redirectTo: `${back}&error=secret` };
  if (confirmedHash !== hash) return { ok: false, error: "confirm", redirectTo: `${back}&error=confirm` };
  return {
    ok: true,
    app,
    kind,
    hash,
    auditDetail: `kind=${kind} app=${app} hash_prefix=${hash.slice(0, 12)}`,
    redirectTo: `/admin/privacy?app=${encodeURIComponent(app)}`,
  };
}
