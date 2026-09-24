// Génération / persistance de session (TTL inactivité 30 min) et IDENTITÉ DU
// VISITEUR — stubs DOM minimaux.
//
// CE FICHIER TESTAIT LE BUG. Il exigeait, noir sur blanc, que l'identifiant soit
// « déterministe pour un même device » — c'est-à-dire exactement la propriété qui
// faisait que deux personnes sur deux postes identiques recevaient la même
// identité. Le test passait au vert en vérifiant le défaut. Il est remplacé ici
// par son contraire : deux navigateurs qui ne partagent pas de stockage doivent
// obtenir deux identifiants DIFFÉRENTS, quelles que soient leurs
// caractéristiques matérielles. Voir packages/db/sql/migration-v57.sql.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Un « navigateur » : son stockage local, isolé des autres. */
function stubBrowserGlobals(store = new Map<string, string>()) {
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  // MÊME poste, MÊME navigateur, MÊME écran : le cas du parc homogène géré par
  // une DSI, où l'ancienne empreinte donnait la même valeur à tout le monde.
  vi.stubGlobal("navigator", { userAgent: "TestUA/1.0", language: "fr-FR" });
  vi.stubGlobal("screen", { width: 1920, height: 1080 });
  return store;
}

describe("getOrCreateSession", () => {
  beforeEach(() => {
    stubBrowserGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("session stable dans la fenêtre d\'inactivité", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    const s1 = getOrCreateSession();
    const s2 = getOrCreateSession();
    expect(s2.sessionId).toBe(s1.sessionId);
  });

  it("nouvelle session après 30 min d\'inactivité", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
    const s1 = getOrCreateSession();
    vi.setSystemTime(new Date("2026-06-10T10:31:00Z"));
    const s2 = getOrCreateSession();
    expect(s2.sessionId).not.toBe(s1.sessionId);
  });

  it("le visiteur SURVIT à l\'expiration de la session — c\'est tout son intérêt", async () => {
    const { getOrCreateSession } = await import("../../packages/rum-sdk/src/session");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T10:00:00Z"));
    const s1 = getOrCreateSession();
    vi.setSystemTime(new Date("2026-06-10T14:00:00Z"));
    const s2 = getOrCreateSession();
    expect(s2.sessionId).not.toBe(s1.sessionId);
    expect(s2.visitorId).toBe(s1.visitorId); // sinon « revenant » ne veut rien dire
  });
});

describe("identité du visiteur — un tirage, pas une déduction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("stable pour un même navigateur", async () => {
    stubBrowserGlobals();
    const { getOrCreateVisitor } = await import("../../packages/rum-sdk/src/session");
    expect(getOrCreateVisitor()).toBe(getOrCreateVisitor());
  });

  it("DIFFÉRENT sur deux postes identiques — le défaut corrigé", async () => {
    // Le cœur du finding 1.3. Mêmes user-agent, langue, résolution et fuseau :
    // l\'ancienne empreinte rendait la même valeur, donc deux collègues d\'un même
    // parc étaient une seule « personne » dans tous les comptages, et l\'export
    // RGPD de l\'un livrait les données de l\'autre.
    const ids: string[] = [];
    for (let poste = 0; poste < 5; poste++) {
      vi.resetModules();
      stubBrowserGlobals(new Map()); // stockage neuf = autre navigateur
      const { getOrCreateVisitor } = await import("../../packages/rum-sdk/src/session");
      ids.push(getOrCreateVisitor());
    }
    expect(new Set(ids).size, `collision entre postes identiques : ${ids.join(" ")}`).toBe(5);
  });

  it("est un UUID v4 — 122 bits tirés, pas une empreinte de 32", async () => {
    // L\'ancienne valeur était un FNV-1a 32 bits : 4 milliards de valeurs
    // possibles, mais surtout DÉTERMINISTE, donc son espace réel valait le
    // nombre de configurations matérielles distinctes du parc. Un UUID v4 tire
    // 122 bits au hasard ; la collision cesse d\'être un mode de fonctionnement.
    stubBrowserGlobals();
    const { getOrCreateVisitor } = await import("../../packages/rum-sdk/src/session");
    const v = getOrCreateVisitor();
    expect(v).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(v.replace(/-/g, "").length).toBeGreaterThanOrEqual(32);
  });

  it("le visiteur peut s\'effacer, et le suivant est un autre", async () => {
    // Sans cela, l\'identifiant serait subi : ni cookie à refuser, ni réglage.
    // Vider le stockage local du navigateur doit suffire.
    const store = stubBrowserGlobals();
    const { getOrCreateVisitor, forgetVisitor } = await import("../../packages/rum-sdk/src/session");
    const avant = getOrCreateVisitor();
    forgetVisitor();
    expect([...store.keys()].some((k) => k.includes("visitor"))).toBe(false);
    expect(getOrCreateVisitor()).not.toBe(avant);
  });

  it("ne jette pas quand le stockage local est refusé", async () => {
    // Navigation privée, réglage restrictif, iframe cloisonnée : l\'accès jette.
    // Une exception ici emporterait toute l\'initialisation du SDK.
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    const { getOrCreateVisitor, forgetVisitor } = await import("../../packages/rum-sdk/src/session");
    expect(() => getOrCreateVisitor()).not.toThrow();
    expect(() => forgetVisitor()).not.toThrow();
  });
});
