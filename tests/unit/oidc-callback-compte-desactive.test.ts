// Le retour SSO de la console (branchée sur la base) ne réactive JAMAIS un compte
// désactivé (recette du 26/09/2026).
//
// Le provisionnement JIT de `app/api/auth/oidc/callback/route.ts` écrivait
// `active = true` à chaque connexion : un administrateur coupait un compte, la
// personne repassait par l'IdP, et le compte revenait — avec une session de 8 h.
// console-api refuse déjà ce cas (`compteSso`, raison `compte_desactive`) ; ce
// fichier tient la même règle sur le chemin de la console.
//
// L'IdP et la base sont simulés : l'IdP rend l'adresse voulue, la base est une
// table `console_user` en mémoire qui exécute l'upsert du JIT à la lettre de son
// SQL (`active = true` dans la mise à jour réactive, `where console_user.active`
// la conditionne). La même règle est jouée sur PostgreSQL réel par
// `tests/integration/oidc-callback-jit-sql.test.ts`.
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la console, pas de la racine : le même module que
// celui que la route charge.
const { NextRequest } = createRequire(`${process.cwd()}/apps/console/package.json`)("next/server") as typeof import("next/server");

const { comptes, requetes, idp } = vi.hoisted(() => {
  process.env.OIDC_ISSUER = "https://idp.recette.test";
  process.env.OIDC_CLIENT_ID = "mip-console";
  process.env.OIDC_CLIENT_SECRET = "secret-de-test";
  process.env.OIDC_REDIRECT_URI = "https://console.test/api/auth/oidc/callback";
  process.env.AUTH_SECRET = "secret-de-test-oidc-callback";
  return {
    comptes: new Map<string, { role: "admin" | "viewer"; apps: string[] | null; active: boolean }>(),
    requetes: [] as { sql: string; params: unknown[] }[],
    idp: { email: "" },
  };
});

vi.mock("@/lib/backend", () => ({ backend: () => ({ estBranche: () => false }) }));
vi.mock("@/lib/oidc-remote", () => ({
  discover: async () => ({ issuer: "https://idp.recette.test", jwks_uri: "https://idp.recette.test/jwks", token_endpoint: "https://idp.recette.test/token" }),
  exchangeCode: async () => ({ id_token: "jeton-id" }),
  remoteJwks: () => ({}),
  verifyIdToken: async () => ({ email: idp.email }),
}));
vi.mock("@/lib/db", () => ({
  q: vi.fn(async (sql: string, params: unknown[] = []) => {
    requetes.push({ sql, params });
    if (/^\s*select\b[\s\S]*from console_user/i.test(sql)) {
      const c = comptes.get(String(params[0]));
      return c ? [{ ...c }] : [];
    }
    if (/insert into console_user/i.test(sql)) {
      const [email, role, apps] = params as [string, "admin" | "viewer", string[] | null];
      const rend = /\breturning\b/i.test(sql) ? [{ email }] : [];
      const existant = comptes.get(email);
      if (!existant) {
        comptes.set(email, { role, apps, active: true });
        return rend;
      }
      const miseAJour = sql.split(/do update/i)[1] ?? "";
      if (/where\s+console_user\.active\b/i.test(miseAJour) && !existant.active) return [];
      existant.role = role;
      existant.apps = apps;
      if (/\bactive\s*=\s*true\b/i.test(miseAJour)) existant.active = true;
      return rend;
    }
    return [];
  }),
}));

import { GET } from "../../apps/console/app/api/auth/oidc/callback/route";

/** Le retour de l'IdP, avec les cookies de transaction posés au départ. */
function retour() {
  return new NextRequest("https://console.test/api/auth/oidc/callback?code=code-idp&state=etat", {
    headers: { cookie: "oidc_state=etat; oidc_verifier=verificateur; oidc_nonce=nonce" },
  });
}

const cookieDeSession = (res: Response) =>
  res.headers.getSetCookie().find((c) => c.startsWith("mip_session=") && !c.startsWith("mip_session=;"));

beforeEach(() => {
  comptes.clear();
  requetes.length = 0;
});

describe("GET /api/auth/oidc/callback — un compte désactivé le reste", () => {
  it("compte désactivé : refus, aucune session, le compte reste désactivé", async () => {
    idp.email = "ancien@client.test";
    comptes.set("ancien@client.test", { role: "admin", apps: null, active: false });

    const res = await GET(retour());

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://console.test/login?error=1");
    expect(cookieDeSession(res)).toBeUndefined();
    expect(comptes.get("ancien@client.test")).toEqual({ role: "admin", apps: null, active: false });
    // La raison est au journal d'audit, jamais au navigateur.
    const audit = requetes.filter((r) => r.sql.includes("audit_log"));
    expect(audit).toHaveLength(1);
    expect(audit[0].params[0]).toBe("ancien@client.test");
    expect(audit[0].sql).toContain("login_failed");
    expect(JSON.parse(String(audit[0].params[1]))).toMatchObject({ method: "sso", raison: "compte_desactive" });
  });

  it("compte actif : connexion, rôle géré dans la console préservé", async () => {
    idp.email = "actif@client.test";
    comptes.set("actif@client.test", { role: "admin", apps: ["app-a"], active: true });

    const res = await GET(retour());

    expect(res.headers.get("location")).toBe("https://console.test/");
    expect(cookieDeSession(res)).toBeDefined();
    expect(comptes.get("actif@client.test")).toEqual({ role: "admin", apps: ["app-a"], active: true });
  });

  it("première connexion : compte créé actif, en lecture", async () => {
    idp.email = "nouveau@client.test";

    const res = await GET(retour());

    expect(res.headers.get("location")).toBe("https://console.test/");
    expect(cookieDeSession(res)).toBeDefined();
    expect(comptes.get("nouveau@client.test")).toMatchObject({ role: "viewer", active: true });
  });
});
