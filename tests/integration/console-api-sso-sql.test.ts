// C1c — le SSO de console-api contre un FAUX fournisseur d'identité, sur PostgreSQL.
//
// L'IdP est simulé dans le processus (découverte, `/token` qui VÉRIFIE le PKCE,
// JWKS RS256), et joint par le `fetch` injecté du module OIDC : aucun réseau.
// Tout le reste est réel — pipeline, table, transactions, v91. Ce que ce fichier
// prouve, et que le SSO d'avant ne tenait pas :
//   · un compte SSO est retrouvé par (émetteur, sujet), plus jamais par l'e-mail ;
//   · une adresse non attestée par l'IdP ne lie ni ne crée aucun compte ;
//   · un compte désactivé le reste ; un compte lié à un autre sujet est refusé ;
//   · l'IdP ne donne jamais la portée plateforme ; un compte créé n'a aucune app ;
//   · état, nonce, transaction, émetteur, audience : chacun refusé s'il ment ;
//   · chaque refus laisse sa raison au journal d'audit, jamais au navigateur.
//
//   SQL_TEST_DATABASE_URL=<base jetable> pnpm test:sql
import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  chargerTrousseau,
  creerConsoleApi,
  creerDebitAuth,
  creerOidc,
  creerTable,
  creerVerificateurSession,
  type ConfigOidc,
  type Transacteur,
} from "@mip/console-api";
import { ECRANS_FACTICES } from "../fixtures/ecrans-factices";
import { COMMANDES_FACTICES } from "../fixtures/commandes-factices";

// jose, celui du paquet (sa dépendance) : il signe les ID tokens du faux IdP.
const { exportJWK, generateKeyPair, SignJWT } = createRequire(join(__dirname, "..", "..", "packages", "console-api", "package.json"))("jose") as typeof import("jose");

const url = process.env.SQL_TEST_DATABASE_URL;
const SQL_DIR = join(__dirname, "..", "..", "packages", "db", "sql");
const SECRET = randomBytes(24).toString("hex");
const IDP = "https://idp.sso-c1c.test";
const CLIENT = "mip-console";
const DOMAINE = "client-c1c.test";
const PREFIXE = "c1c-";
const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function migrations(): string[] {
  const version = (f: string) => Number(f.match(/\d+/)![0]);
  return ["schema.sql", ...readdirSync(SQL_DIR)
    .filter((f) => /^migration-v\d+\.sql$/.test(f))
    .sort((a, b) => version(a) - version(b))]
    .map((f) => join(SQL_DIR, f));
}

/** Le faux IdP : ce que `/authorize` aurait reçu, et les claims à rendre pour chaque code. */
async function fauxIdp(opts: { emetteurAnnonce?: string } = {}) {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "idp-1", alg: "RS256", use: "sig" };
  const codes = new Map<string, { claims: Record<string, unknown>; challenge: string; nonce: string; signe?: { iss?: string; aud?: string; nonce?: string } }>();
  const fetch = (async (entree: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(entree));
    const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { "content-type": "application/json" } });
    if (u.pathname === "/.well-known/openid-configuration") {
      return json({ issuer: opts.emetteurAnnonce ?? IDP, authorization_endpoint: `${IDP}/authorize`, token_endpoint: `${IDP}/token`, jwks_uri: `${IDP}/jwks` });
    }
    if (u.pathname === "/jwks") return json({ keys: [jwk] });
    if (u.pathname === "/token") {
      const p = new URLSearchParams(String(init?.body));
      const c = codes.get(p.get("code") ?? "");
      if (!c) return json({ error: "invalid_grant" }, 400);
      // Le PKCE, vérifié comme un vrai IdP le fait.
      const empreinte = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(p.get("code_verifier") ?? ""))).toString("base64url");
      if (empreinte !== c.challenge || p.get("client_id") !== CLIENT) return json({ error: "invalid_grant" }, 400);
      const id_token = await new SignJWT({ ...c.claims, nonce: c.signe?.nonce ?? c.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "idp-1" })
        .setIssuer(c.signe?.iss ?? IDP)
        .setAudience(c.signe?.aud ?? CLIENT)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      return json({ id_token, access_token: "a" });
    }
    return json({ error: "not_found" }, 404);
  }) as typeof globalThis.fetch;
  /** Ce que fait le navigateur chez l'IdP : l'utilisateur s'authentifie, l'IdP renvoie un code. */
  function autoriser(urlAutorisation: string, claims: Record<string, unknown>, signe?: { iss?: string; aud?: string; nonce?: string }) {
    const a = new URL(urlAutorisation);
    const code = randomBytes(8).toString("hex");
    codes.set(code, { claims, challenge: a.searchParams.get("code_challenge")!, nonce: a.searchParams.get("nonce")!, signe });
    return { code, state: a.searchParams.get("state")! };
  }
  return { fetch, autoriser };
}

(url ? describe : describe.skip)("C1c — SSO de console-api (faux IdP, PostgreSQL)", () => {
  const pool = new pg.Pool(url ? { connectionString: url, max: 4 } : {});
  const transacteur: Transacteur = {
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query("begin");
        const r = await fn(c);
        await c.query("commit");
        return r;
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    },
  };
  const cfg: ConfigOidc = {
    issuer: IDP,
    clientId: CLIENT,
    clientSecret: "secret-client-oidc",
    redirectUri: "https://console.test/api/auth/oidc/callback",
    scopes: "openid email profile",
    roleClaim: "groups",
    adminValues: ["mip-admins"],
    appsClaim: null,
    domainesAutorises: [DOMAINE],
    cleTransaction: new Uint8Array(randomBytes(32)),
  };
  let idp: Awaited<ReturnType<typeof fauxIdp>>;
  let api: (r: Request) => Promise<Response>;
  let n = 0;

  async function service(config: ConfigOidc, fetchIdp: typeof fetch) {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid: "session-c1c", alg: "ES256", use: "sig" }] }), { production: false });
    const sessions = await creerVerificateurSession({ trousseau, db: pool });
    const { table } = await creerTable({
      trousseau,
      version: "c1c",
      db: pool,
      identite: {
        transacteur,
        debit: await creerDebitAuth(SECRET),
        verifierMotDePasse: async () => false,
        hachageFactice: "",
        demo: null,
        oublierSession: (sid) => sessions.oublier(sid),
        oidc: { client: creerOidc(config, { fetch: fetchIdp }), config },
      },
      ecrans: ECRANS_FACTICES,
      commandes: COMMANDES_FACTICES,
    });
    return creerConsoleApi({ table, secretsClient: [SECRET], journal, verifierSession: sessions.verifier, lecteur: pool, debitParMinute: 0 });
  }

  const appel = (a: typeof api, chemin: string, o: { methode?: string; corps?: unknown; jeton?: string } = {}) =>
    a(new Request(`https://console-api.test${chemin}`, {
      method: o.methode ?? "GET",
      headers: {
        "x-mip-client": SECRET,
        "x-request-id": `c1c-requete-${++n}`,
        ...(o.jeton ? { authorization: `Bearer ${o.jeton}` } : {}),
        ...(o.corps ? { "content-type": "application/json" } : {}),
      },
      body: o.corps ? JSON.stringify(o.corps) : undefined,
    }));

  /** Un parcours SSO complet : début, l'IdP, retour. Rend la réponse du retour. */
  async function sso(claims: Record<string, unknown>, o: { signe?: { iss?: string; aud?: string; nonce?: string }; alterer?: (r: { code: string; state: string; transaction: string }) => void } = {}) {
    const debut = await (await appel(api, "/v1/auth/oidc/authorization")).json();
    const { code, state } = idp.autoriser(debut.data.url, claims, o.signe);
    const retour = { code, state, transaction: debut.data.transaction };
    o.alterer?.(retour);
    return appel(api, "/v1/auth/oidc-sessions", { methode: "POST", corps: retour });
  }
  const moi = async (r: Response) => (await (await appel(api, "/v1/me", { jeton: (await r.json()).data.jeton })).json()).data;
  const derniereRaison = async () =>
    JSON.parse((await pool.query("select detail from audit_log where action = 'auth.oidc_refused' order by id desc limit 1")).rows[0].detail).raison;

  async function nettoyer() {
    await pool.query(`delete from console_session where user_id in (select id from console_user where email like '${PREFIXE}%')`);
    await pool.query(`delete from console_user where email like '${PREFIXE}%'`);
  }

  beforeAll(async () => {
    for (const f of migrations()) await pool.query(readFileSync(f, "utf8"));
    await nettoyer();
    idp = await fauxIdp();
    api = await service(cfg, idp.fetch);
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  it("les moyens de connexion le disent : SSO offert, démo fermée", async () => {
    expect((await (await appel(api, "/v1/auth/methods")).json()).data).toEqual({ mot_de_passe: true, sso: true, demo: false });
  });

  it("le début : l'adresse de l'IdP avec PKCE (S256), et une transaction SCELLÉE qui ne se lit pas", async () => {
    const { data } = await (await appel(api, "/v1/auth/oidc/authorization")).json();
    const u = new URL(data.url);
    expect(u.origin + u.pathname).toBe(`${IDP}/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ response_type: "code", client_id: CLIENT, code_challenge_method: "S256" });
    expect(data.transaction.split(".")).toHaveLength(5); // JWE compact
    expect(data.transaction).not.toContain(u.searchParams.get("state"));
  });

  it("personne, adresse attestée dans un domaine autorisé : compte créé, viewer, AUCUNE application", async () => {
    const r = await sso({ sub: "sujet-1", email: `${PREFIXE}nouveau@${DOMAINE}`, email_verified: true });
    expect(r.status).toBe(200);
    expect(await moi(r)).toEqual({ email: `${PREFIXE}nouveau@${DOMAINE}`, role: "viewer", apps: [], demo: false });
    const { rows } = await pool.query("select oidc_iss, oidc_sub, password_hash from console_user where email = $1", [`${PREFIXE}nouveau@${DOMAINE}`]);
    expect(rows[0]).toEqual({ oidc_iss: IDP, oidc_sub: "sujet-1", password_hash: "sso:oidc" });
  });

  it("ensuite retrouvé par (émetteur, sujet) — même si l'IdP change son e-mail", async () => {
    const r = await sso({ sub: "sujet-1", email: `${PREFIXE}renomme@${DOMAINE}`, email_verified: true });
    expect(r.status).toBe(200);
    expect((await moi(r)).email).toBe(`${PREFIXE}nouveau@${DOMAINE}`);
  });

  it("adresse NON attestée, ou hors des domaines autorisés : ni lien, ni création", async () => {
    await pool.query("insert into console_user (email, password_hash, role, apps) values ($1, 'x', 'admin', null)", [`${PREFIXE}admin@${DOMAINE}`]);
    expect((await sso({ sub: "pirate-1", email: `${PREFIXE}admin@${DOMAINE}`, email_verified: false })).status).toBe(401);
    expect(await derniereRaison()).toBe("email_non_verifie");
    expect((await sso({ sub: "pirate-2", email: `${PREFIXE}qui@ailleurs.test`, email_verified: true })).status).toBe(401);
    expect(await derniereRaison()).toBe("domaine_non_autorise");
    const { rows } = await pool.query("select oidc_sub from console_user where email = $1", [`${PREFIXE}admin@${DOMAINE}`]);
    expect(rows[0].oidc_sub).toBeNull();
    expect((await pool.query("select 1 from console_user where email = $1", [`${PREFIXE}qui@ailleurs.test`])).rowCount).toBe(0);
  });

  it("un compte à mot de passe, adresse attestée : lié une fois pour toutes", async () => {
    const r = await sso({ sub: "sujet-admin", email: `${PREFIXE}admin@${DOMAINE}`, email_verified: true, groups: ["mip-admins"] });
    expect(r.status).toBe(200);
    // Le rôle vient du claim ; le périmètre (plateforme, géré dans la console) est préservé.
    expect(await moi(r)).toEqual({ email: `${PREFIXE}admin@${DOMAINE}`, role: "admin", apps: null, demo: false });
    const detail = JSON.parse((await pool.query("select detail from audit_log where action = 'auth.oidc' order by id desc limit 1")).rows[0].detail);
    expect(detail).toEqual({ fournisseur: IDP, lien: "existant" });
  });

  it("un compte déjà lié à un AUTRE sujet : refusé", async () => {
    expect((await sso({ sub: "autre-sujet", email: `${PREFIXE}admin@${DOMAINE}`, email_verified: true })).status).toBe(401);
    expect(await derniereRaison()).toBe("compte_lie_a_un_autre_sujet");
  });

  it("un compte pré-provisionné pour le SSO se lie même sans attestation ; désactivé, il le RESTE", async () => {
    await pool.query("insert into console_user (email, password_hash, role, apps) values ($1, 'sso:oidc', 'viewer', array['app-c1c'])", [`${PREFIXE}prevu@autre.test`]);
    const r = await sso({ sub: "sujet-prevu", email: `${PREFIXE}prevu@autre.test` });
    expect(r.status).toBe(200);
    expect((await moi(r)).apps).toEqual(["app-c1c"]);
    await pool.query("update console_user set active = false where email = $1", [`${PREFIXE}prevu@autre.test`]);
    expect((await sso({ sub: "sujet-prevu", email: `${PREFIXE}prevu@autre.test` })).status).toBe(401);
    expect(await derniereRaison()).toBe("compte_desactive");
    expect((await pool.query("select active from console_user where email = $1", [`${PREFIXE}prevu@autre.test`])).rows[0].active).toBe(false);
  });

  it("état, transaction, nonce, émetteur, audience : chacun refusé s'il ment", async () => {
    const claims = { sub: "sujet-1", email: `${PREFIXE}nouveau@${DOMAINE}`, email_verified: true };
    const cas: [string, Parameters<typeof sso>[1]][] = [
      ["etat_different", { alterer: (r) => (r.state = "etat-forge") }],
      // Un caractère du CHIFFRÉ (4ᵉ segment), pas le dernier du jeton : le dernier
      // caractère base64url d'une étiquette de 16 octets ne porte que des bits de
      // bourrage, et le changer ne change parfois rien (ce test était instable).
      ["transaction_illisible", {
        alterer: (r) => {
          const p = r.transaction.split(".");
          p[3] = (p[3][0] === "A" ? "B" : "A") + p[3].slice(1);
          r.transaction = p.join(".");
        },
      }],
      ["nonce_different", { signe: { nonce: "nonce-forge" } }],
      ["id_token_invalide", { signe: { iss: "https://idp-pirate.test" } }],
      ["id_token_invalide", { signe: { aud: "autre-client" } }],
    ];
    for (const [raison, o] of cas) {
      const r = await sso(claims, o);
      expect(r.status, raison).toBe(401);
      expect((await r.json()).error.message).toBe("connexion SSO refusée");
      expect(await derniereRaison(), raison).toBe(raison);
    }
  });

  it("une découverte qui annonce un autre émetteur : le SSO ne démarre pas (503)", async () => {
    const detourne = await fauxIdp({ emetteurAnnonce: "https://idp-pirate.test" });
    const autre = await service(cfg, detourne.fetch);
    expect((await appel(autre, "/v1/auth/oidc/authorization")).status).toBe(503);
  });

  it("le claim d'applications fait autorité, sans jamais donner la portée plateforme", async () => {
    const avecApps = { ...cfg, appsClaim: "mip_apps" };
    const a = await service(avecApps, idp.fetch);
    const debut = await (await appel(a, "/v1/auth/oidc/authorization")).json();
    const { code, state } = idp.autoriser(debut.data.url, { sub: "sujet-admin", email: `${PREFIXE}admin@${DOMAINE}`, email_verified: true, groups: ["mip-admins"], mip_apps: ["app-x"] });
    const r = await appel(a, "/v1/auth/oidc-sessions", { methode: "POST", corps: { code, state, transaction: debut.data.transaction } });
    expect(r.status).toBe(200);
    const jeton = (await r.json()).data.jeton;
    expect((await (await appel(a, "/v1/me", { jeton })).json()).data).toMatchObject({ role: "admin", apps: ["app-x"] });
  });
});
