// F57 — paramètre `serie` de /correlation : un couple (app, route), au format
// `<app>:<route>` encodé (§ 5.7 CR7-a).
//
// Sous `app=all`, deux apps peuvent avoir `/checkout` : une série désignée par la
// route seule mélangeait leurs heures. Le couple lève l'ambiguïté ; les anciens
// liens (`serie=/checkout`) restent lus tant qu'ils ne désignent qu'une option.
import { describe, expect, it } from "vitest";
import {
  ecrireSerie,
  libelleSerie,
  lireSerie,
  serieParDefaut,
  type CoupleSerie,
} from "../../apps/console/lib/correlation-serie";

const DEMO_PARTNER: CoupleSerie = { app_id: "demo", route: "/partners/:id" };
const A_CHECKOUT: CoupleSerie = { app_id: "app-a", route: "/checkout" };
const B_CHECKOUT: CoupleSerie = { app_id: "app-b", route: "/checkout" };
const A_ACCUEIL: CoupleSerie = { app_id: "app-a", route: "/" };

describe("ecrireSerie / lireSerie", () => {
  it("aller-retour de (demo, /partners/:id) : le `:` de la route est encodé, le premier `:` sépare", () => {
    const valeur = ecrireSerie("demo", "/partners/:id");
    expect(valeur).toBe("demo:%2Fpartners%2F%3Aid");
    expect(lireSerie(valeur, [DEMO_PARTNER])).toEqual(DEMO_PARTNER);
  });

  it("aller-retour à travers une URL : `searchParams` rend la valeur écrite", () => {
    const valeur = ecrireSerie("app:étrange", "/a b/:c");
    const url = new URL(`http://console.test/correlation?${new URLSearchParams({ serie: valeur })}`);
    const couple = { app_id: "app:étrange", route: "/a b/:c" };
    expect(lireSerie(url.searchParams.get("serie"), [couple])).toEqual(couple);
  });

  it("un couple absent des options est ignoré", () => {
    expect(lireSerie(ecrireSerie("autre", "/partners/:id"), [DEMO_PARTNER])).toBeNull();
    expect(lireSerie(ecrireSerie("demo", "/ailleurs"), [DEMO_PARTNER])).toBeNull();
  });

  it("valeur vide ou illisible : ignorée, jamais levée", () => {
    expect(lireSerie(undefined, [A_CHECKOUT])).toBeNull();
    expect(lireSerie("", [A_CHECKOUT])).toBeNull();
    expect(lireSerie("app-a:%E0%A4%A", [A_CHECKOUT])).toBeNull();
  });

  it("lien ancien `serie=/checkout` avec une seule app : retenu", () => {
    expect(lireSerie("/checkout", [A_CHECKOUT, A_ACCUEIL])).toEqual(A_CHECKOUT);
  });

  it("deux apps ayant /checkout : deux options distinctes, et `serie=/checkout` est ignoré", () => {
    const options = [A_CHECKOUT, B_CHECKOUT];
    expect(ecrireSerie(A_CHECKOUT.app_id, A_CHECKOUT.route)).not.toBe(ecrireSerie(B_CHECKOUT.app_id, B_CHECKOUT.route));
    expect(lireSerie("/checkout", options)).toBeNull();
    expect(lireSerie(ecrireSerie("app-b", "/checkout"), options)).toEqual(B_CHECKOUT);
  });
});

describe("serieParDefaut", () => {
  const options = [B_CHECKOUT, A_ACCUEIL, A_CHECKOUT];

  it("route du contrat posée : le premier couple de cette route, par ordre d'app", () => {
    expect(serieParDefaut(options, { route: "/checkout" })).toEqual(A_CHECKOUT);
  });

  it("sinon, le couple qui a le plus d'heures en angle mort", () => {
    const anglesMorts = [
      { ...B_CHECKOUT, heures: 7 },
      { ...A_ACCUEIL, heures: 2 },
    ];
    expect(serieParDefaut(options, { anglesMorts })).toEqual(B_CHECKOUT);
  });

  it("un angle mort hors des options ne l'emporte pas", () => {
    const anglesMorts = [{ app_id: "app-z", route: "/z", heures: 9 }, { ...B_CHECKOUT, heures: 1 }];
    expect(serieParDefaut(options, { anglesMorts })).toEqual(B_CHECKOUT);
  });

  it("sinon, le premier par ordre (route, app) ; aucune option → null", () => {
    expect(serieParDefaut(options)).toEqual(A_ACCUEIL);
    expect(serieParDefaut(options, { route: "/inconnue", anglesMorts: [] })).toEqual(A_ACCUEIL);
    expect(serieParDefaut([])).toBeNull();
  });
});

describe("libelleSerie", () => {
  it("route seule quand une seule app ; « app · route » sinon", () => {
    expect(libelleSerie(A_CHECKOUT, [A_CHECKOUT, A_ACCUEIL])).toBe("/checkout");
    expect(libelleSerie(A_CHECKOUT, [A_CHECKOUT, B_CHECKOUT])).toBe("app-a · /checkout");
  });
});
