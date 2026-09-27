// Le retour SSO de la console (branchée sur la base) ne réactive jamais un compte
// désactivé — sur PostgreSQL réel (recette du 26/09/2026).
//
// `tests/unit/oidc-callback-compte-desactive.test.ts` tient la règle contre une
// table simulée ; ce fichier joue la VRAIE route sur le VRAI `@/lib/db`, pour ce
// qu'une simulation ne prouve pas : la sémantique de `on conflict … do update …
// where console_user.active`. Deux cas :
//   · le compte est déjà désactivé quand la personne revient de l'IdP ;
//   · il est désactivé PENDANT le retour, entre la lecture et l'écriture du JIT
//     (un administrateur qui clique au même instant) : l'upsert ne le rouvre pas.
// L'IdP seul est simulé (découverte, échange du code, ID token).
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { effacerAudit } from "../fixtures/effacer-audit";

const { url, crochet } = vi.hoisted(() => {
  const url = process.env.SQL_TEST_DATABASE_URL || null;
  // AVANT l'import de la route : `@/lib/db` lit DATABASE_URL au chargement. Sans
  // base de test, une adresse morte — jamais une variable héritée du shell.
  process.env.DATABASE_URL = url ?? "postgres://absente:absente@127.0.0.1:9/absente";
  process.env.OIDC_ISSUER = "https://idp.jit-sql.test";
  process.env.OIDC_CLIENT_ID = "mip-console";
  process.env.OIDC_CLIENT_SECRET = "secret-de-test";
  process.env.OIDC_REDIRECT_URI = "https://console.test/api/auth/oidc/callback";
  process.env.AUTH_SECRET = "secret-de-test-jit-sql";
  return {
    url,
    /** Appelé avant chaque requête de la route : de quoi glisser une écriture concurrente. */
    crochet: { avant: null as null | ((sql: string) => Promise<void>), email: "" },
  };
});

vi.mock("@/lib/backend", () => ({ backend: () => ({ estBranche: () => false }) }));
vi.mock("@/lib/oidc-remote", () => ({
  discover: async () => ({ issuer: "https://idp.jit-sql.test", jwks_uri: "https://idp.jit-sql.test/jwks", token_endpoint: "https://idp.jit-sql.test/token" }),
  exchangeCode: async () => ({ id_token: "jeton-id" }),
  remoteJwks: () => ({}),
  verifyIdToken: async () => ({ email: crochet.email }),
}));
vi.mock("@/lib/db", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../../apps/console/lib/db")>();
  return {
    ...reel,
    q: async (sql: string, params?: unknown[]) => {
      await crochet.avant?.(sql);
      return reel.q(sql, params);
    },
  };
});

import { GET } from "../../apps/console/app/api/auth/oidc/callback/route";
import { pool } from "../../apps/console/lib/db";

const { NextRequest } = createRequire(`${process.cwd()}/apps/console/package.json`)("next/server") as typeof import("next/server");
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const DESACTIVE = "jit-sql-desactive@client.test";
const CONCURRENT = "jit-sql-concurrent@client.test";

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

const retour = () =>
  new NextRequest("https://console.test/api/auth/oidc/callback?code=code-idp&state=etat", {
    headers: { cookie: "oidc_state=etat; oidc_verifier=verificateur; oidc_nonce=nonce" },
  });

const sessionPosee = (res: Response) =>
  res.headers.getSetCookie().some((c) => c.startsWith("mip_session=") && !c.startsWith("mip_session=;"));

const compte = async (email: string) =>
  (await pool.query<{ role: string; active: boolean; last_login_at: Date | null }>(
    "select role, active, last_login_at from console_user where email = $1",
    [email],
  )).rows[0];

(url ? describe : describe.skip)("retour SSO de la console : un compte désactivé le reste (PostgreSQL)", () => {
  async function nettoyer() {
    await effacerAudit(pool, "user_email = any($1)", [[DESACTIVE, CONCURRENT]]).catch(() => {});
    await pool.query("delete from console_user where email = any($1)", [[DESACTIVE, CONCURRENT]]);
  }

  beforeAll(async () => {
    for (const fichier of migrations()) await pool.query(readFileSync(fichier, "utf8"));
    await nettoyer();
  });

  beforeEach(() => {
    crochet.avant = null;
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("déjà désactivé : refus, pas de session, le compte reste désactivé et intact", async () => {
    await pool.query(
      "insert into console_user (email, password_hash, role, apps, active) values ($1, 'sso:oidc', 'admin', null, false)",
      [DESACTIVE],
    );
    crochet.email = DESACTIVE;

    const res = await GET(retour());

    expect(res.headers.get("location")).toBe("https://console.test/login?error=1");
    expect(sessionPosee(res)).toBe(false);
    expect(await compte(DESACTIVE)).toEqual({ role: "admin", active: false, last_login_at: null });
    const { rows } = await pool.query<{ action: string; detail: string }>(
      "select action, detail from audit_log where user_email = $1",
      [DESACTIVE],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("login_failed");
    expect(JSON.parse(rows[0].detail)).toMatchObject({ method: "sso", raison: "compte_desactive" });
  });

  it("désactivé pendant le retour, entre la lecture et l'écriture du JIT : l'upsert ne le rouvre pas", async () => {
    await pool.query(
      "insert into console_user (email, password_hash, role, apps, active) values ($1, 'sso:oidc', 'viewer', array['app-a'], true)",
      [CONCURRENT],
    );
    crochet.email = CONCURRENT;
    // L'administrateur clique « Désactiver » juste avant l'écriture du JIT.
    crochet.avant = async (sql) => {
      if (/insert into console_user/i.test(sql)) await pool.query("update console_user set active = false where email = $1", [CONCURRENT]);
    };

    const res = await GET(retour());

    expect(res.headers.get("location")).toBe("https://console.test/login?error=1");
    expect(sessionPosee(res)).toBe(false);
    expect(await compte(CONCURRENT)).toEqual({ role: "viewer", active: false, last_login_at: null });
  });
});
