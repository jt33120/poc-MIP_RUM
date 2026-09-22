// Identité d'un appel sur l'écran Tracing (§ 5.8, F59) : l'ancre d'une ligne de
// « Tous les appels API » et le paramètre `appel=` qui filtre les traces lentes
// lisent la MÊME chaîne `<méthode> <chemin>`. Si elles divergeaient, un clic sur
// le classement renverrait vers une ligne absente, ou un filtre ne retrouverait
// pas l'appel qu'il nomme.
import { describe, expect, it } from "vitest";
import { ancreAppel, lireAppel } from "../../apps/console/lib/tracing-ancres";

describe("ancreAppel — identifiant DOM d'une ligne d'appel", () => {
  it("encode méthode, espace et chemin, sans autre normalisation", () => {
    expect(ancreAppel("GET", "/api/a b")).toBe("appel-GET%20%2Fapi%2Fa%20b");
  });

  it("deux appels qui ne diffèrent que par la méthode ont deux ancres", () => {
    expect(ancreAppel("GET", "/api/x")).not.toBe(ancreAppel("POST", "/api/x"));
  });

  it("un chemin vide (span sans URL) garde une ancre distincte", () => {
    expect(ancreAppel("GET", "")).toBe("appel-GET%20");
  });
});

describe("lireAppel — paramètre d'écran `appel`", () => {
  it("coupe au premier espace", () => {
    expect(lireAppel({ appel: "GET /api/x" })).toEqual({ method: "GET", url: "/api/x" });
  });

  it("un chemin qui contient des espaces reste entier", () => {
    expect(lireAppel({ appel: "GET /api/a b" })).toEqual({ method: "GET", url: "/api/a b" });
  });

  it.each([
    ["absent", {}],
    ["valeur sans espace", { appel: "GET" }],
    ["sans méthode", { appel: " /api/x" }],
    ["vide", { appel: "" }],
    ["répété avec deux valeurs : ambigu, jamais choisi au hasard", { appel: ["GET /api/a", "GET /api/b"] }],
    ["répété sans valeur", { appel: [] }],
  ])("%s → null", (_cas, sp) => {
    expect(lireAppel(sp)).toBeNull();
  });

  it("répété avec la même valeur : lu une fois", () => {
    expect(lireAppel({ appel: ["GET /api/x", "GET /api/x"] })).toEqual({ method: "GET", url: "/api/x" });
  });

  it("chemin vide : relu tel qu'`apiCallsDecomposition` le rend", () => {
    expect(lireAppel({ appel: "GET " })).toEqual({ method: "GET", url: "" });
  });

  it("aller-retour : l'ancre décodée, relue comme paramètre, rend le même appel", () => {
    for (const [method, url] of [["GET", "/api/a b"], ["POST", "/api/checkout?x=1&y=é"], ["DELETE", ""]]) {
      const valeur = decodeURIComponent(ancreAppel(method, url).slice("appel-".length));
      expect(lireAppel({ appel: valeur })).toEqual({ method, url });
    }
  });
});
