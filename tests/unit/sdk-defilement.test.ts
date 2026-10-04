// SDK web — profondeur de défilement (webvital.SCROLL_DEPTH, 04/10/2026).
//
// Le MAXIMUM atteint sur la vue, en % entier : (haut visible + hauteur visible) /
// hauteur totale. Le conteneur qui compte est le plus grand qui défile : la
// fenêtre, ou un `<main>` en overflow quand le document lui-même ne défile pas
// (cas de l'application de recette). Une page qui ne défile pas vaut 100.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEngagement, profondeur, SCROLL_THROTTLE_MS } from "../../packages/rum-sdk/src/engagement";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;
interface Boite {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

let horloge = 0;
let emis: Array<{ name: string; attrs: Attrs }> = [];
const surDocument = new Map<string, Ecouteur[]>();
let doc: Record<string, unknown>;
let racine: Boite;
let main: Boite | null;

const ecouter = (table: Map<string, Ecouteur[]>) => (type: string, fn: Ecouteur) =>
  table.set(type, [...(table.get(type) ?? []), fn]);

/** Un `scroll` puis l'attente du relevé, qui est espacé. */
function defiler(cible: unknown, haut: number) {
  if (cible === doc) vi.stubGlobal("scrollY", haut);
  else (cible as Boite).scrollTop = haut;
  for (const fn of surDocument.get("scroll") ?? []) fn({ type: "scroll", target: cible });
  vi.advanceTimersByTime(SCROLL_THROTTLE_MS);
}
function cacher() {
  doc.visibilityState = "hidden";
  for (const fn of surDocument.get("visibilitychange") ?? []) fn({ type: "visibilitychange" });
}
const profondeurs = () => emis.filter((e) => e.name === "webvital.SCROLL_DEPTH").map((e) => e.attrs["webvital.value"]);

beforeEach(() => {
  vi.useFakeTimers();
  horloge = 0;
  emis = [];
  surDocument.clear();
  racine = { scrollTop: 0, scrollHeight: 1000, clientHeight: 1000 };
  main = null;
  doc = {
    visibilityState: "visible",
    scrollingElement: racine,
    documentElement: racine,
    querySelector: (selecteur: string) => (selecteur === "main" ? main : null),
    addEventListener: ecouter(surDocument),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("innerHeight", 1000);
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("addEventListener", () => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function vue(route = "/") {
  const e = initEngagement((name, attrs) => void emis.push({ name, attrs }), () => horloge);
  e.nouvelleVue(route, 0);
  horloge = 1_000; // un temps visible : sans lui, ni temps passé ni défilement
  return e;
}

describe("profondeur()", () => {
  it("borne à 0-100 et rend un entier", () => {
    expect(profondeur(1000, 1000, 4000)).toBe(50);
    expect(profondeur(0, 700, 2100)).toBe(33);
    expect(profondeur(5000, 1000, 4000)).toBe(100);
    expect(profondeur(-50, 100, 1000)).toBe(10);
    expect(profondeur(0, 800, 0)).toBe(100);
  });
});

describe("défilement de la vue", () => {
  it("une page qui ne défile pas vaut 100", () => {
    vue();
    cacher();
    expect(profondeurs()).toEqual([100]);
  });

  it("fenêtre : le maximum atteint, pas la dernière position", () => {
    racine.scrollHeight = 4000;
    vue();
    defiler(doc, 1000); // (1000 + 1000) / 4000
    defiler(doc, 0);
    cacher();
    expect(profondeurs()).toEqual([50]);
    expect(emis.find((e) => e.name === "webvital.SCROLL_DEPTH")!.attrs).toMatchObject({
      "webvital.name": "SCROLL_DEPTH",
      "mip.route": "/",
    });
  });

  it("sans défilement, la position de départ d'une page longue", () => {
    racine.scrollHeight = 4000;
    vue();
    cacher();
    expect(profondeurs()).toEqual([25]);
  });

  it("conteneur <main> en overflow : c'est lui qui compte, pas le panneau latéral", () => {
    main = { scrollTop: 0, scrollHeight: 2100, clientHeight: 700 };
    const panneau = { scrollTop: 0, scrollHeight: 3000, clientHeight: 200 };
    vue();
    defiler(panneau, 2800); // tout en bas, mais trop petit pour dire la lecture de la page
    defiler(main, 700); // (700 + 700) / 2100
    cacher();
    expect(profondeurs()).toEqual([67]);
  });

  it("<main> qui défile, jamais défilé : sa position de départ, pas 100", () => {
    main = { scrollTop: 0, scrollHeight: 2100, clientHeight: 700 };
    vue();
    cacher();
    expect(profondeurs()).toEqual([33]);
  });

  it("le plus grand conteneur l'emporte sur un plus petit déjà retenu", () => {
    const petit = { scrollTop: 0, scrollHeight: 1200, clientHeight: 600 };
    racine.scrollHeight = 5000;
    vue();
    defiler(petit, 600); // 100 % d'un petit conteneur
    defiler(doc, 1500); // la fenêtre, plus grande : (1500 + 1000) / 5000
    cacher();
    expect(profondeurs()).toEqual([50]);
  });

  it("chaque vue repart de zéro", () => {
    racine.scrollHeight = 4000;
    const e = vue("/liste");
    defiler(doc, 3000);
    vi.stubGlobal("scrollY", 0);
    e.nouvelleVue("/detail/:id", 1_000);
    horloge = 2_000;
    cacher();
    expect(profondeurs()).toEqual([100, 25]);
    const routes = emis.filter((x) => x.name === "webvital.SCROLL_DEPTH").map((x) => x.attrs["mip.route"]);
    expect(routes).toEqual(["/liste", "/detail/:id"]);
  });

  it("les relevés sont espacés : une rafale de scroll ne lit la page qu'une fois", () => {
    racine.scrollHeight = 4000;
    let lectures = 0;
    Object.defineProperty(racine, "scrollHeight", { get: () => (lectures++, 4000), configurable: true });
    vue();
    for (let i = 0; i < 50; i++) {
      for (const fn of surDocument.get("scroll") ?? []) fn({ type: "scroll", target: doc });
    }
    vi.advanceTimersByTime(SCROLL_THROTTLE_MS);
    expect(lectures).toBe(1);
  });
});
