// LA BASCULE VERS console-api : qui sert un écran, une coquille, une écriture — et
// ce que devient un échec du service.
//
// CE QUE CES TESTS EXISTENT POUR EMPÊCHER.
//   - Qu'une session HS256 (signée par la console) parte au service : il ne la
//     connaît pas, l'écran recevrait 401.
//   - Qu'un tirage change d'un rendu à l'autre pour une même session : 10 % des
//     SESSIONS, toujours les mêmes, pas un rendu sur dix.
//   - Qu'une ÉCRITURE à l'issue inconnue (réseau, 5xx, échéance) soit rejouée par la
//     console : la commande a peut-être déjà écrit.
//   - Qu'en mode strict, un échec retombe sur la base : c'est ce que C12 retire.
//   - Qu'un refus de filtre du service devienne une panne : l'écran le traite
//     comme le refus que le chargeur lève en local.
//   - Que la coquille tombe avec le service (F02) : elle s'affiche, partielle.
import { describe, expect, it, vi } from "vitest";
import { COMMANDES, ECRANS, ECRANS_ADMIN } from "@mip/console-contract";
import { creerAiguillage, DISJONCTEUR, seauDe, type Voie } from "../../apps/console/lib/aiguillage-console-api";
import type { Resultat } from "../../apps/console/lib/backend";
import { creerExecutionCommandes, refusDuService } from "../../apps/console/lib/commande";
import { COQUILLE_DEGRADEE, creerChargementEcrans, ErreurConsoleApi } from "../../apps/console/lib/ecran";
import { UnsupportedFilterError } from "../../apps/console/lib/query-compiler";

const ES256 = "es256.jeton.signe";
const HS256 = "hs256.jeton.local";

function aiguillage(o: { branche?: boolean; strict?: boolean; pct?: number; t?: { v: number }; sid?: string | null } = {}) {
  const t = o.t ?? { v: 1_000_000 };
  const journal = { warn: vi.fn(), error: vi.fn() };
  const pourcentage = vi.fn(async () => o.pct ?? 100);
  const a = creerAiguillage({
    env: () => (o.strict ? { CONSOLE_API_STRICT: "1" } : {}),
    branche: () => o.branche ?? true,
    algorithme: (j) => (j === ES256 ? "ES256" : j === HS256 ? "HS256" : null),
    verifier: async (j) => (j === ES256 && o.sid !== null ? { sid: o.sid ?? "session-a" } : null),
    pourcentage,
    maintenant: () => t.v,
    journal,
  });
  return { a, journal, pourcentage, t };
}

describe("l'aiguillage : qui sert", () => {
  it("non branché : la console, sans lire le drapeau ; un mode strict sans service est ignoré et dit une fois", async () => {
    const { a, journal, pourcentage } = aiguillage({ branche: false, strict: true });
    expect(await a.voie("ecrans", ES256)).toEqual({ distante: false, raison: "non_branche", strict: false });
    await a.voie("commandes", ES256);
    expect(journal.error).toHaveBeenCalledTimes(1);
    expect(pourcentage).not.toHaveBeenCalled();
  });

  it("sans session, session HS256, jeton qui ne se vérifie pas : la console", async () => {
    const { a } = aiguillage();
    expect(await a.voie("ecrans", null)).toMatchObject({ distante: false, raison: "sans_session" });
    expect(await a.voie("ecrans", HS256)).toMatchObject({ distante: false, raison: "session_locale" });
    expect(await aiguillage({ sid: null }).a.voie("ecrans", ES256)).toMatchObject({ distante: false, raison: "sans_session" });
  });

  it("le tirage : 0 % → la console ; 100 % → le service, jeton compris", async () => {
    expect(await aiguillage({ pct: 0 }).a.voie("ecrans", ES256)).toMatchObject({ distante: false, raison: "tirage" });
    expect(await aiguillage({ pct: 100 }).a.voie("ecrans", ES256)).toEqual({ distante: true, jeton: ES256, strict: false });
  });

  it("le tirage est STABLE par session : son seau, pas un dé", async () => {
    const seau = await seauDe("session-a");
    expect(seau).toBeGreaterThanOrEqual(0);
    expect(seau).toBeLessThan(100);
    expect(await seauDe("session-a")).toBe(seau);
    // Juste au-dessus du seau : servie ; au seau : pas encore.
    expect((await aiguillage({ pct: seau + 1 }).a.voie("ecrans", ES256)).distante).toBe(true);
    expect((await aiguillage({ pct: seau }).a.voie("ecrans", ES256)).distante).toBe(false);
    // Sur 2 000 sessions, la part servie suit le pourcentage.
    const seaux = await Promise.all(Array.from({ length: 2_000 }, (_, i) => seauDe(`sid-${i}`)));
    const part = seaux.filter((s) => s < 30).length / seaux.length;
    expect(part).toBeGreaterThan(0.26);
    expect(part).toBeLessThan(0.34);
  });

  it("le disjoncteur : 5 échecs en 30 s coupent la famille 60 s, l'autre non ; le mode strict l'ignore", async () => {
    const { a, t, journal } = aiguillage();
    for (let i = 0; i < DISJONCTEUR.echecsMax; i++) a.echec("ecrans");
    expect(await a.voie("ecrans", ES256)).toMatchObject({ distante: false, raison: "disjoncteur" });
    expect((await a.voie("commandes", ES256)).distante).toBe(true);
    expect(journal.warn).toHaveBeenCalledWith(expect.stringContaining("disjoncteur"), expect.objectContaining({ famille: "ecrans" }));
    t.v += DISJONCTEUR.coupureMs;
    expect((await a.voie("ecrans", ES256)).distante).toBe(true);

    const s = aiguillage({ strict: true, pct: 0 });
    for (let i = 0; i < DISJONCTEUR.echecsMax; i++) s.a.echec("ecrans");
    expect(await s.a.voie("ecrans", ES256)).toEqual({ distante: true, jeton: ES256, strict: true });
  });

  it("des échecs espacés de plus de 30 s n'ouvrent rien", async () => {
    const { a, t } = aiguillage();
    for (let i = 0; i < DISJONCTEUR.echecsMax; i++) {
      a.echec("ecrans");
      t.v += DISJONCTEUR.fenetreMs;
    }
    expect((await a.voie("ecrans", ES256)).distante).toBe(true);
  });
});

// ─── Les écrans ──────────────────────────────────────────────────────────────

const echec = (code: string, statut: number, details?: unknown): Resultat<unknown> => ({
  ok: false,
  code: code as never,
  statut,
  message: `refus ${code}`,
  requestId: "req-service",
  ...(details === undefined ? {} : { details }),
});

function ecrans(voie: Voie, reponse: Resultat<unknown> = { ok: true, data: { etat: "ok", vu: "service" }, requestId: "r" }) {
  const appeler = vi.fn(async () => reponse);
  const chargeur = vi.fn(async (principal: unknown, sp: unknown, chemin: unknown) => ({ etat: "ok", vu: "console", principal, sp, chemin, quand: new Date(0) }));
  const echecs = vi.fn();
  const journal = { warn: vi.fn(), error: vi.fn() };
  const coquilleLocale = vi.fn(async () => ({
    projets: { ok: true as const, data: [{ app_id: "demo", name: "Démo" }] },
    schema: { ok: false as const, raison: "base en panne : 10.0.0.3 refuse" },
    fuseaux: { demo: "Europe/Paris" },
    tickets: null,
  }));
  const e = creerChargementEcrans({
    aiguillage: { voie: async () => voie, echec: echecs },
    appeler,
    jeton: async () => ES256,
    requestId: async () => "req-console",
    principal: async () => ({ email: "a@b", role: "admin", apps: null }),
    journal,
  });
  return { e, appeler, chargeur, echecs, journal, coquilleLocale };
}

const DISTANTE: Voie = { distante: true, jeton: ES256, strict: false };
const STRICTE: Voie = { distante: true, jeton: ES256, strict: true };

describe("un écran servi par console-api", () => {
  it("l'opération, les paramètres de l'URL tels quels, ceux du chemin, le jeton et la référence ; aucun chargeur local", async () => {
    const { e, appeler, chargeur } = ecrans(DISTANTE);
    const l = await e.lireEcran(ECRANS.session, chargeur, { app: "demo", period: "7d" }, { id: "s-1" });
    expect(l).toEqual({ ok: true, data: { etat: "ok", vu: "service" } });
    expect(appeler).toHaveBeenCalledWith(ECRANS.session, { params: { id: "s-1" }, requete: { app: "demo", period: "7d" } }, { jeton: ES256, requestId: "req-console", signal: undefined });
    expect(chargeur).not.toHaveBeenCalled();
  });

  it("servi par la console : le chargeur, sa sortie passée par JSON (la forme du fil)", async () => {
    const { e, appeler, chargeur } = ecrans({ distante: false, raison: "tirage", strict: false });
    const l = await e.lireEcran(ECRANS_ADMIN.comptes, chargeur, { vue: "x" });
    expect(appeler).not.toHaveBeenCalled();
    expect(l).toMatchObject({ ok: true, data: { vu: "console", quand: "1970-01-01T00:00:00.000Z", sp: { vue: "x" } } });
  });

  it("un refus de filtre du service est relevé tel que le chargeur l'aurait levé", async () => {
    const { e, chargeur } = ecrans(DISTANTE, echec("filtre_non_supporte", 400, { code: "unsupported_filter" }));
    const promesse = e.lireEcran(ECRANS.overview, chargeur, { app: "demo" });
    await expect(promesse).rejects.toBeInstanceOf(UnsupportedFilterError);
    await expect(e.lireEcran(ECRANS.overview, chargeur, { app: "demo" })).rejects.toMatchObject({ error: { code: "unsupported_filter" } });
    expect(chargeur).not.toHaveBeenCalled();
  });

  it("un échec de transport : compté, et la console sert (hors strict)", async () => {
    const { e, chargeur, echecs, journal } = ecrans(DISTANTE, echec("indisponible", 503));
    const l = await e.lireEcran(ECRANS.overview, chargeur, { app: "demo" });
    expect(l).toMatchObject({ ok: true, data: { vu: "console" } });
    expect(echecs).toHaveBeenCalledWith("ecrans");
    expect(journal.warn).toHaveBeenCalledWith(expect.stringContaining("en échec"), expect.objectContaining({ operation: "screens.overview", code: "indisponible" }));
  });

  it("un refus avant le chargeur : la console sert, le journal dit l'écart — sans compter d'échec", async () => {
    const { e, chargeur, echecs, journal } = ecrans(DISTANTE, echec("entree_invalide", 400, { champ: "period" }));
    const l = await e.lireEcran(ECRANS.overview, chargeur, { app: "demo", period: ["7d", "24h"] });
    expect(l).toMatchObject({ ok: true, data: { vu: "console" } });
    expect(echecs).not.toHaveBeenCalled();
    expect(journal.warn).toHaveBeenCalledWith(expect.stringContaining("écart"), expect.objectContaining({ code: "entree_invalide" }));
  });

  it("strict : un échec de transport est une erreur d'écran (référence du service), jamais la base", async () => {
    const { e, chargeur } = ecrans(STRICTE, echec("echeance_depassee", 503));
    await expect(e.lireEcran(ECRANS.overview, chargeur, { app: "demo" })).rejects.toBeInstanceOf(ErreurConsoleApi);
    await expect(e.lireEcran(ECRANS.overview, chargeur, { app: "demo" })).rejects.toThrow(/réf\. req-service/);
    expect(chargeur).not.toHaveBeenCalled();
  });

  it("strict : un refus avant le chargeur est rendu à l'appelant (la page suit la porte du middleware)", async () => {
    const { e, chargeur } = ecrans(STRICTE, echec("hors_perimetre", 403));
    expect(await e.lireEcran(ECRANS.overview, chargeur, { app: "autre" })).toEqual({
      ok: false,
      refus: { code: "hors_perimetre", message: "refus hors_perimetre", requestId: "req-service" },
    });
    expect(chargeur).not.toHaveBeenCalled();
  });

  it("strict, sans session valable : « session requise », sans appel ni base", async () => {
    const { e, appeler, chargeur } = ecrans({ distante: false, raison: "sans_session", strict: true });
    expect(await e.lireEcran(ECRANS.overview, chargeur, {})).toMatchObject({ ok: false, refus: { code: "session_requise" } });
    expect(appeler).not.toHaveBeenCalled();
    expect(chargeur).not.toHaveBeenCalled();
  });

  it("strict, session HS256 : la console sert encore (le mode strict suppose AUTH_SECRET retiré)", async () => {
    const { e, chargeur } = ecrans({ distante: false, raison: "session_locale", strict: true });
    expect(await e.lireEcran(ECRANS.overview, chargeur, {})).toMatchObject({ ok: true, data: { vu: "console" } });
  });
});

describe("la coquille", () => {
  const coquilleService = {
    projets: { ok: true, data: [{ app_id: "demo", name: "Démo" }] },
    schema: { ok: true, data: ["rum_session.country"] },
    fuseaux: { demo: "Europe/Paris" },
    tickets: null,
  };

  it("servie par console-api : telle quelle", async () => {
    const { e, appeler, coquilleLocale } = ecrans(DISTANTE, { ok: true, data: coquilleService, requestId: "r" });
    expect(await e.lireCoquille(coquilleLocale)).toEqual(coquilleService);
    expect(appeler).toHaveBeenCalledWith(expect.objectContaining({ id: "console.shell" }), {}, { jeton: ES256, requestId: "req-console" });
    expect(coquilleLocale).not.toHaveBeenCalled();
  });

  it("servie par la console : des sections, la raison d'un échec reste au journal", async () => {
    const { e, coquilleLocale } = ecrans({ distante: false, raison: "tirage", strict: false });
    const c = await e.lireCoquille(coquilleLocale);
    expect(c.schema).toEqual({ ok: false, code: "lecture_en_echec" });
    expect(JSON.stringify(c)).not.toContain("10.0.0.3");
  });

  it("le service en échec : la console la sert (hors strict) ; en strict, elle s'affiche partielle", async () => {
    const hors = ecrans(DISTANTE, echec("reseau", 0));
    expect((await hors.e.lireCoquille(hors.coquilleLocale)).projets).toMatchObject({ ok: true });
    expect(hors.echecs).toHaveBeenCalledWith("ecrans");
    const strict = ecrans(STRICTE, echec("reseau", 0));
    expect(await strict.e.lireCoquille(strict.coquilleLocale)).toEqual(COQUILLE_DEGRADEE);
    expect(strict.coquilleLocale).not.toHaveBeenCalled();
  });
});

// ─── Les écritures ───────────────────────────────────────────────────────────

function commandes(voie: Voie, reponse: Resultat<unknown> = { ok: true, data: { etat: "cree", id: 12 }, requestId: "r" }) {
  const appeler = vi.fn(async () => reponse);
  const locale = vi.fn(async () => ({ ok: true as const, data: { etat: "cree", par: "console" } as never }));
  const echecs = vi.fn();
  const journal = { warn: vi.fn() };
  const executer = creerExecutionCommandes({
    aiguillage: { voie: async () => voie, echec: echecs },
    appeler,
    jeton: async () => ES256,
    requestId: async () => "req-console",
    locale,
    journal,
  });
  return { executer, appeler, locale, echecs, journal };
}

describe("une écriture servie par console-api", () => {
  it("l'opération, `?app=` pour la portée, le chemin, le corps ; la décision rendue telle quelle", async () => {
    const { executer, appeler, locale } = commandes(DISTANTE);
    const r = await executer("activerObjectif", { app: "demo", chemin: { id: "12" }, corps: { active: true } });
    expect(r).toEqual({ ok: true, data: { etat: "cree", id: 12 } });
    expect(appeler).toHaveBeenCalledWith(
      COMMANDES.activerObjectif,
      { params: { id: "12" }, requete: { app: "demo" }, corps: { active: true } },
      { jeton: ES256, requestId: "req-console" },
    );
    expect(locale).not.toHaveBeenCalled();
  });

  it("une commande globale ne porte pas `app` ; un paramètre de chemin absent est refusé sans appel", async () => {
    const { executer, appeler } = commandes(DISTANTE);
    await executer("creerCompte", { corps: { email: "x@y" } });
    expect(appeler).toHaveBeenCalledWith(COMMANDES.creerCompte, { params: {}, corps: { email: "x@y" } }, expect.anything());
    appeler.mockClear();
    expect(await executer("supprimerObjectif", { app: "demo", chemin: { id: "" } })).toEqual({
      ok: false,
      code: "entree_invalide",
      message: "paramètre « id » manquant",
      champ: "id",
    });
    expect(appeler).not.toHaveBeenCalled();
  });

  it("les refus du service sont ceux de la commande ; une session révoquée devient « session requise »", async () => {
    expect(await commandes(DISTANTE, echec("entree_invalide", 400, { champ: "name" })).executer("creerObjectif", { app: "demo", corps: {} })).toEqual({
      ok: false,
      code: "entree_invalide",
      message: "refus entree_invalide",
      champ: "name",
    });
    expect(refusDuService(echec("session_invalide", 401) as never)).toEqual({ code: "session_requise", message: "refus session_invalide" });
    expect(refusDuService(echec("demo_refusee", 403) as never)).toMatchObject({ code: "demo_refusee" });
    expect(refusDuService(echec("debit_depasse", 429) as never)).toBeNull();
  });

  it("rien n'est parti (hôte non vérifié) : la console écrit elle-même, hors strict", async () => {
    const { executer, locale, echecs, journal } = commandes(DISTANTE, echec("hote_non_verifie", 0));
    expect(await executer("creerObjectif", { app: "demo", corps: {} })).toMatchObject({ ok: true, data: { par: "console" } });
    expect(locale).toHaveBeenCalledWith("creerObjectif", { app: "demo", corps: {} }, "req-console");
    expect(echecs).toHaveBeenCalledWith("commandes");
    expect(journal.warn).toHaveBeenCalled();
  });

  it.each([
    ["reseau", 0],
    ["indisponible", 502],
    ["erreur_interne", 500],
    ["echeance_depassee", 503],
    ["debit_depasse", 429],
  ])("issue inconnue (%s) : l'action lève, la console n'écrit JAMAIS à la place", async (code, statut) => {
    const { executer, locale } = commandes(DISTANTE, echec(code, statut));
    await expect(executer("creerObjectif", { app: "demo", corps: {} })).rejects.toBeInstanceOf(ErreurConsoleApi);
    expect(locale).not.toHaveBeenCalled();
  });

  it("strict : même un échec où rien n'est parti lève", async () => {
    const { executer, locale } = commandes(STRICTE, echec("non_branche", 0));
    await expect(executer("creerObjectif", { app: "demo", corps: {} })).rejects.toBeInstanceOf(ErreurConsoleApi);
    expect(locale).not.toHaveBeenCalled();
  });

  it("servie par la console : la commande locale, avec la référence de la requête", async () => {
    const { executer, appeler, locale } = commandes({ distante: false, raison: "tirage", strict: false });
    await executer("creerObjectif", { app: "demo", corps: {} });
    expect(appeler).not.toHaveBeenCalled();
    expect(locale).toHaveBeenCalledWith("creerObjectif", { app: "demo", corps: {} }, "req-console");
  });

  it("strict, sans session : « session requise », sans rien exécuter", async () => {
    const { executer, appeler, locale } = commandes({ distante: false, raison: "sans_session", strict: true });
    expect(await executer("creerObjectif", { app: "demo", corps: {} })).toEqual({ ok: false, code: "session_requise", message: "session requise" });
    expect(appeler).not.toHaveBeenCalled();
    expect(locale).not.toHaveBeenCalled();
  });
});
