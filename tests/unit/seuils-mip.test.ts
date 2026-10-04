// Les seuils MIP (`apps/console/lib/seuils.ts`) : la règle de verdict des mesures
// sans seuil publié (vague 4, décision du 29/09/2026).
//
// Ce que ce test garde : les valeurs décidées (une borne qui bouge doit rougir un
// test, pas passer en silence dans une couleur d'écran), le sens inverse du débit,
// « bon » inclusif et « mauvais » strict comme web.dev, la phrase de règle que
// l'écran écrit à côté de la valeur, et la frontière avec `lib/rating.ts` (les
// vitals n'ont PAS de seuil MIP : une quatrième copie de leurs bornes serait une
// dérive de plus à surveiller).
import { describe, expect, it } from "vitest";
import { THRESHOLDS } from "../../apps/console/lib/rating";
import { PHASES_TTFB } from "../../apps/console/lib/perf-domain";
import {
  SANS_SEUIL_MIP,
  SEUILS_MIP,
  formaterBorneMip,
  noteMip,
  seuilMip,
  texteRegleMip,
  texteSeuilsMip,
} from "../../apps/console/lib/seuils";

const NBSP = " ";

describe("SEUILS_MIP : les valeurs décidées le 29/09/2026", () => {
  // SPA_LOAD : ajouté le 04/10/2026 avec les signaux de vue du SDK web 0.6.
  it("chaque mesure porte les bornes du plan de la vague 4", () => {
    const attendu: Record<string, [number, number]> = {
      REDIRECT: [0, 300],
      DNS: [50, 150],
      TCP: [100, 300],
      TLS: [150, 300],
      REQUEST: [200, 600],
      RESPONSE: [100, 300],
      RTT: [150, 400],
      DOWNLINK: [5, 1],
      LONGTASK: [100, 250],
      LOAF: [100, 250],
      RESOURCE: [300, 1000],
      API: [300, 1000],
      SPA_LOAD: [1000, 2500],
      RAGE_CLICKS: [0.01, 0.05],
      DEAD_CLICKS: [0.02, 0.08],
      BROWSER_ERRORS: [0.01, 0.05],
    };
    const lu = Object.fromEntries(Object.entries(SEUILS_MIP).map(([k, s]) => [k, [s.bon, s.mauvais]]));
    expect(lu).toEqual(attendu);
  });

  it("les bornes sont ordonnées dans le sens de la mesure", () => {
    for (const [mesure, s] of Object.entries(SEUILS_MIP)) {
      if (s.sens === "haut-mauvais") expect(s.bon, mesure).toBeLessThan(s.mauvais);
      else expect(s.bon, mesure).toBeGreaterThan(s.mauvais);
    }
  });

  it("DOWNLINK est la seule mesure en sens inverse, lue au 25ᵉ centile", () => {
    const inverses = Object.entries(SEUILS_MIP).filter(([, s]) => s.sens === "bas-mauvais");
    expect(inverses.map(([k]) => k)).toEqual(["DOWNLINK"]);
    expect(SEUILS_MIP.DOWNLINK.statistique).toBe("p25");
    expect(SEUILS_MIP.DOWNLINK.unite).toBe("Mbit/s");
  });

  it("les parts de sessions sont des parts 0..1, jamais des pourcentages entiers", () => {
    for (const [mesure, s] of Object.entries(SEUILS_MIP)) {
      const estPart = s.unite === "part";
      expect(s.statistique === "part-sessions", mesure).toBe(estPart);
      if (estPart) expect(s.mauvais, mesure).toBeLessThan(1);
    }
  });

  it("aucun Web Vital n'a de seuil MIP : ses bornes restent dans lib/rating.ts", () => {
    for (const vital of Object.keys(THRESHOLDS)) {
      expect(seuilMip(vital), vital).toBeNull();
      expect(noteMip(vital, 1), vital).toBeNull();
      expect(texteRegleMip(vital), vital).toBe("");
    }
  });

  it("les six phases du TTFB ont un seuil, sous le libellé de PHASES_TTFB", () => {
    for (const { cle, libelle } of PHASES_TTFB) {
      expect(seuilMip(cle)?.libelle, cle).toBe(libelle);
    }
  });

  it("les formulaires n'ont PAS de seuil, et le fichier dit pourquoi", () => {
    expect(Object.keys(SANS_SEUIL_MIP)).toEqual(["FORMULAIRES"]);
    expect(SANS_SEUIL_MIP.FORMULAIRES).toMatch(/pas de seuil/);
    for (const mesure of Object.keys(SANS_SEUIL_MIP)) expect(seuilMip(mesure)).toBeNull();
  });
});

describe("noteMip", () => {
  it("« bon » est inclusif, « mauvais » strict (sens haut-mauvais)", () => {
    expect(noteMip("DNS", 0)).toBe("good");
    expect(noteMip("DNS", 50)).toBe("good");
    expect(noteMip("DNS", 50.1)).toBe("needs-improvement");
    expect(noteMip("DNS", 150)).toBe("needs-improvement");
    expect(noteMip("DNS", 150.1)).toBe("poor");
  });

  it("chaque borne de chaque mesure : bon inclusif, mauvais strict", () => {
    for (const [mesure, s] of Object.entries(SEUILS_MIP)) {
      const pas = s.unite === "part" ? 0.001 : s.unite === "Mbit/s" ? 0.01 : 1;
      const pire = s.sens === "haut-mauvais" ? pas : -pas;
      expect(noteMip(mesure, s.bon), mesure).toBe("good");
      expect(noteMip(mesure, s.bon + pire), mesure).toBe("needs-improvement");
      expect(noteMip(mesure, s.mauvais), mesure).toBe("needs-improvement");
      expect(noteMip(mesure, s.mauvais + pire), mesure).toBe("poor");
    }
  });

  it("DOWNLINK : un débit HAUT est bon, un débit BAS est mauvais", () => {
    expect(noteMip("DOWNLINK", 50)).toBe("good");
    expect(noteMip("DOWNLINK", 5)).toBe("good");
    expect(noteMip("DOWNLINK", 4.99)).toBe("needs-improvement");
    expect(noteMip("DOWNLINK", 1)).toBe("needs-improvement");
    expect(noteMip("DOWNLINK", 0.99)).toBe("poor");
    expect(noteMip("DOWNLINK", 0)).toBe("poor");
  });

  it("REDIRECT : seule l'absence de redirection est bonne", () => {
    expect(noteMip("REDIRECT", 0)).toBe("good");
    expect(noteMip("REDIRECT", 1)).toBe("needs-improvement");
    expect(noteMip("REDIRECT", 301)).toBe("poor");
  });

  it("les parts de sessions se notent sur une part 0..1", () => {
    expect(noteMip("RAGE_CLICKS", 0.01)).toBe("good");
    expect(noteMip("RAGE_CLICKS", 0.03)).toBe("needs-improvement");
    expect(noteMip("RAGE_CLICKS", 0.06)).toBe("poor");
    expect(noteMip("DEAD_CLICKS", 0.08)).toBe("needs-improvement");
    expect(noteMip("DEAD_CLICKS", 0.081)).toBe("poor");
    expect(noteMip("BROWSER_ERRORS", 0)).toBe("good");
  });

  it("pas de valeur, ou pas de seuil : null, jamais « bon » par défaut", () => {
    expect(noteMip("DNS", null)).toBeNull();
    expect(noteMip("DNS", undefined)).toBeNull();
    expect(noteMip("DNS", Number.NaN)).toBeNull();
    expect(noteMip("DNS", Number.POSITIVE_INFINITY)).toBeNull();
    expect(noteMip("FORMULAIRES", 12_000)).toBeNull();
    expect(noteMip("inconnu", 1)).toBeNull();
    // Les clés héritées d'un objet ne sont pas des mesures.
    expect(noteMip("constructor", 1)).toBeNull();
    expect(noteMip("toString", 1)).toBeNull();
  });
});

describe("texteRegleMip et texteSeuilsMip", () => {
  it("la règle écrite à côté de la valeur : la borne « mauvais »", () => {
    expect(texteRegleMip("DNS")).toBe(`règle MIP : DNS > 150${NBSP}ms`);
    expect(texteRegleMip("TCP")).toBe(`règle MIP : Connexion TCP > 300${NBSP}ms`);
    expect(texteRegleMip("API")).toBe(`règle MIP : Appel API > 1${NBSP}s`);
    expect(texteRegleMip("SPA_LOAD")).toBe(`règle MIP : Changement d'écran (SPA) > 2,5${NBSP}s`);
  });

  it("DOWNLINK s'écrit avec « < » : c'est un débit trop BAS qui est mauvais", () => {
    expect(texteRegleMip("DOWNLINK")).toBe(`règle MIP : Débit descendant < 1${NBSP}Mbit/s`);
    expect(texteSeuilsMip("DOWNLINK")).toBe(`bon ≥ 5${NBSP}Mbit/s, mauvais en dessous de 1${NBSP}Mbit/s`);
  });

  it("une part dit de quoi elle est la part", () => {
    expect(texteRegleMip("RAGE_CLICKS")).toBe(`règle MIP : Clics rageurs > 5${NBSP}% des sessions`);
    expect(texteSeuilsMip("DEAD_CLICKS")).toBe(`bon ≤ 2${NBSP}% des sessions, mauvais au-delà de 8${NBSP}%`);
  });

  it("les deux bornes, pour une légende", () => {
    expect(texteSeuilsMip("DNS")).toBe(`bon ≤ 50${NBSP}ms, mauvais au-delà de 150${NBSP}ms`);
    expect(texteSeuilsMip("RESOURCE")).toBe(`bon ≤ 300${NBSP}ms, mauvais au-delà de 1${NBSP}s`);
    expect(texteSeuilsMip("REDIRECT")).toBe(`bon = 0${NBSP}ms, mauvais au-delà de 300${NBSP}ms`);
  });

  it("chaque mesure a une règle ; une mesure sans seuil n'en a pas", () => {
    for (const mesure of Object.keys(SEUILS_MIP)) {
      expect(texteRegleMip(mesure), mesure).toMatch(/^règle MIP : .+ [<>] \d/);
    }
    expect(texteRegleMip("FORMULAIRES")).toBe("");
    expect(texteSeuilsMip("LCP")).toBe("");
  });

  it("formaterBorneMip : ms sous la seconde, s au-delà, part en %", () => {
    expect(formaterBorneMip("ms", 250)).toBe(`250${NBSP}ms`);
    expect(formaterBorneMip("ms", 1000)).toBe(`1${NBSP}s`);
    expect(formaterBorneMip("ms", 1500)).toBe(`1,5${NBSP}s`);
    expect(formaterBorneMip("part", 0.05)).toBe(`5${NBSP}%`);
    expect(formaterBorneMip("part", 0.015)).toBe(`1,5${NBSP}%`);
    expect(formaterBorneMip("Mbit/s", 0.5)).toBe(`0,5${NBSP}Mbit/s`);
  });
});
