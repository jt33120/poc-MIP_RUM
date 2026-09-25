// C1 — l'identité de console-api, sans base : les clés du débit d'authentification,
// les politiques des opérations d'identité, l'adresse du visiteur.
//
// La même chose contre PostgreSQL (vraies sessions, vrai bcrypt, vrais compteurs) :
// `tests/integration/console-api-identite-sql.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { operation } from "@mip/console-contract";
import { creerConsoleApi, creerDebitAuth, operationsIdentite, REGLES_DEBIT_AUTH, servir, verifierTable, type Lecteur } from "@mip/console-api";
import { chargerTrousseau } from "@mip/console-api";

const SECRET = "c".repeat(40);

describe("C1 — le débit d'authentification : des clés HMAC, jamais une IP ni un e-mail", () => {
  it("clé : `<compteur>:<64 hex>`, la même pour le même e-mail quelle que soit la casse", async () => {
    const d = await creerDebitAuth(SECRET);
    const a = await d.cle("email", "Ana@MIP.test");
    expect(a).toMatch(/^email:[0-9a-f]{64}$/);
    expect(await d.cle("email", " ana@mip.test ")).toBe(a);
    expect(a).not.toContain("ana");
  });

  it("séparation : un autre compteur, un autre secret → une autre clé", async () => {
    const d = await creerDebitAuth(SECRET);
    const autre = await creerDebitAuth("e".repeat(40));
    const ip = await d.cle("ip", "203.0.113.7");
    expect((await d.cle("demo_ip", "203.0.113.7")).split(":")[1]).not.toBe(ip.split(":")[1]);
    expect(await autre.cle("ip", "203.0.113.7")).not.toBe(ip);
  });

  it("les règles du plan : 8 / 30 par 10 min, 20 par heure puis délai qui double, 5 démos par heure", () => {
    expect(REGLES_DEBIT_AUTH.ip_email).toMatchObject({ max: 8, fenetreS: 600 });
    expect(REGLES_DEBIT_AUTH.ip).toMatchObject({ max: 30, fenetreS: 600 });
    expect(REGLES_DEBIT_AUTH.email).toMatchObject({ max: 20, fenetreS: 3600, blocageS: 60, plafondS: 3600 });
    expect(REGLES_DEBIT_AUTH.demo_ip).toMatchObject({ max: 5, fenetreS: 3600 });
  });
});

describe("C1 — les politiques des opérations d'identité", () => {
  async function table() {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid: "session-c1" }] }), { production: false });
    const db: Lecteur = { query: async () => ({ rows: [] }) };
    return operationsIdentite({
      trousseau,
      db,
      transacteur: { transaction: (fn) => fn(db) },
      debit: await creerDebitAuth(SECRET),
      verifierMotDePasse: async () => false,
      hachageFactice: "",
      demo: null,
      oublierSession: () => {},
    });
  }

  it("respectent les règles de la table : toute écriture auditée, refusée à la démo sauf la déconnexion", async () => {
    const t = await table();
    expect(verifierTable(t)).toEqual([]);
    const p = Object.fromEntries(t.map((e) => [e.operation.id, e.politique]));
    expect(p["auth.login"]).toMatchObject({ auth: "public", demo: "refus", audit: "auth.login" });
    expect(p["auth.demo"]).toMatchObject({ auth: "public", demo: "refus", audit: "auth.demo" });
    expect(p["auth.logout"]).toMatchObject({ auth: "session", demo: "lecture", audit: "auth.logout" });
    expect(p["auth.me"]).toMatchObject({ auth: "session", demo: "lecture" });
    // Aucune ne se passe du secret client : seul le serveur de la console ouvre une session.
    expect(t.every((e) => e.politique.secretClient !== "aucun")).toBe(true);
  });
});

describe("C1 — l'adresse du visiteur, posée par le serveur de la console", () => {
  const vue = vi.fn(async ({ ipVisiteur }: { ipVisiteur: string | null }) => ({ ipVisiteur }));
  const api = creerConsoleApi({
    table: [servir(operation("essai.ip", "GET", "/v1/essai/ip"), { auth: "public", portee: "globale", demo: "lecture" }, vue)],
    secretsClient: [SECRET],
    journal: { info() {}, warn() {}, error() {} },
  });
  const lire = async (ip?: string) =>
    (await (await api(new Request("https://c.test/v1/essai/ip", { headers: { "x-mip-client": SECRET, ...(ip === undefined ? {} : { "x-mip-visitor-ip": ip }) } }))).json()).data.ipVisiteur;

  it("IPv4, IPv6 : transmises ; tout autre texte, ou rien : null", async () => {
    expect(await lire("203.0.113.7")).toBe("203.0.113.7");
    expect(await lire("2001:DB8::1")).toBe("2001:db8::1");
    expect(await lire()).toBeNull();
    for (const x of ["203.0.113.7, 10.0.0.1", "localhost", "'; drop", "1".repeat(60)]) expect(await lire(x), x).toBeNull();
  });
});
