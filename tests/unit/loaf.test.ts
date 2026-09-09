// Long Animation Frames — l'attribution des blocages du fil principal.
//
// CE QUE CE FICHIER GARDE. Une entrée LoAF est une structure de bornes
// temporelles, et toutes les erreurs de ce genre se ressemblent : une soustraction
// faite sur un champ à zéro, une durée négative qu'on laisse passer, une valeur
// non finie qui contamine une moyenne que plus personne ne saura expliquer
// ensuite. Aucune ne lève d'erreur — elles produisent un nombre, simplement faux.
//
// Le second sujet est la PII : `sourceURL` est une URL comme une autre, donc
// susceptible de porter un jeton en query string, et `invoker` est du texte libre
// venu de la page.
import { describe, expect, it } from "vitest";
import {
  LOAF_CAP_PER_PAGE,
  LOAF_ENTRY_TYPE,
  attributsLoaf,
  scriptDominant,
  type LoafEntry,
} from "../../packages/rum-sdk/src/loaf";

/** Une frame typique : 200 ms au total, dont 160 de blocage, rendu à la fin. */
const FRAME: LoafEntry = {
  startTime: 1000,
  duration: 200,
  blockingDuration: 160,
  renderStart: 1170,
  scripts: [
    { duration: 12, sourceURL: "https://app.fr/a.js", sourceFunctionName: "petit" },
    {
      duration: 148,
      sourceURL: "https://app.fr/panier.js",
      sourceFunctionName: "recalculerTotal",
      invoker: "BUTTON#payer.onclick",
    },
    { duration: 5, sourceURL: "https://app.fr/b.js" },
  ],
};

describe("scriptDominant — un seul script, celui qu'on corrige", () => {
  it("retient le plus long, quelle que soit sa position", () => {
    expect(scriptDominant(FRAME.scripts)?.sourceFunctionName).toBe("recalculerTotal");
  });

  it("rend null sur une liste vide ou absente", () => {
    expect(scriptDominant([])).toBeNull();
    expect(scriptDominant(undefined)).toBeNull();
  });

  // Une durée absente n'est pas une durée de zéro : un script non mesuré ne doit
  // pas gagner le classement par défaut, ni le perdre contre un script à 0 ms.
  it("ignore les scripts sans durée mesurée", () => {
    expect(scriptDominant([{ sourceURL: "x" }, { duration: 3, sourceURL: "y" }])?.sourceURL).toBe("y");
    expect(scriptDominant([{ sourceURL: "x" }])).toBeNull();
  });

  it("accepte un script à 0 ms — c'est une mesure, pas une absence", () => {
    expect(scriptDominant([{ duration: 0, sourceURL: "z" }])?.sourceURL).toBe("z");
  });
});

describe("attributsLoaf — les durées", () => {
  const a = attributsLoaf(FRAME);

  it("porte la durée de la frame et le temps de blocage", () => {
    expect(a["loaf.duration_ms"]).toBe(200);
    expect(a["loaf.blocking_ms"]).toBe(160);
  });

  it("déduit le temps de rendu de la fin de frame, pas du début", () => {
    // fin = 1000 + 200 = 1200 ; rendu commencé à 1170 -> 30 ms de rendu
    expect(a["loaf.render_ms"]).toBe(30);
  });

  it("arrondit au dixième — la précision réelle de l'API", () => {
    const r = attributsLoaf({ startTime: 0, duration: 212.44444 });
    expect(r["loaf.duration_ms"]).toBe(212.4);
  });

  // LE PIÈGE PRINCIPAL. `renderStart` vaut 0 quand la frame n'a rien rendu.
  // Soustraire aveuglément donnerait une phase de rendu de la taille de
  // l'horodatage — un nombre absurde, mais un nombre, que personne ne verrait.
  it("ne calcule pas de rendu quand la frame n'a rien rendu", () => {
    const r = attributsLoaf({ startTime: 1000, duration: 200, renderStart: 0 });
    expect(r["loaf.render_ms"]).toBeUndefined();
  });

  it("ne calcule pas de rendu quand la borne tombe hors de la frame", () => {
    // avant le début…
    expect(attributsLoaf({ startTime: 1000, duration: 200, renderStart: 900 })["loaf.render_ms"]).toBeUndefined();
    // …ou après la fin
    expect(attributsLoaf({ startTime: 1000, duration: 200, renderStart: 9999 })["loaf.render_ms"]).toBeUndefined();
  });

  it("écarte un temps de blocage négatif", () => {
    const r = attributsLoaf({ startTime: 0, duration: 100, blockingDuration: -5 });
    expect(r["loaf.blocking_ms"]).toBeUndefined();
  });

  it("n'invente rien quand l'entrée est nue", () => {
    expect(attributsLoaf({ startTime: 0, duration: 90 })).toEqual({ "loaf.duration_ms": 90 });
  });

  it("ne produit jamais de valeur non finie", () => {
    for (const r of [
      attributsLoaf(FRAME),
      attributsLoaf({ startTime: 0, duration: 90 }),
      attributsLoaf({ startTime: 1000, duration: 200, renderStart: 0 }),
    ]) {
      for (const [k, v] of Object.entries(r))
        if (typeof v === "number") expect(Number.isFinite(v), k).toBe(true);
    }
  });
});

describe("attributsLoaf — l'attribution", () => {
  const a = attributsLoaf(FRAME);

  it("nomme le script, sa fonction, sa durée et ce qui l'a invoqué", () => {
    expect(a["loaf.script_url"]).toBe("https://app.fr/panier.js");
    expect(a["loaf.script_function"]).toBe("recalculerTotal");
    expect(a["loaf.script_ms"]).toBe(148);
    expect(a["loaf.invoker"]).toBe("BUTTON#payer.onclick");
  });

  // Un `sourceURL` est une URL comme une autre : il passe par le même nettoyage
  // que les URL de page et de ressource. Sans quoi un jeton posé en query string
  // par un chargeur de scripts partirait en base à chaque frame lente.
  it("nettoie l'URL du script de sa query string", () => {
    const r = attributsLoaf({
      startTime: 0,
      duration: 100,
      scripts: [{ duration: 90, sourceURL: "https://app.fr/x.js?token=sk-abcdef123456&v=2" }],
    });
    expect(r["loaf.script_url"]).toBe("https://app.fr/x.js");
    expect(String(r["loaf.script_url"])).not.toContain("sk-");
  });

  it("borne les libellés libres venus de la page", () => {
    const long = "f".repeat(500);
    const r = attributsLoaf({
      startTime: 0,
      duration: 100,
      scripts: [{ duration: 90, sourceFunctionName: long, invoker: long }],
    });
    expect(String(r["loaf.script_function"]).length).toBeLessThanOrEqual(120);
    expect(String(r["loaf.invoker"]).length).toBeLessThanOrEqual(120);
  });

  it("omet ce qui manque plutôt que d'écrire une chaîne vide", () => {
    const r = attributsLoaf({ startTime: 0, duration: 100, scripts: [{ duration: 90 }] });
    expect("loaf.script_url" in r).toBe(false);
    expect("loaf.script_function" in r).toBe(false);
    expect("loaf.invoker" in r).toBe(false);
    expect(r["loaf.script_ms"]).toBe(90); // …mais la durée, elle, est connue
  });
});

describe("garde-fous du module", () => {
  it("plafonne les frames par page vue", () => {
    // Une page qui rame produit des dizaines de frames longues d'affilée ; sans
    // plafond, une seule session en enverrait des centaines.
    expect(LOAF_CAP_PER_PAGE).toBeGreaterThan(0);
    expect(LOAF_CAP_PER_PAGE).toBeLessThanOrEqual(50);
  });

  it("observe le type d'entrée que la spec nomme", () => {
    // Une faute de frappe ici ne lèverait rien : `observe()` sur un type inconnu
    // est silencieux, et la mesure n'existerait simplement jamais.
    expect(LOAF_ENTRY_TYPE).toBe("long-animation-frame");
  });
});
