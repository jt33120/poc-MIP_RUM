import { describe, expect, it } from "vitest";
import { prepareIdentityErase, prepareIdentitySearch } from "../../apps/console/lib/dsar-identity-actions";
// @ts-expect-error module JS partagé sans déclarations
import { hashIdentity } from "../../packages/backend/lib/identity-hash.mjs";

const RAW = "alice@example.test";
const APP = "identity-action-app";
const SECRET = "identity-action-test-secret";

function expectNoRaw(value: unknown) {
  expect(JSON.stringify(value)).not.toContain(RAW);
}

describe("contrat runtime des Server Actions DSAR identité", () => {
  it("transforme le brut du POST en sortie URL/audit exclusivement pseudonymisée", () => {
    const request = prepareIdentitySearch(APP, "user", RAW, SECRET);
    expect(request.ok).toBe(true);
    expectNoRaw(request);
    if (!request.ok) throw new Error("requête inattendue");
    expect(request.hash).toBe(hashIdentity(SECRET, APP, "user", RAW));
    expect(request.redirectTo).toContain(`identity_hash=${request.hash}`);
    expect(request.auditDetail).toContain(`hash_prefix=${request.hash.slice(0, 12)}`);
  });

  it("recalcule le HMAC de confirmation avant d'autoriser l'effacement", () => {
    const hash = hashIdentity(SECRET, APP, "account", RAW)!;
    const accepted = prepareIdentityErase(APP, "account", hash, RAW, SECRET);
    expect(accepted).toMatchObject({ ok: true, app: APP, kind: "account", hash });
    expectNoRaw(accepted);

    const rejected = prepareIdentityErase(APP, "account", hash, "mallory@example.test", SECRET);
    expect(rejected).toMatchObject({ ok: false, error: "confirm" });
    expectNoRaw(rejected);
  });

  it("refuse les scopes toutes-applications et les types invalides", () => {
    expect(prepareIdentitySearch("all", "user", RAW, SECRET)).toEqual({
      ok: false, error: "app", redirectTo: "/admin/privacy?error=app",
    });
    expect(prepareIdentitySearch(APP, "device", RAW, SECRET)).toEqual({
      ok: false, error: "kind", redirectTo: "/admin/privacy?error=kind",
    });
  });
});
