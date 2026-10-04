// SDK web — temps passé sur une vue (webvital.TIME_SPENT, 04/10/2026).
//
// Le temps compte quand la vue est VISIBLE, en cumul : l'ingestion garde la plus
// grande valeur reçue sous un même `webvital.id`, chaque envoi doit donc porter
// tout le temps déjà passé. Émis au passage en hidden, au pagehide et à la fin de
// la vue (navigation SPA suivante), avec la route de la vue qui finit.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initEngagement } from "../../packages/rum-sdk/src/engagement";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;

let horloge = 0;
let emis: Array<{ name: string; attrs: Attrs }> = [];
const surDocument = new Map<string, Ecouteur[]>();
const surFenetre = new Map<string, Ecouteur[]>();
let doc: Record<string, unknown>;

const ecouter = (table: Map<string, Ecouteur[]>) => (type: string, fn: Ecouteur) =>
  table.set(type, [...(table.get(type) ?? []), fn]);
const declencher = (table: Map<string, Ecouteur[]>, type: string) => {
  for (const fn of table.get(type) ?? []) fn({ type, target: doc });
};

function cacher() {
  doc.visibilityState = "hidden";
  declencher(surDocument, "visibilitychange");
}
function montrer() {
  doc.visibilityState = "visible";
  declencher(surDocument, "visibilitychange");
}
const temps = () => emis.filter((e) => e.name === "webvital.TIME_SPENT").map((e) => e.attrs);

beforeEach(() => {
  horloge = 0;
  emis = [];
  surDocument.clear();
  surFenetre.clear();
  // Page qui ne défile pas : le défilement vaut 100, hors sujet ici.
  const racine = { scrollTop: 0, scrollHeight: 800, clientHeight: 800 };
  doc = {
    visibilityState: "visible",
    scrollingElement: racine,
    documentElement: racine,
    querySelector: () => null,
    addEventListener: ecouter(surDocument),
  };
  vi.stubGlobal("document", doc);
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollY", 0);
  vi.stubGlobal("addEventListener", ecouter(surFenetre));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const demarrer = () => initEngagement((name, attrs) => void emis.push({ name, attrs }), () => horloge);

describe("temps passé visible, en cumul", () => {
  it("rien avant la première page vue : aucune vue à clore", () => {
    const e = demarrer();
    e.emettre();
    cacher();
    expect(emis).toEqual([]);
  });

  it("un passage en hidden émet le cumul ; le temps caché ne compte pas", () => {
    const e = demarrer();
    e.nouvelleVue("/dossiers/:id", 0);
    horloge = 5_000;
    cacher();
    const [premier] = temps();
    expect(premier).toMatchObject({
      "webvital.name": "TIME_SPENT",
      "webvital.value": 5_000,
      "mip.route": "/dossiers/:id",
    });
    expect(typeof premier["webvital.id"]).toBe("string");

    horloge = 8_000; // 3 s cachée
    montrer();
    horloge = 10_000;
    cacher();
    const second = temps()[1];
    expect(second["webvital.value"], "cumul : 5 s + 2 s, sans les 3 s cachées").toBe(7_000);
    expect(second["webvital.id"], "même vue, même identifiant").toBe(premier["webvital.id"]);
  });

  it("pagehide après hidden : rien ne repart si rien n'a bougé", () => {
    const e = demarrer();
    e.nouvelleVue("/", 0);
    horloge = 4_200;
    cacher();
    declencher(surFenetre, "pagehide");
    expect(temps()).toHaveLength(1);
    expect(temps()[0]["webvital.value"]).toBe(4_200);
  });

  it("pagehide d'une vue restée visible émet le cumul", () => {
    const e = demarrer();
    e.nouvelleVue("/", 0);
    horloge = 1_234.4;
    declencher(surFenetre, "pagehide");
    expect(temps().map((t) => t["webvital.value"])).toEqual([1_234]);
  });

  it("la navigation SPA clôt la vue avec SA route, puis la suivante repart de zéro", () => {
    const e = demarrer();
    e.nouvelleVue("/liste", 0);
    horloge = 3_000;
    e.nouvelleVue("/detail/:id", 3_000);
    const [fin] = temps();
    expect(fin).toMatchObject({ "webvital.value": 3_000, "mip.route": "/liste" });
    const idListe = fin["webvital.id"];
    expect(e.vueId()).not.toBe(idListe);

    horloge = 4_500;
    cacher();
    const suivante = temps()[1];
    expect(suivante).toMatchObject({ "webvital.value": 1_500, "mip.route": "/detail/:id" });
    expect(suivante["webvital.id"]).toBe(e.vueId());
  });

  it("une vue ouverte cachée (onglet en arrière-plan) compte à partir de l'affichage", () => {
    const e = demarrer();
    doc.visibilityState = "hidden";
    e.nouvelleVue("/", 0);
    horloge = 60_000;
    montrer();
    horloge = 62_000;
    cacher();
    expect(temps().map((t) => t["webvital.value"])).toEqual([2_000]);
  });

  it("une vue jamais visible n'envoie pas de temps passé", () => {
    const e = demarrer();
    doc.visibilityState = "hidden";
    e.nouvelleVue("/", 0);
    horloge = 10_000;
    e.emettre();
    expect(temps()).toEqual([]);
  });
});
