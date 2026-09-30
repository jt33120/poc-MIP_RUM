// Interactions des séries (refonte monitoring, vague 2 — spec A2 § 5.4) : réticule
// partagé, pinceau, légende chiffrée et cliquable. Même procédé que les tests de
// ThresholdSeries / StackedBars : la logique PURE est testée directement, les
// composants sont rendus côté serveur (`renderToStaticMarkup`, plan § 0.4) ; les
// gestes du bouton de légende sont appelés sur l'élément qu'il rend.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// `next` est une dépendance de la CONSOLE : routeur inerte (même procédé que Figure.test.tsx).
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {}, replace() {} }) }));

const {
  LEGENDE_INITIALE,
  PINCEAU_REPOS,
  SYNCHRO_PAGE,
  aspectSerie,
  basculerLegende,
  gestePinceau,
  hrefPlage,
  indexSeauContenant,
  plagePinceau,
  valeurLegende,
} = await import("@/lib/interactions-series");
const { BoutonLegende, Reticule } = await import("@/components/charts/InteractionsSeries");
const { ThresholdSeries } = await import("@/components/charts/ThresholdSeries");
const { StackedBars } = await import("@/components/charts/StackedBars");
const { libellePlage } = await import("@/components/GlobalFilters");

const H = (h: number) => `2026-09-29T${String(h).padStart(2, "0")}:00:00Z`;
const GRILLE_1H = [10, 11, 12, 13, 14, 15].map(H);
const GRILLE_6H = [H(0), H(6), H(12), H(18)];
const MAINTENANT = Date.parse("2026-09-29T23:59:30Z");

describe("réticule partagé — même instant, seaux différents", () => {
  it("toutes les séries d'une page partagent UN identifiant de synchronisation", () => {
    const serie = renderToStaticMarkup(
      <ThresholdSeries
        grille={GRILLE_1H}
        points={[{ t: H(10), lcp: 2100 }]}
        series={[{ cle: "lcp", libelle: "LCP p75", role: "principale" }]}
        format="ms"
        seauSecondes={3600}
        fuseau="Europe/Paris"
        ariaLabel="LCP"
        synchro="ancien-nom-de-paire"
      />,
    );
    const barres = renderToStaticMarkup(
      <StackedBars
        grille={GRILLE_6H}
        points={[{ t: H(12), a: 3 }]}
        series={[{ cle: "a", libelle: "Chargements" }]}
        format="count"
        seauSecondes={21_600}
        fuseau="Europe/Paris"
        ariaLabel="Vues"
      />,
    );
    const ids = [...(serie + barres).matchAll(/data-synchro="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([SYNCHRO_PAGE, SYNCHRO_PAGE]);
  });

  it("l'instant d'un graphique horaire tombe dans le bon seau de 6 h (la valeur exacte n'y existe pas)", () => {
    expect(indexSeauContenant(GRILLE_6H, 21_600, "Europe/Paris", H(14))).toBe(2);
    expect(indexSeauContenant(GRILLE_6H, 21_600, "Europe/Paris", H(12))).toBe(2);
    expect(indexSeauContenant(GRILLE_6H, 21_600, "Europe/Paris", H(23))).toBe(3);
    expect(indexSeauContenant(GRILLE_1H, 3600, "Europe/Paris", H(12))).toBe(2);
  });

  it("hors de la grille : -1 (pas de réticule plutôt qu'un trait au bord)", () => {
    expect(indexSeauContenant(GRILLE_1H, 3600, "Europe/Paris", H(9))).toBe(-1);
    expect(indexSeauContenant(GRILLE_1H, 3600, "Europe/Paris", H(16))).toBe(-1);
    expect(indexSeauContenant(GRILLE_1H, 3600, "Europe/Paris", undefined)).toBe(-1);
    expect(renderToStaticMarkup(<Reticule payloadIndex={-1} points={[{ x: 5, y: 0 }, { x: 5, y: 10 }]} />)).toBe("");
  });

  it("grille de jours locaux : l'instant est ramené au jour du fuseau d'affichage", () => {
    const jours = ["2026-09-28", "2026-09-29", "2026-09-30"];
    // 29/09 23:30 UTC = 30/09 01:30 à Paris.
    expect(indexSeauContenant(jours, 86_400, "Europe/Paris", "2026-09-29T23:30:00Z")).toBe(2);
    expect(indexSeauContenant(jours, 86_400, "Europe/Paris", "2026-09-29")).toBe(1);
  });

  it("réticule : trait vertical sur une série, bande du seau sur des barres", () => {
    expect(renderToStaticMarkup(<Reticule payloadIndex={2} points={[{ x: 40, y: 8 }, { x: 40, y: 180 }]} />)).toContain("<line");
    expect(renderToStaticMarkup(<Reticule payloadIndex={2} x={30} y={8} width={20} height={170} />)).toContain("<rect");
  });
});

describe("pinceau — plage, bornes, minimum 2 seaux, Échap", () => {
  it("du début du premier seau à la fin du dernier, dans un sens comme dans l'autre", () => {
    const aller = plagePinceau(GRILLE_1H, 3600, H(11), H(13), MAINTENANT);
    const retour = plagePinceau(GRILLE_1H, 3600, H(13), H(11), MAINTENANT);
    expect(aller).toEqual({ from: "2026-09-29T11:00:00Z", to: "2026-09-29T14:00:00Z", debut: 1, fin: 3, seaux: 3 });
    expect(retour).toEqual(aller);
  });

  it("le dernier seau (en cours) est coupé à la minute passée : jamais une fin dans le futur", () => {
    const plage = plagePinceau(GRILLE_1H, 3600, H(14), H(15), Date.parse("2026-09-29T15:20:45Z"));
    expect(plage?.to).toBe("2026-09-29T15:20:00Z");
  });

  it("un seul seau n'est pas une plage (c'est le zoom au clic) ; hors grille ou jours locaux : rien", () => {
    expect(plagePinceau(GRILLE_1H, 3600, H(12), H(12), MAINTENANT)).toBeNull();
    expect(plagePinceau(GRILLE_1H, 3600, H(12), H(22), MAINTENANT)).toBeNull();
    expect(plagePinceau(["2026-09-28", "2026-09-29"], 86_400, "2026-09-28", "2026-09-29", MAINTENANT)).toBeNull();
  });

  it("la plage remplit le gabarit de zoom de l'écran (from/to dans l'URL)", () => {
    const href = hrefPlage("/?app=demo&from={from}&to={to}", { from: "2026-09-29T11:00:00Z", to: "2026-09-29T14:00:00Z" });
    const u = new URL(href, "https://console.test");
    expect(u.searchParams.get("from")).toBe("2026-09-29T11:00:00Z");
    expect(u.searchParams.get("to")).toBe("2026-09-29T14:00:00Z");
    expect(u.searchParams.get("app")).toBe("demo");
  });

  it("presser, glisser, relâcher sur 3 seaux : plage retenue, le clic qui suit est absorbé", () => {
    let e = gestePinceau(PINCEAU_REPOS, { type: "presser", seau: H(11) }, GRILLE_1H, 3600).etat;
    e = gestePinceau(e, { type: "glisser", seau: H(13) }, GRILLE_1H, 3600).etat;
    expect(e.zone).toEqual({ debut: H(11), fin: H(13) });
    const fin = gestePinceau(e, { type: "relacher", maintenant: MAINTENANT }, GRILLE_1H, 3600);
    expect(fin.plage?.seaux).toBe(3);
    expect(fin.etat).toEqual({ zone: null, absorbe: true });
  });

  it("presser et relâcher sur UN seau : pas de plage, le clic garde le zoom", () => {
    const e = gestePinceau(PINCEAU_REPOS, { type: "presser", seau: H(12) }, GRILLE_1H, 3600).etat;
    const fin = gestePinceau(e, { type: "relacher", maintenant: MAINTENANT }, GRILLE_1H, 3600);
    expect(fin.plage).toBeNull();
    expect(fin.etat.absorbe).toBe(false);
  });

  it("Échap annule en cours de geste : plus de zone, rien au relâchement, clic absorbé", () => {
    let e = gestePinceau(PINCEAU_REPOS, { type: "presser", seau: H(11) }, GRILLE_1H, 3600).etat;
    e = gestePinceau(e, { type: "glisser", seau: H(14) }, GRILLE_1H, 3600).etat;
    e = gestePinceau(e, { type: "echap" }, GRILLE_1H, 3600).etat;
    expect(e).toEqual({ zone: null, absorbe: true });
    const fin = gestePinceau(e, { type: "relacher", maintenant: MAINTENANT }, GRILLE_1H, 3600);
    expect(fin.plage).toBeNull();
    // Un nouveau geste repart de zéro : l'absorption ne survit pas à la pression suivante.
    expect(gestePinceau(fin.etat, { type: "presser", seau: H(12) }, GRILLE_1H, 3600).etat.absorbe).toBe(false);
  });

  it("puce : « 14:00–16:30 » aujourd'hui, la date un autre jour, les deux jours à cheval", () => {
    const nb = (s: string) => s.replace(/[  ]/g, " ");
    const auj = Date.parse("2026-09-29T18:00:00Z");
    expect(nb(libellePlage("2026-09-29T12:00:00Z", "2026-09-29T14:30:00Z", "Europe/Paris", auj))).toBe("14:00–16:30");
    expect(nb(libellePlage("2026-09-28T12:00:00Z", "2026-09-28T14:30:00Z", "Europe/Paris", auj))).toBe("28/09 14:00–16:30");
    expect(nb(libellePlage("2026-09-28T20:00:00Z", "2026-09-29T00:00:00Z", "Europe/Paris", auj))).toBe("28/09 22:00 – 29/09 02:00");
  });
});

describe("légende chiffrée et cliquable — isoler, masquer, rétablir", () => {
  it("clic = isoler (les autres estompées) ; second clic = tout rétablir", () => {
    const isolee = basculerLegende(LEGENDE_INITIALE, "a", false);
    expect(aspectSerie(isolee, "a")).toBe("isolee");
    expect(aspectSerie(isolee, "b")).toBe("estompee");
    expect(basculerLegende(isolee, "a", false)).toEqual(LEGENDE_INITIALE);
    // Un clic sur une autre série déplace l'isolement.
    expect(basculerLegende(isolee, "b", false)).toEqual({ isolee: "b", masquees: [] });
  });

  it("Alt-clic = masquer, second Alt-clic = démasquer ; un clic simple lève les masques", () => {
    const masquee = basculerLegende(LEGENDE_INITIALE, "b", true);
    expect(aspectSerie(masquee, "b")).toBe("masquee");
    expect(aspectSerie(masquee, "a")).toBe("normale");
    expect(basculerLegende(masquee, "b", true)).toEqual(LEGENDE_INITIALE);
    expect(basculerLegende(masquee, "a", false)).toEqual({ isolee: "a", masquees: [] });
  });

  it("bouton : aria-pressed suit l'isolement ; la série masquée le dit dans son nom", () => {
    const rendu = (aspect: "normale" | "isolee" | "estompee" | "masquee") =>
      renderToStaticMarkup(
        <BoutonLegende cle="a" libelle="LCP p75" aspect={aspect} onBasculer={() => {}}>
          LCP p75
        </BoutonLegende>,
      );
    expect(rendu("isolee")).toContain('aria-pressed="true"');
    expect(rendu("normale")).toContain('aria-pressed="false"');
    expect(rendu("estompee")).toContain('aria-pressed="false"');
    expect(rendu("masquee")).toContain('aria-label="Isoler LCP p75 (masquée)"');
  });

  it("clavier : Entrée / Espace isolent, Alt + Entrée masque ; le clic synthétique du clavier n'agit pas deux fois", () => {
    const appels: [string, boolean][] = [];
    const bouton = BoutonLegende({
      cle: "a",
      libelle: "LCP p75",
      aspect: "normale",
      onBasculer: (cle, masquer) => appels.push([cle, masquer]),
      children: "LCP p75",
    }) as ReactElement<{
      onKeyDown: (e: { key: string; altKey: boolean; preventDefault: () => void }) => void;
      onClick: (e: { detail: number; altKey: boolean }) => void;
    }>;
    let empeche = 0;
    const touche = (key: string, altKey = false) => bouton.props.onKeyDown({ key, altKey, preventDefault: () => empeche++ });
    touche("Enter");
    touche(" ");
    touche("Enter", true);
    touche("Tab");
    bouton.props.onClick({ detail: 0, altKey: false });
    bouton.props.onClick({ detail: 1, altKey: true });
    expect(appels).toEqual([
      ["a", false],
      ["a", false],
      ["a", true],
      ["a", true],
    ]);
    expect(empeche).toBe(3);
  });

  it("valeur : celle du seau survolé (un trou reste « — »), sinon la dernière connue", () => {
    const lignes = [
      { t: H(10), a: 4 },
      { t: H(11), a: null },
      { t: H(12), a: 7 },
      { t: H(13), a: null },
    ];
    expect(valeurLegende(lignes, "a", null)).toEqual({ valeur: 7, index: 2 });
    expect(valeurLegende(lignes, "a", 0)).toEqual({ valeur: 4, index: 0 });
    expect(valeurLegende(lignes, "a", 1)).toEqual({ valeur: null, index: 1 });
  });

  it("rendu : chaque série a son bouton aria-pressed et sa valeur ; une série seule n'a rien à isoler", () => {
    const deux = renderToStaticMarkup(
      <ThresholdSeries
        grille={GRILLE_1H}
        points={[
          { t: H(10), a: 2100, b: 1800 },
          { t: H(12), a: 2500, b: 1900 },
        ]}
        series={[
          { cle: "a", libelle: "Release 1.1", role: "categorie" },
          { cle: "b", libelle: "Release 1.0", role: "categorie" },
        ]}
        format="ms"
        seauSecondes={3600}
        fuseau="Europe/Paris"
        ariaLabel="LCP par release"
      />,
    );
    expect(deux.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(deux.match(/data-testid="legende-valeur"/g)).toHaveLength(2);
    const une = renderToStaticMarkup(
      <ThresholdSeries
        grille={GRILLE_1H}
        points={[{ t: H(10), a: 2100 }]}
        series={[{ cle: "a", libelle: "LCP p75", role: "principale" }]}
        format="ms"
        seauSecondes={3600}
        fuseau="Europe/Paris"
        ariaLabel="LCP"
      />,
    );
    expect(une).not.toContain("aria-pressed");
    expect(une).toContain('data-testid="legende-valeur"');
  });

  it("barres empilées : une série à destination garde son libellé en lien, le bouton est sa pastille", () => {
    const html = renderToStaticMarkup(
      <StackedBars
        grille={GRILLE_1H}
        points={[{ t: H(10), a: 3, b: 1 }]}
        series={[
          { cle: "a", libelle: "TypeError", href: "/errors?panel=error:fp1" },
          { cle: "b", libelle: "Autres groupes (somme)" },
        ]}
        format="count"
        seauSecondes={3600}
        fuseau="Europe/Paris"
        ariaLabel="Occurrences"
      />,
    );
    expect(html.match(/aria-pressed="false"/g)).toHaveLength(2);
    expect(html).toContain('href="/errors?panel=error:fp1"');
    expect(html).not.toMatch(/<button[^>]*>(?:(?!<\/button>).)*<a /s);
  });
});
