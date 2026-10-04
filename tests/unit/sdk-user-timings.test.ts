// SDK web — repères du développeur (performance.mark / measure, 04/10/2026).
//
// Relevés sans code de plus (PerformanceObserver, buffered) et émis comme les
// timings de MIPRum.addTiming() : `rum.timing`, `mip.event_name` = `mark:<nom>` ou
// `measure:<nom>`, `mip.timing_ms` = instant depuis le début de la vue pour un
// mark, durée pour un measure. Les repères des outils (React, Next.js, webpack, le
// SDK…) et les valeurs négatives sont ignorés ; 30 par vue au plus.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  estRepereOutil,
  initUserTimings,
  USER_TIMINGS_PAR_VUE,
} from "../../packages/rum-sdk/src/user-timings";

type Attrs = Record<string, unknown>;
interface Repere {
  name: string;
  entryType: "mark" | "measure";
  startTime: number;
  duration: number;
}

const ORIGINE = 1_760_000_000_000;
let emis: Array<{ name: string; attrs: Attrs; ts?: number }> = [];
const observateurs: Array<{ type: string; buffered: boolean; rappel: (l: { getEntries: () => Repere[] }) => void }> = [];

const mark = (name: string, startTime: number): Repere => ({ name, entryType: "mark", startTime, duration: 0 });
const measure = (name: string, startTime: number, duration: number): Repere => ({ name, entryType: "measure", startTime, duration });
function livrer(...reperes: Repere[]) {
  for (const o of observateurs) {
    const siens = reperes.filter((r) => r.entryType === o.type);
    if (siens.length) o.rappel({ getEntries: () => siens });
  }
}
const timings = () => emis.filter((e) => e.name === "rum.timing").map((e) => e.attrs);

beforeEach(() => {
  emis = [];
  observateurs.length = 0;
  vi.stubGlobal("performance", { timeOrigin: ORIGINE, now: () => 0 });
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      rappel: (l: { getEntries: () => Repere[] }) => void;
      constructor(rappel: (l: { getEntries: () => Repere[] }) => void) {
        this.rappel = rappel;
      }
      observe(o: { type: string; buffered?: boolean }) {
        observateurs.push({ type: o.type, buffered: o.buffered === true, rappel: this.rappel });
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function demarrer() {
  const ut = initUserTimings((name, attrs, ts) => void emis.push({ name, attrs, ts }));
  expect(ut).not.toBeNull();
  ut!.nouvelleVue(0);
  return ut!;
}

describe("repères de l'app → rum.timing", () => {
  it("observe mark et measure, y compris ceux posés avant le SDK (buffered)", () => {
    demarrer();
    expect(observateurs.map((o) => [o.type, o.buffered])).toEqual([["mark", true], ["measure", true]]);
  });

  it("sans PerformanceObserver : rien, sans erreur", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    expect(initUserTimings(() => {})).toBeNull();
  });

  it("mark : instant depuis le début de la vue ; measure : durée", () => {
    demarrer();
    livrer(mark("panier-pret", 1234.6), measure("calcul-total", 2000, 87.4));
    expect(timings()).toEqual([
      { "mip.event_type": "timing", "mip.event_name": "mark:panier-pret", "mip.timing_ms": 1235 },
      { "mip.event_type": "timing", "mip.event_name": "measure:calcul-total", "mip.timing_ms": 87 },
    ]);
    // Horodaté à l'instant du repère, pas à celui de sa livraison.
    expect(emis.map((e) => e.ts)).toEqual([ORIGINE + 1235, ORIGINE + 2000]);
  });

  it("vue SPA : un mark se compte depuis le début de la vue, un repère d'avant est écarté", () => {
    const ut = demarrer();
    ut.nouvelleVue(10_000);
    livrer(
      mark("ancien", 9_000),
      measure("fini-avant", 8_000, 500),
      mark("detail-affiche", 10_480),
      measure("chargement-detail", 9_900, 700), // à cheval : sa durée reste vraie
    );
    expect(timings().map((t) => [t["mip.event_name"], t["mip.timing_ms"]])).toEqual([
      ["mark:detail-affiche", 480],
      ["measure:chargement-detail", 700],
    ]);
  });

  it("ignore les repères des outils et du SDK", () => {
    demarrer();
    livrer(
      mark("⚛ App [mount]", 10),
      mark("Next.js-before-hydration", 20),
      mark("next-route-change", 25),
      mark("mip-rum:init", 30),
      mark("__v3", 40),
      mark("webpack:chunk", 50),
      mark("react-render", 60),
      mark("beforeRender", 70),
      mark("afterHydrate", 80),
      mark("mon-repere", 90),
    );
    expect(timings().map((t) => t["mip.event_name"])).toEqual(["mark:mon-repere"]);
    expect(estRepereOutil("Next.js-hydration")).toBe(true);
    expect(estRepereOutil("recherche-partenaires")).toBe(false);
  });

  it("ignore les valeurs négatives ou non finies et les noms vides", () => {
    demarrer();
    livrer(measure("negatif", 10, -5), measure("infini", 10, Number.POSITIVE_INFINITY), mark("   ", 10));
    expect(timings()).toEqual([]);
  });

  it("nom borné : 100 caractères, préfixe compris, comme l'exige l'ingestion", () => {
    demarrer();
    livrer(mark("x".repeat(300), 5));
    const nom = String(timings()[0]["mip.event_name"]);
    expect(nom).toHaveLength(100);
    expect(nom.startsWith("mark:xxx")).toBe(true);
  });

  it("30 par vue, plafond remis à zéro à la vue suivante", () => {
    const ut = demarrer();
    livrer(...Array.from({ length: 45 }, (_, i) => mark(`m${i}`, i)));
    expect(timings()).toHaveLength(USER_TIMINGS_PAR_VUE);
    ut.nouvelleVue(100);
    livrer(mark("apres", 150));
    expect(timings()).toHaveLength(USER_TIMINGS_PAR_VUE + 1);
  });
});
