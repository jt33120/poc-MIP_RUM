// P7.3 — navigation, interactions et erreurs JS du SDK React Native.
//
// TOUTES LES HORLOGES SONT DÉTERMINISTES, comme en P7.2 : horloge murale par
// `vi.setSystemTime`, horloge monotone et aléa par adaptateurs injectés. Une
// fenêtre causale qui dépendrait de l'heure réelle serait un test qui échoue un
// jour sur dix — et la fenêtre causale est précisément ce dont on ne peut pas se
// contenter de croire qu'il marche.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockAdapter, EtatCycleDeVie, RandomAdapter } from "../../packages/rum-mobile/src/adapters";
import { FenetreCausale } from "../../packages/rum-mobile/src/causal";
import { SuiviNavigation, navigationDepuisRouteur } from "../../packages/rum-mobile/src/navigation";
import { creerInstrumentation } from "../../packages/rum-mobile/src/interactions";
import { installerRejets, rejetsDepuisTracker } from "../../packages/rum-mobile/src/rejets";
import {
  analyserTraceparent,
  composerTracestate,
  doitPropager,
  normaliserOrigine,
  resoudreTraceOrigins,
} from "../../packages/rum-mobile/src/trace";
// @ts-expect-error module JS partagé sans déclarations
import { flattenOtlp } from "../../apps/ingest/supabase/functions/_shared/otlp.mjs";

const ENDPOINT = "https://ingest.test/v1/traces";
const API = "https://api.exemple.fr";
const TIERS = "https://pixel.tiers.test";
const BASE = 1_760_000_000_000;

type Lot = Record<string, any>;

// ───────────────────────────── adaptateurs de test ───────────────────────────

function horlogeFactice(): ClockAdapter & { avance(ms: number): void } {
  let t = 0;
  return { nowMs: () => t, avance: (ms: number) => { t += ms; } };
}

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

interface AppelReseau {
  url: string;
  init: any;
  corps: string;
  lot: Lot | null;
}

function reseauFactice() {
  const appels: AppelReseau[] = [];
  let reponse: { status: number } | Error = { status: 202 };
  /** URL retenue en vol, et la promesse qui la libère. */
  let retenue: { motif: string; gate: Promise<void> } | null = null;
  return {
    appels,
    /** Retient toute requête dont l'URL contient `motif`, jusqu'à `liberer()`. */
    retiens(motif: string): () => void {
      let liberer: () => void = () => {};
      retenue = { motif, gate: new Promise<void>((r) => { liberer = r; }) };
      return liberer;
    },
    /** Lots OTLP réellement envoyés à l'endpoint de collecte. */
    get lots(): Lot[] {
      return appels.filter((a) => a.url === ENDPOINT && a.lot).map((a) => a.lot!);
    },
    /** Requêtes de l'APPLICATION, celles que le patch traverse. */
    get applicatifs(): AppelReseau[] {
      return appels.filter((a) => a.url !== ENDPOINT);
    },
    echoue(e: Error) { reponse = e; },
    // Pas de valeur par défaut sur `init` : c'est ce qui permet de prouver que
    // le patch passe la requête TELLE QUELLE quand il n'a rien à y ajouter.
    fetch: async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : String(input?.url ?? "");
      const corps = typeof init?.body === "string" ? init.body : "";
      let lot: Lot | null = null;
      try {
        lot = corps ? JSON.parse(corps) : null;
      } catch {
        lot = null;
      }
      appels.push({ url, init, corps, lot });
      if (retenue && url.includes(retenue.motif)) await retenue.gate;
      if (reponse instanceof Error) throw reponse;
      return { status: reponse.status, headers: { get: () => null } };
    },
  };
}

function cycleDeVieFactice() {
  const abonnes: Array<(e: EtatCycleDeVie) => void> = [];
  return {
    emettre(etat: EtatCycleDeVie) { for (const cb of [...abonnes]) cb(etat); },
    adapter: {
      subscribe(cb: (e: EtatCycleDeVie) => void) {
        abonnes.push(cb);
        return () => {
          const i = abonnes.indexOf(cb);
          if (i >= 0) abonnes.splice(i, 1);
        };
      },
    },
  };
}

/** Routeur double : la surface publique consommée, et rien de plus. */
function routeurFactice(depart = { name: "Accueil", key: "Accueil-1" }) {
  let courante: { name: string; key: string } | null = depart;
  const ecouteurs: Array<() => void> = [];
  let desabonnements = 0;
  return {
    get desabonnements() { return desabonnements; },
    /** Change de route PUIS notifie — comme le fait un vrai conteneur. */
    va(name: string, key: string, notifications = 1) {
      courante = { name, key };
      for (let i = 0; i < notifications; i++) for (const cb of [...ecouteurs]) cb();
    },
    /** Notifie SANS changer de route : le double callback d'une transition. */
    renotifie(n = 1) {
      for (let i = 0; i < n; i++) for (const cb of [...ecouteurs]) cb();
    },
    ref: {
      addListener(_type: "state", cb: () => void) {
        ecouteurs.push(cb);
        return () => {
          desabonnements++;
          const i = ecouteurs.indexOf(cb);
          if (i >= 0) ecouteurs.splice(i, 1);
        };
      },
      getCurrentRoute: () => courante,
      isReady: () => true,
    },
  };
}

// ─────────────────────────────── harnais SDK ─────────────────────────────────

interface Harnais {
  sdk: typeof import("../../packages/rum-mobile/src/index");
  reseau: ReturnType<typeof reseauFactice>;
  horloge: ReturnType<typeof horlogeFactice>;
  cycle: ReturnType<typeof cycleDeVieFactice>;
  routeur: ReturnType<typeof routeurFactice>;
}

async function sdkFrais(opts: Record<string, unknown> = {}, avecRouteur = false): Promise<Harnais> {
  vi.resetModules();
  const reseau = reseauFactice();
  const horloge = horlogeFactice();
  const cycle = cycleDeVieFactice();
  const routeur = routeurFactice();
  vi.stubGlobal("fetch", reseau.fetch);
  const sdk = await import("../../packages/rum-mobile/src/index");
  const adapters: Record<string, unknown> = {
    random: aleaFactice(),
    monotonicClock: horloge,
    lifecycle: cycle.adapter,
    ...((opts.adapters as Record<string, unknown>) ?? {}),
  };
  if (avecRouteur) adapters.navigation = sdk.navigationDepuisRouteur(routeur.ref);
  delete opts.adapters;
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
    adapters,
    ...opts,
  });
  return { sdk, reseau, horloge, cycle, routeur };
}

function spansDe(lot: Lot): Lot[] {
  return lot.resourceSpans.flatMap((rs: Lot) => rs.scopeSpans.flatMap((ss: Lot) => ss.spans));
}

function tousLesSpans(lots: Lot[]): Lot[] {
  return lots.flatMap(spansDe);
}

function attrs(span: Lot): Record<string, any> {
  const out: Record<string, any> = {};
  for (const a of span.attributes ?? []) {
    const v = a.value ?? {};
    out[a.key] = "stringValue" in v ? v.stringValue
      : "intValue" in v ? Number(v.intValue)
      : "doubleValue" in v ? v.doubleValue
      : "boolValue" in v ? v.boolValue
      : null;
  }
  return out;
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

// ═════════════════════════ 1. Navigation et écrans ═══════════════════════════

describe("P7.3 — dédoublonnage des écrans (unité)", () => {
  it("un callback répété sur le même écran ne produit qu'une vue", () => {
    const suivi = new SuiviNavigation();
    expect(suivi.accepte("Accueil")).toEqual({ name: "Accueil", key: null });
    expect(suivi.accepte("Accueil")).toBeNull();
    expect(suivi.accepte("Accueil")).toBeNull();
  });

  it("la clef de route prime sur le nom : deux instances empilées sont distinctes", () => {
    const suivi = new SuiviNavigation();
    expect(suivi.accepte({ name: "Produit", key: "Produit-1" })).not.toBeNull();
    // Même écran, autre instance : c'est bien une seconde consultation.
    expect(suivi.accepte({ name: "Produit", key: "Produit-2" })).not.toBeNull();
    expect(suivi.accepte({ name: "Produit", key: "Produit-2" })).toBeNull();
  });

  it("A → B → A rend bien trois vues : on ne compare qu'à l'écran COURANT", () => {
    const suivi = new SuiviNavigation();
    expect(suivi.accepte("A")).not.toBeNull();
    expect(suivi.accepte("B")).not.toBeNull();
    expect(suivi.accepte("A")).not.toBeNull();
  });

  it("un écran invalide est refusé SANS effacer l'écran courant", () => {
    const suivi = new SuiviNavigation();
    suivi.accepte("Accueil");
    expect(suivi.accepte("")).toBeNull();
    expect(suivi.accepte({ name: 42 as unknown as string })).toBeNull();
    // Si l'invalide avait effacé l'état, « Accueil » repasserait.
    expect(suivi.accepte("Accueil")).toBeNull();
  });
});

describe("P7.3 — adaptateur de navigation branché sur le routeur", () => {
  it("l'écran d'ouverture est compté, et le double callback ne le double pas", async () => {
    const { sdk, reseau, routeur } = await sdkFrais({}, true);
    routeur.renotifie(3); // le conteneur renotifie sans changer de route
    await sdk.flushNow();

    const vues = tousLesSpans(reseau.lots).filter((s) => s.name === "pageview");
    expect(vues).toHaveLength(1);
    expect(attrs(vues[0])["mip.route"]).toBe("Accueil");
    expect(sdk.getDiagnostics().jsCapabilities?.navigation).toBe("active");
  });

  it("changement d'écran rapide : aucun écran perdu, aucun doublé", async () => {
    const { sdk, reseau, routeur } = await sdkFrais({}, true);
    // Trois transitions dans la même milliseconde, chacune notifiée deux fois —
    // le cas des piles imbriquées, où conteneur et pile notifient chacun.
    routeur.va("Liste", "Liste-1", 2);
    routeur.va("Produit", "Produit-1", 2);
    routeur.va("Panier", "Panier-1", 2);
    await sdk.flushNow();

    const routes = tousLesSpans(reseau.lots)
      .filter((s) => s.name === "pageview")
      .map((s) => attrs(s)["mip.route"]);
    expect(routes).toEqual(["Accueil", "Liste", "Produit", "Panier"]);
  });

  it("routes imbriquées : le conteneur et la pile résolvent la même route finale", async () => {
    const { sdk, reseau, routeur } = await sdkFrais({}, true);
    // Une transition vers un onglet imbriqué : la route la plus profonde est la
    // même à chaque notification, quel que soit le niveau qui l'émet.
    routeur.va("Onglets>Profil", "Profil-1", 4);
    await sdk.flushNow();

    const routes = tousLesSpans(reseau.lots)
      .filter((s) => s.name === "pageview")
      .map((s) => attrs(s)["mip.route"]);
    expect(routes).toEqual(["Accueil", "Onglets>Profil"]);
  });

  it("retour sur le même écran : la vue est bien recomptée", async () => {
    const { sdk, reseau, routeur } = await sdkFrais({}, true);
    routeur.va("Produit", "Produit-1");
    routeur.va("Accueil", "Accueil-1"); // retour
    await sdk.flushNow();

    const routes = tousLesSpans(reseau.lots)
      .filter((s) => s.name === "pageview")
      .map((s) => attrs(s)["mip.route"]);
    expect(routes).toEqual(["Accueil", "Produit", "Accueil"]);
  });

  it("shutdown() se désabonne du routeur ; une notification ultérieure n'émet rien", async () => {
    const { sdk, reseau, routeur } = await sdkFrais({}, true);
    await sdk.shutdown();
    expect(routeur.desabonnements).toBe(1);
    const avant = reseau.appels.length;
    routeur.va("Fantome", "Fantome-1");
    expect(reseau.appels).toHaveLength(avant);
  });

  it("screen() manuel dédoublonne aussi, et la clef distingue deux instances", async () => {
    const { sdk, reseau } = await sdkFrais();
    sdk.screen("Accueil");
    sdk.screen("Accueil"); // callback manuel répété
    sdk.screen("Produit", "Produit-1");
    sdk.screen("Produit", "Produit-2"); // autre instance : comptée
    await sdk.flushNow();

    const routes = tousLesSpans(reseau.lots)
      .filter((s) => s.name === "pageview")
      .map((s) => attrs(s)["mip.route"]);
    expect(routes).toEqual(["Accueil", "Produit", "Produit"]);
    // Aucun adaptateur branché : la capacité le dit.
    expect(sdk.getDiagnostics().jsCapabilities?.navigation).toBe("unavailable");
  });

  it("l'adaptateur ne lève jamais dans l'app hôte, même si le routeur est hostile", async () => {
    const adapter = navigationDepuisRouteur({
      addListener() { throw new Error("routeur cassé"); },
      getCurrentRoute() { throw new Error("route cassée"); },
    });
    const vus: unknown[] = [];
    let desabonner: () => void = () => {};
    expect(() => { desabonner = adapter.subscribeScreen((e) => vus.push(e)); }).not.toThrow();
    expect(vus).toHaveLength(0);
    expect(() => desabonner()).not.toThrow();
  });
});

// ═══════════════════════ 2. Interactions Pressable ═══════════════════════════

describe("P7.3 — instrumentation d'appui, opt-in et sans texte affiché", () => {
  function crochetsFactices() {
    const ouvertes: string[] = [];
    const suivies: unknown[] = [];
    return {
      ouvertes,
      suivies,
      crochets: {
        ouvrir: (nom: string) => { ouvertes.push(nom); return `a-${ouvertes.length}`; },
        suivre: (r: unknown) => { suivies.push(r); },
      },
    };
  }

  it("sans mipActionName, les props sont rendues À L'IDENTIQUE", () => {
    const { crochets, ouvertes } = crochetsFactices();
    const instrument = creerInstrumentation(crochets);
    const onPress = () => {};
    const props = { onPress, accessibilityLabel: "Payer" };
    expect(instrument(props)).toBe(props); // même objet, pas une copie
    expect(ouvertes).toHaveLength(0);
  });

  it("le texte affiché n'est JAMAIS lu — même quand il est là", () => {
    const { crochets, ouvertes } = crochetsFactices();
    const instrument = creerInstrumentation(crochets);
    let luChildren = 0;
    const props: Record<string, unknown> = {
      mipActionName: "checkout.payer",
      onPress: () => {},
      accessibilityLabel: "Payer la commande",
    };
    // Un getter qui COMPTE les lectures : si l'instrumentation extrayait le
    // libellé, ce compteur serait non nul et le montant partirait en télémétrie.
    Object.defineProperty(props, "children", {
      enumerable: true,
      get() { luChildren++; return "Payer 128,40 €"; },
    });
    const sortie = instrument(props as never) as Record<string, unknown>;
    (sortie.onPress as () => void)();

    expect(ouvertes).toEqual(["checkout.payer"]);
    expect(luChildren).toBe(0);
    expect(JSON.stringify(ouvertes)).not.toContain("128,40");
  });

  it("l'accessibilité et toutes les autres props traversent inchangées", () => {
    const { crochets } = crochetsFactices();
    const instrument = creerInstrumentation(crochets);
    const onPress = () => {};
    const sortie = instrument({
      mipActionName: "checkout.payer",
      onPress,
      accessibilityLabel: "Payer la commande",
      accessibilityRole: "button",
      accessibilityHint: "Valide le paiement",
      accessibilityState: { disabled: false },
      testID: "btn-payer",
    } as never) as Record<string, unknown>;

    expect(sortie.accessibilityLabel).toBe("Payer la commande");
    expect(sortie.accessibilityRole).toBe("button");
    expect(sortie.accessibilityHint).toBe("Valide le paiement");
    expect(sortie.accessibilityState).toEqual({ disabled: false });
    expect(sortie.testID).toBe("btn-payer");
    // `mipActionName` ne doit pas atteindre le composant cible.
    expect("mipActionName" in sortie).toBe(false);
    expect(sortie.onPress).not.toBe(onPress);
  });

  it("l'appel original est préservé : arguments, `this`, valeur rendue, exception", () => {
    const { crochets, ouvertes, suivies } = crochetsFactices();
    const instrument = creerInstrumentation(crochets);
    const recu: unknown[] = [];
    const hote = {
      onPress(this: unknown, ...args: unknown[]) { recu.push(this, ...args); return "rendu"; },
    };
    const sortie = instrument({ mipActionName: "a", onPress: hote.onPress } as never) as Record<string, unknown>;
    const resultat = (sortie.onPress as (...a: unknown[]) => unknown).call(hote, { nativeEvent: 1 });

    expect(resultat).toBe("rendu");
    expect(recu[0]).toBe(hote);
    expect(recu[1]).toEqual({ nativeEvent: 1 });
    expect(suivies).toEqual(["rendu"]);

    const cassee = instrument({
      mipActionName: "b",
      onPress: () => { throw new Error("boum applicatif"); },
    } as never) as Record<string, unknown>;
    // L'exception du gestionnaire remonte TELLE QUELLE : sans quoi une erreur
    // applicative disparaîtrait parce que MIP est installé.
    expect(() => (cassee.onPress as () => void)()).toThrow("boum applicatif");
    expect(ouvertes).toEqual(["a", "b"]);
  });

  it("le gestionnaire enveloppé est STABLE : pas un rendu React par frame", () => {
    const { crochets } = crochetsFactices();
    const instrument = creerInstrumentation(crochets);
    const onPress = () => {};
    const a = instrument({ mipActionName: "x", onPress } as never) as Record<string, unknown>;
    const b = instrument({ mipActionName: "x", onPress } as never) as Record<string, unknown>;
    expect(a.onPress).toBe(b.onPress);
    // Un autre nom sur le même gestionnaire reste une autre action.
    const c = instrument({ mipActionName: "y", onPress } as never) as Record<string, unknown>;
    expect(c.onPress).not.toBe(a.onPress);
  });

  it("un crochet qui lève ne casse jamais l'appui", () => {
    const instrument = creerInstrumentation({
      ouvrir: () => { throw new Error("SDK cassé"); },
      suivre: () => { throw new Error("SDK cassé"); },
    });
    let appele = false;
    const sortie = instrument({
      mipActionName: "a",
      onPress: () => { appele = true; },
    } as never) as Record<string, unknown>;
    expect(() => (sortie.onPress as () => void)()).not.toThrow();
    expect(appele).toBe(true);
  });

  it("bout en bout : l'action racine porte type=click et le nom déclaré", async () => {
    const { sdk, reseau } = await sdkFrais();
    const props = sdk.instrumentPressable({
      mipActionName: "checkout.payer",
      accessibilityLabel: "Payer",
      onPress: () => {},
    });
    (props as { onPress: () => void }).onPress();
    await sdk.flushNow();

    const actions = tousLesSpans(reseau.lots).filter((s) => s.name === "rum.action");
    expect(actions).toHaveLength(1);
    const a = attrs(actions[0]);
    expect(a["mip.event_name"]).toBe("checkout.payer");
    expect(a["mip.action_type"]).toBe("click");
    expect(typeof a["mip.action_id"]).toBe("string");

    // L'ingestion accepte le type et crée bien une ligne d'action.
    const rows = flattenOtlp(reseau.lots[0]);
    expect(rows.actions).toHaveLength(1);
    expect(rows.actions[0]).toMatchObject({ type: "click", name: "checkout.payer" });
  });
});

// ═══════════════════════ 3. Fenêtre causale ══════════════════════════════════

describe("P7.3 — fenêtre causale (unité)", () => {
  function fenetreFactice(opts: Partial<{ accepte: boolean }> = {}) {
    let t = 0;
    let session = "s-1";
    let epoch = 1;
    const emises: string[] = [];
    const f = new FenetreCausale({
      now: () => t,
      sessionId: () => session,
      epoch: () => epoch,
      newId: () => `a-${emises.length + 1}`,
      emitRoot: (id) => { emises.push(id); return opts.accepte !== false; },
    });
    return {
      f,
      emises,
      avance: (ms: number) => { t += ms; },
      tourneSession: () => { session = `s-${Math.random()}`; },
      revoque: () => { epoch++; },
    };
  }

  it("dans la fenêtre : attribué ; après la fenêtre : non attribué", () => {
    const { f, avance } = fenetreFactice();
    const id = f.ouvrir("Payer", "click");
    expect(id).toBe("a-1");
    avance(4_999);
    expect(f.courante()).toBe("a-1");
    avance(2);
    // Et surtout : PAS de repli sur le dernier clic connu.
    expect(f.courante()).toBeNull();
  });

  it("une racine refusée n'attribue rien du tout", () => {
    const { f } = fenetreFactice({ accepte: false });
    expect(f.ouvrir("Payer", "click")).toBeNull();
    expect(f.courante()).toBeNull();
  });

  it("deux actions rapprochées : la seconde remplace la première", () => {
    const { f, avance } = fenetreFactice();
    f.ouvrir("Premier", "click");
    avance(200);
    f.ouvrir("Second", "click");
    expect(f.courante()).toBe("a-2");
  });

  it("une promesse en vol MAINTIENT la fenêtre, son règlement la referme", async () => {
    const { f, avance } = fenetreFactice();
    f.ouvrir("Payer", "click");
    let resoudre: () => void = () => {};
    f.suivre(new Promise<void>((r) => { resoudre = r; }));

    avance(20_000); // bien au-delà des 5 s de base
    expect(f.courante()).toBe("a-1"); // la promesse est encore en vol

    resoudre();
    await Promise.resolve();
    await Promise.resolve();
    // Réglée : le travail causé par l'appui est terminé. Ce qui vient après ne
    // lui appartient plus.
    expect(f.courante()).toBeNull();
  });

  it("le maintien par promesse est PLAFONNÉ : une promesse éternelle n'attribue pas à vie", () => {
    const { f, avance } = fenetreFactice();
    f.ouvrir("Payer", "click");
    f.suivre(new Promise<void>(() => {}));
    avance(29_999);
    expect(f.courante()).toBe("a-1");
    avance(2);
    expect(f.courante()).toBeNull();
  });

  it("rotation de session et révocation coupent le lien immédiatement", () => {
    const a = fenetreFactice();
    a.f.ouvrir("Payer", "click");
    a.tourneSession();
    expect(a.f.courante()).toBeNull();

    const b = fenetreFactice();
    b.f.ouvrir("Payer", "click");
    b.revoque();
    expect(b.f.courante()).toBeNull();
  });

  it("une valeur non-thenable n'ouvre aucun maintien", () => {
    const { f, avance } = fenetreFactice();
    f.ouvrir("Payer", "click");
    f.suivre(undefined);
    f.suivre(42);
    avance(5_001);
    expect(f.courante()).toBeNull();
  });
});

describe("P7.3 — fenêtre causale bout en bout", () => {
  it("les signaux d'un appui portent son action_id, ceux d'après ne le portent plus", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    const props = sdk.instrumentPressable({
      mipActionName: "checkout.payer",
      onPress: () => { sdk.track("paiement_lance", { n: 1 }); },
    });
    (props as { onPress: () => void }).onPress();

    // Hors fenêtre : travail tardif, non attribué. On ne devine pas le clic.
    horloge.avance(5_001);
    sdk.track("beaucoup_plus_tard", { n: 2 });
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const racine = spans.find((s) => s.name === "rum.action")!;
    const actionId = attrs(racine)["mip.action_id"];
    const pendant = spans.find((s) => attrs(s)["mip.event_name"] === "paiement_lance")!;
    const apres = spans.find((s) => attrs(s)["mip.event_name"] === "beaucoup_plus_tard")!;

    expect(attrs(pendant)["mip.action_id"]).toBe(actionId);
    expect(attrs(apres)["mip.action_id"] ?? null).toBeNull();
  });

  it("deux actions proches : chaque effet va à la SIENNE", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    sdk.addAction("Premier");
    sdk.track("effet_du_premier", {});
    horloge.avance(300);
    sdk.addAction("Second");
    sdk.track("effet_du_second", {});
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const parNom = (n: string) => spans.find((s) => attrs(s)["mip.event_name"] === n)!;
    const idPremier = attrs(parNom("Premier"))["mip.action_id"];
    const idSecond = attrs(parNom("Second"))["mip.action_id"];
    expect(idPremier).not.toBe(idSecond);
    expect(attrs(parNom("effet_du_premier"))["mip.action_id"]).toBe(idPremier);
    expect(attrs(parNom("effet_du_second"))["mip.action_id"]).toBe(idSecond);
  });

  it("une erreur SANS action ne porte aucun action_id", async () => {
    const { sdk, reseau } = await sdkFrais();
    sdk.addError(new Error("échec isolé"));
    await sdk.flushNow();
    const erreur = tousLesSpans(reseau.lots).find((s) => s.name === "exception")!;
    expect(attrs(erreur)["mip.action_id"] ?? null).toBeNull();
  });

  it("une navigation ferme la fenêtre : l'écran suivant n'hérite pas de l'appui", async () => {
    const { sdk, reseau } = await sdkFrais();
    sdk.addAction("Payer");
    sdk.screen("Confirmation");
    sdk.track("sur_confirmation", {});
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const suivant = spans.find((s) => attrs(s)["mip.event_name"] === "sur_confirmation")!;
    expect(attrs(suivant)["mip.action_id"] ?? null).toBeNull();
  });

  it("promesse rendue par onPress : la requête tardive qu'elle lance reste attribuée", async () => {
    const { sdk, reseau, horloge } = await sdkFrais({ traceOrigins: [API] });
    let resoudre: () => void = () => {};
    const props = sdk.instrumentPressable({
      mipActionName: "checkout.payer",
      onPress: () => new Promise<void>((r) => { resoudre = r; }),
    });
    (props as { onPress: () => unknown }).onPress();

    horloge.avance(8_000); // au-delà de la fenêtre de base
    await (globalThis as { fetch: (u: string) => Promise<unknown> }).fetch(`${API}/payer`);
    resoudre();
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const racine = spans.find((s) => s.name === "rum.action")!;
    const http = spans.find((s) => s.name === "http.client")!;
    expect(attrs(http)["mip.action_id"]).toBe(attrs(racine)["mip.action_id"]);
  });
});

// ════════ 4. Racine refusée : aucun enfant orphelin (mécanisme du web) ═══════

describe("P7.3 — une racine refusée ne laisse pas d'enfants porteurs de son id", () => {
  it("hook qui rejette la racine : les effets partent SANS action_id", async () => {
    const { sdk, reseau } = await sdkFrais({
      beforeSend: (a: Record<string, unknown>) =>
        a["mip.event_type"] === "action" ? null : a,
    });
    expect(sdk.addAction("Payer")).toBe(false);
    sdk.track("effet", { n: 1 });
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    expect(spans.filter((s) => s.name === "rum.action")).toHaveLength(0);
    const effet = spans.find((s) => attrs(s)["mip.event_name"] === "effet")!;
    expect(attrs(effet)["mip.action_id"] ?? null).toBeNull();
  });

  it("racine évincée du TAMPON d'attente de consentement : le lien est coupé", async () => {
    // En `pending`, le tampon mémoire est le seul stockage. Quand il déborde, le
    // plus ancien tombe — et le plus ancien, c'est la racine. C'est le cas que
    // `revokedRoots` traite côté web dans `ConsentGate.submit`.
    const { sdk, reseau } = await sdkFrais({
      requireConsent: true,
      initialConsent: "pending",
      offline: { maxEvents: 3 },
    });
    expect(sdk.addAction("Payer")).toBe(true); // accepté… en mémoire seulement
    sdk.track("effet-1", {});
    sdk.track("effet-2", {});
    sdk.track("effet-3", {}); // évince la racine du tampon
    sdk.consent(true);
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    expect(spans.filter((s) => s.name === "rum.action")).toHaveLength(0);
    for (const s of spans) expect(attrs(s)["mip.action_id"] ?? null).toBeNull();
  });

  it("après une révocation, plus rien ne porte l'action de l'époque refusée", async () => {
    const { sdk, reseau } = await sdkFrais();
    sdk.addAction("Payer");
    sdk.consent(false);
    expect(sdk.addAction("Encore")).toBe(false);
    sdk.consent(true);
    sdk.track("apres", {});
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    expect(spans.filter((s) => s.name === "rum.action")).toHaveLength(0);
    const apres = spans.find((s) => attrs(s)["mip.event_name"] === "apres")!;
    expect(attrs(apres)["mip.action_id"] ?? null).toBeNull();
  });

  it("une racine ÉVINCÉE de la file coupe le lien des enfants restés en file", async () => {
    // File minuscule : la racine, plus ancienne, tombe la première.
    const { sdk, reseau } = await sdkFrais({ offline: { maxEvents: 3 } });
    sdk.addAction("Payer");
    sdk.track("effet-1", {});
    sdk.track("effet-2", {});
    sdk.track("effet-3", {}); // évince la racine
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    expect(spans.filter((s) => s.name === "rum.action")).toHaveLength(0);
    for (const s of spans) expect(attrs(s)["mip.action_id"] ?? null).toBeNull();
    expect(sdk.getDiagnostics().dropped).toBeGreaterThan(0);
  });
});

// ════════════════════════ 5. Erreurs JS ══════════════════════════════════════

describe("P7.3 — erreurs JS non interceptées", () => {
  function errorUtilsFactice() {
    let handler: ((e: unknown, fatal: boolean) => void) | null = null;
    const precedents: Array<[unknown, boolean]> = [];
    const precedent = (e: unknown, fatal: boolean) => { precedents.push([e, fatal]); };
    handler = precedent;
    return {
      precedents,
      get handler() { return handler; },
      api: {
        getGlobalHandler: () => handler,
        setGlobalHandler: (h: (e: unknown, fatal: boolean) => void) => { handler = h; },
      },
    };
  }

  it("un JS fatal est déclaré fatal, garde le handler précédent, et n'est PAS un crash natif", async () => {
    const EU = errorUtilsFactice();
    vi.stubGlobal("ErrorUtils", EU.api);
    const { sdk, reseau } = await sdkFrais();
    expect(sdk.getDiagnostics().jsCapabilities?.errorHandler).toBe("active");

    const erreur = new Error("plantage JS");
    EU.handler!(erreur, true);
    await sdk.flushNow();

    // Le comportement d'origine (redbox / terminaison) n'est pas masqué.
    expect(EU.precedents).toEqual([[erreur, true]]);

    const rows = flattenOtlp(reseau.lots[0]);
    expect(rows.errors).toHaveLength(1);
    expect(rows.errors[0]).toMatchObject({
      kind: "crash",
      handled: false,
      is_fatal: true,
      // La source dit « JS React Native » : un crash NATIF n'a pas cette source
      // et ne sera pas collecté par ce runtime (P8.5).
      error_source: "react_native_js",
    });
  });

  it("un JS non fatal est déclaré non fatal — la fatalité n'est jamais déduite", async () => {
    const EU = errorUtilsFactice();
    vi.stubGlobal("ErrorUtils", EU.api);
    const { sdk, reseau } = await sdkFrais();
    EU.handler!(new Error("avertissement"), false);
    await sdk.flushNow();
    expect(flattenOtlp(reseau.lots[0]).errors[0].is_fatal).toBe(false);
  });

  it("sans ErrorUtils, la capacité est déclarée ABSENTE (jamais « zéro erreur »)", async () => {
    vi.stubGlobal("ErrorUtils", undefined);
    const { sdk } = await sdkFrais();
    expect(sdk.getDiagnostics().jsCapabilities?.errorHandler).toBe("unavailable");
  });

  it("un rejet non géré est collecté par adaptateur, non fatal et non intercepté", async () => {
    let emettre: ((r: unknown) => void) | null = null;
    let desabonnements = 0;
    const { sdk, reseau } = await sdkFrais({
      adapters: {
        unhandledRejection: {
          subscribe(cb: (r: unknown) => void) {
            emettre = cb;
            return () => { desabonnements++; };
          },
        },
      },
    });
    expect(sdk.getDiagnostics().jsCapabilities?.unhandledRejection).toBe("active");

    emettre!(new Error("promesse abandonnée"));
    await sdk.flushNow();

    const rows = flattenOtlp(reseau.lots[0]);
    expect(rows.errors[0]).toMatchObject({
      kind: "unhandledrejection",
      handled: false,
      is_fatal: false,
      error_source: "react_native_js",
    });

    await sdk.shutdown();
    expect(desabonnements).toBe(1);
  });

  it("mode « capacité absente » : aucun mécanisme retirable, rien n'est posé", () => {
    const vu: unknown[] = [];
    const installation = installerRejets(undefined, {}, (r) => vu.push(r));
    expect(installation).toMatchObject({ etat: "unavailable", source: "none" });
    expect(() => installation.desinstaller()).not.toThrow();
  });

  it("un adaptateur qui ne rend pas de désabonnement est REFUSÉ", () => {
    const installation = installerRejets(
      { subscribe: () => undefined as unknown as () => void },
      {},
      () => {},
    );
    // Sinon un écouteur survivrait à `shutdown()` — on préfère l'absence à la
    // promesse d'un arrêt qu'on ne tient pas.
    expect(installation.etat).toBe("unavailable");
  });

  it("l'événement standard `unhandledrejection` est utilisé quand il existe", () => {
    const ecouteurs = new Map<string, (e: unknown) => void>();
    const cible = {
      addEventListener(t: string, l: (e: unknown) => void) { ecouteurs.set(t, l); },
      removeEventListener(t: string) { ecouteurs.delete(t); },
    };
    const vu: unknown[] = [];
    const installation = installerRejets(undefined, cible, (r) => vu.push(r));
    expect(installation).toMatchObject({ etat: "active", source: "events" });

    ecouteurs.get("unhandledrejection")!({ reason: new Error("rejet") });
    expect((vu[0] as Error).message).toBe("rejet");
    installation.desinstaller();
    expect(ecouteurs.size).toBe(0);
  });

  it("`process.on` n'est JAMAIS utilisé : y poser un écouteur supprimerait la terminaison", () => {
    const poses: string[] = [];
    const cible = {
      process: {
        on(t: string) { poses.push(t); },
        off() {},
      },
    } as unknown as Parameters<typeof installerRejets>[1];
    const installation = installerRejets(undefined, cible, () => {});
    // Sous Node, la seule présence d'un écouteur `unhandledRejection` désactive
    // le comportement par défaut du runtime. Collecter ne doit pas faire
    // survivre un processus que l'exploitant voulait voir mourir.
    expect(poses).toEqual([]);
    expect(installation.etat).toBe("unavailable");
  });

  it("l'événement standard n'appelle pas preventDefault : la trace du moteur reste visible", () => {
    let empeche = 0;
    const ecouteurs = new Map<string, (e: unknown) => void>();
    const cible = {
      addEventListener(t: string, l: (e: unknown) => void) { ecouteurs.set(t, l); },
      removeEventListener(t: string) { ecouteurs.delete(t); },
    };
    installerRejets(undefined, cible, () => {});
    ecouteurs.get("unhandledrejection")!({
      reason: new Error("rejet"),
      preventDefault() { empeche++; },
    });
    expect(empeche).toBe(0);
  });

  it("rejetsDepuisTracker branche le module que l'application possède, et le coupe", () => {
    let options: Record<string, any> | null = null;
    let desactive = 0;
    const adapter = rejetsDepuisTracker({
      enable(o) { options = o; },
      disable() { desactive++; },
    });
    const vu: unknown[] = [];
    const desabonner = adapter.subscribe((r) => vu.push(r));
    expect(options!.allRejections).toBe(true);

    options!.onUnhandled(1, new Error("rejet"));
    expect(vu).toHaveLength(1);
    desabonner();
    expect(desactive).toBe(1);
    // Après désabonnement, plus rien ne remonte même si le module rappelle.
    options!.onUnhandled(2, new Error("tardif"));
    expect(vu).toHaveLength(1);
  });

  it("une erreur JS pendant l'appui porte l'action qui l'a causée", async () => {
    const EU = errorUtilsFactice();
    vi.stubGlobal("ErrorUtils", EU.api);
    const { sdk, reseau } = await sdkFrais();
    const props = sdk.instrumentPressable({
      mipActionName: "checkout.payer",
      onPress: () => { throw new Error("boum pendant l'appui"); },
    });
    expect(() => (props as { onPress: () => void }).onPress()).toThrow();
    EU.handler!(new Error("boum pendant l'appui"), false);
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const racine = spans.find((s) => s.name === "rum.action")!;
    const erreur = spans.find((s) => s.name === "exception")!;
    expect(attrs(erreur)["mip.action_id"]).toBe(attrs(racine)["mip.action_id"]);
  });
});

// ═══════════════════ 6. Fetch : recopie, préservation, allowlist ═════════════

describe("P7.3 — propagation de trace (unité)", () => {
  it("un traceparent valide est reconnu, un traceparent tout-zéro ne l'est pas", () => {
    expect(analyserTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      flags: "01",
    });
    expect(analyserTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeNull();
    expect(analyserTraceparent("00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01")).toBeNull();
    expect(analyserTraceparent("01-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01")).toBeNull();
    expect(analyserTraceparent("n'importe quoi")).toBeNull();
  });

  it("une liste vide ne propage vers RIEN — c'est la rupture de comportement", () => {
    expect(doitPropager("https://api.exemple.fr", [], "https://ingest.test")).toBe(false);
    expect(doitPropager("https://api.exemple.fr", ["https://api.exemple.fr"], "https://ingest.test")).toBe(true);
    // L'endpoint reste exclu même déclaré : sinon chaque envoi produirait un span.
    expect(doitPropager("https://ingest.test", ["https://ingest.test"], "https://ingest.test")).toBe(false);
  });

  it("les origines sont normalisées, et une entrée non absolue est REFUSÉE", () => {
    const r = resoudreTraceOrigins(["HTTPS://API.Exemple.fr/v1/commandes", "api.exemple.fr", "", 42]);
    expect(r.origines).toEqual(["https://api.exemple.fr"]);
    expect(r.refusees).toEqual(["api.exemple.fr"]);
    expect(normaliserOrigine("/relatif")).toBeNull();
  });

  it("le tracestate existant est conservé derrière le nôtre, et borné", () => {
    expect(composerTracestate(undefined, "s1")).toBe("mip=s:s1");
    expect(composerTracestate("autre=x", "s1")).toBe("mip=s:s1,autre=x");
    expect(composerTracestate("a".repeat(600), "s1")).toBe("mip=s:s1");
  });
});

describe("P7.3 — patch fetch", () => {
  const tp = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";

  it("réseau TIERS : aucun en-tête MIP, mais le span reste observé", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    await (globalThis as any).fetch(`${TIERS}/collect?id=1`);
    await sdk.flushNow();

    const appel = reseau.applicatifs[0];
    // Rien n'a été ajouté : `init` est passé tel quel au fetch d'origine.
    expect(appel.init?.headers).toBeUndefined();
    expect(JSON.stringify(appel.init ?? {})).not.toContain("traceparent");
    expect(JSON.stringify(appel.init ?? {})).not.toContain("mip=s:");
    // L'appel est quand même mesuré : observer sa latence n'expose rien au tiers.
    const http = tousLesSpans(reseau.lots).find((s) => s.name === "http.client")!;
    expect(attrs(http)["http.url"]).toContain(TIERS);
  });

  it("origine déclarée : traceparent et tracestate propagés, et corrélés au span", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [`${API}/v1`] });
    await (globalThis as any).fetch(`${API}/commandes`, { method: "POST", headers: { authorization: "Bearer x" } });
    await sdk.flushNow();

    const entetes = reseau.applicatifs[0].init.headers as Headers;
    const traceparent = entetes.get("traceparent")!;
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(entetes.get("tracestate")).toMatch(/^mip=s:[0-9a-f]+$/);
    // L'en-tête de l'appelant n'a pas été perdu par la fusion.
    expect(entetes.get("authorization")).toBe("Bearer x");

    const http = tousLesSpans(reseau.lots).find((s) => s.name === "http.client")!;
    expect(traceparent).toContain(attrs(http)["mip.trace_id"]);
    expect(traceparent).toContain(attrs(http)["mip.span_id"]);
    expect(attrs(http)["http.method"]).toBe("POST");
  });

  it("un traceparent VALIDE déjà posé est préservé, et devient l'identité du span", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    await (globalThis as any).fetch(`${API}/commandes`, { headers: { traceparent: tp } });
    await sdk.flushNow();

    // L'init de l'appelant n'est même pas réécrit : rien à ajouter.
    expect(reseau.applicatifs[0].init.headers.traceparent).toBe(tp);
    const http = tousLesSpans(reseau.lots).find((s) => s.name === "http.client")!;
    expect(attrs(http)["mip.trace_id"]).toBe("0af7651916cd43dd8448eb211c80319c");
    expect(attrs(http)["mip.span_id"]).toBe("b7ad6b7169203331");
  });

  it("un traceparent INVALIDE n'est pas une trace : il est remplacé", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    await (globalThis as any).fetch(`${API}/x`, { headers: { traceparent: "00-0-0-0" } });
    const entetes = reseau.applicatifs[0].init.headers as Headers;
    expect(entetes.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    await sdk.flushNow();
  });

  it("un Request : méthode ET en-têtes recopiés, jamais remplacés", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    const requete = new Request(`${API}/commandes`, {
      method: "PUT",
      headers: { "x-client": "mobile", "content-type": "application/json" },
    });
    await (globalThis as any).fetch(requete);
    await sdk.flushNow();

    const entetes = reseau.applicatifs[0].init.headers as Headers;
    // Sans fusion, `init.headers` remplacerait la totalité des en-têtes du
    // Request selon WHATWG : l'en-tête client et le content-type disparaîtraient.
    expect(entetes.get("x-client")).toBe("mobile");
    expect(entetes.get("content-type")).toBe("application/json");
    expect(entetes.get("traceparent")).toBeTruthy();

    const http = tousLesSpans(reseau.lots).find((s) => s.name === "http.client")!;
    // La méthode venait du Request, pas d'`init` : avant P7.3 elle valait « GET ».
    expect(attrs(http)["http.method"]).toBe("PUT");
  });

  it("un Request avec traceparent valide est préservé, sans réécriture d'init", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    await (globalThis as any).fetch(new Request(`${API}/x`, { headers: { traceparent: tp } }));
    await sdk.flushNow();
    expect(reseau.applicatifs[0].init).toBeUndefined();
    const http = tousLesSpans(reseau.lots).find((s) => s.name === "http.client")!;
    expect(attrs(http)["mip.trace_id"]).toBe("0af7651916cd43dd8448eb211c80319c");
  });

  it("l'endpoint de collecte n'est ni tracé ni observé : pas de boucle", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [ENDPOINT, API] });
    sdk.track("x", {});
    await sdk.flushNow();
    const spans = tousLesSpans(reseau.lots);
    expect(spans.filter((s) => s.name === "http.client")).toHaveLength(0);
    const envoi = reseau.appels.find((a) => a.url === ENDPOINT)!;
    expect(JSON.stringify(envoi.init.headers)).not.toContain("traceparent");
  });

  it("requête EN VOL pendant une rotation d'identité : le snapshot d'origine tient", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    sdk.setUser("u-avant");
    const liberer = reseau.retiens("/lent");
    const enVol = (globalThis as any).fetch(`${API}/lent`);
    // La requête est partie ; l'utilisateur change AVANT qu'elle ne réponde.
    sdk.setUser("u-apres");
    sdk.track("apres_rotation", {});
    liberer();
    await enVol;
    await sdk.flushNow();

    const spans = tousLesSpans(reseau.lots);
    const http = spans.find((s) => s.name === "http.client")!;
    const apres = spans.find((s) => attrs(s)["mip.event_name"] === "apres_rotation")!;
    // Le span porte l'identité ET la session du DÉPART. Réattribuer au flush
    // ferait porter à « u-apres » une requête qu'il n'a jamais faite.
    expect(attrs(http)["mip.identity.user_id"]).toBe("u-avant");
    expect(attrs(apres)["mip.identity.user_id"]).toBe("u-apres");
    expect(attrs(http)["mip.session_id"]).not.toBe(attrs(apres)["mip.session_id"]);
  });

  it("une erreur réseau est mesurée (status 0) et l'exception remonte", async () => {
    const { sdk, reseau } = await sdkFrais({ traceOrigins: [API] });
    reseau.echoue(new Error("network request failed"));
    await expect((globalThis as any).fetch(`${API}/x`)).rejects.toThrow("network request failed");
  });
});

// ════════════════════════ 7. Démarrage applicatif ════════════════════════════

describe("P7.3 — démarrage JS, et ce qu'il n'est pas", () => {
  it("js_start_to_first_screen_ms mesure de init() au premier écran déclaré", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    horloge.avance(820);
    expect(sdk.markFirstScreenRendered()).toBe(true);
    await sdk.flushNow();

    const timing = tousLesSpans(reseau.lots).find((s) => s.name === "rum.timing")!;
    const a = attrs(timing);
    expect(a["mip.event_name"]).toBe("js_start_to_first_screen_ms");
    expect(a["mip.timing_ms"]).toBe(820);
    expect(sdk.getDiagnostics().jsCapabilities?.appStart).toBe("active");

    const rows = flattenOtlp(reseau.lots[0]);
    const evenement = rows.events.find((e: Lot) => e.name === "js_start_to_first_screen_ms");
    expect(evenement).toMatchObject({ event_type: "timing", timing_ms: 820 });
  });

  it("un second appel sans passage en arrière-plan ne mesure rien", async () => {
    const { sdk, horloge } = await sdkFrais();
    horloge.avance(500);
    expect(sdk.markFirstScreenRendered()).toBe(true);
    horloge.avance(500);
    expect(sdk.markFirstScreenRendered()).toBe(false);
  });

  it("le démarrage à CHAUD porte un nom distinct et part du retour au premier plan", async () => {
    const { sdk, reseau, horloge, cycle } = await sdkFrais();
    horloge.avance(700);
    sdk.markFirstScreenRendered();

    cycle.emettre("background");
    horloge.avance(120_000); // l'utilisateur revient bien plus tard
    cycle.emettre("active");
    horloge.avance(140);
    expect(sdk.markFirstScreenRendered()).toBe(true);
    await sdk.flushNow();

    const timings = tousLesSpans(reseau.lots)
      .filter((s) => s.name === "rum.timing")
      .map((s) => [attrs(s)["mip.event_name"], attrs(s)["mip.timing_ms"]]);
    expect(timings).toEqual([
      ["js_start_to_first_screen_ms", 700],
      // 140 ms depuis le retour au premier plan, PAS 120 840 depuis init().
      ["js_warm_start_to_first_screen_ms", 140],
    ]);
  });

  it("une durée invraisemblable est REFUSÉE, et ne repousse pas la mesure", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    horloge.avance(120_000);
    expect(sdk.markFirstScreenRendered()).toBe(false);
    horloge.avance(10);
    // La fenêtre froide est consommée : pas de seconde chance avec une valeur pire.
    expect(sdk.markFirstScreenRendered()).toBe(false);
    await sdk.flushNow();
    expect(tousLesSpans(reseau.lots).filter((s) => s.name === "rum.timing")).toHaveLength(0);
  });

  it("aucun ANR n'est déduit : rien n'est émis par le seul écoulement du temps", async () => {
    const { sdk, reseau, horloge } = await sdkFrais();
    horloge.avance(600_000);
    vi.advanceTimersByTime(600_000);
    await sdk.flushNow();
    const noms = tousLesSpans(reseau.lots).map((s) => attrs(s)["mip.event_name"] ?? s.name);
    for (const nom of noms) expect(String(nom)).not.toMatch(/anr|freeze|hang/i);
    expect(sdk.getDiagnostics().jsCapabilities?.appStart).toBe("unavailable");
  });

  it("avant init, aucune capacité n'est affirmée ; markFirstScreenRendered ne lève pas", async () => {
    vi.resetModules();
    const sdk = await import("../../packages/rum-mobile/src/index");
    expect(sdk.getDiagnostics().jsCapabilities).toBeNull();
    expect(sdk.markFirstScreenRendered()).toBe(false);
  });
});

// ═════════════ 8. Cycle de vie sans global.require, et arrêt propre ══════════

describe("P7.3 — découverte de capacités : plus aucun global.require", () => {
  it("sans adaptateur de cycle de vie, rien n'est découvert et rien ne lève", async () => {
    const appels: string[] = [];
    vi.stubGlobal("require", (m: string) => { appels.push(m); return { AppState: { addEventListener: () => ({ remove() {} }) } }; });
    const { sdk } = await sdkFrais({ adapters: { lifecycle: undefined } });
    // Le repli historique passait par `global.require("react-native")` : il
    // réussissait chez le développeur et échouait en production, sans le dire.
    expect(appels).toEqual([]);
    expect(sdk.getDiagnostics().jsCapabilities?.navigation).toBe("unavailable");
  });
});
