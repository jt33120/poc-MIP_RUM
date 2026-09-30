// Hero de /tracing (§ 5.8, T6, F60) : « Appels API les plus lents, et la part
// médiane du serveur ».
//
// Ce que ce test verrouille (DF2) :
//   - AUCUNE ligne n'a de `segments` : la barre vaut le p75 navigateur, rien d'autre.
//     Découper une barre en « serveur » et « réseau = front_p75 − back_p75 » faisait
//     lire une différence de percentiles comme une durée ;
//   - la part serveur est une proportion (0-100 %), dite « non décomposé » quand aucun
//     appel n'a de jumeau serveur — jamais « 0 % serveur » ;
//   - couleur de la RÈGLE MIP des appels API (`SEUILS_MIP.API`, amendement de R-S du
//     29/09/2026), forme devant la valeur, règle écrite en tête (`REGLE_HERO`) ;
//   - le libellé mène à la ligne de « Tous les appels API » (ancre encodée), et
//     « Traces de cet appel » filtre les traces lentes sur l'appel.
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, Fragment, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import type { ApiCallDecomposition } from "../../apps/console/lib/queries-tracing";
import { RATING_HEX, RATING_JETON, SERIE } from "../../apps/console/lib/palette";
import { SEUILS_MIP, texteRegleMip } from "../../apps/console/lib/seuils";
import { ancreAppel, type Appel } from "../../apps/console/lib/tracing-ancres";
import {
  APPELS_HERO,
  REGLE_HERO,
  fragmentVers,
  libelleAppel,
  lignesHero,
  partServeur,
  texteDecomposition,
  tracesParAppel,
} from "../../apps/console/lib/tracing-hero";

function appel(over: Partial<ApiCallDecomposition> = {}): ApiCallDecomposition {
  return {
    url: "/api/panier",
    method: "GET",
    n: 150,
    n_suivis: 120,
    front_p75: 820,
    back_p75: 300,
    reseau_p75: 410,
    part_serveur_p50: 0.42,
    err: 3,
    ...over,
  };
}

const OPTIONS = {
  hrefAppel: (a: Appel) => `/tracing?app=demo#${encodeURIComponent(ancreAppel(a.method, a.url))}`,
  hrefTraces: (a: Appel) => `/tracing?app=demo&appel=${encodeURIComponent(`${a.method} ${a.url}`)}#traces`,
};

const rendre = (noeud: ReactNode) => renderToStaticMarkup(createElement(Fragment, null, noeud));

describe("lignesHero — T6", () => {
  it("aucune ligne n'a de segments : une barre = le p75 vu du navigateur", () => {
    const { lignes } = lignesHero(
      [appel(), appel({ url: "/api/b", part_serveur_p50: null, n_suivis: 0, back_p75: null }), appel({ url: "/api/c" })],
      { ...OPTIONS, ensemble: { front_p75: 700, back_p75: 250, correlated: 240 } },
    );
    expect(lignes).toHaveLength(4);
    for (const l of lignes) expect(l.segments).toBeUndefined();
    expect(lignes.slice(1).map((l) => l.value)).toEqual([820, 820, 820]);
  });

  it("part serveur null ou aucun appel suivi : « non décomposé », pas de ShareBar, jamais « 0 % »", () => {
    const { lignes } = lignesHero(
      [appel({ part_serveur_p50: null }), appel({ url: "/api/sans-jumeau", n_suivis: 0, part_serveur_p50: 0.3 })],
      OPTIONS,
    );
    for (const l of lignes) {
      const html = rendre(l.sub);
      expect(html).toContain("non décomposé");
      expect(html).not.toContain("% serveur");
      expect(html).not.toMatch(/\b0\s?% serveur/);
    }
  });

  it("part serveur mesurée : ShareBar sur 0-100 % et sa définition (médiane, appels suivis sur n)", () => {
    const html = rendre(lignesHero([appel()], OPTIONS).lignes[0].sub);
    expect(html).toContain("42\u00a0% serveur");
    expect(html).toContain("width:42%");
    expect(html).toContain("médiane, 120 appels suivis sur 150");
    expect(html).toContain("150 appels");
    // La part n'est jamais convertie en millisecondes.
    expect(html).not.toMatch(/\d\s?ms/);
  });

  it("libellé → ligne de la table (ancre) ; « Traces de cet appel » → T9 filtré, ancre #traces", () => {
    const [ligne] = lignesHero([appel({ method: "POST", url: "/api/a b" })], OPTIONS).lignes;
    expect(ligne.label).toBe("POST /api/a b");
    expect(ligne.href).toBe(`/tracing?app=demo#${encodeURIComponent("appel-POST%20%2Fapi%2Fa%20b")}`);
    const html = rendre(ligne.sub);
    expect(html).toContain("Traces de cet appel");
    expect(html).toContain(`appel=${encodeURIComponent("POST /api/a b")}#traces`.replace(/&/g, "&amp;"));
  });

  it("couleur de la règle MIP des appels API (SEUILS_MIP.API), forme devant la valeur ; « Ensemble » reste gris", () => {
    const { lignes } = lignesHero(
      [
        appel({ front_p75: SEUILS_MIP.API.bon }),
        appel({ url: "/api/m", front_p75: SEUILS_MIP.API.bon + 1 }),
        appel({ url: "/api/x", front_p75: SEUILS_MIP.API.mauvais + 1 }),
      ],
      { ...OPTIONS, ensemble: { front_p75: 900, back_p75: null, correlated: 0 } },
    );
    expect(lignes[0]).toMatchObject({ label: "Ensemble", color: SERIE.reference });
    expect(lignes[0].href).toBeUndefined();
    expect(lignes[0].sub).toBe("serveur : aucun appel suivi");
    expect(lignes.slice(1).map((l) => l.color)).toEqual([RATING_JETON.good, RATING_JETON["needs-improvement"], RATING_JETON.poor]);
    expect(String(lignes[3].display)).toMatch(/^■ /);
    expect(String(lignes[1].display)).toMatch(/^● /);
    // Aucune couleur constante de verdict (RATING_HEX) : les jetons suivent le thème.
    for (const l of lignes) expect(Object.values(RATING_HEX)).not.toContain(l.color);
    // La règle que l'écran écrit en tête du classement.
    expect(REGLE_HERO).toBe(texteRegleMip("API"));
    expect(lignes[3].title).toContain(REGLE_HERO);
  });

  it("« Ensemble » en tête : p75 navigateur global, et le p75 serveur sur les appels suivis", () => {
    const [ensemble] = lignesHero([appel()], {
      ...OPTIONS,
      ensemble: { front_p75: 700, back_p75: 250, correlated: 240 },
    }).lignes;
    expect(ensemble.value).toBe(700);
    expect(ensemble.sub).toBe("serveur : p75 250\u00a0ms sur 240 appels suivis");
  });

  it("les dix premières lignes de la table, dans son ordre ; un appel sans p75 est exclu et compté", () => {
    const appels = Array.from({ length: 14 }, (_v, i) =>
      appel({ url: `/api/${i}`, front_p75: i === 3 ? null : 1000 - i }),
    );
    const { lignes, exclues } = lignesHero(appels, OPTIONS);
    expect(APPELS_HERO).toBe(10);
    expect(exclues).toBe(1);
    expect(lignes.map((l) => l.label)).toEqual(
      appels.slice(0, 10).filter((a) => a.front_p75 != null).map((a) => `GET ${a.url}`),
    );
  });

  it("aucun appel : aucune ligne, pas même « Ensemble »", () => {
    expect(lignesHero([], { ...OPTIONS, ensemble: { front_p75: null, back_p75: null, correlated: 0 } }).lignes).toEqual([]);
  });
});

describe("partServeur, texteDecomposition, libelleAppel", () => {
  it("part bornée à [0, 100], arrondie ; null sans appel suivi", () => {
    expect(partServeur({ n_suivis: 2, part_serveur_p50: 0.5 })).toBe(50);
    expect(partServeur({ n_suivis: 2, part_serveur_p50: 1.2 })).toBe(100);
    expect(partServeur({ n_suivis: 0, part_serveur_p50: 0.5 })).toBeNull();
    expect(partServeur({ n_suivis: 3, part_serveur_p50: null })).toBeNull();
  });

  it("texte de l'alternative", () => {
    expect(texteDecomposition({ n: 150, n_suivis: 120, part_serveur_p50: 0.42 })).toBe(
      "part serveur 42\u00a0% (médiane, 120 appels suivis sur 150)",
    );
    expect(texteDecomposition({ n: 3, n_suivis: 0, part_serveur_p50: null })).toBe("non décomposé : aucun jumeau serveur");
  });

  it("« Traces les plus lentes » : trois traces au plus par appel, le reste compté et relié (recette du 26/09/2026)", () => {
    const t = (url: string, ms: number) => ({ method: "GET", url, front_ms: ms });
    const traces = [t("/a", 900), t("/a", 800), t("/b", 700), t("/a", 600), t("/a", 500), t("/a", 400), t("/b", 300)];
    const lignes = tracesParAppel(traces, 3);
    expect(lignes.map((l) => (l.kind === "trace" ? `${l.trace.url} ${l.trace.front_ms}` : `+${l.n} ${l.appel.url}`))).toEqual([
      "/a 900",
      "/a 800",
      "/b 700",
      "/a 600",
      "+2 /a",
      "/b 300",
    ]);
    // Filtré sur un appel : rien n'est replié.
    expect(tracesParAppel(traces, Infinity).every((l) => l.kind === "trace")).toBe(true);
  });

  it("plafond posé en SQL : le reste se compte sur toute la plage (`traces_appel`), pas sur les lignes lues", () => {
    const t = (url: string, ms: number, total: number) => ({ method: "GET", url, front_ms: ms, traces_appel: total });
    const lignes = tracesParAppel([t("/a", 900, 42), t("/a", 800, 42), t("/b", 700, 1), t("/a", 600, 42)], 3);
    expect(lignes.map((l) => (l.kind === "trace" ? `${l.trace.url} ${l.trace.front_ms}` : `+${l.n} ${l.appel.url}`))).toEqual([
      "/a 900",
      "/a 800",
      "/b 700",
      "/a 600",
      "+39 /a",
    ]);
  });

  it("un span sans URL garde un libellé lisible", () => {
    expect(libelleAppel({ method: "GET", url: "" })).toBe("GET (sans URL)");
  });
});

describe("fragmentVers — le lien du hero retrouve la ligne après le décodage de Next.js", () => {
  it("décodé une fois, le fragment redonne l'identifiant exact de la ligne", () => {
    const id = ancreAppel("GET", "/api/a b");
    const fragment = fragmentVers(id);
    expect(fragment).toBe("#appel-GET%2520%252Fapi%252Fa%2520b");
    expect(decodeURIComponent(fragment.slice(1))).toBe(id);
  });
});
