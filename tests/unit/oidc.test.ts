// SSO/OIDC (P0) — helpers PURS (lib/oidc.ts) : config, PKCE, URL d'autorisation,
// mapping des claims → rôle/apps. La validation de l'ID token (jose, réseau) et le
// provisioning JIT sont validés respectivement contre l'IdP de test (Keycloak) et
// sur Postgres réel (scripts/verify-oidc-jit.mjs).
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  generatePkce,
  isOidcEnabled,
  mapClaims,
  type OidcConfig,
  oidcConfig,
  randomToken,
} from "../../apps/console/lib/oidc";

const b64url = (b: Buffer) =>
  b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const CFG: OidcConfig = {
  issuer: "https://idp.example",
  clientId: "mip-rum",
  clientSecret: "s3cret",
  redirectUri: "https://console.example/api/auth/oidc/callback",
  scopes: "openid email profile",
  roleClaim: "groups",
  adminValues: ["rum-admins"],
  appsClaim: "rum_apps",
};

describe("generatePkce", () => {
  it("challenge = base64url(sha256(verifier)), S256", () => {
    const { verifier, challenge } = generatePkce();
    expect(challenge).toBe(b64url(createHash("sha256").update(verifier).digest()));
  });
  it("verifier/challenge en base64url (pas de +,/,=)", () => {
    const { verifier, challenge } = generatePkce();
    for (const s of [verifier, challenge]) expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("aléatoire à chaque appel", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("buildAuthorizeUrl", () => {
  it("porte tous les paramètres OIDC + PKCE", () => {
    const url = new URL(
      buildAuthorizeUrl("https://idp.example/authorize", {
        clientId: "mip-rum",
        redirectUri: "https://c/cb",
        scope: "openid email",
        state: "st",
        nonce: "no",
        codeChallenge: "ch",
      }),
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("mip-rum");
    expect(url.searchParams.get("redirect_uri")).toBe("https://c/cb");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("st");
    expect(url.searchParams.get("nonce")).toBe("no");
    expect(url.searchParams.get("code_challenge")).toBe("ch");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("mapClaims", () => {
  it("email normalisé (minuscule, trim)", () => {
    expect(mapClaims({ email: "  Alice@MIP.FR " }, CFG).email).toBe("alice@mip.fr");
  });
  it("repli sur preferred_username sans email", () => {
    expect(mapClaims({ preferred_username: "bob@mip.fr" }, CFG).email).toBe("bob@mip.fr");
  });
  it("lève sans email ni preferred_username", () => {
    expect(() => mapClaims({ sub: "x" }, CFG)).toThrow();
  });
  it("rôle admin si groups ∩ adminValues", () => {
    expect(mapClaims({ email: "a@mip.fr", groups: ["rum-admins", "x"] }, CFG).role).toBe("admin");
  });
  it("rôle viewer si roleClaim présent sans match admin", () => {
    expect(mapClaims({ email: "a@mip.fr", groups: ["users"] }, CFG).role).toBe("viewer");
  });
  it("rôle null si roleClaim non configuré (préserve la console)", () => {
    expect(mapClaims({ email: "a@mip.fr", groups: ["rum-admins"] }, { ...CFG, roleClaim: null }).role).toBeNull();
  });
  it("apps depuis appsClaim (string ou tableau), appsProvided=true", () => {
    expect(mapClaims({ email: "a@mip.fr", rum_apps: ["app-a", "app-b"] }, CFG)).toMatchObject({
      apps: ["app-a", "app-b"], appsProvided: true,
    });
    expect(mapClaims({ email: "a@mip.fr", rum_apps: "solo" }, CFG)).toMatchObject({
      apps: ["solo"], appsProvided: true,
    });
  });
  it("apps non fourni si claim absent → appsProvided=false, apps null", () => {
    expect(mapClaims({ email: "a@mip.fr" }, CFG)).toMatchObject({ apps: null, appsProvided: false });
  });
});

describe("oidcConfig / isOidcEnabled", () => {
  const KEYS = ["OIDC_ISSUER", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET", "OIDC_REDIRECT_URI",
    "OIDC_SCOPES", "OIDC_ROLE_CLAIM", "OIDC_ADMIN_VALUES", "OIDC_APPS_CLAIM"];
  afterEach(() => { for (const k of KEYS) delete process.env[k]; });

  it("null si variables requises absentes", () => {
    expect(oidcConfig()).toBeNull();
    expect(isOidcEnabled()).toBe(false);
  });
  it("parse la config et normalise l'issuer (sans slash final)", () => {
    process.env.OIDC_ISSUER = "https://idp.example/";
    process.env.OIDC_CLIENT_ID = "mip-rum";
    process.env.OIDC_CLIENT_SECRET = "s";
    process.env.OIDC_REDIRECT_URI = "https://c/cb";
    process.env.OIDC_ROLE_CLAIM = "groups";
    process.env.OIDC_ADMIN_VALUES = "rum-admins, ops";
    const c = oidcConfig()!;
    expect(c.issuer).toBe("https://idp.example");
    expect(c.scopes).toBe("openid email profile"); // défaut
    expect(c.adminValues).toEqual(["rum-admins", "ops"]);
    expect(isOidcEnabled()).toBe(true);
  });
});
