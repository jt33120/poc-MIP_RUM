// C0c — console-api : le jeton de session, son vérificateur, et la ressource du
// chemin résolue avant le traitement.
//
// Sans base : le vérificateur lit une base factice qui compte ses requêtes. La
// même chaîne contre PostgreSQL (v90, vrais comptes, vraie révocation) est dans
// `tests/contract/console-api-authz.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { operation } from "@mip/console-contract";
import {
  AUDIENCE_SESSION,
  CACHE_SESSION_MS,
  chargerTrousseau,
  creerConsoleApi,
  creerVerificateurSession,
  DUREE_MAX_SESSION_S,
  EMETTEUR_SESSION,
  emettreJetonSession,
  ErreurContrat,
  lireJetonSession,
  servir,
  signer,
  versBase64url,
  type Lecteur,
  type Trousseau,
} from "@mip/console-api";

const SECRET = "s".repeat(40);
const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const SID = "0b7e3a52-4c1d-4f8e-9a61-2d5c8e7f1a09";
const AUTRE_SID = "7f3c9d10-2b4a-4e6f-8c1d-9a0b1c2d3e4f";
const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);
const S0 = T0 / 1000;

async function cle(kid: string) {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig" };
}
async function trousseau(...kids: string[]): Promise<Trousseau> {
  return chargerTrousseau(JSON.stringify({ keys: await Promise.all(kids.map(cle)) }), { production: true });
}
async function clesPubliques(t: Trousseau) {
  const m = new Map<string, CryptoKey>();
  for (const c of t.toutes) m.set(c.kid, await crypto.subtle.importKey("jwk", { ...c.publique, ext: true }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  return m;
}
const b64 = (v: unknown) => versBase64url(new TextEncoder().encode(JSON.stringify(v)));
/** Un jeton forgé à la main, signé par la clé courante : chaque champ au choix. */
async function forger(t: Trousseau, enTete: Record<string, unknown>, charge: Record<string, unknown>) {
  const corps = `${b64(enTete)}.${b64(charge)}`;
  return `${corps}.${await signer(t.courante, corps)}`;
}
const REV = { iss: EMETTEUR_SESSION, aud: AUDIENCE_SESSION, sid: SID, iat: S0, exp: S0 + 8 * 3600 };

describe("C0c — le jeton de session : exactement ce que ce service émet, rien d'autre", () => {
  it("aller-retour : émis par la clé courante, relu avec ses revendications", async () => {
    const t = await trousseau("session-20260924-a");
    const jeton = await emettreJetonSession(t, { sid: SID, iat: S0, exp: S0 + 3600 });
    const [enTete] = jeton.split(".");
    expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(enTete.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))))).toEqual({
      alg: "ES256",
      typ: "JWT",
      kid: "session-20260924-a",
    });
    expect(await lireJetonSession(jeton, await clesPubliques(t), S0 + 10)).toEqual({ sid: SID, iat: S0, exp: S0 + 3600 });
  });

  it("l'émetteur refuse un identifiant mal formé ou une durée hors bornes", async () => {
    const t = await trousseau("session-20260924-a");
    await expect(emettreJetonSession(t, { sid: "pas-un-uuid", iat: S0, exp: S0 + 60 })).rejects.toThrow(/identifiant/);
    await expect(emettreJetonSession(t, { sid: SID, iat: S0, exp: S0 })).rejects.toThrow(/durée/);
    await expect(emettreJetonSession(t, { sid: SID, iat: S0, exp: S0 + DUREE_MAX_SESSION_S + 1 })).rejects.toThrow(/durée/);
  });

  it("refuse une signature altérée, une charge modifiée, une clé inconnue", async () => {
    const t = await trousseau("session-20260924-a");
    const autre = await trousseau("session-20260924-z");
    const cles = await clesPubliques(t);
    const jeton = await emettreJetonSession(t, { sid: SID, iat: S0, exp: S0 + 3600 });
    const [h, c, s] = jeton.split(".");
    const sAltere = (s[0] === "A" ? "B" : "A") + s.slice(1);
    expect(await lireJetonSession(`${h}.${c}.${sAltere}`, cles, S0)).toBeNull();
    expect(await lireJetonSession(`${h}.${b64({ ...REV, sid: AUTRE_SID })}.${s}`, cles, S0)).toBeNull();
    expect(await lireJetonSession(await emettreJetonSession(autre, { sid: SID, iat: S0, exp: S0 + 3600 }), cles, S0)).toBeNull();
    for (const bizarre of ["", "a.b", "a.b.c.d", `${h}.${c}.`, `${h}.${c}.${s}=`, `${h}.${c}.${"A".repeat(90)}`]) {
      expect(await lireJetonSession(bizarre, cles, S0), bizarre).toBeNull();
    }
  });

  it("refuse tout autre algorithme, et un en-tête qui désigne une clé ailleurs", async () => {
    const t = await trousseau("session-20260924-a");
    const cles = await clesPubliques(t);
    const kid = t.courante.kid;
    for (const enTete of [
      { alg: "none", typ: "JWT", kid },
      { alg: "HS256", typ: "JWT", kid },
      { alg: "ES256", kid },
      { alg: "ES256", typ: "JWT" },
      { alg: "ES256", typ: "JWT", kid, jku: "https://attaquant.test/jwks.json" },
      { alg: "ES256", typ: "JWT", kid, jwk: t.courante.publique },
      { alg: "ES256", typ: "JWT", kid, crit: ["exp"] },
    ]) {
      expect(await lireJetonSession(await forger(t, enTete, REV), cles, S0), JSON.stringify(enTete)).toBeNull();
    }
  });

  it("refuse un autre émetteur, une autre audience, une revendication de trop — un rôle glissé dans le jeton", async () => {
    const t = await trousseau("session-20260924-a");
    const cles = await clesPubliques(t);
    const enTete = { alg: "ES256", typ: "JWT", kid: t.courante.kid };
    expect(await lireJetonSession(await forger(t, enTete, REV), cles, S0)).not.toBeNull();
    for (const charge of [
      { ...REV, iss: "mip-console" },
      { ...REV, aud: "mip-console-api" },
      { ...REV, aud: [AUDIENCE_SESSION] },
      { ...REV, role: "admin" },
      { ...REV, apps: null },
      { ...REV, sid: "admin" },
      { ...REV, iat: String(S0) },
    ]) {
      expect(await lireJetonSession(await forger(t, enTete, charge), cles, S0), JSON.stringify(charge)).toBeNull();
    }
  });

  it("refuse un jeton expiré, émis dans le futur, ou d'une durée impossible", async () => {
    const t = await trousseau("session-20260924-a");
    const cles = await clesPubliques(t);
    const enTete = { alg: "ES256", typ: "JWT", kid: t.courante.kid };
    expect(await lireJetonSession(await forger(t, enTete, REV), cles, REV.exp)).toBeNull();
    expect(await lireJetonSession(await forger(t, enTete, REV), cles, REV.exp - 1)).not.toBeNull();
    expect(await lireJetonSession(await forger(t, enTete, { ...REV, iat: S0 + 120 }), cles, S0)).toBeNull();
    expect(await lireJetonSession(await forger(t, enTete, { ...REV, iat: S0 + 30 }), cles, S0)).not.toBeNull();
    expect(await lireJetonSession(await forger(t, enTete, { ...REV, exp: S0 + DUREE_MAX_SESSION_S + 1 }), cles, S0 + 10)).toBeNull();
  });

  it("pendant une rotation, la clé suivante vérifie aussi ; retirée, plus rien de ce qu'elle a signé", async () => {
    const courante = await cle("session-20260924-a");
    const suivante = await cle("session-20261001-b");
    const avant = await chargerTrousseau(JSON.stringify({ keys: [suivante, courante] }), { production: true });
    const pendant = await chargerTrousseau(JSON.stringify({ keys: [courante, suivante] }), { production: true });
    const apres = await chargerTrousseau(JSON.stringify({ keys: [suivante] }), { production: true });
    const signeParSuivante = await emettreJetonSession(avant, { sid: SID, iat: S0, exp: S0 + 3600 });
    const signeParCourante = await emettreJetonSession(pendant, { sid: SID, iat: S0, exp: S0 + 3600 });
    expect(await lireJetonSession(signeParSuivante, await clesPubliques(pendant), S0)).not.toBeNull();
    expect(await lireJetonSession(signeParCourante, await clesPubliques(apres), S0)).toBeNull();
  });
});

// ─── Le vérificateur : la signature, PUIS la base ─────────────────────────────

type Ligne = Record<string, unknown>;
const COMPTE: Ligne = {
  demo: false, demo_email: null, demo_apps: null, expires_at: new Date(T0 + 8 * 3600_000),
  user_id: "12", email: "ana@mip.test", role: "admin", apps: ["app-a"], active: true,
};
const DEMO: Ligne = {
  demo: true, demo_email: "demo@mip.test", demo_apps: ["app-demo"], expires_at: new Date(T0 + 8 * 3600_000),
  user_id: null, email: null, role: null, apps: null, active: null,
};

function base(lignes: Record<string, Ligne | Error | undefined>) {
  const appels: string[] = [];
  const db: Lecteur = {
    async query(texte: string, valeurs?: readonly unknown[]) {
      const sid = String(valeurs?.[0]);
      appels.push(sid);
      expect(texte).toMatch(/from console_session s\s+left join console_user u/);
      expect(texte).toMatch(/revoked_at is null/);
      const l = lignes[sid];
      if (l instanceof Error) throw l;
      return { rows: (l ? [l] : []) as never[] };
    },
  };
  return { db, appels };
}

async function verificateur(lignes: Record<string, Ligne | Error | undefined>, horloge = () => T0) {
  const t = await trousseau("session-20260924-a");
  const b = base(lignes);
  const v = await creerVerificateurSession({ trousseau: t, db: b.db, horloge });
  const jeton = (sid = SID) => emettreJetonSession(t, { sid, iat: Math.floor(horloge() / 1000), exp: Math.floor(horloge() / 1000) + 8 * 3600 });
  return { v, jeton, appels: b.appels, t };
}

describe("C0c — le vérificateur : le rôle et le périmètre viennent de la base", () => {
  it("un compte : son rôle et son périmètre, relus dans console_user", async () => {
    const { v, jeton } = await verificateur({ [SID]: COMPTE });
    expect(await v.verifier(await jeton())).toEqual({
      kind: "session", sessionId: SID, userId: "12", email: "ana@mip.test", role: "admin", apps: ["app-a"], demo: false,
    });
  });

  it("une démo : viewer par construction, son périmètre figé", async () => {
    const { v, jeton } = await verificateur({ [SID]: DEMO });
    expect(await v.verifier(await jeton())).toEqual({
      kind: "session", sessionId: SID, userId: null, email: "demo@mip.test", role: "viewer", apps: ["app-demo"], demo: true,
    });
  });

  it("refusée : ligne absente (révoquée, expirée, inconnue), compte désactivé, rôle inconnu, démo sans périmètre", async () => {
    const lignes: Record<string, Ligne> = {
      "11111111-1111-4111-8111-111111111111": { ...COMPTE, active: false },
      "22222222-2222-4222-8222-222222222222": { ...COMPTE, role: "superadmin" },
      "33333333-3333-4333-8333-333333333333": { ...DEMO, demo_apps: [] },
      "44444444-4444-4444-8444-444444444444": { ...COMPTE, user_id: null },
    };
    const { v, jeton } = await verificateur(lignes);
    expect(await v.verifier(await jeton(AUTRE_SID))).toBeNull();
    for (const sid of Object.keys(lignes)) expect(await v.verifier(await jeton(sid)), sid).toBeNull();
  });

  it("un jeton mal signé ne coûte AUCUNE requête", async () => {
    const { v, appels } = await verificateur({ [SID]: COMPTE });
    const autre = await trousseau("session-20260924-z");
    expect(await v.verifier(await emettreJetonSession(autre, { sid: SID, iat: S0, exp: S0 + 60 }))).toBeNull();
    expect(await v.verifier("x".repeat(40))).toBeNull();
    expect(appels).toEqual([]);
  });

  it("cache de 30 s : une requête par session, puis relue — c'est le délai maximal d'une révocation", async () => {
    let maintenant = T0;
    const lignes: Record<string, Ligne | undefined> = { [SID]: COMPTE };
    const { v, jeton, appels } = await verificateur(lignes, () => maintenant);
    const j = await jeton();
    for (let i = 0; i < 5; i++) expect(await v.verifier(j)).not.toBeNull();
    expect(appels).toHaveLength(1);
    delete lignes[SID]; // révoquée en base
    maintenant += CACHE_SESSION_MS - 1;
    expect(await v.verifier(j)).not.toBeNull();
    maintenant += 2;
    expect(await v.verifier(j)).toBeNull();
    expect(appels).toHaveLength(2);
  });

  it("une révocation écrite par cette réplique vaut tout de suite (`oublier`)", async () => {
    const lignes: Record<string, Ligne | undefined> = { [SID]: COMPTE };
    const { v, jeton } = await verificateur(lignes);
    const j = await jeton();
    expect(await v.verifier(j)).not.toBeNull();
    delete lignes[SID];
    v.oublier(SID);
    expect(await v.verifier(j)).toBeNull();
  });

  it("le cache ne sert pas une session au-delà de son expiration en base", async () => {
    let maintenant = T0;
    const { v, jeton, appels } = await verificateur({ [SID]: { ...COMPTE, expires_at: new Date(T0 + 5_000) } }, () => maintenant);
    const j = await jeton();
    await v.verifier(j);
    maintenant += 6_000;
    await v.verifier(j);
    expect(appels).toHaveLength(2);
  });

  it("appels simultanés pour la même session : UNE lecture (le sondage de la console)", async () => {
    const { v, jeton, appels } = await verificateur({ [SID]: COMPTE });
    const j = await jeton();
    const r = await Promise.all(Array.from({ length: 8 }, () => v.verifier(j)));
    expect(r.every((p) => p?.kind === "session")).toBe(true);
    expect(appels).toHaveLength(1);
  });

  it("base injoignable : 503 `indisponible`, pas 401 — et rien n'est mis en cache", async () => {
    const lignes: Record<string, Ligne | Error> = { [SID]: new Error("Connection terminated unexpectedly") };
    const { v, jeton, appels } = await verificateur(lignes);
    const j = await jeton();
    await expect(v.verifier(j)).rejects.toMatchObject({ code: "indisponible", statut: 503 });
    expect(await v.verifier(j).catch((e: unknown) => e)).toBeInstanceOf(ErreurContrat);
    lignes[SID] = COMPTE;
    expect(await v.verifier(j)).not.toBeNull();
    expect(appels).toHaveLength(3);
  });
});

// ─── La ressource du chemin, résolue avant le traitement ─────────────────────

describe("C0c — la ressource du chemin : son application confrontée au périmètre, avant le traitement", () => {
  const OBJET = operation<{ id: string }>("essai.tableau", "GET", "/v1/essai/tableaux/{id}");
  const traitement = vi.fn(async ({ params, apps }: { params: { id: string }; apps: readonly string[] | null }) => ({ id: params.id, apps }));
  const TABLEAU_A = "aaaaaaaa-0000-4000-8000-000000000001";
  const TABLEAU_B = "bbbbbbbb-0000-4000-8000-000000000002";
  const requetes: unknown[][] = [];
  const lecteur: Lecteur = {
    async query(texte: string, valeurs?: readonly unknown[]) {
      requetes.push([texte, ...(valeurs ?? [])]);
      const app = { [TABLEAU_A]: "app-a", [TABLEAU_B]: "app-b" }[String(valeurs?.[0])];
      return { rows: (app ? [{ app_id: app }] : []) as never[] };
    },
  };
  const PRINCIPAUX = {
    viewer: { kind: "session", sessionId: "s1", userId: "1", email: "v@mip.test", role: "viewer", apps: ["app-a"], demo: false },
    plateforme: { kind: "session", sessionId: "s2", userId: "2", email: "p@mip.test", role: "admin", apps: null, demo: false },
  } as const;
  const api = creerConsoleApi({
    table: [servir(OBJET, { auth: "session", portee: "ressource", demo: "lecture", ressource: { table: "dashboard", parametre: "id", format: "uuid" } }, traitement)],
    secretsClient: [SECRET],
    journal,
    lecteur,
    verifierSession: async (j) => PRINCIPAUX[j.replace("jeton-de-session-", "") as keyof typeof PRINCIPAUX] ?? null,
  });
  const appel = (id: string, qui: keyof typeof PRINCIPAUX) =>
    api(new Request(`https://console-api.test/v1/essai/tableaux/${id}`, { headers: { "x-mip-client": SECRET, authorization: `Bearer jeton-de-session-${qui}` } }));

  it("dans le périmètre : le traitement reçoit l'application de la ressource", async () => {
    const res = await appel(TABLEAU_A, "viewer");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: TABLEAU_A, apps: ["app-a"] });
    expect(requetes.at(-1)).toEqual(["select app_id from dashboard where id = $1 limit 1", TABLEAU_A]);
  });

  it("ailleurs, ou inexistante : le MÊME 404, et le traitement ne s'exécute pas", async () => {
    traitement.mockClear();
    const ailleurs = await appel(TABLEAU_B, "viewer");
    const absente = await appel("cccccccc-0000-4000-8000-000000000003", "viewer");
    expect([ailleurs.status, absente.status]).toEqual([404, 404]);
    const [a, b] = [await ailleurs.json(), await absente.json()];
    expect(a.error).toEqual(b.error);
    expect(a.error.code).toBe("ressource_inconnue");
    expect(traitement).not.toHaveBeenCalled();
  });

  it("un identifiant mal formé : 404 sans requête", async () => {
    const avant = requetes.length;
    for (const id of ["42", "AAAAAAAA-0000-4000-8000-000000000001", "x' or '1'='1"]) {
      expect((await appel(encodeURIComponent(id), "viewer")).status, id).toBe(404);
    }
    expect(requetes.length).toBe(avant);
  });

  it("administrateur de la plateforme : toute ressource existante", async () => {
    expect((await appel(TABLEAU_B, "plateforme")).status).toBe(200);
  });
});
