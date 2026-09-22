// F22 — règles de détection écrites par la console = constantes du SDK qui détecte.
//
// La console ne dépend pas du SDK navigateur : `lib/frustration-regles.ts` en recopie
// les constantes. Ce test échoue dès qu'une constante du SDK bouge sans elles — sans
// quoi l'écran afficherait « 3 clics en 1 s » pendant que le code en compte 4 en 2 s.
import { describe, expect, it } from "vitest";
import * as console from "../../apps/console/lib/frustration-regles";
import { ACTION_WINDOW_MS } from "../../packages/rum-sdk/src/actions";
import * as sdk from "../../packages/rum-sdk/src/frustration";

/** Espace insécable, écrite par son code : invisible dans une source. */
const NBSP = String.fromCharCode(0xa0);
const clair = (t: string) => t.split(NBSP).join(" ");
const secondes = (ms: number) => `${(ms / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${NBSP}s`;

describe("F22 — règles de frustration = constantes du SDK", () => {
  it("rage, dead, plafond par page : mêmes valeurs que packages/rum-sdk/src/frustration.ts", () => {
    expect(console.RAGE_MIN_CLICKS).toBe(sdk.RAGE_MIN_CLICKS);
    expect(console.RAGE_WINDOW_MS).toBe(sdk.RAGE_WINDOW_MS);
    expect(console.DEAD_CLICK_WINDOW_MS).toBe(sdk.DEAD_CLICK_WINDOW_MS);
    expect(console.FRUSTRATION_CAP_PER_PAGE).toBe(sdk.FRUSTRATION_CAP_PER_PAGE);
  });

  it("error click : la fenêtre causale des actions (packages/rum-sdk/src/actions.ts)", () => {
    expect(console.ERROR_CLICK_WINDOW_MS).toBe(ACTION_WINDOW_MS);
  });

  it("le texte affiché est calculé depuis ces constantes", () => {
    const [rage, dead, error] = console.reglesFrustration();
    expect(rage.texte).toBe(`${sdk.RAGE_MIN_CLICKS} clics sur la même cible en ${secondes(sdk.RAGE_WINDOW_MS)}.`);
    expect(dead.texte).toContain(`en ${secondes(sdk.DEAD_CLICK_WINDOW_MS)}`);
    expect(dead.texte).toContain("sans mutation, navigation ni défilement");
    expect(error.texte).toContain(`dans les ${secondes(ACTION_WINDOW_MS)}`);
    // Valeurs actuelles, en clair : « 3 clics … 1 s », « 1,5 s », « 5 s ».
    expect(clair(rage.texte)).toBe("3 clics sur la même cible en 1 s.");
    expect(clair(dead.texte)).toContain("1,5 s");
    expect(clair(error.texte)).toContain("5 s");
  });

  it("pluriels ÉCRITS : « signal » est irrégulier, jamais « signalaux »", () => {
    expect(console.pluriel("signal", 2)).toBe("signaux");
    expect(console.pluriel("signal", 1)).toBe("signal");
    expect(console.pluriel("signal", 0)).toBe("signal");
    expect(console.pluriel("session", 3)).toBe("sessions");
    expect(console.pluriel("route", 2)).toBe("routes"); // mot régulier : la règle par défaut
  });

  it("le sous-texte d'une tuile : « N signaux, N sessions », exactement", () => {
    expect(console.sousTexteSignaux(2, 1)).toBe("2 signaux, 1 session");
    expect(console.sousTexteSignaux(1, 1)).toBe("1 signal, 1 session");
    expect(console.sousTexteSignaux(0, 0)).toBe("0 signal, 0 session");
    expect(console.sousTexteSignaux(14, 9)).toBe("14 signaux, 9 sessions");
    expect(console.sousTexteSignaux(60, 1)).toBe("60 signaux, 1 session");
    expect(clair(console.sousTexteSignaux(2, 1))).not.toContain("signalaux");
  });

  it("les limites disent le sous-report et le plafond", () => {
    expect(console.LIMITES_FRUSTRATION).toContain("sous-report assumé");
    expect(console.LIMITES_FRUSTRATION).toContain(`${sdk.FRUSTRATION_CAP_PER_PAGE} signaux par page vue`);
    expect(console.LIMITES_FRUSTRATION).toContain("frappes au clavier ne sont pas comptées");
  });
});
