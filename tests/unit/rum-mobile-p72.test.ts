// P7.2 — consentement, visiteur et transport du SDK React Native.
//
// TOUTES LES HORLOGES SONT DÉTERMINISTES. L'horloge murale vient de
// `vi.setSystemTime`, l'horloge monotone et l'aléa d'adaptateurs injectés. Un
// test de retrait exponentiel qui dépendrait de `Math.random` et de l'heure
// réelle serait un test qui échoue un jour sur dix sans que personne ne sache
// pourquoi — et le retrait exponentiel est précisément ce qu'on ne peut pas se
// permettre de croire sur parole.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ClockAdapter,
  EtatCycleDeVie,
  RandomAdapter,
  StorageAdapter,
} from "../../packages/rum-mobile/src/adapters";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../packages/backend/shared/otlp.mjs";

const ENDPOINT = "https://ingest.test/v1/traces";
const BASE = 1_760_000_000_000;

type Lot = Record<string, any>;

// ───────────────────────────── adaptateurs de test ───────────────────────────

/** Horloge monotone pilotée à la main : elle ne recule jamais, comme la vraie. */
function horlogeFactice(): ClockAdapter & { avance(ms: number): void } {
  let t = 0;
  return { nowMs: () => t, avance: (ms: number) => { t += ms; } };
}

/** Aléa déterministe (congruence linéaire) : chaque test rejoue la même suite. */
function aleaFactice(graine = 7): RandomAdapter {
  let n = graine >>> 0;
  return {
    bytes(length: number): Uint8Array {
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) {
        n = (Math.imul(n, 1103515245) + 12345) >>> 0;
        out[i] = (n >>> 16) & 0xff;
      }
      return out;
    },
  };
}

interface StockageFactice {
  adapter: StorageAdapter;
  cles: Map<string, string>;
  ecritures: number;
  pannePermanente(actif: boolean): void;
  panneApres(n: number): void;
}

function stockageFactice(opts: { atomicWrite?: boolean; cles?: Map<string, string> } = {}): StockageFactice {
  const cles = opts.cles ?? new Map<string, string>();
  let panne = false;
  let restantAvantPanne = Number.POSITIVE_INFINITY;
  const etat: StockageFactice = {
    cles,
    ecritures: 0,
    adapter: {
      ...(opts.atomicWrite ? { capabilities: { atomicWrite: true } } : {}),
      async getItem(key: string) {
        return cles.has(key) ? cles.get(key)! : null;
      },
      async setItem(key: string, value: string) {
        etat.ecritures++;
        if (panne || restantAvantPanne-- <= 0) throw new Error("disque plein");
        cles.set(key, value);
      },
      async removeItem(key: string) {
        cles.delete(key);
      },
    },
    pannePermanente(actif: boolean) { panne = actif; },
    panneApres(n: number) { restantAvantPanne = n; },
  };
  return etat;
}

interface Attente {
  status?: number;
  headers?: Record<string, string>;
  reseau?: boolean;
}

function reseauFactice() {
  const appels: Array<{ corps: string; lot: Lot }> = [];
  let file: Attente[] = [];
  let parDefaut: Attente = { status: 202 };
  return {
    appels,
    programme(...attentes: Attente[]) { file = attentes; },
    defaut(attente: Attente) { parDefaut = attente; },
    fetch: async (_url: string, init: any) => {
      const attente = file.length ? file.shift()! : parDefaut;
      // Le corps peut manquer : après `shutdown`, notre patch devient un
      // passe-plat et relaie les requêtes de l'application telles quelles.
      const corps = typeof init?.body === "string" ? init.body : "";
      appels.push({ corps, lot: corps ? JSON.parse(corps) : {} });
      if (attente.reseau) throw new Error("network request failed");
      return {
        status: attente.status ?? 202,
        headers: { get: (k: string) => attente.headers?.[k.toLowerCase()] ?? null },
      };
    },
  };
}

function cycleDeVieFactice() {
  const abonnes: Array<(e: EtatCycleDeVie) => void> = [];
  let desabonnements = 0;
  return {
    get abonnes() { return abonnes.length; },
    get desabonnements() { return desabonnements; },
    emettre(etat: EtatCycleDeVie) { for (const cb of [...abonnes]) cb(etat); },
    adapter: {
      subscribe(cb: (e: EtatCycleDeVie) => void) {
        abonnes.push(cb);
        return () => {
          desabonnements++;
          const i = abonnes.indexOf(cb);
          if (i >= 0) abonnes.splice(i, 1);
        };
      },
    },
  };
}

// ─────────────────────────────── harnais SDK ─────────────────────────────────

interface Harnais {
  sdk: typeof import("../../packages/rum-mobile/src/index");
  reseau: ReturnType<typeof reseauFactice>;
  horloge: ReturnType<typeof horlogeFactice>;
  stockage: StockageFactice;
  cycle: ReturnType<typeof cycleDeVieFactice>;
}

async function sdkFrais(opts: Record<string, unknown> = {}, prealables?: {
  cles?: Map<string, string>;
  atomicWrite?: boolean;
  sansStockage?: boolean;
}): Promise<Harnais> {
  vi.resetModules();
  const reseau = reseauFactice();
  const horloge = horlogeFactice();
  const stockage = stockageFactice({ cles: prealables?.cles, atomicWrite: prealables?.atomicWrite });
  const cycle = cycleDeVieFactice();
  vi.stubGlobal("fetch", reseau.fetch);
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
    flushIntervalMs: 3_600_000,
    adapters: {
      random: aleaFactice(),
      monotonicClock: horloge,
      lifecycle: cycle.adapter,
      ...(prealables?.sansStockage ? {} : { storage: stockage.adapter }),
    },
    ...opts,
  });
  return { sdk, reseau, horloge, stockage, cycle };
}

/** Tous les spans d'un lot, à plat — sans relire l'encodage OTLP à la main. */
function spansDe(lot: Lot): Lot[] {
  return lot.resourceSpans.flatMap((rs: Lot) => rs.scopeSpans.flatMap((ss: Lot) => ss.spans));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(BASE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ═══════════════════ 1. Gate de consentement et époques ══════════════════════

describe("P7.2 — gate de consentement et instantanés d'époque", () => {
  it("pending : tampon mémoire seul, aucun octet sur le réseau ni sur le disque", async () => {
    const { sdk, reseau, stockage } = await sdkFrais({ requireConsent: true });
    sdk.screen("Accueil");
    sdk.track("checkout", { amount: 42 });
    await sdk.flushNow();

    expect(reseau.appels).toHaveLength(0);
    expect(stockage.cles.size).toBe(0);
    const diag = sdk.getDiagnostics();
    expect(diag.consent).toBe("pending");
    expect(diag.queued).toBe(2);
    expect(diag.dropped).toBe(0);
    // Pas de visiteur tant que le consentement manque : un identifiant
    // d'installation créé « au cas où » serait déjà une collecte.
    expect(diag.identityPersistence).toBeNull();
  });

  it("consent(true) rejoue le tampon avec les horodatages d'origine", async () => {
    const { sdk, reseau } = await sdkFrais({ requireConsent: true });
    sdk.track("avant", { n: 1 });
    vi.setSystemTime(BASE + 120_000);
    sdk.track("apres", { n: 2 });

    sdk.consent(true);
    await sdk.flushNow();

    expect(reseau.appels).toHaveLength(1);
    const spans = spansDe(reseau.appels[0].lot);
    expect(spans).toHaveLength(2);
    // Deux minutes séparent les deux événements : le rejeu ne les écrase pas
    // avec l'heure du consentement.
    const debuts = spans.map((s: Lot) => Number(s.startTimeUnixNano));
    expect(debuts[1] - debuts[0]).toBe(120_000 * 1e6);
    expect(sdk.getDiagnostics().consent).toBe("granted");
  });

  it("granted → denied purge AVANT tout nouvel enqueue, y compris sur le disque", async () => {
    const { sdk, reseau, stockage } = await sdkFrais({ offline: { persistent: true } });
    sdk.track("avant", { n: 1 });
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(1);
    sdk.track("encore", { n: 2 });
    expect(sdk.getDiagnostics().queued).toBe(1);

    sdk.consent(false);

    // La purge est SYNCHRONE : elle a déjà eu lieu au retour de `consent`.
    expect(sdk.getDiagnostics().queued).toBe(0);
    expect(sdk.getDiagnostics().consent).toBe("denied");
    // Un événement postérieur n'entre pas, et l'API le dit sans lever.
    expect(sdk.addError(new Error("après refus"))).toBe(false);
    expect(sdk.addAction("Payer")).toBe(false);
    expect(sdk.getDiagnostics().queued).toBe(0);

    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(1); // rien de nouveau n'est parti
    await vi.waitFor(() => {
      const files = [...stockage.cles.keys()].filter((k) => k.includes(".queue."));
      expect(files).toHaveLength(0);
    });
  });

  it("révocation PENDANT un flush : la réponse du lot en vol ne réinjecte rien", async () => {
    const { sdk, reseau } = await sdkFrais();
    let liberer: () => void = () => {};
    const enVol = new Promise<void>((r) => { liberer = r; });
    vi.stubGlobal("fetch", async (_url: string, init: any) => {
      reseau.appels.push({ corps: init.body, lot: JSON.parse(init.body) });
      await enVol;
      // Le serveur répond « plus tard » : sans vérification d'époque, le lot
      // reviendrait en file — c'est-à-dire ressusciterait après le refus.
      return { status: 503, headers: { get: () => null } };
    });

    sdk.track("pendant", { n: 1 });
    const flush = sdk.flushNow();
    await vi.waitFor(() => expect(reseau.appels).toHaveLength(1));

    sdk.consent(false);
    liberer();
    await flush;

    expect(sdk.getDiagnostics().queued).toBe(0);
    expect(sdk.getDiagnostics().retries).toBe(0);
  });

  it("un hook rejeté ne modifie ni le contexte global, ni la session, ni la vue", async () => {
    const { sdk } = await sdkFrais({
      beforeSend: (attrs: Record<string, unknown>) => {
        // Hook hostile : il mute l'objet reçu PUIS rejette l'événement.
        attrs["mip.session_id"] = "usurpee";
        attrs["mip.view_id"] = "usurpee";
        return null;
      },
    });
    sdk.setGlobalContext({ plan: "pro" });
    sdk.startView("Checkout");
    const contexteAvant = JSON.stringify(sdk.getGlobalContext());

    expect(sdk.addAction("Payer")).toBe(false);
    expect(sdk.getGlobalContext()).toEqual(JSON.parse(contexteAvant));
    expect(sdk.getDiagnostics().consent).toBe("granted");

    // La preuve décisive : l'événement SUIVANT, laissé passer, porte toujours la
    // vraie session et la vraie vue.
    const { sdk: propre, reseau } = await sdkFrais();
    propre.startView("Checkout");
    await propre.flushNow();
    const attrs = spansDe(reseau.appels[0].lot)[0].attributes;
    const parCle = Object.fromEntries(attrs.map((a: Lot) => [a.key, a.value]));
    expect(parCle["mip.session_id"].stringValue).not.toBe("usurpee");
  });

  it("initialConsent prime sur requireConsent : pas de second écran au relancement", async () => {
    const { sdk, reseau } = await sdkFrais({ requireConsent: true, initialConsent: "granted" });
    sdk.track("direct", { n: 1 });
    await sdk.flushNow();
    expect(sdk.getDiagnostics().consent).toBe("granted");
    expect(reseau.appels).toHaveLength(1);
  });
});

// ═══════════════════ 2. Session, visiteur et horloges ════════════════════════

describe("P7.2 — session et visiteur par adaptateurs", () => {
  it("une bascule arrière-plan → actif de 2 s ne tourne pas la session", async () => {
    const { sdk, reseau, horloge, cycle } = await sdkFrais();
    sdk.track("avant", { n: 1 });
    cycle.emettre("background");
    horloge.avance(2_000);
    cycle.emettre("active");
    sdk.track("apres", { n: 2 });
    await sdk.flushNow();

    const sessions = flattenOtlp(reseau.appels[0].lot).events.map((e: Lot) => e.session_id);
    expect(new Set(sessions).size).toBe(1);
  });

  it("une reprise après 31 minutes ouvre une nouvelle visite", async () => {
    const { sdk, reseau, horloge, cycle } = await sdkFrais();
    sdk.track("avant", { n: 1 });
    cycle.emettre("background");
    horloge.avance(31 * 60_000);
    cycle.emettre("active");
    sdk.track("apres", { n: 2 });
    await sdk.flushNow();

    const sessions = flattenOtlp(reseau.appels[0].lot).events.map((e: Lot) => e.session_id);
    expect(new Set(sessions).size).toBe(2);
  });

  it("l'inactivité tourne la session même sans callback de cycle de vie", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    sdk.track("avant", { n: 1 });
    horloge.avance(30 * 60_000 + 1);
    sdk.track("apres", { n: 2 });
    await sdk.flushNow();

    const sessions = flattenOtlp(reseau.appels[0].lot).events.map((e: Lot) => e.session_id);
    expect(new Set(sessions).size).toBe(2);
  });

  it("le seuil d'inactivité est configurable mais borné", async () => {
    const { sdk, reseau, horloge } = await sdkFrais({ sessionInactivityMs: 1 });
    sdk.track("avant", { n: 1 });
    horloge.avance(30_000); // sous la borne basse d'une minute
    sdk.track("apres", { n: 2 });
    await sdk.flushNow();

    const sessions = flattenOtlp(reseau.appels[0].lot).events.map((e: Lot) => e.session_id);
    // 1 ms serait absurde : toute notification consultée créerait une visite.
    expect(new Set(sessions).size).toBe(1);
  });

  it("une horloge murale qui recule ne produit jamais de timing négatif", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    sdk.startView("Checkout");
    horloge.avance(500);
    // L'utilisateur change de fuseau : l'horloge murale recule d'une minute.
    vi.setSystemTime(BASE - 60_000);
    expect(sdk.addTiming("prete")).toBe(true);
    // Et avec un horodatage mural explicite, antérieur au recul.
    expect(sdk.addTiming("prete_explicite", BASE + 100)).toBe(true);
    await sdk.flushNow();

    const timings = flattenOtlp(reseau.appels[0].lot).events.filter((e: Lot) => e.event_type === "timing");
    expect(timings).toHaveLength(2);
    for (const t of timings) expect(t.timing_ms).toBeGreaterThanOrEqual(0);
  });

  it("le visiteur est une installation : persistant, app-scopé, jamais un identifiant d'appareil", async () => {
    const cles = new Map<string, string>();
    const premier = await sdkFrais({}, { cles });
    premier.sdk.track("un", { n: 1 });
    await premier.sdk.flushNow();
    const v1 = flattenOtlp(premier.reseau.appels[0].lot).sessions[0].visitor_id;
    expect(v1).toMatch(/^[0-9a-f]{32}$/);
    expect(premier.sdk.getDiagnostics().identityPersistence).toBe("storage");

    // Relancement : MÊME stockage, même visiteur.
    await premier.sdk.shutdown();
    const second = await sdkFrais({}, { cles });
    second.sdk.track("deux", { n: 2 });
    await second.sdk.flushNow();
    expect(flattenOtlp(second.reseau.appels[0].lot).sessions[0].visitor_id).toBe(v1);

    // Une AUTRE application, même appareil, même stockage : autre visiteur.
    await second.sdk.shutdown();
    vi.resetModules();
    const reseauB = reseauFactice();
    vi.stubGlobal("fetch", reseauB.fetch);
    const sdkB = await import("../../packages/rum-mobile/src/index");
    sdkB.init({
      endpoint: ENDPOINT, appId: "autre-app", platform: "ios", flushIntervalMs: 3_600_000,
      adapters: { random: aleaFactice(99), storage: stockageFactice({ cles }).adapter },
    });
    sdkB.track("trois", { n: 3 });
    await sdkB.flushNow();
    expect(flattenOtlp(reseauB.appels[0].lot).sessions[0].visitor_id).not.toBe(v1);
  });

  it("le visiteur n'est créé qu'APRÈS consentement lorsqu'il est requis", async () => {
    const { sdk, reseau, stockage } = await sdkFrais({ requireConsent: true });
    sdk.track("avant", { n: 1 });
    await sdk.flushNow();
    expect(stockage.cles.size).toBe(0);

    sdk.consent(true);
    await sdk.flushNow();
    const session = flattenOtlp(reseau.appels[0].lot).sessions[0];
    expect(session.visitor_id).toMatch(/^[0-9a-f]{32}$/);
    // L'événement mis en tampon AVANT le consentement reçoit lui aussi le
    // visiteur : sinon la moitié d'une visite serait orpheline.
    expect(sdk.getDiagnostics().identityPersistence).toBe("storage");
  });

  it("stockage indisponible : identifiant mémoire et identity_persistence=memory", async () => {
    const { sdk, reseau, stockage } = await sdkFrais({}, {});
    await sdk.shutdown();
    const enPanne = await sdkFrais();
    enPanne.stockage.pannePermanente(true);
    // Re-bootstrap avec le disque en panne.
    enPanne.sdk.consent(true);
    enPanne.sdk.track("un", { n: 1 });
    await enPanne.sdk.flushNow();

    expect(enPanne.sdk.getDiagnostics().identityPersistence).toBe("memory");
    expect(enPanne.sdk.getDiagnostics().storageAvailable).toBe(false);
    const visiteur = flattenOtlp(enPanne.reseau.appels[0].lot).sessions[0].visitor_id;
    expect(visiteur).toMatch(/^[0-9a-f]{32}$/);
    void reseau; void stockage;
  });

  it("sans adaptateur de stockage : mémoire assumée, jamais « inconnu »", async () => {
    const { sdk } = await sdkFrais({}, { sansStockage: true });
    sdk.track("un", { n: 1 });
    await sdk.flushNow();
    expect(sdk.getDiagnostics().storageAvailable).toBe(false);
    expect(sdk.getDiagnostics().identityPersistence).toBe("memory");
  });
});

// ═════════════════════════ 3. File bornée par app/époque ═════════════════════

describe("P7.2 — file bornée", () => {
  it("évince les plus anciens au dépassement, et le compte", async () => {
    const { sdk } = await sdkFrais({ offline: { maxEvents: 5 }, requireConsent: true });
    for (let i = 0; i < 12; i++) sdk.track(`e${i}`, { i });
    const diag = sdk.getDiagnostics();
    expect(diag.queued).toBe(5);
    expect(diag.dropped).toBe(7);
  });

  it("un seul événement énorme ne fait pas dépasser le plafond et ne vide pas la file", async () => {
    const { sdk } = await sdkFrais({ offline: { maxEvents: 50, maxBytes: 100_000 }, requireConsent: true });
    sdk.track("petit", { n: 1 });
    sdk.track("autre", { n: 2 });
    expect(sdk.getDiagnostics().queued).toBe(2);

    sdk.track("enorme", { charge: "x".repeat(200_000) });

    const diag = sdk.getDiagnostics();
    expect(diag.queued).toBe(2); // les deux petits sont intacts
    expect(diag.dropped).toBe(1); // l'énorme est refusé, et compté
  });

  it("les plafonds durs bornent une configuration trop généreuse", async () => {
    const { sdk } = await sdkFrais({
      offline: { maxEvents: 100_000, maxBytes: 999_000_000 },
      requireConsent: true,
    });
    // Le tampon d'attente de consentement reste au plafond P2 (200), quelle que
    // soit la configuration de la file.
    for (let i = 0; i < 260; i++) sdk.track(`e${i}`, { i });
    expect(sdk.getDiagnostics().queued).toBe(200);
  });

  it("le TTL retire les événements trop vieux, sans les envoyer", async () => {
    const { sdk, reseau } = await sdkFrais({ requireConsent: true, offline: { ttlMs: 60_000 } });
    sdk.track("vieux", { n: 1 });
    vi.setSystemTime(BASE + 61_000);
    sdk.track("recent", { n: 2 });

    sdk.consent(true);
    await sdk.flushNow();
    const spans = spansDe(reseau.appels[0].lot);
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("track.recent");
  });

  it("un lot ne dépasse jamais 64 événements", async () => {
    const { sdk, reseau } = await sdkFrais({ requireConsent: true, offline: { maxEvents: 200 } });
    for (let i = 0; i < 150; i++) sdk.track(`e${i}`, { i });
    sdk.consent(true);
    await sdk.flushNow();

    expect(reseau.appels.length).toBeGreaterThanOrEqual(3);
    for (const appel of reseau.appels) expect(spansDe(appel.lot).length).toBeLessThanOrEqual(64);
    expect(reseau.appels.reduce((n, a) => n + spansDe(a.lot).length, 0)).toBe(150);
  });
});

// ═══════════════ 4. Acquittement, retry et réponses définitives ══════════════

describe("P7.2 — acquittement avant retrait", () => {
  it("hors ligne puis en ligne : rien n'est perdu, tout repart à l'identique", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    reseau.programme({ reseau: true });
    sdk.track("pendant_le_vol", { n: 1 });
    await sdk.flushNow();

    expect(reseau.appels).toHaveLength(1);
    expect(sdk.getDiagnostics().queued).toBe(1); // pas d'acquittement, pas de retrait
    expect(sdk.getDiagnostics().retries).toBe(1);

    horloge.avance(10 * 60_000); // l'échéance du retrait est passée
    await sdk.flushNow();

    expect(reseau.appels).toHaveLength(2);
    expect(sdk.getDiagnostics().queued).toBe(0);
    // MÊME identifiant de span : l'ingestion dédoublonne au lieu de compter deux.
    const id = (lot: Lot) => spansDe(lot)[0].spanId;
    expect(id(reseau.appels[1].lot)).toBe(id(reseau.appels[0].lot));
  });

  it("429 avec Retry-After : rien ne repart avant l'échéance, et elle est bornée", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    reseau.programme({ status: 429, headers: { "retry-after": "120" } });
    sdk.track("trop_vite", { n: 1 });
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(1);
    expect(sdk.getDiagnostics().lastTransportStatus).toBe(429);

    horloge.avance(60_000);
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(1); // on respecte les 120 s demandées

    horloge.avance(5 * 60_000);
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(2);
    expect(sdk.getDiagnostics().queued).toBe(0);
  });

  it("un Retry-After déraisonnable est plafonné, pas obéi aveuglément", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    reseau.programme({ status: 503, headers: { "retry-after": "86400" } }); // 24 h
    sdk.track("incident", { n: 1 });
    await sdk.flushNow();

    horloge.avance(30 * 60_000); // 30 min : au-delà du plafond de 15 min + bruit
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(2);
  });

  it("401 : le lot est abandonné, sans boucle et sans corps dans le diagnostic", async () => {
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk, reseau, horloge } = await sdkFrais();
    reseau.defaut({ status: 401 });
    sdk.track("clef_refusee", { n: 1 });
    await sdk.flushNow();

    expect(reseau.appels).toHaveLength(1);
    expect(sdk.getDiagnostics().queued).toBe(0); // jeté, pas rejoué indéfiniment
    expect(sdk.getDiagnostics().dropped).toBe(1);
    expect(sdk.getDiagnostics().retries).toBe(0); // un refus n'est pas un renvoi
    expect(sdk.getDiagnostics().lastTransportStatus).toBe(401);

    horloge.avance(60 * 60_000);
    await sdk.flushNow();
    expect(reseau.appels).toHaveLength(1); // la file est vide : rien à renvoyer

    // Un STATUT, jamais un corps de réponse — il peut réfléchir la charge émise.
    expect(avertissement).toHaveBeenCalledTimes(1);
    expect(String(avertissement.mock.calls[0][0])).toContain("401");
    expect(String(avertissement.mock.calls[0][0])).not.toContain("clef_refusee");
  });

  it("400 sur un lot ne fait pas autant de requêtes qu'il y a de lots en file", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk, reseau } = await sdkFrais({ requireConsent: true, offline: { maxEvents: 200 } });
    for (let i = 0; i < 150; i++) sdk.track(`e${i}`, { i });
    reseau.defaut({ status: 400 });
    sdk.consent(true);
    await sdk.flushNow();
    // Un seul essai : on recule avant d'en tenter un autre, au lieu d'enchaîner
    // trois requêtes vouées au même refus.
    expect(reseau.appels).toHaveLength(1);
  });

  it("le retrait exponentiel croît et reste dispersé par le bruit", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    reseau.defaut({ reseau: true });
    sdk.track("boucle", { n: 1 });

    const essais: number[] = [];
    for (let i = 0; i < 4; i++) {
      const avant = reseau.appels.length;
      let attendu = 0;
      // On avance par paliers jusqu'à ce qu'une tentative reparte.
      while (reseau.appels.length === avant && attendu < 60 * 60_000) {
        horloge.avance(500);
        attendu += 500;
        await sdk.flushNow();
      }
      essais.push(attendu);
    }
    expect(essais[0]).toBeGreaterThan(0);
    expect(essais[3]).toBeGreaterThan(essais[0]);
    expect(sdk.getDiagnostics().retries).toBeGreaterThanOrEqual(4);
  });

  it("changement d'utilisateur pendant un retry : l'événement garde son identité d'origine", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    sdk.setUser("alice");
    reseau.programme({ reseau: true });
    sdk.track("achat_alice", { n: 1 });
    await sdk.flushNow();
    expect(sdk.getDiagnostics().queued).toBe(1);

    sdk.setUser("bob"); // l'utilisateur change AVANT que le lot ne parte
    horloge.avance(10 * 60_000);
    await sdk.flushNow();

    const attrs = spansDe(reseau.appels[1].lot)[0].attributes;
    const parCle = Object.fromEntries(attrs.map((a: Lot) => [a.key, a.value?.stringValue]));
    // Jamais de réattribution au flush : ce serait inventer un achat de Bob.
    expect(parCle["mip.identity.user_id"]).toBe("alice");
    expect(parCle["mip.session_id"]).toBe(
      Object.fromEntries(spansDe(reseau.appels[0].lot)[0].attributes.map((a: Lot) => [a.key, a.value?.stringValue]))[
        "mip.session_id"
      ],
    );
  });

  it("un lot dont le corps dépasse le plafond HTTP est coupé, pas abandonné", async () => {
    const { sdk, reseau } = await sdkFrais({
      requireConsent: true,
      offline: { maxEvents: 60, maxBytes: 2 * 1024 * 1024 },
    });
    // 34 événements de ~60 Kio : le lot tient dans la file (2 Mio) mais son
    // corps encodé dépasse les 2 Mo acceptés par l'ingestion.
    for (let i = 0; i < 34; i++) sdk.track(`gros${i}`, { charge: "x".repeat(60_000) });
    sdk.consent(true);
    await sdk.flushNow();

    expect(reseau.appels.length).toBeGreaterThan(1);
    for (const appel of reseau.appels) {
      expect(new TextEncoder().encode(appel.corps).length).toBeLessThanOrEqual(2_000_000);
    }
    expect(sdk.getDiagnostics().queued).toBe(0);
  });
});

// ════════════════════════ 5. Persistance versionnée ══════════════════════════

describe("P7.2 — persistance durable optionnelle", () => {
  it("désactivée par défaut : rien de la file n'atteint le disque", async () => {
    const { sdk, stockage, cycle } = await sdkFrais();
    sdk.track("un", { n: 1 });
    cycle.emettre("background");
    await vi.waitFor(() => expect(stockage.cles.size).toBeGreaterThan(0));
    expect([...stockage.cles.keys()].some((k) => k.includes(".queue."))).toBe(false);
  });

  it("activée : avertit que l'usage en production exige P8.1", async () => {
    const avertissement = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sdkFrais({ offline: { persistent: true } });
    expect(String(avertissement.mock.calls[0]?.[0])).toContain("P8.1");
  });

  it("sauvegarde en arrière-plan puis restauration au démarrage suivant", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cles = new Map<string, string>();
    const premier = await sdkFrais({ offline: { persistent: true } }, { cles });
    premier.reseau.defaut({ reseau: true });
    premier.sdk.track("perdu_en_vol", { n: 1 });
    await premier.sdk.flushNow();
    premier.cycle.emettre("background");
    await vi.waitFor(() => {
      expect([...cles.keys()].some((k) => k.includes(".queue."))).toBe(true);
    });

    // Fermeture puis réouverture.
    await premier.sdk.shutdown();
    const second = await sdkFrais({ offline: { persistent: true } }, { cles });
    second.sdk.track("nouveau", { n: 2 });
    await second.sdk.flushNow();

    const noms = spansDe(second.reseau.appels[0].lot).map((s: Lot) => s.name).sort();
    expect(noms).toEqual(["track.nouveau", "track.perdu_en_vol"]);
  });

  it("aucune clef d'API ni identité brute dans la file persistée", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk, reseau, stockage, cycle } = await sdkFrais({ offline: { persistent: true } });
    reseau.defaut({ reseau: true });
    sdk.setUser("alice@example.test");
    sdk.setAccount("customer-42");
    sdk.addError(new Error("incident de jean@client.fr avec token=s3cr3t"));
    sdk.track("checkout", { email: "a@b.fr", amount: 42 });
    await sdk.flushNow();
    cycle.emettre("background");
    await vi.waitFor(() => {
      expect([...stockage.cles.keys()].some((k) => k.includes(".queue."))).toBe(true);
    });

    const disque = [...stockage.cles.values()].join("|");
    expect(disque).not.toContain("alice@example.test");
    expect(disque).not.toContain("customer-42");
    expect(disque).not.toContain("mip_mob_123"); // la clef d'API
    expect(disque).not.toContain("jean@client.fr");
    expect(disque).not.toContain("a@b.fr");
    expect(disque).not.toContain("s3cr3t");
    // Ce qui reste : le contexte scrubbé et les identifiants techniques.
    expect(disque).toContain("[email]");
    expect(disque).toContain("mip.session_id");
  });

  it("un événement restauré n'est JAMAIS rattaché à l'utilisateur courant", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cles = new Map<string, string>();
    const premier = await sdkFrais({ offline: { persistent: true } }, { cles });
    premier.reseau.defaut({ reseau: true });
    premier.sdk.setUser("alice@example.test");
    premier.sdk.track("achat", { n: 1 });
    await premier.sdk.flushNow();
    premier.cycle.emettre("background");
    await vi.waitFor(() => expect([...cles.keys()].some((k) => k.includes(".queue."))).toBe(true));
    await premier.sdk.shutdown();

    const second = await sdkFrais({ offline: { persistent: true } }, { cles });
    second.sdk.setUser("bob@example.test");
    await second.sdk.flushNow();

    const restaure = spansDe(second.reseau.appels[0].lot).find((s: Lot) => s.name === "track.achat");
    const parCle = Object.fromEntries(restaure.attributes.map((a: Lot) => [a.key, a.value?.stringValue]));
    expect(parCle["mip.identity.user_id"]).toBeUndefined();
    // Le serveur le rattachera s'il connaît déjà la session d'origine ; le SDK,
    // lui, ne reconstruit rien depuis l'utilisateur du moment.
    expect(parCle["mip.session_id"]).toBeTruthy();
  });

  it("reprise après corruption : la file est abandonnée, l'application ne casse pas", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cles = new Map<string, string>();
    const premier = await sdkFrais({ offline: { persistent: true } }, { cles });
    premier.reseau.defaut({ reseau: true });
    premier.sdk.track("avant_corruption", { n: 1 });
    await premier.sdk.flushNow();
    premier.cycle.emettre("background");
    await vi.waitFor(() => expect([...cles.keys()].some((k) => k.includes(".queue."))).toBe(true));
    await premier.sdk.shutdown();

    // Un emplacement tronqué, comme après un kill de l'OS pendant l'écriture.
    for (const cle of [...cles.keys()]) {
      if (/\.queue\..*\.\d$/.test(cle)) cles.set(cle, cles.get(cle)!.slice(0, 40));
    }

    const second = await sdkFrais({ offline: { persistent: true } }, { cles });
    second.sdk.track("apres", { n: 2 });
    await expect(second.sdk.flushNow()).resolves.toBeUndefined();
    const noms = spansDe(second.reseau.appels[0].lot).map((s: Lot) => s.name);
    expect(noms).toEqual(["track.apres"]);
    expect(second.sdk.getDiagnostics().storageCorruptions).toBeGreaterThan(0);
  });

  it("écriture atomique déclarée : une seule clef, pas de manifeste", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk, reseau, stockage, cycle } = await sdkFrais(
      { offline: { persistent: true } },
      { atomicWrite: true },
    );
    reseau.defaut({ reseau: true });
    sdk.track("un", { n: 1 });
    await sdk.flushNow();
    cycle.emettre("background");
    await vi.waitFor(() => {
      expect([...stockage.cles.keys()].some((k) => k.includes(".queue."))).toBe(true);
    });
    const files = [...stockage.cles.keys()].filter((k) => k.includes(".queue."));
    expect(files).toHaveLength(1);
    expect(files[0]).not.toMatch(/\.\d$/);
  });

  it("disque plein : le SDK continue en mémoire et le dit", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sdk, reseau, stockage, cycle, horloge } = await sdkFrais({ offline: { persistent: true } });
    reseau.defaut({ reseau: true });
    stockage.pannePermanente(true);
    sdk.track("un", { n: 1 });
    await sdk.flushNow();
    cycle.emettre("background");
    await vi.waitFor(() => expect(sdk.getDiagnostics().storageAvailable).toBe(false));

    expect(sdk.getDiagnostics().queued).toBe(1); // toujours en mémoire
    reseau.defaut({ status: 202 });
    horloge.avance(10 * 60_000); // l'échéance du retrait est passée
    await sdk.flushNow();
    expect(sdk.getDiagnostics().queued).toBe(0);
  });

  it("la file de l'application A ne peut pas être envoyée dans B", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cles = new Map<string, string>();
    const a = await sdkFrais({ offline: { persistent: true } }, { cles });
    a.reseau.defaut({ reseau: true });
    a.sdk.track("secret_de_A", { n: 1 });
    await a.sdk.flushNow();
    a.cycle.emettre("background");
    await vi.waitFor(() => expect([...cles.keys()].some((k) => k.includes(".queue."))).toBe(true));
    await a.sdk.shutdown();

    // Attaque la plus favorable possible : on RECOPIE l'enregistrement de A sous
    // la clef de B. La clef est app-scopée, mais on ne s'y fie pas seule.
    for (const [cle, valeur] of [...cles.entries()]) {
      if (cle.includes("mon-app")) cles.set(cle.replace("mon-app", "app-b"), valeur);
    }

    vi.resetModules();
    const reseauB = reseauFactice();
    vi.stubGlobal("fetch", reseauB.fetch);
    const sdkB = await import("../../packages/rum-mobile/src/index");
    sdkB.init({
      endpoint: ENDPOINT, appId: "app-b", platform: "ios", flushIntervalMs: 3_600_000,
      offline: { persistent: true },
      adapters: { random: aleaFactice(3), storage: stockageFactice({ cles }).adapter },
    });
    sdkB.track("de_B", { n: 2 });
    await sdkB.flushNow();

    const noms = spansDe(reseauB.appels[0].lot).map((s: Lot) => s.name);
    expect(noms).toEqual(["track.de_B"]);
  });

  it("une file d'époque révoquée n'est jamais rejouée au démarrage suivant", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cles = new Map<string, string>();
    const premier = await sdkFrais({ offline: { persistent: true } }, { cles });
    premier.reseau.defaut({ reseau: true });
    premier.sdk.track("avant_refus", { n: 1 });
    await premier.sdk.flushNow();
    premier.cycle.emettre("background");
    await vi.waitFor(() => expect([...cles.keys()].some((k) => k.includes(".queue."))).toBe(true));

    // On simule l'effacement disque qui échoue (stockage en lecture seule) :
    // l'enregistrement SURVIT, mais son époque devient périmée.
    const sauvegarde = new Map(cles);
    premier.sdk.consent(false);
    await vi.waitFor(() => expect(premier.sdk.getDiagnostics().consent).toBe("denied"));
    for (const [cle, valeur] of sauvegarde) {
      if (cle.includes(".queue.")) cles.set(cle, valeur);
    }
    await premier.sdk.shutdown();

    const second = await sdkFrais({ offline: { persistent: true } }, { cles });
    second.sdk.consent(true);
    second.sdk.track("apres", { n: 2 });
    await second.sdk.flushNow();
    const noms = spansDe(second.reseau.appels[0].lot).map((s: Lot) => s.name);
    expect(noms).toEqual(["track.apres"]);
  });
});

// ═════════════════════════════ 6. shutdown ═══════════════════════════════════

describe("P7.2 — shutdown", () => {
  it("n'enlève que les hooks et timers posés par MIP", async () => {
    const { sdk, cycle } = await sdkFrais();
    expect(cycle.abonnes).toBe(1);
    await sdk.shutdown();
    expect(cycle.abonnes).toBe(0);
    expect(cycle.desabonnements).toBe(1);
    expect(sdk.getDiagnostics().consent).toBeNull();
    expect(sdk.getDiagnostics().retries).toBeNull();
  });

  it("respecte un patch fetch installé APRÈS le nôtre", async () => {
    const { sdk } = await sdkFrais();
    const notreFetch = globalThis.fetch;
    const appelsTiers: string[] = [];
    const tiers = async (input: any, init: any) => {
      appelsTiers.push("tiers");
      return (notreFetch as any)(input, init);
    };
    vi.stubGlobal("fetch", tiers);

    await sdk.shutdown();

    // Le patch du tiers est TOUJOURS en place : le retirer effacerait le sien.
    expect(globalThis.fetch).toBe(tiers);
    await (globalThis.fetch as any)("https://api.tiers.fr/x", {});
    expect(appelsTiers).toEqual(["tiers"]);
  });

  it("un re-init après shutdown ne duplique pas les écouteurs", async () => {
    const { sdk, cycle, reseau } = await sdkFrais();
    await sdk.shutdown();
    sdk.init({
      endpoint: ENDPOINT, appId: "mon-app", platform: "ios", flushIntervalMs: 3_600_000,
      adapters: { random: aleaFactice(5), lifecycle: cycle.adapter },
    });
    expect(cycle.abonnes).toBe(1);

    sdk.track("apres_remontage", { n: 1 });
    await sdk.flushNow();
    expect(spansDe(reseau.appels[0].lot)).toHaveLength(1);
  });

  it("flush borné : shutdown rend la main même si le réseau ne répond pas", async () => {
    const { sdk } = await sdkFrais();
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    sdk.track("jamais_livre", { n: 1 });
    const arret = sdk.shutdown();
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(arret).resolves.toBeUndefined();
  });
});

// ══════════════════════ 7. diagnostics : 0 n'est pas null ════════════════════

describe("P7.2 — diagnostics", () => {
  it("avant init, tout ce qui dépend du runtime est inconnu", async () => {
    vi.resetModules();
    const sdk = await import("../../packages/rum-mobile/src/index");
    const diag = sdk.getDiagnostics();
    expect(diag).toMatchObject({
      queued: 0,
      dropped: 0,
      retries: null,
      storageAvailable: null,
      consent: null,
      nativeCapabilities: null,
      identityPersistence: null,
      lastTransportStatus: null,
      storageCorruptions: null,
    });
  });

  it("après init, 0 renvoi est un vrai 0 — et aucune capacité native n'est active", async () => {
    const { sdk } = await sdkFrais();
    const diag = sdk.getDiagnostics();
    expect(diag.retries).toBe(0);
    expect(diag.consent).toBe("granted");
    // Le bootstrap a déjà lu le stockage : la réponse est connue, pas inconnue.
    expect(diag.storageAvailable).toBe(true);
    // P7.5 a posé le modèle de capacités : APRÈS `init`, le tableau est vide et
    // c'est un FAIT connu — aucun module natif MIP n'est livré. `null` reste
    // réservé à l'état avant `init`, où le runtime ne sait rien encore. Le
    // contrat détaillé est vérifié par `tests/unit/rum-mobile-p75.test.ts`.
    expect(diag.nativeCapabilities).toEqual([]);
    expect(diag.nativeCapabilitiesReason).toContain("P8.5");
  });
});
