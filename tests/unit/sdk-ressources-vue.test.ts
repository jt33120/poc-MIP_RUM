// SDK web — toutes les ressources d'une vue (04/10/2026).
//
// Résumé par vue, toujours : webvital.RESOURCE_COUNT (ressources chargées pendant
// la vue, exports MIP exclus) et webvital.RESOURCE_BYTES (somme des transferSize),
// en cumul. Les spans `resource` individuels restent, par défaut, les lents et les
// bloquants (20 par page) : l'alerte resource_p75 en dépend. `resources: "all"` les
// envoie tous, 150 par page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEngagement } from "../../packages/rum-sdk/src/engagement";
import {
  DEFAULT_SLOW_RESOURCE_MS,
  initResources,
  RESOURCE_CAP_ALL,
  RESOURCE_CAP_PER_PAGE,
} from "../../packages/rum-sdk/src/resources";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;
type Entree = Partial<PerformanceResourceTiming> & { name: string; startTime: number };

let emis: Array<{ name: string; attrs: Attrs }> = [];
const surDocument = new Map<string, Ecouteur[]>();
let doc: Record<string, unknown>;
let livrer: ((entrees: Entree[]) => void) | null = null;

const ENDPOINT = "https://ingest.mip.test/v1/traces";
const entree = (name: string, startTime: number, extra: Partial<PerformanceResourceTiming> = {}): Entree => ({
  name,
  startTime,
  duration: 40,
  transferSize: 1000,
  initiatorType: "script",
  ...extra,
});
function cacher() {
  doc.visibilityState = "hidden";
  for (const fn of surDocument.get("visibilitychange") ?? []) fn({ type: "visibilitychange" });
}
const valeurs = (nom: string) =>
  emis.filter((e) => e.name === `webvital.${nom}`).map((e) => e.attrs["webvital.value"]);

beforeEach(() => {
  emis = [];
  livrer = null;
  surDocument.clear();
  doc = { visibilityState: "visible", addEventListener: (t: string, fn: Ecouteur) => surDocument.set(t, [...(surDocument.get(t) ?? []), fn]) };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal(
    "PerformanceObserver",
    class {
      constructor(rappel: (liste: { getEntries: () => Entree[] }) => void) {
        livrer = (entrees) => rappel({ getEntries: () => entrees });
      }
      observe() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function brancher(all = false) {
  const emit = (name: string, attrs: Attrs) => void emis.push({ name, attrs });
  const engagement = initEngagement(emit, () => 0);
  const cap = initResources(emit, {
    slowResourceMs: DEFAULT_SLOW_RESOURCE_MS,
    endpoint: ENDPOINT,
    all,
    onEntry: engagement.ressource,
  });
  return { engagement, cap };
}

describe("résumé des ressources de la vue", () => {
  it("compte toutes les ressources et somme les octets, exports MIP exclus", () => {
    const { engagement } = brancher();
    engagement.nouvelleVue("/", 0);
    livrer!([
      entree("https://app.test/app.js", 10, { transferSize: 50_000 }),
      entree("https://cdn.test/logo.png", 20, { transferSize: 0 }), // en cache, ou sans Timing-Allow-Origin
      entree(`${ENDPOINT}`, 30, { transferSize: 900 }),
      entree("https://app.test/api/x", 40, { transferSize: 1200 }),
    ]);
    cacher();
    expect(valeurs("RESOURCE_COUNT")).toEqual([3]);
    expect(valeurs("RESOURCE_BYTES")).toEqual([51_200]);
    const compte = emis.find((e) => e.name === "webvital.RESOURCE_COUNT")!.attrs;
    expect(compte).toMatchObject({ "webvital.name": "RESOURCE_COUNT", "mip.route": "/" });
    expect(compte["webvital.id"]).toBe(engagement.vueId());
  });

  it("cumul : chaque envoi porte tout ce que la vue a chargé", () => {
    const { engagement } = brancher();
    engagement.nouvelleVue("/", 0);
    livrer!([entree("https://app.test/a.js", 10)]);
    engagement.emettre();
    livrer!([entree("https://app.test/b.js", 500), entree("https://app.test/c.js", 600)]);
    engagement.emettre();
    expect(valeurs("RESOURCE_COUNT")).toEqual([1, 3]);
    expect(valeurs("RESOURCE_BYTES")).toEqual([1000, 3000]);
  });

  it("vue SPA : la précédente part close, une ressource d'avant la vue n'y entre pas", () => {
    const { engagement } = brancher();
    engagement.nouvelleVue("/liste", 0);
    livrer!([entree("https://app.test/a.js", 10)]);
    engagement.nouvelleVue("/detail/:id", 5_000);
    livrer!([entree("https://app.test/tardive.js", 4_900), entree("https://app.test/api/detail", 5_010)]);
    engagement.emettre();
    const comptes = emis.filter((e) => e.name === "webvital.RESOURCE_COUNT").map((e) => [e.attrs["mip.route"], e.attrs["webvital.value"]]);
    expect(comptes).toEqual([["/liste", 1], ["/detail/:id", 1]]);
  });

  it("une vue sans ressource vaut 0 : la médiane des vues SPA le compte", () => {
    const { engagement } = brancher();
    engagement.nouvelleVue("/", 0);
    engagement.emettre();
    expect(valeurs("RESOURCE_COUNT")).toEqual([0]);
    expect(valeurs("RESOURCE_BYTES")).toEqual([0]);
  });
});

describe("spans resource individuels", () => {
  const lot = (n: number, duree: number) =>
    Array.from({ length: n }, (_, i) => entree(`https://app.test/r${i}.js`, i, { duration: duree }));

  it("par défaut : les lentes et les bloquantes seulement, 20 par page", () => {
    brancher();
    livrer!([
      entree("https://app.test/rapide.js", 1, { duration: 20 }),
      entree("https://app.test/bloquante.css", 2, { duration: 20, renderBlockingStatus: "blocking" } as never),
      entree("https://app.test/lente.js", 3, { duration: 450 }),
    ]);
    const spans = emis.filter((e) => e.name === "resource").map((e) => e.attrs["resource.url"]);
    expect(spans).toEqual(["https://app.test/bloquante.css", "https://app.test/lente.js"]);
    emis = [];
    livrer!(lot(40, 900));
    expect(emis.filter((e) => e.name === "resource")).toHaveLength(RESOURCE_CAP_PER_PAGE - 2);
  });

  it('resources: "all" : toutes, 150 par page, remises à zéro par page vue', () => {
    const { cap } = brancher(true);
    livrer!([entree("https://app.test/rapide.js?jeton=secret", 1, { duration: 5 })]);
    expect(emis.filter((e) => e.name === "resource").map((e) => e.attrs["resource.url"])).toEqual([
      "https://app.test/rapide.js",
    ]);
    livrer!(lot(200, 5));
    expect(emis.filter((e) => e.name === "resource")).toHaveLength(RESOURCE_CAP_ALL);
    cap.reset();
    livrer!(lot(3, 5));
    expect(emis.filter((e) => e.name === "resource")).toHaveLength(RESOURCE_CAP_ALL + 3);
  });

  it("les exports MIP ne sont jamais un span resource, même avec \"all\"", () => {
    brancher(true);
    livrer!([entree(ENDPOINT, 1), entree("https://autre.test/v1/traces", 2)]);
    expect(emis.filter((e) => e.name === "resource")).toEqual([]);
  });
});
