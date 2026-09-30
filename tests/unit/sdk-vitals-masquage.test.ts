// T2 de l'audit du 28/09/2026 : les Web Vitals finalisés tard manquaient.
//
// CE QUI ÉTAIT FAUX. Sur 24 h, 70 chargements donnaient 70 FCP et 69 TTFB, mais
// 23 CLS, 5 LCP et 3 INP. FCP et TTFB partent au chargement ; LCP, CLS et INP
// sont finalisés par `web-vitals` au MASQUAGE de la page (`visibilitychange` →
// `hidden`, juste avant le déchargement). Chaque vital émis à ce moment appelait
// `forceFlush()`, et `flushBatch()` chaînait chaque envoi sur la RÉPONSE réseau
// du précédent (`pending.then(...)`). Le premier lot partait ; les suivants
// attendaient une réponse qui n'arrive jamais quand la page se ferme : perdus,
// sans échec ni file de rejeu, puisqu'ils n'atteignaient même pas l'exporteur.
//
// LA RÈGLE. Page masquée ou quittée : un lot part TOUT DE SUITE, sans attendre
// la réponse du précédent. Page visible : l'ordre des lots reste garanti (un
// enfant ne dépasse pas sa racine, voir otlp-spans-natifs.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Ecouteur = () => void;

describe("les vitals finalisés au masquage partent tous", () => {
  let otel: typeof import("../../packages/rum-sdk/src/otel");
  let requetes: string[] = [];
  let doc: { visibilityState: string; addEventListener: (t: string, f: Ecouteur) => void };
  const ecouteursFenetre = new Map<string, Ecouteur[]>();

  beforeEach(async () => {
    requetes = [];
    ecouteursFenetre.clear();
    doc = { visibilityState: "visible", addEventListener: () => {} };
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 Test" });
    vi.stubGlobal("document", doc);
    vi.stubGlobal("addEventListener", (type: string, f: Ecouteur) => {
      ecouteursFenetre.set(type, [...(ecouteursFenetre.get(type) ?? []), f]);
    });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
    // La page se ferme : aucune réponse n'arrivera jamais. C'est exactement ce
    // que voit le SDK pendant un déchargement.
    vi.stubGlobal("fetch", (_url: string, init: { body: string }) => {
      requetes.push(init.body);
      return new Promise(() => {});
    });
    vi.resetModules();
    otel = await import("../../packages/rum-sdk/src/otel");
  });

  afterEach(() => vi.unstubAllGlobals());

  function emettre(tracer: ReturnType<typeof otel.initOtel>, name: string, attrs: Record<string, unknown> = {}) {
    const span = tracer.startSpan(name);
    span.setAttributes({ "mip.session_id": "sess-1", ...attrs });
    span.end();
  }

  const vital = (nom: string, valeur: number) => ({ "webvital.name": nom, "webvital.value": valeur });

  it("un lot déjà en vol ne bloque pas LCP, CLS et INP émis au masquage", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    // Le lot du chargement part pendant que la page est visible, et sa réponse
    // se fait attendre (réseau lent, ou page qui se ferme).
    emettre(tracer, "pageview");
    emettre(tracer, "webvital.FCP", vital("FCP", 900));
    void otel.forceFlush();
    await Promise.resolve();
    expect(requetes).toHaveLength(1);

    // L'utilisateur quitte la page : web-vitals finalise, une métrique à la fois,
    // et le SDK vide le lot après chacune (index.ts, realEmit).
    doc.visibilityState = "hidden";
    for (const [nom, valeur] of [["LCP", 2100], ["CLS", 0.04], ["INP", 180]] as const) {
      emettre(tracer, `webvital.${nom}`, vital(nom, valeur));
      void otel.forceFlush();
    }
    await Promise.resolve();

    const partis = requetes.join("\n");
    expect(partis).toContain("webvital.LCP");
    expect(partis).toContain("webvital.CLS");
    expect(partis).toContain("webvital.INP");
  });

  it("l'envoi au masquage est SYNCHRONE : il ne dépend d'aucune tâche ultérieure", () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    emettre(tracer, "pageview");
    void otel.forceFlush();
    doc.visibilityState = "hidden";
    emettre(tracer, "webvital.CLS", vital("CLS", 0.02));
    void otel.forceFlush();
    // Aucun `await` : le fetch keepalive doit être lancé avant que l'écouteur
    // `visibilitychange` ne rende la main au navigateur.
    expect(requetes.some((corps) => corps.includes("webvital.CLS"))).toBe(true);
  });

  it("pagehide suffit, même si le navigateur n'a pas signalé le masquage", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    emettre(tracer, "pageview");
    void otel.forceFlush();
    await Promise.resolve();
    expect(requetes).toHaveLength(1);
    // Safari a longtemps déchargé sans `visibilitychange` : seul `pagehide` passe.
    emettre(tracer, "webvital.LCP", vital("LCP", 1900));
    for (const f of ecouteursFenetre.get("pagehide") ?? []) f();
    expect(requetes.some((corps) => corps.includes("webvital.LCP"))).toBe(true);
  });

  it("page visible : l'ordre des lots reste garanti", async () => {
    const tracer = otel.initOtel({ endpoint: "https://x/v1/traces", appId: "demo" });
    emettre(tracer, "rum.action", { "mip.event_type": "action" });
    void otel.forceFlush();
    await Promise.resolve();
    emettre(tracer, "exception");
    void otel.forceFlush();
    await Promise.resolve();
    expect(requetes).toHaveLength(1);
  });
});
