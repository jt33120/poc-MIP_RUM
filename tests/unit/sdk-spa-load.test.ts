// SDK web — chargement d'un changement d'écran SPA (webvital.SPA_LOAD, 04/10/2026).
//
// Méthode « loading time » de Datadog : du pushState/popstate à la dernière activité
// (mutation du DOM, requête fetch/XHR en cours) suivie de 100 ms de calme. Plafond
// 10 s, au-delà rien n'est émis ; un clic, une touche ou une autre navigation avant
// la fin abandonnent la mesure. Les exports MIP ne comptent jamais comme activité.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initSpaLoad, SPA_CALME_MS, SPA_PLAFOND_MS, type SpaLoad } from "../../packages/rum-sdk/src/spa-load";

type Attrs = Record<string, unknown>;
type Ecouteur = (event: Record<string, unknown>) => void;

const T0 = 1_000_000;
let emis: Array<{ name: string; attrs: Attrs }> = [];
let muter: (() => void) | null = null;
let observe = 0;
const surFenetre = new Map<string, Ecouteur[]>();
const appels: Array<{ resolve: (r: Response) => void; reject: (e: unknown) => void }> = [];
let xhrs: FakeXhr[] = [];

class FakeXhr {
  ecouteurs = new Map<string, Array<() => void>>();
  open(_m: string, _u: string) {}
  send() {
    xhrs.push(this);
  }
  addEventListener(type: string, fn: () => void) {
    this.ecouteurs.set(type, [...(this.ecouteurs.get(type) ?? []), fn]);
  }
  terminer() {
    for (const fn of this.ecouteurs.get("loadend") ?? []) fn();
  }
}

const maintenant = () => Date.now() - T0;
const avancer = (ms: number) => vi.advanceTimersByTime(ms);
const chargements = () => emis.filter((e) => e.name === "webvital.SPA_LOAD").map((e) => e.attrs);

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  emis = [];
  muter = null;
  observe = 0;
  surFenetre.clear();
  appels.length = 0;
  xhrs = [];
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(rappel: () => void) {
        muter = rappel;
      }
      observe() {
        observe++;
      }
      disconnect() {}
    },
  );
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("location", { href: "https://app.test/liste" });
  vi.stubGlobal("window", {
    fetch: () => new Promise<Response>((resolve, reject) => appels.push({ resolve, reject })),
  });
  vi.stubGlobal("XMLHttpRequest", class extends FakeXhr {});
  vi.stubGlobal("addEventListener", (type: string, fn: Ecouteur) =>
    surFenetre.set(type, [...(surFenetre.get(type) ?? []), fn]),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function demarrer(): SpaLoad {
  const spa = initSpaLoad((name, attrs) => void emis.push({ name, attrs }), {
    denyOrigins: ["https://ingest.mip.test"],
    maintenant,
  });
  expect(spa).not.toBeNull();
  return spa!;
}
const naviguer = (spa: SpaLoad, route = "/detail/:id", id = "vue-2") =>
  spa.nouvelleVue({ route, id, debut: maintenant() });
const interagir = (type: string, timeStamp?: number) => {
  for (const fn of surFenetre.get(type) ?? []) fn({ type, timeStamp });
};

describe("fin de chargement d'un écran SPA", () => {
  it("sans MutationObserver, pas de mesure (et fetch reste intact)", () => {
    vi.stubGlobal("MutationObserver", undefined);
    const fetchNatif = (window as unknown as { fetch: unknown }).fetch;
    expect(initSpaLoad(() => {}, { denyOrigins: [] })).toBeNull();
    expect((window as unknown as { fetch: unknown }).fetch).toBe(fetchNatif);
  });

  it("dernière mutation suivie de 100 ms de calme : la durée va jusqu'à elle", () => {
    const spa = demarrer();
    naviguer(spa);
    expect(observe).toBe(1);
    avancer(50);
    muter!();
    avancer(70);
    muter!();
    avancer(80);
    muter!(); // 200 ms après le début, jamais 100 ms de calme avant
    avancer(SPA_CALME_MS - 1);
    expect(chargements()).toEqual([]);
    avancer(1);
    expect(chargements()).toEqual([
      { "webvital.name": "SPA_LOAD", "webvital.value": 200, "webvital.id": "vue-2", "mip.route": "/detail/:id" },
    ]);
    // Une seule fois par vue.
    muter!();
    avancer(1_000);
    expect(chargements()).toHaveLength(1);
  });

  it("100 ms de calme closent la mesure : ce qui bouge après n'y entre pas", () => {
    const spa = demarrer();
    naviguer(spa);
    avancer(50);
    muter!();
    avancer(150);
    muter!();
    expect(chargements().map((c) => c["webvital.value"])).toEqual([50]);
  });

  it("une requête fetch en cours retient la fin, même après 100 ms de calme", async () => {
    const spa = demarrer();
    naviguer(spa);
    avancer(10);
    const reponse = (window as unknown as { fetch: (u: string) => Promise<Response> }).fetch("/api/detail/42");
    avancer(500);
    expect(chargements()).toEqual([]);
    appels[0].resolve(new Response("{}"));
    await reponse;
    await Promise.resolve();
    avancer(30);
    muter!(); // rendu des données, 540 ms après le début
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.value"])).toEqual([540]);
  });

  it("un fetch rejeté termine aussi la requête, et l'app reçoit son rejet intact", async () => {
    const spa = demarrer();
    naviguer(spa);
    const reponse = (window as unknown as { fetch: (u: string) => Promise<Response> }).fetch("/api/x");
    avancer(300);
    const erreur = new TypeError("Failed to fetch");
    appels[0].reject(erreur);
    await expect(reponse).rejects.toBe(erreur);
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.value"])).toEqual([300]);
  });

  it("XHR : la fin (loadend) compte comme activité", () => {
    const spa = demarrer();
    naviguer(spa);
    const xhr = new (XMLHttpRequest as unknown as typeof FakeXhr)();
    xhr.open("GET", "/api/liste");
    xhr.send();
    avancer(700);
    expect(chargements()).toEqual([]);
    xhrs[0].terminer();
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.value"])).toEqual([700]);
  });

  it("les exports MIP ne retiennent pas la mesure", () => {
    const spa = demarrer();
    naviguer(spa);
    (window as unknown as { fetch: (u: string) => Promise<Response> }).fetch("https://ingest.mip.test/v1/traces");
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.value"])).toEqual([0]);
  });

  it("une requête partie avant la navigation ne compte pas", () => {
    const spa = demarrer();
    (window as unknown as { fetch: (u: string) => Promise<Response> }).fetch("/api/ancienne");
    naviguer(spa);
    avancer(SPA_CALME_MS);
    expect(chargements()).toHaveLength(1);
  });

  it("plafond 10 s : un écran qui ne se pose jamais n'émet rien", () => {
    const spa = demarrer();
    naviguer(spa);
    for (let t = 0; t < SPA_PLAFOND_MS + 1_000; t += 50) {
      avancer(50);
      muter!();
    }
    avancer(1_000);
    expect(chargements()).toEqual([]);
  });

  it("plafond 10 s : une requête qui ne finit jamais clôt la mesure sans rien émettre", () => {
    const spa = demarrer();
    naviguer(spa);
    (window as unknown as { fetch: (u: string) => Promise<Response> }).fetch("/api/longue");
    avancer(SPA_PLAFOND_MS + SPA_CALME_MS);
    expect(chargements()).toEqual([]);
    muter!(); // plus de mesure en cours
    avancer(SPA_CALME_MS);
    expect(chargements()).toEqual([]);
  });

  it("une activité à 9,95 s reste mesurée", () => {
    const spa = demarrer();
    naviguer(spa);
    for (let t = 0; t < 9_950; t += 50) {
      avancer(50);
      muter!();
    }
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.value"])).toEqual([9_950]);
  });

  it("un clic ou une touche avant la fin abandonne ; le clic déclencheur, non", () => {
    const spa = demarrer();
    avancer(5);
    const avant = maintenant() - 1;
    naviguer(spa);
    interagir("click", avant); // l'événement qui a déclenché la navigation
    avancer(SPA_CALME_MS);
    expect(chargements()).toHaveLength(1);

    naviguer(spa, "/autre", "vue-3");
    avancer(20);
    interagir("click", maintenant());
    avancer(SPA_CALME_MS);
    naviguer(spa, "/encore", "vue-4");
    avancer(20);
    interagir("keydown", maintenant());
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => c["webvital.id"])).toEqual(["vue-2"]);
  });

  it("une nouvelle navigation avant la fin abandonne la mesure en cours", () => {
    const spa = demarrer();
    naviguer(spa, "/a", "vue-a");
    avancer(60);
    naviguer(spa, "/b", "vue-b");
    avancer(SPA_CALME_MS);
    expect(chargements().map((c) => [c["mip.route"], c["webvital.id"]])).toEqual([["/b", "vue-b"]]);
  });

  it("une navigation qui n'est pas SPA (bfcache) abandonne aussi", () => {
    const spa = demarrer();
    naviguer(spa);
    spa.nouvelleVue(null);
    avancer(SPA_CALME_MS * 3);
    expect(chargements()).toEqual([]);
  });
});
