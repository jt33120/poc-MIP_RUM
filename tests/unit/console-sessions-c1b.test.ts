// C1b — les sessions de console-api, vues de la console (`lib/session-console.ts`).
//
// Les jetons sont ÉMIS par le vrai code du service (`emettreJetonSession`) et
// vérifiés par celui de la console (jose, clé publique seule) : si l'un change
// de format, ce fichier le voit. Le parcours complet (connexion, pages, démo,
// déconnexion) passe en E2E, console branchée sur console-api.
import { describe, expect, it } from "vitest";
import { chargerTrousseau, emettreJetonSession, type Trousseau } from "@mip/console-api";
import {
  algorithmeDuJeton,
  ConsoleApiIndisponible,
  principalConsoleApi,
  verifierJetonConsoleApi,
} from "../../apps/console/lib/session-console";

const SID = "0b7e3a52-4c1d-4f8e-9a61-2d5c8e7f1a09";
const maintenant = () => Math.floor(Date.now() / 1000);

async function trousseau(kid: string): Promise<Trousseau> {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid, alg: "ES256", use: "sig" }] }), { production: false });
}
const env = (t: Trousseau) => ({ SESSION_PUBLIC_JWKS: JSON.stringify(t.jwks) });

describe("C1b — la console vérifie les jetons de console-api avec la clé PUBLIQUE", () => {
  it("un jeton émis par le service : vérifié, avec son id et son drapeau de démo", async () => {
    const t = await trousseau("session-c1b-a");
    const s = maintenant();
    const jeton = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600 });
    expect(algorithmeDuJeton(jeton)).toBe("ES256");
    expect(await verifierJetonConsoleApi(jeton, env(t))).toEqual({ sid: SID, exp: s + 3600, demo: false });
    const demo = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600, demo: true });
    expect((await verifierJetonConsoleApi(demo, env(t)))?.demo).toBe(true);
  });

  it("refusé : autre clé, jeu absent ou illisible, jeton expiré, jeton HS256", async () => {
    const t = await trousseau("session-c1b-a");
    const autre = await trousseau("session-c1b-z");
    const s = maintenant();
    const jeton = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600 });
    expect(await verifierJetonConsoleApi(jeton, env(autre))).toBeNull();
    expect(await verifierJetonConsoleApi(jeton, {})).toBeNull();
    expect(await verifierJetonConsoleApi(jeton, { SESSION_PUBLIC_JWKS: "{pas du json" })).toBeNull();
    const expire = await emettreJetonSession(t, { sid: SID, iat: s - 7200, exp: s - 3600 });
    expect(await verifierJetonConsoleApi(expire, env(t))).toBeNull();
    const hs256 = "eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jIn0.c2lnbmF0dXJl";
    expect(algorithmeDuJeton(hs256)).toBe("HS256");
    expect(await verifierJetonConsoleApi(hs256, env(t))).toBeNull();
  });

  it("une clé PRIVÉE posée par erreur dans SESSION_PUBLIC_JWKS n'est pas utilisée", async () => {
    const t = await trousseau("session-c1b-a");
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const privee = { ...(await crypto.subtle.exportKey("jwk", paire.privateKey)), kid: "session-c1b-a" };
    const s = maintenant();
    const jeton = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600 });
    expect(await verifierJetonConsoleApi(jeton, { SESSION_PUBLIC_JWKS: JSON.stringify({ keys: [privee] }) })).toBeNull();
  });
});

describe("C1b — le principal : la signature ici, le rôle et le périmètre par /v1/me", () => {
  async function cas(reponse: unknown, jetonDemo = false) {
    const t = await trousseau("session-c1b-a");
    const s = maintenant();
    const jeton = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600, ...(jetonDemo ? { demo: true as const } : {}) });
    const appels: string[] = [];
    const client = {
      estBranche: () => true,
      appeler: (async (op: { id: string }) => {
        appels.push(op.id);
        return reponse;
      }) as never,
    };
    return { run: () => principalConsoleApi(jeton, { client, env: env(t) }), appels };
  }

  it("le service répond : le principal, tel que la base le dit", async () => {
    const { run, appels } = await cas({ ok: true, data: { email: "ana@mip.test", role: "admin", apps: ["app-a"], demo: false }, requestId: "r" });
    expect(await run()).toEqual({ email: "ana@mip.test", role: "admin", apps: ["app-a"], demo: false });
    expect(appels).toEqual(["auth.me"]);
  });

  it("session révoquée ou compte désactivé (401) : non connecté", async () => {
    const { run } = await cas({ ok: false, code: "session_invalide", statut: 401, message: "", requestId: "r" });
    expect(await run()).toBeNull();
  });

  it("service injoignable, hôte non vérifié : ce n'est PAS une déconnexion — l'erreur remonte", async () => {
    for (const r of [
      { ok: false, code: "reseau", statut: 0, message: "", requestId: "r1" },
      { ok: false, code: "hote_non_verifie", statut: 0, message: "", requestId: null },
      { ok: false, code: "indisponible", statut: 503, message: "", requestId: "r3" },
    ]) {
      const { run } = await cas(r);
      await expect(run(), r.code).rejects.toBeInstanceOf(ConsoleApiIndisponible);
    }
  });

  it("le jeton et le service doivent dire la même chose de la démo", async () => {
    const { run } = await cas({ ok: true, data: { email: "d@mip.test", role: "viewer", apps: ["a"], demo: true }, requestId: "r" }, false);
    expect(await run()).toBeNull();
  });

  it("console non branchée, ou jeton qui ne vérifie pas : aucun appel", async () => {
    const t = await trousseau("session-c1b-a");
    const s = maintenant();
    const jeton = await emettreJetonSession(t, { sid: SID, iat: s, exp: s + 3600 });
    let appels = 0;
    const client = { estBranche: () => false, appeler: (async () => (appels++, null)) as never };
    expect(await principalConsoleApi(jeton, { client, env: env(t) })).toBeNull();
    const branche = { estBranche: () => true, appeler: (async () => (appels++, null)) as never };
    expect(await principalConsoleApi(jeton, { client: branche, env: env(await trousseau("session-c1b-z")) })).toBeNull();
    expect(appels).toBe(0);
  });
});
