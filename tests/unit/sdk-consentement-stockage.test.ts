// SDK web — rien sur le terminal avant le consentement (finding 1.11), et une
// session qui ne dure pas plus de 4 heures (finding 2.12 b).
//
// CE QUI ÉTAIT FAUX. `requireConsent` retenait le RÉSEAU seulement : init()
// écrivait `mip_rum_session`, `mip_rum_visitor` et `mip_rum_sampling` dans le
// stockage local AVANT que la barrière de consentement n'existe, et un refus ne
// les effaçait pas. L'article 82 de la loi Informatique et Libertés vise toute
// lecture ou écriture sur le terminal, stockage local compris.
//
// Ces tests chargent le VRAI SDK (session, consentement, échantillonnage, file
// de rejeu, fil d'Ariane, navigation) sur un stockage local qui journalise
// chaque accès, et rejouent plusieurs chargements de page sur le même stockage.
// Seuls l'émetteur OTLP et les capteurs qui exigent un vrai navigateur sont
// remplacés.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Attrs = Record<string, unknown>;
const { etat } = vi.hoisted(() => ({
  etat: {
    spans: [] as Array<{ name: string; attributes: Attrs }>,
    traces: 0,
    // Options que le SDK passe au traçage des appels réseau (dernier init()).
    optionsApi: null as null | { actif?: () => boolean; sessionId: () => string },
  },
}));

vi.mock("../../packages/rum-sdk/src/otel", () => ({
  currentTraceId: () => "a".repeat(32),
  forceFlush: () => Promise.resolve(),
  discardPendingSpans: () => {},
  newPageTrace: () => {
    etat.traces++;
    return "a".repeat(32);
  },
  initOtel: () => ({
    startSpan(name: string) {
      const span = { name, attributes: {} as Attrs };
      return {
        setAttributes(a: Attrs) { span.attributes = { ...a }; },
        end() { etat.spans.push(span); },
      };
    },
  }),
}));
vi.mock("../../packages/rum-sdk/src/errors", () => ({
  initErrors: () => ({ drainer: () => {}, reset: () => {}, report: () => {}, dejaCapture: () => false, compteurs: () => ({}) }),
}));
vi.mock("../../packages/rum-sdk/src/forms", () => ({ initForms: () => {} }));
vi.mock("../../packages/rum-sdk/src/frustration", () => ({ initFrustration: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/loaf", () => ({ initLoaf: () => null }));
vi.mock("../../packages/rum-sdk/src/longtasks", () => ({ initLongTasks: () => ({ reset: () => {} }) }));
vi.mock("../../packages/rum-sdk/src/navtiming", () => ({ initNavTiming: () => {} }));
vi.mock("../../packages/rum-sdk/src/vitals", () => ({ initVitals: () => {} }));
vi.mock("../../packages/rum-sdk/src/resources", () => ({
  DEFAULT_SLOW_RESOURCE_MS: 1000,
  initResources: () => ({ reset: () => {} }),
}));
vi.mock("../../packages/rum-sdk/src/apispans", () => ({
  initApiSpans: (_emit: unknown, options: typeof etat.optionsApi) => {
    etat.optionsApi = options;
    return null;
  },
}));
vi.mock("../../packages/rum-sdk/src/replay", () => ({
  flushReplayBoundary: () => {}, isReplaySampled: () => false, startReplay: () => {},
}));

// ═══════════════════════════════ Navigateur simulé ═════════════════════════════

/** Le stockage local SURVIT aux chargements de page ; le journal dit qui y a touché. */
const stockage = new Map<string, string>();
const journal: Array<{ op: "lire" | "ecrire" | "effacer"; cle: string }> = [];
const ecritures = () => journal.filter((a) => a.op === "ecrire");

const MINUTE = 60_000;
const T0 = Date.UTC(2026, 9, 1, 8, 0, 0);
let maintenant = T0;

beforeEach(() => {
  etat.spans.length = 0;
  etat.traces = 0;
  etat.optionsApi = null;
  stockage.clear();
  journal.length = 0;
  maintenant = T0;
  vi.spyOn(Date, "now").mockImplementation(() => maintenant);
  vi.stubGlobal("localStorage", {
    getItem: (cle: string) => {
      journal.push({ op: "lire", cle });
      return stockage.get(cle) ?? null;
    },
    setItem: (cle: string, v: string) => {
      journal.push({ op: "ecrire", cle });
      stockage.set(cle, String(v));
    },
    removeItem: (cle: string) => {
      journal.push({ op: "effacer", cle });
      stockage.delete(cle);
    },
    get length() {
      return stockage.size;
    },
    key: (i: number) => [...stockage.keys()][i] ?? null,
  });
  vi.stubGlobal("document", {
    visibilityState: "visible", referrer: "", currentScript: null,
    addEventListener: () => {}, head: { appendChild: () => {} }, createElement: () => ({ setAttribute: () => {} }),
  });
  vi.stubGlobal("window", {});
  vi.stubGlobal("navigator", { userAgent: "vitest" });
  vi.stubGlobal("location", { href: "https://app.test/dossiers/42?q=1", pathname: "/dossiers/42" });
  vi.stubGlobal("history", { pushState: () => {}, replaceState: () => {} });
  vi.stubGlobal("performance", { getEntriesByType: () => [{ type: "navigate" }] });
  vi.stubGlobal("addEventListener", () => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Sdk = typeof import("../../packages/rum-sdk/src/index");
type Config = Partial<Parameters<Sdk["init"]>[0]>;

/** Un chargement de page : un SDK neuf (mémoire vide), le même stockage local. */
async function chargerPage(cfg: Config = {}): Promise<Sdk> {
  vi.resetModules();
  const sdk = await import("../../packages/rum-sdk/src/index");
  sdk.init({ endpoint: "https://ingest.test/v1/traces", appId: "app-consentement", trace: false, ...cfg });
  return sdk;
}

const sessionStockee = () => JSON.parse(stockage.get("mip_rum_session") ?? "null")?.sid as string | undefined;
const idsDe = (depuis: number, cle: string) => new Set(etat.spans.slice(depuis).map((s) => s.attributes[cle]));

// ═══════════════════════════════ 1.11 — consentement ═══════════════════════════

describe("requireConsent : rien sur le terminal avant l'accord", () => {
  it("aucune lecture ni écriture du stockage local tant que consent(true) n'est pas venu", async () => {
    const sdk = await chargerPage({ requireConsent: true });
    // Une page vivante : page vue, événement métier, identité, vue nommée, action, erreur.
    sdk.setUser("agent-7");
    sdk.track("dossier_ouvert", { etape: 1 });
    sdk.startView("Dossier");
    sdk.addAction("Valider");
    sdk.addError(new Error("échec de validation"));
    maintenant += 5 * MINUTE;
    sdk.track("dossier_ferme");

    expect(journal, "le SDK a touché au stockage local avant l'accord").toEqual([]);
    expect(etat.spans, "rien ne part avant l'accord").toEqual([]);

    sdk.consent(true);
    const cles = new Set(ecritures().map((a) => a.cle));
    expect(cles).toContain("mip_rum_session");
    expect(cles).toContain("mip_rum_visitor");
    expect(cles).toContain("mip_rum_sampling");
    // Le tampon part avec les identifiants désormais écrits, pas avec d'autres.
    expect(etat.spans.map((s) => s.name)).toContain("pageview");
    expect(idsDe(0, "mip.session_id")).toEqual(new Set([sessionStockee()]));
    expect(idsDe(0, "mip.visitor_id")).toEqual(new Set([stockage.get("mip_rum_visitor")]));
  });

  it("un visiteur qui a déjà consenti retrouve sa session et son visiteur à la page suivante", async () => {
    let sdk = await chargerPage({ requireConsent: true });
    sdk.consent(true);
    const session = sessionStockee();
    const visiteur = stockage.get("mip_rum_visitor");
    expect(session).toBeTruthy();

    // Page suivante : l'outil de consentement rappelle consent(true) après init().
    maintenant += 2 * MINUTE;
    sdk = await chargerPage({ requireConsent: true });
    journal.length = 0;
    sdk.track("page_deux");
    expect(journal, "la page suivante a lu le stockage avant l'accord").toEqual([]);
    const depuis = etat.spans.length;
    sdk.consent(true);
    sdk.track("apres_accord");
    // Les événements tamponnés sous l'identifiant de mémoire partent sous celui repris.
    expect(idsDe(depuis, "mip.session_id")).toEqual(new Set([session]));
    expect(idsDe(depuis, "mip.visitor_id")).toEqual(new Set([visiteur]));
    expect(sessionStockee()).toBe(session);
  });

  it("le widget d'avis chargé par le SDK reçoit l'interrupteur : pas de période de silence avant l'accord", async () => {
    const sdk = await chargerPage({ requireConsent: true, feedback: { label: "Avis" } });
    const config = (window as unknown as { MIPRumFeedback: { label: string; stockageAutorise: () => boolean } }).MIPRumFeedback;
    expect(config.label).toBe("Avis");
    expect(config.stockageAutorise()).toBe(false);
    sdk.consent(true);
    expect(config.stockageAutorise()).toBe(true);
    sdk.consent(false);
    expect(config.stockageAutorise()).toBe(false);
  });

  it("le mode d'échantillonnage se décide à l'accord, pour la session retenue", async () => {
    // keepOnError:false et sampleRate:0 : la session tombe hors échantillon.
    const sdk = await chargerPage({ requireConsent: true, sampleRate: 0, keepOnError: false });
    sdk.track("avant_accord");
    expect(stockage.has("mip_rum_sampling")).toBe(false);
    sdk.consent(true);
    expect(JSON.parse(stockage.get("mip_rum_sampling")!).mode).toBe("off");
    sdk.track("apres_accord");
    expect(etat.spans, "une session hors échantillon n'envoie ni son tampon ni la suite").toEqual([]);
  });

  it("une session que l'accord fait tomber hors échantillon cesse d'injecter traceparent", async () => {
    const sdk = await chargerPage({ requireConsent: true, sampleRate: 0, keepOnError: false, trace: true });
    expect(etat.optionsApi?.actif?.(), "avant l'accord, la page trace comme une session retenue").toBe(true);
    sdk.consent(true);
    expect(etat.optionsApi?.actif?.()).toBe(false);
  });

  it("error-biased : le tampon part entier s'il porte une erreur, rien sinon", async () => {
    let sdk = await chargerPage({ requireConsent: true, sampleRate: 0 });
    sdk.track("routine");
    sdk.consent(true);
    expect(etat.spans).toEqual([]);

    stockage.clear();
    sdk = await chargerPage({ requireConsent: true, sampleRate: 0 });
    sdk.track("avant_erreur");
    sdk.addError(new Error("panne"));
    sdk.consent(true);
    const noms = etat.spans.map((s) => s.name);
    expect(noms).toContain("pageview");
    expect(noms).toContain("track.avant_erreur");
    expect(noms).toContain("exception");
    // Promue par son erreur, la session reste entière pour la suite et après rechargement.
    expect(JSON.parse(stockage.get("mip_rum_sampling")!).mode).toBe("full");
  });
});

describe("consent(false) : ce que le SDK avait posé est effacé", () => {
  it("efface session, visiteur, échantillonnage, compteur, file de rejeu et silence du widget ; plus rien n'est écrit", async () => {
    const sdk = await chargerPage(); // sans requireConsent : tout est écrit dès l'init
    stockage.set("mip_rum_retry", JSON.stringify({ spans: [], notBefore: 0, tentatives: 1 }));
    stockage.set("mip_rum_retry_revoked_actions", "[]");
    stockage.set("mip_rum_feedback_last:app-consentement", String(T0));
    stockage.set("preference_du_site", "garder"); // le stockage du site hôte n'est pas le nôtre
    const session = sessionStockee();
    const visiteur = stockage.get("mip_rum_visitor");
    for (const cle of ["mip_rum_session", "mip_rum_visitor", "mip_rum_sampling", "mip_rum_seq"]) {
      expect(stockage.has(cle), `${cle} devrait exister avant le refus`).toBe(true);
    }

    sdk.consent(false);
    for (const cle of [
      "mip_rum_session", "mip_rum_visitor", "mip_rum_sampling", "mip_rum_seq",
      "mip_rum_retry", "mip_rum_retry_revoked_actions", "mip_rum_feedback_last:app-consentement",
    ]) {
      expect(stockage.has(cle), `${cle} survit au refus`).toBe(false);
    }
    expect(stockage.get("preference_du_site")).toBe("garder");

    journal.length = 0;
    sdk.track("apres_refus");
    sdk.setUser("autre-agent");
    expect(ecritures(), "le SDK écrit encore après un refus").toEqual([]);

    // Un nouvel accord ne ressuscite pas les identifiants effacés : nouveau visiteur.
    sdk.consent(true);
    expect(sessionStockee()).toBeTruthy();
    expect(sessionStockee()).not.toBe(session);
    expect(stockage.get("mip_rum_visitor")).not.toBe(visiteur);
  });
});

describe("consent(false) arrête le rejeu", () => {
  it("l'enregistrement cesse, et ni le morceau en cours ni ceux en file ne partent", async () => {
    vi.resetModules();
    const { startReplay, flushReplayBoundary } = await vi.importActual<typeof import("../../packages/rum-sdk/src/replay")>(
      "../../packages/rum-sdk/src/replay",
    );
    const envois: string[] = [];
    vi.stubGlobal("fetch", (_url: string, init: { headers: Record<string, string> }) => {
      envois.push(init.headers["x-mip-seq"]);
      return Promise.resolve({ ok: true, status: 200, headers: new Headers() });
    });
    let emettre: (evenement: unknown) => void = () => {};
    let enregistre = true;
    (window as { MIPRumReplay?: unknown }).MIPRumReplay = {
      record: (o: { emit: (e: unknown) => void }) => {
        emettre = o.emit;
        return () => { enregistre = false; };
      },
    };

    const arreter = startReplay({ endpoint: "https://ingest.test/v1/traces", appId: "app" }, "session-1");
    await vi.waitFor(() => expect(typeof emettre).toBe("function"));
    emettre({ type: 2, data: "instantane" });
    flushReplayBoundary();
    await vi.waitFor(() => expect(envois).toEqual(["0"]));

    emettre({ type: 3, data: "en file" });
    flushReplayBoundary(); // morceau 1 enfilé, compression pas encore faite
    emettre({ type: 3, data: "en cours" });
    arreter();
    expect(enregistre, "rrweb enregistre encore").toBe(false);
    flushReplayBoundary();
    await new Promise((r) => setTimeout(r, 50));
    expect(envois, "un morceau est parti après le refus").toEqual(["0"]);
  });
});

describe("sans requireConsent, rien ne change", () => {
  it("session, visiteur et mode sont écrits dès l'init", async () => {
    await chargerPage();
    const cles = new Set(ecritures().map((a) => a.cle));
    for (const cle of ["mip_rum_session", "mip_rum_visitor", "mip_rum_sampling"]) expect(cles).toContain(cle);
    expect(etat.spans.map((s) => s.name)).toContain("pageview");
  });
});

// ═══════════════════════════════ 2.12 b — durée maximale ═══════════════════════

describe("une session dure au plus 4 heures, même active", () => {
  it("d'un chargement à l'autre : active toutes les 20 minutes, elle tourne à 4 h, même visiteur", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    const premiere = getOrCreateSession();
    for (let t = 20; t < 240; t += 20) {
      maintenant = T0 + t * MINUTE;
      expect(getOrCreateSession().sessionId, `à ${t} min`).toBe(premiere.sessionId);
    }
    maintenant = T0 + 240 * MINUTE;
    const suivante = getOrCreateSession();
    expect(suivante.sessionId).not.toBe(premiere.sessionId);
    expect(suivante.visitorId).toBe(premiere.visitorId);
  });

  it("dans la même page : l'événement qui suit l'échéance ouvre une session neuve", async () => {
    const sdk = await chargerPage();
    const premiere = sessionStockee();
    for (let t = 20; t < 240; t += 20) {
      maintenant = T0 + t * MINUTE;
      sdk.track("poste_mural");
    }
    expect(idsDe(0, "mip.session_id")).toEqual(new Set([premiere]));
    const depuis = etat.spans.length;
    maintenant = T0 + 241 * MINUTE;
    sdk.track("poste_mural");
    const seconde = [...idsDe(depuis, "mip.session_id")];
    expect(seconde).toHaveLength(1);
    expect(seconde[0]).not.toBe(premiere);
    expect(sessionStockee()).toBe(seconde[0]);
    // Même visiteur, et la session neuve garde le mode de la page.
    expect(idsDe(0, "mip.visitor_id").size).toBe(1);
    expect(JSON.parse(stockage.get("mip_rum_sampling")!)).toEqual({ sid: seconde[0], mode: "full" });
  });

  it("deux onglets sur la même session passent ENSEMBLE à la suivante, et y restent", async () => {
    // Deux imports du SDK (vi.resetModules) sur le même stockage : deux onglets.
    const a = await chargerPage();
    maintenant = T0 + MINUTE;
    const b = await chargerPage();
    const s0 = sessionStockee();
    for (let t = 20; t < 240; t += 20) {
      maintenant = T0 + t * MINUTE;
      a.track("onglet_a");
      b.track("onglet_b");
    }
    expect(idsDe(0, "mip.session_id")).toEqual(new Set([s0]));

    const depuis = etat.spans.length;
    maintenant = T0 + 241 * MINUTE;
    a.track("onglet_a");
    const suivante = sessionStockee();
    expect(suivante).not.toBe(s0);
    // Le second onglet atteint l'échéance à son tour : il REPREND la session que le
    // premier vient d'ouvrir, au lieu d'en tirer une troisième.
    maintenant = T0 + 242 * MINUTE;
    b.track("onglet_b");
    for (let t = 250; t < 400; t += 10) {
      maintenant = T0 + t * MINUTE;
      a.track("onglet_a");
      b.track("onglet_b");
    }
    expect(idsDe(depuis, "mip.session_id")).toEqual(new Set([suivante]));
    expect(sessionStockee()).toBe(suivante);
  });

  it("dans la même page : 30 minutes sans événement ferment la session", async () => {
    const sdk = await chargerPage();
    const premiere = sessionStockee();
    maintenant += 29 * MINUTE;
    sdk.track("encore_la");
    expect(idsDe(0, "mip.session_id")).toEqual(new Set([premiere]));

    const depuis = etat.spans.length;
    maintenant += 45 * MINUTE;
    sdk.track("retour_apres_pause");
    const seconde = [...idsDe(depuis, "mip.session_id")];
    expect(seconde).toHaveLength(1);
    expect(seconde[0]).not.toBe(premiere);
    expect(sessionStockee()).toBe(seconde[0]);
    expect(idsDe(0, "mip.visitor_id").size, "même visiteur").toBe(1);
  });

  it("un onglet resté inactif rejoint la session qu'un autre onglet a ouverte entre-temps", async () => {
    const a = await chargerPage();
    const s0 = sessionStockee();
    maintenant += 2 * 60 * MINUTE;
    await chargerPage(); // second onglet, deux heures plus tard : session neuve
    const s1 = sessionStockee();
    expect(s1).not.toBe(s0);

    maintenant += MINUTE;
    const depuis = etat.spans.length;
    a.track("retour_sur_le_premier_onglet");
    expect(idsDe(depuis, "mip.session_id")).toEqual(new Set([s1]));
    // Et il ne réécrit pas l'ancienne session par-dessus celle de l'autre onglet.
    expect(sessionStockee()).toBe(s1);
  });

  it("la première action après l'échéance naît dans la session suivante", async () => {
    const sdk = await chargerPage();
    const premiere = sessionStockee();
    maintenant = T0 + 241 * MINUTE;
    const depuis = etat.spans.length;
    sdk.addAction("Valider");
    const suivante = sessionStockee();
    expect(suivante).not.toBe(premiere);
    const racine = etat.spans.slice(depuis).find((s) => s.name === "rum.action");
    expect(racine?.attributes["mip.session_id"], "la racine est partie sous l'ancienne session").toBe(suivante);
  });

  it("error-biased : l'erreur qui suit cette action s'y rattache, dans la session suivante", async () => {
    // La racine n'est émise qu'à l'erreur (rejeu error-biased) : c'est l'erreur qui
    // ferait tourner la session si l'action ne l'avait pas fait à son ouverture.
    const sdk = await chargerPage({ sampleRate: 0 });
    maintenant = T0 + 241 * MINUTE;
    const depuis = etat.spans.length;
    sdk.addAction("Valider");
    sdk.addError(new Error("échec après l'échéance"));
    const suivante = sessionStockee();
    const racine = etat.spans.slice(depuis).find((s) => s.name === "rum.action");
    const erreur = etat.spans.slice(depuis).find((s) => s.name === "exception");
    expect(erreur?.attributes["mip.session_id"]).toBe(suivante);
    expect(racine?.attributes["mip.session_id"]).toBe(suivante);
    expect(erreur?.attributes["mip.action_id"], "l'action a été close à peine ouverte").toBe(racine?.attributes["mip.action_id"]);
  });

  it("une session écrite par un SDK d'avant (sans début) reprend, et compte ses 4 h depuis maintenant", async () => {
    stockage.set("mip_rum_session", JSON.stringify({ sid: "ancienne-session", last: T0 - MINUTE }));
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    expect(getOrCreateSession().sessionId).toBe("ancienne-session");
    expect(JSON.parse(stockage.get("mip_rum_session")!).start).toBe(T0);
  });
});
