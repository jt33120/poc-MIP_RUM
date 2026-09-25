// C0a — console-api : le contrat, le routeur, les règles de la table, les clés,
// et CHAQUE garde du pipeline, dans l'ordre où elle s'applique.
//
// Le pipeline ne connaît que `Request` et `Response` : ces tests l'appellent
// directement, sans serveur. Le service lancé pour de vrai (bundle, kit, base)
// est couvert par `tests/contract/console-api-service.test.ts`.
import { describe, expect, it, vi } from "vitest";
import {
  CODES_ERREUR,
  ETAT_PLATEFORME,
  entier,
  facultatif,
  lignesDuContrat,
  messageDePoignee,
  objet,
  operation,
  OPERATIONS,
  parmi,
  chaine,
  cadencePubliee,
  type Operation,
} from "@mip/console-contract";
import {
  chargerTrousseau,
  creerConsoleApi,
  creerDebitAuth,
  creerDebit,
  creerRouteur,
  creerTable,
  echeanceDemandee,
  egaliteConstante,
  empreinte,
  ErreurContrat,
  lireEtatPlateforme,
  servir,
  signer,
  verifierSignature,
  verifierTable,
  type Enregistrement,
  type Lecteur,
  type Principal,
} from "@mip/console-api";
import { cadencePubliee as cadenceConsole } from "../../apps/console/lib/etat-latence";
// @ts-expect-error module ESM, sans déclarations
import { fautesDuBundle } from "../../services/console-api/build.mjs";

const SECRET = "s".repeat(40);
const SECRET_SUIVANT = "t".repeat(40);
const journal = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

async function jeuDeCles(kid = "session-20260924-abcd") {
  const paire = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", paire.privateKey);
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d, kid, alg: "ES256", use: "sig" };
}

/** Les chargeurs d'écrans (C2), inertes : la table réelle les exige. */
const ECRANS_FACTICES = { coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }) };

/** Les dépendances de l'identité (C1), inertes : la table réelle les exige. */
async function identiteFactice() {
  return {
    transacteur: { transaction: <T,>(fn: (c: Lecteur) => Promise<T>) => fn({ query: async () => ({ rows: [] as never[] }) }) },
    debit: await creerDebitAuth("i".repeat(40)),
    verifierMotDePasse: async () => false,
    hachageFactice: "",
    demo: null,
    oublierSession: () => {},
  };
}

/** Une base factice : chaque requête rend les lignes prévues, ou lève. */
function baseFactice(reponses: Record<string, unknown[] | Error>): Lecteur {
  return {
    async query(texte: string) {
      const cle = Object.keys(reponses).find((k) => texte.includes(k));
      const r = cle ? reponses[cle] : [];
      if (r instanceof Error) throw r;
      return { rows: r as never[] };
    },
  };
}

// ─── Une table d'essai qui couvre chaque politique ─────────────────────────────
const LIRE_PUBLIC = operation("essai.public", "GET", "/v1/essai/public");
const LIRE_SESSION = operation("essai.session", "GET", "/v1/essai/session");
const LIRE_APP = operation<Record<string, never>, { jours?: number }>("essai.app", "GET", "/v1/essai/app");
const LIRE_ADMIN = operation("essai.admin", "GET", "/v1/essai/admin");
const LIRE_PLATEFORME = operation("essai.plateforme", "GET", "/v1/essai/plateforme");
const ECRIRE = operation<Record<string, never>, Record<string, never>, { nom: string }>("essai.ecrire", "POST", "/v1/essai/objets");
const LIRE_OBJET = operation<{ id: string }>("essai.objet", "GET", "/v1/essai/objets/{id}");
const LIRE_FIXE = operation("essai.fixe", "GET", "/v1/essai/objets/modeles");
const LENT = operation("essai.lent", "GET", "/v1/essai/lent");
const PANNE = operation("essai.panne", "GET", "/v1/essai/panne");

const TABLE: Enregistrement[] = [
  servir(LIRE_PUBLIC, { auth: "public", portee: "globale", demo: "lecture" }, async () => ({ bonjour: true })),
  servir(LIRE_SESSION, { auth: "session", portee: "globale", demo: "lecture" }, async ({ principal }) => ({ qui: principal.kind })),
  servir(
    LIRE_APP,
    { auth: "session", portee: "app", demo: "lecture", entree: { requete: objet({ jours: facultatif(entier({ min: 1, max: 90 })) }) } },
    async ({ apps, requete }) => ({ apps, requete }),
  ),
  servir(LIRE_ADMIN, { auth: "admin", portee: "globale", demo: "lecture" }, async () => ({ ok: 1 })),
  servir(LIRE_PLATEFORME, { auth: "admin-plateforme", portee: "globale", demo: "lecture" }, async () => ({ ok: 1 })),
  servir(
    ECRIRE,
    { auth: "session", portee: "globale", demo: "refus", audit: "essai.creer", corpsMax: 64, entree: { corps: objet({ nom: chaine({ max: 20 }) }) } },
    async ({ corps }) => ({ cree: corps.nom }),
  ),
  servir(
    LIRE_OBJET,
    { auth: "session", portee: "ressource", demo: "lecture", ressource: { table: "essai_objet", parametre: "id", format: "entier" } },
    async ({ params, apps }) => ({ id: params.id, apps }),
  ),
  servir(LIRE_FIXE, { auth: "session", portee: "globale", demo: "lecture" }, async () => ({ fixe: true })),
  servir(LENT, { auth: "public", portee: "globale", demo: "lecture" }, () => new Promise((r) => setTimeout(() => r({ tard: true }), 400))),
  servir(PANNE, { auth: "public", portee: "globale", demo: "lecture" }, async () => {
    throw new Error("connexion à db.interne.exemple refusée");
  }),
];

const PROFILS: Record<string, Principal> = {
  viewer: { kind: "session", sessionId: "s-viewer", userId: "1", email: "v@mip.test", role: "viewer", apps: ["app-a"], demo: false },
  viewerLarge: { kind: "session", sessionId: "s-vl", userId: "2", email: "vl@mip.test", role: "viewer", apps: ["app-a", "app-b"], demo: false },
  aucuneApp: { kind: "session", sessionId: "s-vide", userId: "3", email: "x@mip.test", role: "viewer", apps: [], demo: false },
  demo: { kind: "session", sessionId: "s-demo", userId: null, email: "demo@mip.test", role: "viewer", apps: ["app-a"], demo: true },
  adminRestreint: { kind: "session", sessionId: "s-ar", userId: "4", email: "ar@mip.test", role: "admin", apps: ["app-a"], demo: false },
  adminPlateforme: { kind: "session", sessionId: "s-ap", userId: "5", email: "ap@mip.test", role: "admin", apps: null, demo: false },
};

function api(opts: Partial<Parameters<typeof creerConsoleApi>[0]> = {}) {
  return creerConsoleApi({
    table: TABLE,
    secretsClient: [SECRET],
    journal,
    verifierSession: async (jeton) => PROFILS[jeton.replace(/^jeton-de-session-/, "")] ?? null,
    // L'objet 42 appartient à app-a ; tout autre identifiant n'existe pas.
    lecteur: {
      async query(texte: string, valeurs?: readonly unknown[]) {
        return { rows: (texte.includes("from essai_objet") && valeurs?.[0] === "42" ? [{ app_id: "app-a" }] : []) as never[] };
      },
    },
    ...opts,
  });
}

function appel(chemin: string, init: { methode?: string; profil?: string; secret?: string | null; entetes?: Record<string, string>; corps?: string } = {}) {
  const entetes: Record<string, string> = { ...(init.entetes ?? {}) };
  if (init.secret !== null) entetes["x-mip-client"] = init.secret ?? SECRET;
  if (init.profil) entetes.authorization = `Bearer jeton-de-session-${init.profil}`;
  return new Request(`https://console-api.test${chemin}`, { method: init.methode ?? "GET", headers: entetes, body: init.corps });
}

async function lire(res: Response) {
  const texte = await res.text();
  return { statut: res.status, corps: texte ? JSON.parse(texte) : null, entetes: res.headers };
}

describe("C0a — le contrat", () => {
  it("un descripteur refuse un identifiant ou un chemin mal formé", () => {
    expect(() => operation("sanspoint", "GET", "/v1/x")).toThrow(/identifiant/);
    expect(() => operation("a.b", "GET", "/v2/x" as `/v1/${string}`)).toThrow(/chemin/);
    expect(() => operation("a.b", "GET", "/v1/X")).toThrow(/chemin/);
    expect(() => operation("a.b", "GET", "/v1/a//b")).toThrow(/chemin/);
    expect(operation("a.b", "GET", "/v1/.well-known/jwks.json").chemin).toBe("/v1/.well-known/jwks.json");
  });

  it("chaque code d'erreur a un statut HTTP d'erreur", () => {
    for (const [code, statut] of Object.entries(CODES_ERREUR)) expect(statut, code).toBeGreaterThanOrEqual(400);
  });

  it("les validateurs rendent la valeur typée, ou le champ en cause", () => {
    const v = objet({ n: entier({ min: 1, max: 5 }), mode: parmi(["a", "b"] as const) });
    expect(v({ n: "3", mode: "a" }, "q")).toEqual({ ok: true, value: { n: 3, mode: "a" } });
    expect(v({ n: "9", mode: "a" }, "q")).toMatchObject({ ok: false, error: { champ: "n" } });
    expect(v({ n: "3", mode: "c" }, "q")).toMatchObject({ ok: false, error: { champ: "mode" } });
    expect(v({ n: "3", mode: "a", intrus: "1" }, "q")).toMatchObject({ ok: false, error: { champ: "intrus", message: "champ inconnu" } });
  });

  it("la cadence publiée : la console lit la MÊME fonction que console-api (C0b)", () => {
    expect(cadenceConsole).toBe(cadencePubliee);
    expect(["5", "15", "30", "7", "05", "150", "", undefined, 15].map(cadencePubliee)).toEqual([5, 15, 30, null, 5, null, null, null, null]);
  });
});

describe("C0a — les règles de la table, vérifiées au démarrage", () => {
  const P = { auth: "session", portee: "globale", demo: "lecture" } as const;
  const faute = (e: Enregistrement[]) => verifierTable(e);
  const op = (id: string, methode: "GET" | "POST" | "DELETE", chemin: `/v1/${string}`) => operation(id, methode, chemin);
  const t = async () => ({});

  it("la table réelle est conforme, et chaque opération du contrat est servie", async () => {
    const { table } = await creerTable({ trousseau: await chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles()] }), { production: true }), version: "abc", db: baseFactice({}), identite: await identiteFactice(), ecrans: ECRANS_FACTICES });
    expect(verifierTable(table)).toEqual([]);
    expect(table.map((e) => e.operation.id).sort()).toEqual(OPERATIONS.map((o) => o.id).sort());
  });

  it("refuse une écriture ouverte à la démo, sans audit, ou exemptée sans motif", () => {
    expect(faute([servir(op("a.b", "POST", "/v1/a"), { ...P, audit: "a.b" }, t)])).toEqual([expect.stringContaining("refusée à la démo")]);
    expect(faute([servir(op("a.b", "POST", "/v1/a"), { ...P, demo: "refus" }, t)])).toEqual([expect.stringContaining("action d'audit")]);
    expect(faute([servir(op("a.b", "POST", "/v1/a"), { ...P, demo: "refus", audit: { exempt: "perso" } }, t)])).toEqual([expect.stringContaining("sans motif")]);
    expect(faute([servir(op("a.b", "POST", "/v1/a"), { ...P, demo: "refus", audit: "Creer" }, t)])).toEqual([expect.stringContaining("mal formée")]);
    expect(faute([servir(op("a.b", "POST", "/v1/a"), { ...P, demo: "refus", audit: { exempt: "objet personnel de l'espace de travail" } }, t)])).toEqual([]);
  });

  it("seule la déconnexion est une écriture permise à la démo", () => {
    expect(faute([servir(op("auth.logout", "DELETE", "/v1/auth/sessions/current"), { ...P, audit: "auth.logout" }, t)])).toEqual([]);
  });

  it("refuse un doublon, un secret client omis hors lecture publique, une portée incohérente", () => {
    expect(faute([servir(op("a.b", "GET", "/v1/a"), P, t), servir(op("a.b", "GET", "/v1/b"), P, t)])).toEqual([expect.stringContaining("en double")]);
    expect(faute([servir(op("a.b", "GET", "/v1/x/{id}"), P, t), servir(op("a.c", "GET", "/v1/x/{nom}"), P, t)])).toEqual([expect.stringContaining("déjà servis")]);
    expect(faute([servir(op("a.b", "GET", "/v1/a"), { ...P, secretClient: "aucun" }, t)])).toEqual([expect.stringContaining("secret client")]);
    expect(faute([servir(op("a.b", "GET", "/v1/a"), { ...P, auth: "public", portee: "app" }, t)])).toEqual([expect.stringContaining("pas de portée")]);
    expect(faute([servir(op("a.b", "GET", "/v1/a"), { ...P, portee: "ressource" }, t)])).toEqual([
      expect.stringContaining("sans identifiant"),
      expect.stringContaining("sans résolveur"),
    ]);
  });

  it("une ressource du chemin déclare sa table, son paramètre et sa forme — en identifiants SQL simples", () => {
    const R = { table: "dashboard", parametre: "id", format: "uuid" } as const;
    expect(faute([servir(op("a.b", "GET", "/v1/d/{id}"), { ...P, portee: "ressource", ressource: R }, t)])).toEqual([]);
    expect(faute([servir(op("a.b", "GET", "/v1/d/{id}"), { ...P, portee: "globale", ressource: R }, t)])).toEqual([expect.stringContaining("sans portée « ressource »")]);
    expect(faute([servir(op("a.b", "GET", "/v1/d/{nom}"), { ...P, portee: "ressource", ressource: R }, t)])).toEqual([expect.stringContaining("pas dans le chemin")]);
    for (const table of ["dashboard; drop table x", "Dashboard", "public.dashboard", ""]) {
      expect(faute([servir(op("a.b", "GET", "/v1/d/{id}"), { ...P, portee: "ressource", ressource: { ...R, table } }, t)]), table).toEqual([expect.stringContaining("table de ressource")]);
    }
    expect(faute([servir(op("a.b", "GET", "/v1/d/{id}"), { ...P, portee: "ressource", ressource: { ...R, colonne: "id = id or true" } }, t)])).toEqual([expect.stringContaining("colonne de ressource")]);
  });

  it("une table qui déclare des ressources exige un lecteur pour les résoudre", () => {
    expect(() => creerConsoleApi({ table: TABLE, secretsClient: [SECRET], journal })).toThrow(/exige `lecteur`/);
  });

  it("un service dont la table viole une règle ne démarre pas", () => {
    expect(() => creerConsoleApi({ table: [servir(op("a.b", "POST", "/v1/a"), P, t)], secretsClient: [SECRET], journal })).toThrow(/table des opérations refusée/);
  });

  it("refuse un secret client absent, trop court, ou plus de deux", () => {
    for (const secretsClient of [[], ["court"], [SECRET, SECRET_SUIVANT, SECRET]]) {
      expect(() => creerConsoleApi({ table: TABLE, secretsClient, journal })).toThrow(/secret client/);
    }
  });
});

describe("C0a — le routeur", () => {
  const r = creerRouteur(TABLE);
  it("un segment fixe l'emporte sur un paramètre", () => {
    expect(r("GET", "/v1/essai/objets/modeles")).toMatchObject({ trouve: true, enregistrement: { operation: { id: "essai.fixe" } } });
    expect(r("GET", "/v1/essai/objets/42")).toMatchObject({ trouve: true, params: { id: "42" } });
  });
  it("décode un paramètre, refuse un parcours", () => {
    expect(r("GET", "/v1/essai/objets/a%20b")).toMatchObject({ params: { id: "a b" } });
    for (const c of ["/v1/essai/objets/..", "/v1/essai/objets/%2F", "/v1/essai/objets/%E0%A4%A", "/v1/essai//objets"]) expect(r("GET", c), c).toMatchObject({ trouve: false, statut: 404 });
  });
  it("une méthode non servie rend 405 et les méthodes permises", () => {
    expect(r("DELETE", "/v1/essai/objets")).toEqual({ trouve: false, statut: 405, permises: ["POST"] });
  });
});

describe("C0a — le pipeline, garde par garde", () => {
  it("sans secret client, ou avec un faux : 404 NU, sans enveloppe ni signature", async () => {
    for (const secret of [null, "faux".repeat(10), `${SECRET}x`]) {
      const res = await api()(appel("/v1/essai/public", { secret }));
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
      expect(res.headers.get("x-mip-console-api")).toBeNull();
      expect(res.headers.get("x-request-id")).toBeNull();
    }
    // Même réponse qu'un chemin inconnu : le service ne se révèle pas.
    const inconnu = await api()(appel("/v1/nulle-part", { secret: null }));
    expect(inconnu.status).toBe(404);
    expect(await inconnu.text()).toBe("");
  });

  it("pendant une rotation, les deux secrets valent", async () => {
    const a = api({ secretsClient: [SECRET_SUIVANT, SECRET] });
    expect((await a(appel("/v1/essai/public", { secret: SECRET }))).status).toBe(200);
    expect((await a(appel("/v1/essai/public", { secret: SECRET_SUIVANT }))).status).toBe(200);
  });

  it("un navigateur (en-tête Origin) est refusé : 403", async () => {
    const { statut, corps } = await lire(await api()(appel("/v1/essai/public", { entetes: { origin: "https://mip-rum-console.vercel.app" } })));
    expect(statut).toBe(403);
    expect(corps.error.code).toBe("origine_refusee");
  });

  it("chemin inconnu 404, méthode non servie 405 avec `allow`", async () => {
    expect((await lire(await api()(appel("/v1/nulle-part")))).corps.error.code).toBe("route_inconnue");
    const m = await lire(await api()(appel("/v1/essai/objets", { methode: "DELETE" })));
    expect(m.statut).toBe(405);
    expect(m.entetes.get("allow")).toBe("POST");
  });

  it("session requise, puis invalide", async () => {
    expect((await lire(await api()(appel("/v1/essai/session")))).corps.error.code).toBe("session_requise");
    expect((await lire(await api()(appel("/v1/essai/session", { profil: "inconnu" })))).corps.error.code).toBe("session_invalide");
    // Sans vérificateur (C0a en production) : aucune opération à session n'est servie.
    expect((await lire(await api({ verifierSession: undefined })(appel("/v1/essai/session", { profil: "viewer" })))).statut).toBe(401);
  });

  it("démo : lecture oui, écriture non", async () => {
    expect((await api()(appel("/v1/essai/session", { profil: "demo" }))).status).toBe(200);
    const e = await lire(await api()(appel("/v1/essai/objets", { methode: "POST", profil: "demo", corps: '{"nom":"x"}', entetes: { "content-type": "application/json" } })));
    expect(e.statut).toBe(403);
    expect(e.corps.error.code).toBe("demo_refusee");
  });

  it("rôle : admin, et admin de plateforme = admin sans restriction de périmètre", async () => {
    expect((await api()(appel("/v1/essai/admin", { profil: "viewer" }))).status).toBe(403);
    expect((await api()(appel("/v1/essai/admin", { profil: "adminRestreint" }))).status).toBe(200);
    expect((await api()(appel("/v1/essai/plateforme", { profil: "adminRestreint" }))).status).toBe(403);
    expect((await api()(appel("/v1/essai/plateforme", { profil: "adminPlateforme" }))).status).toBe(200);
  });

  it("portée app : vérifiée avant le traitement, `all` = le périmètre effectif (F53)", async () => {
    const lireApp = async (q: string, profil: string) => lire(await api()(appel(`/v1/essai/app${q}`, { profil })));
    expect((await lireApp("", "viewer")).corps.error).toMatchObject({ code: "entree_invalide", details: { champ: "app" } });
    expect((await lireApp("?app=app-b", "viewer")).corps.error.code).toBe("hors_perimetre");
    expect((await lireApp("?app=app-a", "viewer")).corps.data.apps).toEqual(["app-a"]);
    expect((await lireApp("?app=all", "viewerLarge")).corps.data.apps).toEqual(["app-a", "app-b"]);
    expect((await lireApp("?app=all", "adminPlateforme")).corps.data.apps).toBeNull();
    expect((await lireApp("?app=all", "aucuneApp")).corps.error.code).toBe("hors_perimetre");
  });

  it("entrée : validée, paramètre inconnu ou répété refusé", async () => {
    const q = async (s: string) => lire(await api()(appel(`/v1/essai/app?app=app-a${s}`, { profil: "viewer" })));
    expect((await q("&jours=7")).corps.data.requete).toEqual({ jours: 7 });
    expect((await q("&jours=900")).corps.error).toMatchObject({ code: "entree_invalide", details: { champ: "jours" } });
    expect((await q("&intrus=1")).corps.error.message).toContain("champ inconnu");
    expect((await q("&jours=1&jours=2")).corps.error.message).toContain("répété");
    expect((await lire(await api()(appel("/v1/essai/public?x=1")))).corps.error.message).toContain("inconnu");
  });

  it("corps : JSON exigé, validé, sous plafond — même sans content-length", async () => {
    const post = async (corps: string, type = "application/json") =>
      lire(await api()(appel("/v1/essai/objets", { methode: "POST", profil: "viewer", corps, entetes: { "content-type": type } })));
    expect((await post('{"nom":"tableau"}')).corps.data).toEqual({ cree: "tableau" });
    expect((await post('{"nom":1}')).corps.error.code).toBe("entree_invalide");
    expect((await post("nom=x", "application/x-www-form-urlencoded")).corps.error.message).toContain("JSON attendu");
    expect((await post("{pas du json")).corps.error.message).toContain("illisible");
    expect((await post(JSON.stringify({ nom: "x".repeat(100) }))).statut).toBe(413);
    const flux = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"nom":"'));
        c.enqueue(new TextEncoder().encode("y".repeat(200)));
        c.close();
      },
    });
    const req = new Request("https://console-api.test/v1/essai/objets", {
      method: "POST",
      headers: { "x-mip-client": SECRET, authorization: "Bearer jeton-de-session-viewer", "content-type": "application/json" },
      body: flux,
      duplex: "half",
    } as RequestInit);
    expect((await api()(req)).status).toBe(413);
  });

  it("débit : par principal, 429 avec retry-after", async () => {
    const a = api({ debitParMinute: 2 });
    const statuts = [];
    for (let i = 0; i < 3; i++) statuts.push((await a(appel("/v1/essai/session", { profil: "viewer" }))).status);
    expect(statuts).toEqual([200, 200, 429]);
    const autre = await a(appel("/v1/essai/session", { profil: "viewerLarge" }));
    expect(autre.status).toBe(200);
    const trop = await a(appel("/v1/essai/session", { profil: "viewer" }));
    expect(trop.headers.get("retry-after")).toMatch(/^\d+$/);
  });

  it("échéance : bornée, et un traitement trop lent rend 503", async () => {
    expect(echeanceDemandee(null, 8000)).toBe(8000);
    expect(echeanceDemandee("50", 8000)).toBe(200);
    expect(echeanceDemandee("99999", 8000)).toBe(15_000);
    expect(echeanceDemandee("-1", 8000)).toBe(8000);
    const { statut, corps } = await lire(await api()(appel("/v1/essai/lent", { entetes: { "x-mip-deadline-ms": "200" } })));
    expect(statut).toBe(503);
    expect(corps.error.code).toBe("echeance_depassee");
  });

  it("une panne rend 500 générique : la raison reste au journal", async () => {
    journal.error.mockClear();
    const { statut, corps } = await lire(await api()(appel("/v1/essai/panne")));
    expect(statut).toBe(500);
    expect(corps.error.code).toBe("erreur_interne");
    expect(JSON.stringify(corps)).not.toContain("db.interne");
    expect(journal.error).toHaveBeenCalledWith("traitement en échec", expect.objectContaining({ operation: "essai.panne", err: expect.stringContaining("db.interne") }));
  });

  it("toute réponse : enveloppe, request_id, no-store, signée — et jamais d'en-tête CORS", async () => {
    const rep = await api()(appel("/v1/essai/public", { entetes: { "x-request-id": "req-abcdef12" } }));
    const { corps, entetes } = await lire(rep);
    expect(corps).toEqual({ meta: { request_id: "req-abcdef12" }, data: { bonjour: true } });
    expect(entetes.get("cache-control")).toBe("no-store");
    expect(entetes.get("x-mip-console-api")).toBe("1");
    expect([...entetes.keys()].filter((k) => k.startsWith("access-control-"))).toEqual([]);
    // Un identifiant de requête mal formé est remplacé, pas propagé.
    const autre = await api()(appel("/v1/essai/public", { entetes: { "x-request-id": "<script>" } }));
    expect(autre.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("un refus levé par un traitement garde son code", async () => {
    const t = [servir(operation("x.y", "GET", "/v1/x"), { auth: "public", portee: "globale", demo: "lecture" }, async () => {
      throw new ErreurContrat("conflit", "révision dépassée", { details: { revision: 3 } });
    })];
    const { statut, corps } = await lire(await creerConsoleApi({ table: t, secretsClient: [SECRET], journal })(appel("/v1/x")));
    expect(statut).toBe(409);
    expect(corps.error).toEqual({ code: "conflit", message: "révision dépassée", details: { revision: 3 } });
  });
});

describe("C0a — la matrice d'autorisations, sur la VRAIE table", () => {
  // Générée depuis les politiques : chaque opération × chaque profil, le statut
  // ATTENDU se déduit de la politique, pas d'une liste écrite à la main.
  function attendu(o: Operation<unknown, unknown, unknown, unknown>, pol: Enregistrement["politique"], profil: string): number {
    if (profil === "sansSecret") return pol.secretClient === "aucun" ? 200 : 404;
    if (profil === "navigateur") return 403;
    // C1 : la connexion sans corps (ni adresse du visiteur) est une entrée invalide,
    // la démo fermée n'existe pas — leur contrat, pas une panne.
    // C1c : le SSO non configuré n'existe pas (404) ; son retour sans corps est une entrée invalide.
    if (pol.auth === "public") return ({ "auth.login": 400, "auth.demo": 404, "auth.oidcStart": 404, "auth.oidc": 400 } as Record<string, number>)[o.id] ?? 200;
    if (profil === "anonyme") return 401;
    return 401; // C0a : aucune session servie (vérificateur absent) — la matrice complète arrive en C0c
  }

  it("chaque opération répond ce que sa politique dit, pour chaque profil", async () => {
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles()] }), { production: true });
    const { table } = await creerTable({ trousseau, version: "abc", db: baseFactice({}), identite: await identiteFactice(), ecrans: ECRANS_FACTICES });
    const service = creerConsoleApi({ table, secretsClient: [SECRET], journal });
    const nonce = "n".repeat(24);
    for (const { operation: o, politique } of table) {
      const chemin = o.id === "ops.version" ? `${o.chemin}?nonce=${nonce}` : o.chemin;
      for (const profil of ["sansSecret", "navigateur", "anonyme", "viewer"]) {
        const req = appel(chemin, {
          methode: o.methode,
          secret: profil === "sansSecret" ? null : SECRET,
          profil: profil === "viewer" ? "viewer" : undefined,
          entetes: profil === "navigateur" ? { origin: "https://ailleurs.test" } : {},
        });
        expect((await service(req)).status, `${o.id} × ${profil}`).toBe(attendu(o, politique, profil));
      }
    }
  });
});

describe("C0a — les clés et la poignée de main", () => {
  it("charge un jeu valide ; refuse JSON illisible, trop de clés, clé publique seule, kid de test en production", async () => {
    const cle = await jeuDeCles();
    await expect(chargerTrousseau(JSON.stringify({ keys: [cle] }), { production: true })).resolves.toMatchObject({ courante: { kid: cle.kid } });
    await expect(chargerTrousseau("{pas du json", { production: false })).rejects.toThrow(/illisible/);
    await expect(chargerTrousseau(JSON.stringify({ keys: [cle, await jeuDeCles("b"), await jeuDeCles("c")] }), { production: false })).rejects.toThrow(/1 ou 2/);
    const { d: _d, ...publique } = cle;
    await expect(chargerTrousseau(JSON.stringify({ keys: [publique] }), { production: false })).rejects.toThrow(/PRIVÉE/);
    await expect(chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles("cle-test-01")] }), { production: true })).rejects.toThrow(/de test refusé/);
    await expect(chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles("cle-test-01")] }), { production: false })).resolves.toBeTruthy();
    await expect(chargerTrousseau(JSON.stringify({ keys: [cle, cle] }), { production: false })).rejects.toThrow(/en double/);
  });

  it("jamais une valeur de clé dans un message d'erreur", async () => {
    const cle = await jeuDeCles("session-x");
    const abimee = { ...cle, x: "AAAA" };
    const err = await chargerTrousseau(JSON.stringify({ keys: [abimee] }), { production: false }).catch((e: Error) => e.message);
    expect(err).toMatch(/invalide/);
    expect(err).not.toContain(cle.d);
  });

  it("signature ES256 : vérifiée par la clé publique, refusée sur un message altéré", async () => {
    const t = await chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles()] }), { production: false });
    const sig = await signer(t.courante, "bonjour");
    expect(await verifierSignature(t.jwks.keys[0], "bonjour", sig)).toBe(true);
    expect(await verifierSignature(t.jwks.keys[0], "bonjouR", sig)).toBe(false);
    expect(await verifierSignature(t.jwks.keys[0], "bonjour", "AAAA")).toBe(false);
    expect(JSON.stringify(t.jwks)).not.toContain('"d"');
  });

  it("la poignée de main : sans secret, signée, avec l'empreinte du contrat servi", async () => {
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles()] }), { production: false });
    const { table, contrat } = await creerTable({ trousseau, version: "deadbeef", db: baseFactice({}), identite: await identiteFactice(), ecrans: ECRANS_FACTICES });
    expect(contrat).toBe(await empreinte(lignesDuContrat(OPERATIONS)));
    const service = creerConsoleApi({ table, secretsClient: [SECRET], journal });
    const nonce = "abcdefghijklmnopqrstuv";
    const { statut, corps } = await lire(await service(appel(`/v1/version?nonce=${nonce}`, { secret: null })));
    expect(statut).toBe(200);
    const v = corps.data;
    expect(v).toMatchObject({ service: "console-api", nonce, version: "deadbeef", contrat, kid: trousseau.courante.kid });
    expect(await verifierSignature(trousseau.jwks.keys[0], messageDePoignee(v), v.signature)).toBe(true);
    // Un nonce rejoué avec la signature d'un autre ne passe pas.
    expect(await verifierSignature(trousseau.jwks.keys[0], messageDePoignee({ ...v, nonce: "x".repeat(22) }), v.signature)).toBe(false);
    expect((await lire(await service(appel("/v1/version?nonce=court", { secret: null })))).statut).toBe(400);
    const jwks = await service(appel("/v1/.well-known/jwks.json", { secret: null }));
    expect(await jwks.json()).toEqual(trousseau.jwks);
  });

  it("égalité en temps constant : ni la longueur ni le préfixe ne changent le verdict", async () => {
    expect(await egaliteConstante(SECRET, SECRET)).toBe(true);
    expect(await egaliteConstante(SECRET, `${SECRET}x`)).toBe(false);
    expect(await egaliteConstante(SECRET, "")).toBe(false);
  });
});

describe("C0a — l'état de la plateforme, lecture par lecture", () => {
  it("lit les trois témoins", async () => {
    const db = baseFactice({
      tenant_usage_daily: [{ t: "2026-09-23 03:00:00+00" }],
      scheduler_lease: [{ t: "2026-09-24 10:15:00+00" }],
      platform_flag: [{ value: "15" }],
    });
    expect(await lireEtatPlateforme(db)).toEqual({
      quotidien: { etat: "lu", date: new Date("2026-09-23T03:00:00Z") },
      tick: { etat: "lu", date: new Date("2026-09-24T10:15:00Z"), cadenceMin: 15 },
    });
  });

  it("une lecture en échec rend « illisible », jamais « jamais exécuté »", async () => {
    const db = baseFactice({ tenant_usage_daily: new Error("relation absente"), scheduler_lease: [{ t: null }], platform_flag: new Error("v87 absente") });
    expect(await lireEtatPlateforme(db)).toEqual({ quotidien: { etat: "illisible" }, tick: { etat: "lu", date: null, cadenceMin: null } });
    const tickIllisible = await lireEtatPlateforme(baseFactice({ scheduler_lease: new Error("x") }));
    expect(tickIllisible.tick).toEqual({ etat: "illisible" });
  });

  it("l'opération est publique mais exige le secret client : c'est la console qui la lit", async () => {
    expect(ETAT_PLATEFORME.chemin).toBe("/v1/public/platform-status");
    const trousseau = await chargerTrousseau(JSON.stringify({ keys: [await jeuDeCles()] }), { production: false });
    const { table } = await creerTable({ trousseau, version: "x", db: baseFactice({ platform_flag: [{ value: "5" }] }), identite: await identiteFactice(), ecrans: ECRANS_FACTICES });
    const service = creerConsoleApi({ table, secretsClient: [SECRET], journal });
    expect((await service(appel("/v1/public/platform-status", { secret: null }))).status).toBe(404);
    expect((await lire(await service(appel("/v1/public/platform-status")))).corps.data.tick.cadenceMin).toBe(5);
  });
});

describe("C0a — la garde du build", () => {
  it("refuse un bundle qui importe l'application console", () => {
    expect(fautesDuBundle(["packages/console-api/src/pipeline.ts", "services/console-api/server.mjs"])).toEqual([]);
    expect(fautesDuBundle(["../../apps/console/lib/db.ts"])).toEqual([expect.stringContaining("apps/console/lib/db.ts")]);
  });
});

describe("C0a — le débit", () => {
  it("fenêtre fixe d'une minute, par clé", () => {
    let t = 0;
    const d = creerDebit({ parMinute: 2, horloge: () => t });
    expect([d.consommer("a"), d.consommer("a"), d.consommer("a")]).toEqual([null, null, 60]);
    expect(d.consommer("b")).toBeNull();
    t = 60_000;
    expect(d.consommer("a")).toBeNull();
    expect(creerDebit({ parMinute: 0 }).consommer("a")).toBeNull();
  });
});
