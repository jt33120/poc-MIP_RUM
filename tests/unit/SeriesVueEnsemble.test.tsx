// « Charge, erreurs et LCP » (F12, plan § 5.1.2, zone 6) — rendu serveur, sans
// graphique : chaque cas choisit des lectures qui mènent à un ÉTAT par panneau.
//
// Revue de F12 : une lecture en échec n'est pas une série vide. Méta « non lu »,
// alternative « — » ; jamais « 0 occurrence » sur une fenêtre qu'on n'a pas lue.
// Et les occurrences sans source déclarée, hors du panneau (2), sont dites (CP14).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ChargeErreursLcp } from "@/components/vue-ensemble/SeriesVueEnsemble";

// « Réessayer » (SectionErreur, client) lit le routeur de Next : hors application, un
// routeur inerte (même procédé que Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const texte = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

const GRILLE = ["2026-09-22T10:00:00Z", "2026-09-22T11:00:00Z"];
const COMMUN = {
  grille: GRILLE,
  seauSecondes: 3600,
  zoomHref: "/?from={from}&to={to}",
  annotations: { annotations: [], indisponible: null },
  plage: "24 h",
};
const VIDE_VUES = GRILLE.map((bucket) => ({ bucket, chargements: 0, spa: 0, inconnu: 0 }));
const VIDE_LCP = GRILLE.map((bucket) => ({ bucket, p75: null, n: 0 }));

/** Les cellules de la colonne `nom` de l'alternative textuelle. */
function colonne(html: string, nom: string): string[] {
  const table = html.slice(html.indexOf("<table"));
  const entetes = [...table.matchAll(/<th scope="col"[^>]*>([^<]*)<\/th>/g)].map((m) => m[1].replace(/&#x27;/g, "'"));
  const i = entetes.indexOf(nom);
  const lignes = [...table.matchAll(/<tr class="border-b border-line\/60[^"]*">([\s\S]*?)<\/tr>/g)].map((m) =>
    [...m[1].matchAll(/<t[hd][^>]*>([^<]*)<\/t[hd]>/g)].map((c) => c[1]),
  );
  return lignes.map((l) => l[i]);
}

describe("ChargeErreursLcp — lecture en échec", () => {
  it("occurrences non lues : méta « non lu », alternative « — », jamais 0", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: { ok: false, raison: "base coupée" },
          lcp: { ok: true, data: VIDE_LCP },
        }}
      />,
    );
    const t = texte(html);
    expect(t).toContain("occurrences navigateur : non lu");
    expect(t).not.toContain("0 occurrences navigateur");
    expect(t).toContain("0 pages vues"); // lue, réellement vide : 0
    expect(colonne(html, "Occurrences d'erreurs navigateur")).toEqual(["—", "—"]);
    expect(colonne(html, "Chargements")).toEqual(["0", "0"]);
  });

  it("LCP non lu : ni p75 ni effectif chiffrés", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: { ok: true, data: { restreint: true, points: GRILLE.map((bucket) => ({ bucket, navigateur: 0, sansSource: 0 })) } },
          lcp: { ok: false, raison: "base coupée" },
        }}
      />,
    );
    expect(texte(html)).toContain("mesures LCP : non lu");
    expect(colonne(html, "Mesures LCP")).toEqual(["—", "—"]);
    expect(colonne(html, "LCP p75")).toEqual(["—", "—"]);
  });
});

describe("ChargeErreursLcp — occurrences sans source déclarée (CP14)", () => {
  it("aucune occurrence navigateur, 3 sans source : l'état vide le dit", () => {
    const html = renderToStaticMarkup(
      <ChargeErreursLcp
        {...COMMUN}
        mode={{ kind: "simple" }}
        lectures={{
          vues: { ok: true, data: VIDE_VUES },
          erreurs: {
            ok: true,
            data: { restreint: true, points: [{ bucket: GRILLE[0], navigateur: 0, sansSource: 3 }, { bucket: GRILLE[1], navigateur: 0, sansSource: 0 }] },
          },
          lcp: { ok: true, data: VIDE_LCP },
        }}
      />,
    );
    expect(texte(html)).toContain("3 occurrence(s) sans source déclarée, non comptée(s).");
  });
});
