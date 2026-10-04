// Les signaux de vue du SDK web ≥ 0.6 (`apps/console/lib/signaux-vue.ts`) : la liste
// des mesures écartées des lectures de Web Vitals, l'effectif requis et sa phrase,
// la source d'un repère. La population en base est gardée par
// `tests/integration/engagement-sql.test.ts`.
import { describe, expect, it } from "vitest";
import { CORE_VITALS } from "../../apps/console/lib/rating";
import { SEUILS_MIP } from "../../apps/console/lib/seuils";
import {
  EFFECTIF_MIN_SIGNAL_VUE,
  MESURES_DE_VUE,
  estMesureDeVue,
  manqueEffectif,
  sourceRepere,
  sqlHorsMesuresDeVue,
} from "../../apps/console/lib/signaux-vue";

const NBSP = " ";

describe("signaux de vue", () => {
  it("cinq mesures, aucune n'est un Web Vital ni une phase réseau", () => {
    expect([...MESURES_DE_VUE]).toEqual(["TIME_SPENT", "SCROLL_DEPTH", "SPA_LOAD", "RESOURCE_COUNT", "RESOURCE_BYTES"]);
    for (const m of MESURES_DE_VUE) expect(CORE_VITALS).not.toContain(m);
    expect(estMesureDeVue("SPA_LOAD")).toBe(true);
    expect(estMesureDeVue("LCP")).toBe(false);
    // Seul SPA_LOAD porte une règle MIP : une durée notée comme un appel.
    expect(MESURES_DE_VUE.filter((m) => m in SEUILS_MIP)).toEqual(["SPA_LOAD"]);
  });

  it("le fragment SQL écarte les cinq noms, sans valeur venue de la requête", () => {
    expect(sqlHorsMesuresDeVue("m.name")).toBe(
      " and m.name <> all('{TIME_SPENT,SCROLL_DEPTH,SPA_LOAD,RESOURCE_COUNT,RESOURCE_BYTES}'::text[])",
    );
  });

  it("13 mesures requises : la p75 n'a pas d'intervalle à 95 % en dessous", () => {
    expect(EFFECTIF_MIN_SIGNAL_VUE).toBe(13);
    expect(manqueEffectif(13, "vue")).toBeNull();
    expect(manqueEffectif(3, "vue")).toBe(`3${NBSP}vues, 13 requises`);
    expect(manqueEffectif(1, "mesure")).toBe(`1${NBSP}mesure, 13 requises`);
    expect(manqueEffectif(0, "chargement")).toBe(`0${NBSP}chargement, 13 requis`);
  });

  it("la source d'un repère se lit à son préfixe", () => {
    expect(sourceRepere("mark:hero")).toBe("mark");
    expect(sourceRepere("measure:api")).toBe("measure");
    expect(sourceRepere("panier_pret")).toBe("manuel");
    expect(sourceRepere("markup")).toBe("manuel");
  });
});
