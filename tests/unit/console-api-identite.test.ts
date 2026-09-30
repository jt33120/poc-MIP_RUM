// C1 — l'identité de console-api, sans base : les clés du débit d'authentification,
// les politiques des opérations d'identité, l'adresse du visiteur.
//
// La même chose contre PostgreSQL (vraies sessions, vrai bcrypt, vrais compteurs) :
// `tests/integration/console-api-identite-sql.test.ts`.
import { describe, expect, it, vi } from "vitest";
import { identifiantSite, MOT_DE_PASSE_INSCRIPTION, operation, verifierInscription } from "@mip/console-contract";
import { adresseDeDebit, creerConsoleApi, creerDebitAuth, operationsIdentite, REGLES_DEBIT_AUTH, servir, verifierTable, type Lecteur } from "@mip/console-api";
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

  it("l'inscription en libre-service (v107) : 3 tentatives par heure et par IP, puis une heure de blocage", async () => {
    expect(REGLES_DEBIT_AUTH.inscription_ip).toEqual({ max: 3, fenetreS: 3600, blocageS: 3600, plafondS: 3600 });
    // Le préfixe est l'un de ceux qu'admet la contrainte `auth_throttle_cle` de v107.
    expect(await (await creerDebitAuth(SECRET)).cle("inscription_ip", "203.0.113.7")).toMatch(/^inscription_ip:[0-9a-f]{64}$/);
  });

  // Un abonné IPv6 reçoit un /64 : 2^64 adresses. Comptées une à une, trois
  // tentatives par heure ne borneraient rien.
  it("l'adresse d'un compteur d'inscription : une IPv4 entière, une IPv6 par son /64, une IPv4 mappée redevient IPv4", () => {
    expect(adresseDeDebit("203.0.113.7")).toBe("203.0.113.7");
    expect(adresseDeDebit(" 203.0.113.7 ")).toBe("203.0.113.7");
    // Complète, compressée, en capitales : le même /64.
    const slash64 = "2001:db8:a:b::/64";
    for (const ip of ["2001:0db8:000a:000b:1111:2222:3333:4444", "2001:db8:a:b::1", "2001:DB8:A:B:FFFF::", "2001:db8:a:b:0:0:0:0"])
      expect(adresseDeDebit(ip), ip).toBe(slash64);
    expect(adresseDeDebit("2001:db8:a:c::1")).toBe("2001:db8:a:c::/64");
    expect(adresseDeDebit("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(adresseDeDebit("::1")).toBe("0:0:0:0::/64");
    // IPv4 mappée, sous ses deux écritures.
    expect(adresseDeDebit("::ffff:198.51.100.9")).toBe("198.51.100.9");
    expect(adresseDeDebit("::FFFF:c633:6409")).toBe("198.51.100.9");
    expect(adresseDeDebit("0:0:0:0:0:ffff:198.51.100.9")).toBe("198.51.100.9");
    // Illisible : rendue telle quelle (une clé, non regroupée) — jamais une exception.
    for (const ip of ["1:2:3", "1::2::3", "::ffff:300.1.1.1", "1:2:3:4:5:6:7:8:9", "12345::1"]) expect(adresseDeDebit(ip), ip).toBe(ip);
  });

  it("deux adresses du même /64 partagent la même clé ; deux /64 voisins, non", async () => {
    const d = await creerDebitAuth(SECRET);
    const cle = (ip: string) => d.cle("inscription_ip", adresseDeDebit(ip));
    expect(await cle("2001:db8:a:b::1")).toBe(await cle("2001:db8:a:b:dead:beef:0:2"));
    expect(await cle("2001:db8:a:b::1")).not.toBe(await cle("2001:db8:a:c::1"));
    expect(await cle("::ffff:203.0.113.7")).toBe(await cle("203.0.113.7"));
  });
});

describe("C1 — les politiques des opérations d'identité", () => {
  /** `requetes` : ce que les opérations ont demandé à la base (aucune base réelle ici). */
  /** `inscrits` : les adresses que la fausse base dit déjà inscrites. */
  async function table(
    inscription: { parJour: number; debitMaxMin: number; hacher?: (clair: string) => Promise<string> } | null = null,
    requetes: string[] = [],
    inscrits: string[] = [],
  ) {
    const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
    const j = await crypto.subtle.exportKey("jwk", paire.privateKey);
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [{ kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, kid: "session-c1" }] }), { production: false });
    const db: Lecteur = {
      query: async (sql: string, params?: unknown[]) => {
        requetes.push(sql);
        const existe = /from console_user where email = \$1/.test(sql) && inscrits.includes(String(params?.[0]));
        return { rows: existe ? [{ "?column?": 1 }] : [] };
      },
    };
    return operationsIdentite({
      trousseau,
      db,
      transacteur: { transaction: (fn) => fn(db) },
      debit: await creerDebitAuth(SECRET),
      verifierMotDePasse: async () => false,
      hachageFactice: "",
      demo: null,
      oublierSession: () => {},
      inscription: inscription && { parJour: inscription.parJour, debitMaxMin: inscription.debitMaxMin, hacherMotDePasse: inscription.hacher ?? (async () => "haché") },
    });
  }
  const service = async (inscription: { parJour: number; debitMaxMin: number } | null, requetes: string[] = []) =>
    creerConsoleApi({ table: await table(inscription, requetes), secretsClient: [SECRET], journal: { info() {}, warn() {}, error() {} } });
  const appel = (chemin: string, corps?: unknown) =>
    new Request(`https://c.test${chemin}`, {
      method: corps === undefined ? "GET" : "POST",
      headers: { "x-mip-client": SECRET, "x-mip-visitor-ip": "203.0.113.7", ...(corps === undefined ? {} : { "content-type": "application/json" }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  const SAISIE = { email: "ana@exemple.fr", mot_de_passe: "douze-caracteres", nom_site: "Ma boutique", url_site: "https://ma-boutique.fr/panier" };

  it("respectent les règles de la table : toute écriture auditée, refusée à la démo sauf la déconnexion", async () => {
    const t = await table();
    expect(verifierTable(t)).toEqual([]);
    const p = Object.fromEntries(t.map((e) => [e.operation.id, e.politique]));
    expect(p["auth.login"]).toMatchObject({ auth: "public", demo: "refus", audit: "auth.login" });
    expect(p["auth.demo"]).toMatchObject({ auth: "public", demo: "refus", audit: "auth.demo" });
    expect(p["auth.logout"]).toMatchObject({ auth: "session", demo: "lecture", audit: "auth.logout" });
    expect(p["auth.me"]).toMatchObject({ auth: "session", demo: "lecture" });
    // L'inscription (v107) : ouverte à qui n'a pas de session — c'est son objet —,
    // jamais à une démo, et auditée comme une connexion.
    expect(p["auth.signup"]).toMatchObject({ auth: "public", portee: "globale", demo: "refus", audit: "auth.signup" });
    // Aucune ne se passe du secret client : seul le serveur de la console ouvre une session.
    expect(t.every((e) => e.politique.secretClient !== "aucun")).toBe(true);
  });

  it("l'inscription fermée (INSCRIPTIONS_PAR_JOUR=0) : le même 404 qu'un chemin inconnu, et `methods` la dit fermée", async () => {
    const requetes: string[] = [];
    const api = await service(null, requetes);
    const res = await api(appel("/v1/auth/accounts", SAISIE));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("route_inconnue");
    expect((await (await api(appel("/v1/auth/methods"))).json()).data).toMatchObject({ inscription: false });
    expect(requetes).toEqual([]);
  });

  it("l'inscription ouverte : `methods` le dit ; une saisie refusée l'est champ par champ, AVANT la base", async () => {
    const requetes: string[] = [];
    const api = await service({ parJour: 20, debitMaxMin: 120 }, requetes);
    expect((await (await api(appel("/v1/auth/methods"))).json()).data).toMatchObject({ inscription: true });
    for (const [champ, valeur] of [
      ["email", "pas-une-adresse"],
      ["mot_de_passe", "court"],
      ["nom_site", "   "],
      ["url_site", "ftp://ma-boutique.fr"],
    ] as const) {
      const res = await api(appel("/v1/auth/accounts", { ...SAISIE, [champ]: valeur }));
      expect(res.status, champ).toBe(400);
      expect((await res.json()).error, champ).toMatchObject({ code: "entree_invalide", details: { champ } });
    }
    // Une saisie refusée ne coûte ni bcrypt, ni une tentative du compteur par IP.
    expect(requetes).toEqual([]);
  });

  it("une adresse déjà inscrite : 409 AVANT le hachage — la tentative est comptée, bcrypt n'est pas payé", async () => {
    const requetes: string[] = [];
    const hacher = vi.fn(async () => "haché");
    const api = creerConsoleApi({
      table: await table({ parJour: 20, debitMaxMin: 120, hacher }, requetes, ["ana@exemple.fr"]),
      secretsClient: [SECRET],
      journal: { info() {}, warn() {}, error() {} },
    });
    const res = await api(appel("/v1/auth/accounts", SAISIE));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflit");
    expect(hacher).not.toHaveBeenCalled();
    expect(requetes.some((q) => q.includes("insert into auth_throttle"))).toBe(true);
    // Ni verrou, ni site, ni compte : la transaction de l'inscription n'est pas ouverte.
    expect(requetes.filter((q) => /pg_advisory_xact_lock|insert into app_registry|insert into console_user/.test(q))).toEqual([]);
  });
});

describe("Inscription — les règles de saisie, communes à la console et au service", () => {
  const SAISIE = { email: " Ana@Exemple.FR ", mot_de_passe: "douze-caracteres", nom_site: "  Ma boutique ", url_site: " https://ma-boutique.fr:443/panier?x=1 " };

  it("normalise : e-mail en minuscules, nom sans blancs, l'ORIGINE du site (celle que la collecte admettra)", () => {
    expect(verifierInscription(SAISIE)).toEqual({ ok: true, valeur: { email: "ana@exemple.fr", nom: "Ma boutique", origine: "https://ma-boutique.fr" } });
    expect(verifierInscription({ ...SAISIE, url_site: "http://localhost:8080/" })).toMatchObject({ ok: true, valeur: { origine: "http://localhost:8080" } });
  });

  it("refuse le premier champ fautif, dans l'ordre du formulaire", () => {
    const refus = (m: Partial<typeof SAISIE>) => verifierInscription({ ...SAISIE, ...m });
    expect(refus({ email: "ana@exemple" })).toEqual({ ok: false, champ: "email" });
    expect(refus({ email: `${"a".repeat(195)}@exemple.fr` })).toEqual({ ok: false, champ: "email" });
    expect(refus({ email: "x", mot_de_passe: "x" })).toEqual({ ok: false, champ: "email" });
    expect(refus({ nom_site: "" })).toEqual({ ok: false, champ: "nom_site" });
    expect(refus({ nom_site: "n".repeat(201) })).toEqual({ ok: false, champ: "nom_site" });
    for (const url_site of ["ma-boutique.fr", "javascript:alert(1)", "ftp://ma-boutique.fr", `https://exemple.fr/${"a".repeat(2048)}`])
      expect(refus({ url_site }), url_site).toEqual({ ok: false, champ: "url_site" });
  });

  it("mot de passe : 12 caractères au moins, 72 octets au plus (au-delà, bcrypt tronque en silence)", () => {
    expect(MOT_DE_PASSE_INSCRIPTION).toEqual({ min: 12, maxOctets: 72 });
    const mdp = (mot_de_passe: string) => verifierInscription({ ...SAISIE, mot_de_passe }).ok;
    expect(mdp("a".repeat(11))).toBe(false);
    expect(mdp("a".repeat(12))).toBe(true);
    expect(mdp("a".repeat(72))).toBe(true);
    expect(mdp("a".repeat(73))).toBe(false);
    // Des caractères de 2 octets : 36 passent (72 octets), 37 non — la borne est en octets.
    expect(mdp("é".repeat(36))).toBe(true);
    expect(mdp("é".repeat(37))).toBe(false);
    // 12 caractères, comptés comme tels, même hors du plan multilingue de base.
    expect(mdp("😀".repeat(12))).toBe(true);
  });
});

describe("Inscription — l'identifiant du site créé", () => {
  // Le motif de `validateAppId` (apps/console/lib/onboarding.ts) : un identifiant
  // qu'il refuserait ne s'ouvrirait nulle part dans la console.
  const VALIDE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

  it("le nom en minuscules, sans accents ni ponctuation, suivi du suffixe", () => {
    expect(identifiantSite("Ma Boutique", "1a2b")).toBe("ma-boutique-1a2b");
    expect(identifiantSite("Crêperie Éléonore & Fils !", "00ff")).toBe("creperie-eleonore-fils-00ff");
    expect(identifiantSite("--Déjà--vu--", "abcd")).toBe("deja-vu-abcd");
  });

  it("un nom sans lettre latine ni chiffre : « site- » et le suffixe", () => {
    for (const nom of ["", "   ", "!!!", "東京ストア", "—"]) expect(identifiantSite(nom, "beef"), nom).toBe("site-beef");
  });

  it("toujours admis par validateAppId, même d'un nom très long", () => {
    const noms = ["a", "Ma boutique", "x".repeat(200), `${"a".repeat(29)} b`, "é".repeat(80), "a-".repeat(40), "Z9"];
    for (const nom of noms) {
      const id = identifiantSite(nom, "c0de");
      expect(id, nom).toMatch(VALIDE);
      expect(id.length, nom).toBeLessThanOrEqual(35);
    }
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
