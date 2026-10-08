// AUDIT DU 07/10/2026 — AUCUN IDENTIFIANT DE PERSONNE DANS UNE URL (`/admin/privacy`).
//
// Le HMAC d'une identité métier et l'identifiant d'un visiteur sont des
// identifiants : dans une URL, ils finiraient dans l'historique du navigateur, les
// journaux d'accès et l'en-tête Referer. Ces tests jouent les actions de l'écran et
// son export, et vérifient qu'aucune redirection ni aucun lien n'en porte : la
// demande est scellée dans un cookie (`lib/demande-rgpd.ts`), opaque, qui expire.
import { beforeEach, describe, expect, it, vi } from "vitest";

const HASH = "c0ffee".padEnd(64, "9");
const VISITEUR = "visiteur-brut-77aa31";
const IDENTITE_BRUTE = "alice@example.test";

class Redirection extends Error {
  constructor(readonly url: string) {
    super(`redirect ${url}`);
  }
}
const redirections: string[] = [];
const jar = new Map<string, { value: string; options: Record<string, unknown> }>();
const commandes: { nom: string; entree: unknown }[] = [];
let reponse: (nom: string) => unknown = () => ({ ok: true, data: { etat: "ok" } });

// `next` n'est installé que dans la console : on simule le module que SES fichiers
// résolvent, par son chemin (un `vi.mock("next/headers")` d'ici ne le toucherait pas).
vi.mock("../../apps/console/node_modules/next/navigation.js", () => ({
  redirect: (url: string) => {
    redirections.push(url);
    throw new Redirection(url);
  },
}));
vi.mock("../../apps/console/node_modules/next/cache.js", () => ({ revalidatePath: () => {} }));
vi.mock("../../apps/console/node_modules/next/headers.js", () => ({
  cookies: async () => ({
    get: (nom: string) => (jar.has(nom) ? { name: nom, value: jar.get(nom)!.value } : undefined),
    set: (nom: string, value: string, options: Record<string, unknown>) => void jar.set(nom, { value, options }),
  }),
}));
vi.mock("@/lib/commande", () => ({
  executerCommande: async (nom: string, entree: unknown) => {
    commandes.push({ nom, entree });
    return reponse(nom);
  },
}));
vi.mock("@/lib/commande-suite", () => ({ apresRefus: () => {} }));

const actions = await import("../../apps/console/app/admin/privacy/actions");
const { GET: exporter } = await import("../../apps/console/app/admin/privacy/export/route");
const D = await import("../../apps/console/lib/demande-rgpd");
const { resolveAuthSecret } = await import("../../apps/console/lib/auth");

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(champs)) fd.set(k, v);
  return fd;
}

async function jouer(action: (fd: FormData) => Promise<void>, champs: Record<string, string>): Promise<string> {
  await expect(action(formulaire(champs))).rejects.toBeInstanceOf(Redirection);
  return redirections.at(-1)!;
}

/** Une URL ne porte ni le HMAC, ni l'identifiant de visiteur, ni l'identité brute — ni leurs noms de paramètre. */
function sansIdentifiant(url: string): void {
  for (const interdit of [HASH, VISITEUR, IDENTITE_BRUTE, encodeURIComponent(IDENTITE_BRUTE), "identity_hash", "user="]) {
    expect(url, url).not.toContain(interdit);
  }
}

beforeEach(() => {
  redirections.length = 0;
  commandes.length = 0;
  jar.clear();
  reponse = () => ({ ok: true, data: { etat: "ok" } });
});

describe("/admin/privacy — les actions ne mettent aucun identifiant dans une URL", () => {
  it("recherche par identité : le HMAC est scellé dans un cookie opaque, httpOnly, Strict, borné à l'écran ; l'URL n'en dit rien", async () => {
    reponse = () => ({ ok: true, data: { etat: "ok", hash: HASH } });
    const url = await jouer(actions.searchIdentityAction, { app: "app-a", kind: "user", identity: IDENTITE_BRUTE });
    expect(url).toBe("/admin/privacy");
    const cookie = jar.get(D.COOKIE_DEMANDE_RGPD)!;
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "strict", path: "/admin/privacy", maxAge: D.DUREE_DEMANDE_RGPD_S });
    expect(cookie.value).not.toContain(HASH);
    expect(await D.ouvrirDemande(cookie.value, resolveAuthSecret())).toEqual({ type: "identite", app: "app-a", kind: "user", hash: HASH });
  });

  it("recherche par visiteur : une action serveur (POST), plus un formulaire GET ; l'identifiant reste hors de l'URL", async () => {
    const url = await jouer(actions.searchVisitorAction, { visitor_app: "app-a", user: VISITEUR });
    sansIdentifiant(url);
    const cookie = jar.get(D.COOKIE_DEMANDE_RGPD)!;
    expect(cookie.value).not.toContain(VISITEUR);
    expect(await D.ouvrirDemande(cookie.value, resolveAuthSecret())).toEqual({ type: "visiteur", app: "app-a", visitorId: VISITEUR });
  });

  it("effacements : ni le refus, ni la confirmation manquée, ni le succès ne redirigent avec un identifiant ; le succès oublie la demande", async () => {
    for (const etat of [{ etat: "confirmation" }, { etat: "indisponible" }, { etat: "efface", lignes: 4 }]) {
      reponse = () => ({ ok: true, data: etat });
      sansIdentifiant(await jouer(actions.eraseIdentityAction, { app: "app-a", kind: "user", identity_hash: HASH, confirm_identity: IDENTITE_BRUTE }));
    }
    expect(jar.get(D.COOKIE_DEMANDE_RGPD)?.options.maxAge).toBe(0);
    for (const etat of [{ etat: "confirmation" }, { etat: "interdit" }, { etat: "refus", motif: "refus_empreinte" }, { etat: "efface", lignes: 2 }]) {
      reponse = () => ({ ok: true, data: etat });
      sansIdentifiant(await jouer(actions.eraseUserAction, { app: "app-a", user: VISITEUR, confirm: VISITEUR }));
    }
    reponse = () => ({ ok: false, code: "hors_perimetre", message: "x" });
    sansIdentifiant(await jouer(actions.eraseUserAction, { app: "app-a", user: VISITEUR, confirm: VISITEUR }));
    sansIdentifiant(await jouer(actions.eraseIdentityAction, { app: "app-a", kind: "user", identity_hash: HASH, confirm_identity: "x" }));
    expect(redirections.length).toBeGreaterThan(8);
  });

  it("la page : aucun lien ni formulaire GET ne porte la personne", async () => {
    const { readFileSync } = await import("node:fs");
    const page = readFileSync("apps/console/app/admin/privacy/page.tsx", "utf8");
    expect(page).not.toMatch(/identity_hash=|[?&]user=/);
    expect(page).not.toContain('method="GET"');
    expect(page).toContain('const exportHref = "/admin/privacy/export";');
  });
});

describe("/admin/privacy/export — la personne vient de la demande scellée, pas de l'URL", () => {
  it("sans demande : 400, et aucune commande — même si l'URL porte un identifiant", async () => {
    const r = await exporter();
    expect(r.status).toBe(400);
    expect(commandes).toEqual([]);
  });

  it("avec une demande de visiteur : l'export de CE visiteur", async () => {
    jar.set(D.COOKIE_DEMANDE_RGPD, { value: await D.scellerDemande({ type: "visiteur", app: "app-a", visitorId: VISITEUR }, resolveAuthSecret()), options: {} });
    reponse = () => ({ ok: true, data: { etat: "ok", fichier: "dsar.json", document: { ok: 1 } } });
    const r = await exporter();
    expect(r.status).toBe(200);
    expect(commandes).toEqual([{ nom: "exporterVisiteur", entree: { corps: { app: "app-a", visitor_id: VISITEUR } } }]);
  });

  it("avec une demande d'identité : l'export de CE HMAC, dans son application", async () => {
    jar.set(D.COOKIE_DEMANDE_RGPD, { value: await D.scellerDemande({ type: "identite", app: "app-a", kind: "account", hash: HASH }, resolveAuthSecret()), options: {} });
    reponse = () => ({ ok: true, data: { etat: "ok", fichier: "dsar.json", document: {} } });
    expect((await exporter()).status).toBe(200);
    expect(commandes).toEqual([{ nom: "exporterIdentite", entree: { app: "app-a", corps: { kind: "account", identity_hash: HASH } } }]);
  });
});

describe("la demande scellée (`lib/demande-rgpd.ts`)", () => {
  const SECRET = "secret-de-test-demande-rgpd";

  it("altérée, scellée sous un autre secret, ou expirée : elle ne s'ouvre pas", async () => {
    const t0 = Math.floor(Date.parse("2026-10-08T10:00:00Z") / 1000);
    const jeton = await D.scellerDemande({ type: "visiteur", app: "all", visitorId: VISITEUR }, SECRET, t0);
    const pendant = new Date((t0 + 60) * 1000);
    expect(await D.ouvrirDemande(jeton, SECRET, pendant)).toEqual({ type: "visiteur", app: "all", visitorId: VISITEUR });
    expect(await D.ouvrirDemande(jeton, "un-autre-secret", pendant)).toBeNull();
    const altere = jeton.slice(0, -4) + (jeton.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(await D.ouvrirDemande(altere, SECRET, pendant)).toBeNull();
    expect(await D.ouvrirDemande(jeton, SECRET, new Date((t0 + D.DUREE_DEMANDE_RGPD_S + 5) * 1000))).toBeNull();
    expect(await D.ouvrirDemande(undefined, SECRET)).toBeNull();
  });

  it("une demande mal formée n'est pas scellée", async () => {
    await expect(D.scellerDemande({ type: "identite", app: "app-a", kind: "user", hash: "pas-un-hmac" }, SECRET)).rejects.toThrow();
    await expect(D.scellerDemande({ type: "identite", app: "all", kind: "user", hash: HASH }, SECRET)).rejects.toThrow();
    await expect(D.scellerDemande({ type: "visiteur", app: "app-a", visitorId: "x".repeat(201) }, SECRET)).rejects.toThrow();
  });

  it("les paramètres de l'écran : un identifiant venu de l'URL est écarté, seule la demande en fournit", () => {
    const sp = { app: "app-a", identity_hash: HASH, user: VISITEUR, period: "7d" };
    expect(D.parametresEcranRgpd(sp, null)).toEqual({ app: "app-a", period: "7d" });
    expect(D.parametresEcranRgpd(sp, { type: "visiteur", app: "all", visitorId: "v-2" })).toEqual({ app: "app-a", period: "7d", visitor_app: "all", user: "v-2" });
    expect(D.parametresEcranRgpd({}, { type: "identite", app: "app-b", kind: "account", hash: HASH })).toEqual({ app: "app-b", kind: "account", identity_hash: HASH });
  });
});
