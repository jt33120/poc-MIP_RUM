// PR2 — SDK mobile React Native. Round-trip : les spans mobiles (crash, écran,
// réseau, événement) produits par le cœur sont ingérés par flattenOtlp dans les
// MÊMES tables que le web, avec device_type = mobile. Preuve que le mobile
// réutilise toute la pipeline sans changement serveur.
//
// P6.1 : env et release du SDK voyagent sur chaque signal, et la plateforme
// déclarée (« ios ») devient le système de la session, jamais sa classe.
//
// P7.1 : l'enveloppe rejoint le contrat P2 (contexte, identités, vue, action,
// timing, flag, erreur déclarée), `beforeSend` est isolé, et `mip.user_hash`
// n'est plus émis comme identité personnelle.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildExceptionSpan,
  buildHttpSpan,
  buildPayload,
  buildScreenSpan,
  buildTrackSpan,
  type Ctx,
  type MobileConfig,
} from "../../packages/rum-mobile/src/core";
import { EventContextStore } from "../../packages/rum-sdk/src/event-context";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";
// @ts-expect-error module JS partagé sans déclarations
import { secureOtlpIdentities } from "../../apps/ingest/lib/identity-hash.mjs";

const cfg: MobileConfig = {
  endpoint: "https://i/v1/traces",
  appId: "mon-app",
  apiKey: "mip_mob_123",
  env: "prod",
  clientId: "acme",
  appVersion: "1.2.3",
  userAgent: "MIP-RN/0.1 (ios 17)",
};
const ctx: Ctx = { sessionId: "sess-m", route: "Accueil", userHash: "uh", tz: "Europe/Paris", deviceType: "ios" };
const T = 1_760_000_000_000;

describe("rum-mobile — round-trip OTLP -> flattenOtlp", () => {
  const spans = [
    buildScreenSpan(ctx, T, "aa11bb22cc33dd44"),
    buildExceptionSpan(ctx, { message: "boom for jean@x.fr", type: "TypeError", stack: "at App" }, T + 10, "bb22cc33dd44ee55"),
    buildHttpSpan(ctx, { traceId: "0af7651916cd43dd8448eb211c80319c", url: "https://api.exemple.fr/cart", method: "POST", status: 200, durationMs: 88 }, T + 20, "cc33dd44ee55ff66"),
    buildTrackSpan(ctx, "checkout", { amount: 42, email: "a@b.fr" }, T + 30, "dd44ee55ff667788"),
  ];
  const rows = flattenOtlp(buildPayload(cfg, spans));

  it("crée la session mobile : classe mobile, plateforme portée par le système (P6.1)", () => {
    expect(rows.sessions).toHaveLength(1);
    // « ios » n'est pas une classe d'appareil : le user-agent synthétique du SDK
    // donne mobile, iOS 17, et aucun navigateur.
    expect(rows.sessions[0]).toMatchObject({
      device_type: "mobile", os: "iOS", os_version: "17", browser: null, browser_version: null,
    });
    expect(rows.sessions[0].geo_country).toBe("FR"); // depuis mip.tz
    expect(rows.apiKeys[0]).toEqual({ app_id: "mon-app", api_key: "mip_mob_123" });
  });

  it("route chaque signal dans la bonne table", () => {
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.pageviews[0].route).toBe("Accueil");
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0].kind).toBe("crash");
    expect(rows.errors[0].message).toContain("[email]"); // scrub PII à l'ingestion
    expect(rows.errors[0].release).toBe("1.2.3");
    expect(rows.spans).toHaveLength(1);
    expect(rows.spans[0].tier).toBe("front");
    expect(rows.spans[0].duration_ms).toBe(88);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0].name).toBe("checkout");
    expect(rows.events[0].props).toEqual({ amount: 42, email: "[redacted]" });
    expect(rows.rejected).toBe(0);
  });

  it("recopie env et release sur chaque signal ; le nom constant du SDK n'est pas un service", () => {
    for (const ligne of [...rows.pageviews, ...rows.errors, ...rows.spans, ...rows.events]) {
      expect(ligne).toMatchObject({ env: "prod", release: "1.2.3" });
    }
    expect(rows.errors[0].service).toBeNull();
    expect(rows.spans[0].service).toBeNull();
  });

  it("n'émet plus mip.user_hash : l'ancienne empreinte d'appareil n'est pas une identité", () => {
    // Le champ reste accepté dans le type (compatibilité d'appel) mais ne part
    // plus sur le fil : une session ne doit pas hériter d'un identifiant dont
    // l'ingestion sait qu'il ne répond à aucune demande d'accès RGPD.
    const attributs = JSON.stringify(buildPayload(cfg, spans));
    expect(attributs).not.toContain("mip.user_hash");
    expect(rows.sessions[0].user_hash).toBeNull();
  });
});

// ─────────────────────────── P7.1 — enveloppe RN ────────────────────────────

const ENDPOINT = "https://ingest.test/v1/traces";
const SECRET = "secret-de-test-hmac";

type Lot = Record<string, unknown>;

/**
 * Runtime mobile neuf : état de module remis à zéro, `fetch` capturé. Le SDK est
 * volontairement un singleton (comme le web) ; sans `resetModules`, `init` serait
 * ignoré au deuxième test.
 */
async function sdkFrais(opts: Record<string, unknown> = {}) {
  vi.resetModules();
  const lots: Lot[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    lots.push(JSON.parse(init.body));
    return { status: 202 };
  });
  const sdk = await import("../../packages/rum-mobile/src/index");
  sdk.init({
    endpoint: ENDPOINT,
    appId: "mon-app",
    apiKey: "mip_mob_123",
    clientId: "acme",
    env: "prod",
    appVersion: "1.2.3",
    platform: "ios",
    osVersion: "17",
    flushIntervalMs: 60_000,
    ...opts,
  });
  return {
    sdk,
    lots,
    async lignes(secret?: string) {
      await sdk.flushNow();
      const lot = lots[lots.length - 1];
      return flattenOtlp(secret ? secureOtlpIdentities(lot, secret).payload : lot);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rum-mobile P7.1 — enveloppe P2 complète", () => {
  it("émet vue, action, timing, flag, erreur et événement dans les mêmes tables que le web", async () => {
    const { sdk, lignes } = await sdkFrais();
    sdk.setGlobalContext({ plan: "pro", essai: false });
    sdk.screen("Accueil");
    sdk.startView("Checkout", { etape: 1 });
    sdk.addAction("Payer");
    expect(sdk.addTiming("prete")).toBe(true);
    expect(sdk.addFeatureFlagEvaluation("nouveau_tunnel", true)).toBe(true);
    sdk.addError(new Error("boom for jean@x.fr"), { panier: 3 }, { fingerprint: "checkout-v1" });
    sdk.track("checkout", { amount: 42, ok: true, absent: null });

    const rows = await lignes();
    expect(rows.rejected).toBe(0);
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.pageviews[0].route).toBe("Accueil");
    expect(rows.actions).toHaveLength(1);
    expect(rows.actions[0]).toMatchObject({ name: "Payer", type: "manual" });
    expect(rows.errors).toHaveLength(1);
    // `addError` : l'application a intercepté l'erreur, et le runtime est connu.
    expect(rows.errors[0]).toMatchObject({ handled: true, error_source: "react_native_js", is_fatal: null });

    const parType = Object.fromEntries(rows.events.map((e: Lot) => [e.event_type, e]));
    expect(Object.keys(parType).sort()).toEqual(["action", "custom", "feature_flag", "timing", "view"]);
    expect(parType.view).toMatchObject({ name: "Checkout", view_name: "Checkout" });
    expect(parType.view.view_id).toBeTruthy();
    expect(parType.timing.timing_ms).toBeGreaterThanOrEqual(0);
    expect(parType.feature_flag.feature_flag_value).toBe("true");
    expect(parType.custom.props).toEqual({ amount: 42, ok: true, absent: null });
  });

  it("transporte les identités BRUTES : le HMAC app-scopé reste au port serveur", async () => {
    const { sdk, lots } = await sdkFrais();
    expect(sdk.setUser({ id: "alice@example.test", role: "admin" })).toBe(true);
    expect(sdk.setAccount("customer-42")).toBe(true);
    sdk.track("checkout", { amount: 1 });

    await sdk.flushNow();
    const brut = JSON.stringify(lots[lots.length - 1]);
    // L'identifiant métier voyage en clair vers MIP — et seulement vers MIP.
    expect(brut).toContain("mip.identity.user_id");
    expect(brut).not.toContain("mip.user_id_hash");

    const rows = flattenOtlp(secureOtlpIdentities(JSON.parse(brut), SECRET).payload);
    expect(rows.events[0].user_id_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.events[0].account_id_hash).toMatch(/^[0-9a-f]{64}$/);
    // Aucun secret de hachage n'est embarqué : le SDK n'a jamais vu le hash.
    expect(brut).not.toContain(rows.events[0].user_id_hash);
  });

  it("conserve screen / track / flushNow historiques", async () => {
    const { sdk, lignes } = await sdkFrais();
    sdk.screen("Accueil");
    // `screen` reste le signal de navigation : une page vue, pas une vue P2 —
    // sans quoi une intégration existante doublerait son volume d'événements.
    sdk.track("ancien_evenement", { n: 1 });
    expect(sdk.flushNow()).toBeInstanceOf(Promise);

    const rows = await lignes();
    expect(rows.pageviews).toHaveLength(1);
    expect(rows.events).toHaveLength(1);
    expect(rows.events[0].name).toBe("ancien_evenement");
    expect(rows.events.filter((e: Lot) => e.event_type === "view")).toHaveLength(0);
  });

  it("tourne la session sur changement d'identité, pas sur une identité identique", async () => {
    const { sdk, lots } = await sdkFrais();
    sdk.track("avant", {});
    sdk.setUser("u-1");
    sdk.track("apres", {});
    sdk.setUser("u-1"); // même identité : aucune rotation
    sdk.track("encore", {});
    await sdk.flushNow();

    const sessions = flattenOtlp(lots[0]).events.map((e: Lot) => e.session_id);
    expect(new Set(sessions).size).toBe(2);
    expect(sessions[1]).toBe(sessions[2]);
  });

  it("refuse une identité invalide sans lever, et distingue refus et absence de changement", async () => {
    const { sdk } = await sdkFrais();
    expect(sdk.setUser(42 as never)).toBe(false);
    expect(sdk.setUser({ id: "" } as never)).toBe(false);
    expect(sdk.setUser("u-1")).toBe(true);
    expect(sdk.setUser("u-1")).toBe(true); // valide, simplement inchangée
    expect(sdk.setUser(null)).toBe(true);
  });

  it("refuse timing sans vue et flag sans vue, sans jamais lever", async () => {
    const { sdk } = await sdkFrais();
    expect(sdk.addTiming("prete")).toBe(false);
    expect(sdk.addFeatureFlagEvaluation("flag", true)).toBe(false);
    expect(sdk.startView("Accueil")).toBe(true);
    expect(sdk.addTiming("prete")).toBe(true);
    expect(sdk.addFeatureFlagEvaluation("flag", true)).toBe(true);
  });

  it("émet le visiteur mémoire de l'installation, jamais un identifiant d'appareil", async () => {
    const { sdk, lignes } = await sdkFrais();
    sdk.screen("Accueil");
    const rows = await lignes();
    // Visiteur = tirage aléatoire du lancement (P7.2 le rendra persistant).
    expect(rows.sessions[0].visitor_id).toMatch(/^[0-9a-f-]{32,36}$/);
    expect(rows.sessions[0].user_hash).toBeNull();
  });
});

describe("rum-mobile P7.1 — limites, types et parité avec le web", () => {
  it("garde bool, null et nombre exacts de bout en bout", async () => {
    const { sdk, lignes } = await sdkFrais();
    sdk.setGlobalContext({ actif: true, inactif: false, rien: null, entier: 7, reel: 1.5 });
    sdk.track("types", { vrai: true, faux: false, nul: null, entier: 7, reel: 1.5 });
    const rows = await lignes();
    expect(rows.events[0].props).toEqual({ vrai: true, faux: false, nul: null, entier: 7, reel: 1.5 });
    expect(rows.events[0].context).toMatchObject({ actif: true, inactif: false, rien: null, entier: 7, reel: 1.5 });
  });

  it("applique au contexte RN la précédence et les limites EXACTES du web", async () => {
    const { sdk, lignes } = await sdkFrais();
    sdk.setGlobalContext({ partage: "global", global: true });
    sdk.setUser({ id: "u-1", partage: "user", role: "admin" });
    sdk.setAccount({ id: "a-1", partage: "account", tier: "gold" });
    sdk.startView("Checkout", { partage: "view", etape: 1 });
    sdk.track("evenement", {}, { partage: "local", local: true });
    const rows = await lignes();

    // Même scénario, joué par le store du SDK WEB : le contexte attendu n'est
    // pas réécrit ici à la main, il est calculé par l'implémentation web.
    const web = new EventContextStore();
    web.setGlobal({ partage: "global", global: true });
    web.setUser({ id: "u-1", partage: "user", role: "admin" });
    web.setAccount({ id: "a-1", partage: "account", tier: "gold" });
    web.startView("Checkout", "", { partage: "view", etape: 1 });
    const attendu = web.snapshot({}, { partage: "local", local: true });

    const custom = rows.events.find((e: Lot) => e.event_type === "custom");
    expect(custom.context).toEqual(JSON.parse(JSON.stringify(attendu)));
    expect(custom.context.partage).toBe("local"); // le plus local gagne
  });

  it("traite un cycle et une profondeur excessive sans lever ni boucler", async () => {
    const { sdk, lignes } = await sdkFrais();
    const cyclique: Record<string, unknown> = { nom: "panier" };
    cyclique.soi = cyclique;
    const profond = { a: { b: { c: { d: { e: "trop-profond" } } } } };

    expect(() => sdk.setGlobalContext({ cyclique, profond })).not.toThrow();
    expect(() => sdk.track("cycle", { cyclique })).not.toThrow();
    const rows = await lignes();

    expect(rows.rejected).toBe(0);
    // Profondeur : au-delà de CONTEXT_LIMITS.depth la branche est coupée, la
    // clef qui la portait disparaît — et le reste du contexte survit.
    expect(rows.events[0].context.profond).toEqual({ a: { b: {} } });
    // Cycle : la limite de profondeur le casse, aucune récursion infinie.
    expect(JSON.stringify(rows.events[0].props).length).toBeLessThan(2000);
  });

  it("borne un nom trop long et refuse l'événement plutôt que d'en tronquer le sens", async () => {
    const { sdk, lignes } = await sdkFrais();
    const trop = "x".repeat(101);
    sdk.startView("Vue");
    expect(sdk.addAction(trop)).toBe(false);
    expect(sdk.addTiming(trop)).toBe(false);
    expect(sdk.addFeatureFlagEvaluation(trop, true)).toBe(false);
    sdk.track(trop, {});
    sdk.track("valide", {});
    const rows = await lignes();
    expect(rows.events.filter((e: Lot) => e.event_type === "custom")).toHaveLength(1);
  });
});

describe("rum-mobile P7.1 — beforeSend", () => {
  it("restaure les métadonnées structurelles qu'un hook tenterait de réécrire", async () => {
    const { sdk, lignes } = await sdkFrais({
      beforeSend: (attrs: Record<string, unknown>) => ({
        ...attrs,
        "mip.session_id": "usurpee",
        "mip.view_id": "usurpee",
        "mip.device_type": "desktop",
        "mip.context": JSON.stringify({ plan: "pseudonymise" }),
      }),
    });
    sdk.startView("Checkout", { plan: "reel" });
    const rows = await lignes();

    expect(rows.sessions[0].session_id).not.toBe("usurpee");
    expect(rows.sessions[0].device_type).toBe("mobile");
    expect(rows.events[0].view_id).not.toBe("usurpee");
    // `mip.context` n'est PAS structurel : un hook a le droit de pseudonymiser
    // la donnée applicative, c'est exactement sa raison d'être.
    expect(rows.events[0].context).toEqual({ plan: "pseudonymise" });
  });

  it("isole une exception du hook : événement jeté, diagnostic borné, app intacte", async () => {
    const { sdk, lignes } = await sdkFrais({
      beforeSend: () => {
        throw new Error("hook cassé avec jean@x.fr dedans");
      },
    });
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => sdk.screen("Accueil")).not.toThrow();
    expect(() => sdk.track("checkout", {})).not.toThrow();
    expect(sdk.addError(new Error("boum"))).toBe(false);

    const diag = sdk.getDiagnostics();
    expect(diag.dropped).toBe(3);
    expect(diag.beforeSendFaults.exception).toBe(3);
    expect(diag.queued).toBe(0);
    // Diagnostic BORNÉ : un seul avertissement par lancement, et jamais le
    // contenu de l'exception — il peut porter la PII que le hook devait retirer.
    expect(avertissement).toHaveBeenCalledTimes(1);
    expect(String(avertissement.mock.calls[0][0])).not.toContain("jean@x.fr");
    avertissement.mockRestore();

    const rows = await lignes();
    expect(rows.pageviews).toHaveLength(0);
    expect(rows.events).toHaveLength(0);
  });

  it("traite une Promise comme une entrée invalide, pas comme une attente", async () => {
    const { sdk } = await sdkFrais({
      beforeSend: () => Promise.resolve({}) as never,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    sdk.track("checkout", {});
    expect(sdk.getDiagnostics().beforeSendFaults.async).toBe(1);
    expect(sdk.getDiagnostics().queued).toBe(0);
    vi.restoreAllMocks();
  });

  it("un hook qui renvoie null jette l'événement et le compte", async () => {
    const { sdk, lignes } = await sdkFrais({ beforeSend: () => null });
    sdk.track("checkout", {});
    expect(sdk.getDiagnostics().dropped).toBe(1);
    expect(sdk.getDiagnostics().beforeSendFaults).toEqual({ exception: 0, async: 0 });
    const rows = await lignes();
    expect(rows.events).toHaveLength(0);
  });

  it("le scrub serveur reste autoritaire même quand le hook laisse passer la PII", async () => {
    const { sdk, lignes } = await sdkFrais({ beforeSend: (attrs: Record<string, unknown>) => attrs });
    sdk.addError(new Error("appel de jean@x.fr au 06 12 34 56 78"));
    sdk.track("contact", { email: "a@b.fr" });
    const rows = await lignes();
    expect(rows.errors[0].message).toContain("[email]");
    expect(rows.errors[0].message).not.toContain("jean@x.fr");
    expect(rows.events[0].props).toEqual({ email: "[redacted]" });
  });
});
