// Cascade (F07, plan § 4.2) : la couleur dit la SÉVÉRITÉ et ne la dit jamais seule ;
// « partiel » est écrit EN TÊTE, avant le dessin ; l'alternative a les mêmes lignes
// que le dessin ; un enfant suit son parent ; rien ne sort de l'axe.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Cascade,
  TON_LIBELLE,
  ordonnerCascade,
  texteDuree,
  type ElementCascade,
  type PisteCascade,
  type TonCascade,
} from "@/components/charts/Cascade";

const PISTES: PisteCascade[] = [
  { cle: "nav", libelle: "Navigateur" },
  { cle: "srv", libelle: "Serveur" },
  { cle: "db", libelle: "Base de données" },
];

const el = (id: string, ton: TonCascade, extra: Partial<ElementCascade> = {}): ElementCascade => ({
  id,
  piste: "srv",
  libelle: `segment-${id}`,
  debutMs: 0,
  dureeMs: 100,
  ton,
  ...extra,
});

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/[\u00a0\u202f]/g, " ");

/** Le `<li>` de la ligne d'un élément, dans la liste détaillée. */
function ligne(html: string, libelle: string): string {
  const liste = html.slice(html.indexOf('data-testid="cascade-elements"'));
  const lignes = liste.split("<li").slice(1).map((l) => l.slice(0, l.indexOf("</li>")));
  const trouvee = lignes.find((l) => l.includes(`>${libelle}<`));
  if (!trouvee) throw new Error(`ligne ${libelle} absente`);
  return trouvee;
}

describe("Cascade — ton par sévérité", () => {
  const TONS: TonCascade[] = ["neutre", "good", "warn", "poor", "erreur"];
  const html = renderToStaticMarkup(
    <Cascade totalMs={1000} pistes={PISTES} elements={TONS.map((t, i) => el(t, t, { debutMs: i * 100 }))} />,
  );

  it("chaque ton a sa teinte de jeton (F01), jamais une classe de couleur brute", () => {
    const attendu: Record<TonCascade, string> = {
      neutre: "bg-ink-faint",
      good: "bg-good",
      warn: "bg-warn",
      poor: "bg-bad",
      erreur: "bg-bad",
    };
    for (const t of TONS) {
      const l = ligne(html, `segment-${t}`);
      expect(l).toContain(`data-ton="${t}"`);
      expect(l).toMatch(new RegExp(`cascade-ton-${t} [^"]*${attendu[t]}(\\s|")`));
    }
    expect(html).not.toMatch(/emerald-|amber-|red-\d/);
  });

  it("« erreur » se distingue de « mauvais » par un motif, pas par la seule couleur", () => {
    expect(ligne(html, "segment-erreur")).toContain("repeating-linear-gradient");
    expect(ligne(html, "segment-poor")).not.toContain("repeating-linear-gradient");
  });

  it("la sévérité est écrite en toutes lettres sous le libellé (sauf « neutre ») et dans l'alternative", () => {
    for (const t of ["good", "warn", "poor", "erreur"] as const) {
      expect(texte(ligne(html, `segment-${t}`))).toContain(TON_LIBELLE[t]);
    }
    expect(texte(ligne(html, "segment-neutre"))).not.toContain(TON_LIBELLE.neutre);
    const alternative = html.slice(html.indexOf('data-testid="alternative"'));
    expect(alternative).toContain(">Sévérité<");
    for (const t of TONS) expect(texte(alternative)).toContain(TON_LIBELLE[t]);
  });
});

describe("Cascade — « partiel » en tête", () => {
  it("le bandeau précède l'aperçu, la liste et l'alternative ; il est une note", () => {
    const html = renderToStaticMarkup(
      <Cascade
        totalMs={1000}
        pistes={PISTES}
        elements={[el("a", "neutre", { piste: "nav" }), el("b", "neutre", { piste: "db" })]}
        partiel="ressources de plus de 300 ms seulement, 20 par vue"
      />,
    );
    const bandeau = html.indexOf('data-testid="etat-partiel"');
    expect(bandeau).toBeGreaterThan(-1);
    expect(html.slice(bandeau - 60, bandeau)).toContain('role="note"');
    expect(texte(html)).toContain("Partiel : ressources de plus de 300 ms seulement, 20 par vue");
    for (const suite of ['data-testid="cascade-apercu"', 'data-testid="cascade-elements"', 'data-testid="alternative"']) {
      expect(html.indexOf(suite)).toBeGreaterThan(bandeau);
    }
  });

  it("sans `partiel`, aucun bandeau", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={100} pistes={PISTES} elements={[el("a", "neutre")]} />);
    expect(html).not.toContain("etat-partiel");
  });

  it("partiel et aucun élément : le bandeau reste, rien n'est dessiné", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={0} pistes={PISTES} elements={[]} partiel="collecte coupée" />);
    expect(texte(html)).toContain("Partiel : collecte coupée");
    expect(texte(html)).toContain("Aucun élément à placer sur l'axe.");
    expect(html).not.toContain("cascade-elements");
    expect(html).not.toMatch(/NaN|Infinity/);
  });
});

describe("Cascade — ordre, parents et sélection", () => {
  const ELEMENTS: ElementCascade[] = [
    el("db", "neutre", { piste: "db", debutMs: 50, parentId: "srv" }),
    el("srv", "erreur", { debutMs: 20, parentId: "nav" }),
    el("nav", "erreur", { piste: "nav", debutMs: 0 }),
    el("seul", "neutre", { debutMs: 10, parentId: "absent" }),
  ];

  it("chronologique, chaque enfant sous son parent, indenté ; un parent absent → racine", () => {
    expect(ordonnerCascade(ELEMENTS).map((o) => [o.element.id, o.profondeur])).toEqual([
      ["nav", 0],
      ["srv", 1],
      ["db", 2],
      ["seul", 0],
    ]);
    const html = renderToStaticMarkup(<Cascade totalMs={200} pistes={PISTES} elements={ELEMENTS} />);
    const ordre = ["segment-nav", "segment-srv", "segment-db", "segment-seul"].map((l) =>
      html.indexOf(`>${l}<`, html.indexOf("cascade-elements")),
    );
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(ligne(html, "segment-db")).toContain("padding-left:20px");
  });

  it("une boucle de parents ne fait perdre aucun élément", () => {
    const boucle = [el("a", "neutre", { parentId: "b" }), el("b", "neutre", { parentId: "a", debutMs: 5 })];
    expect(ordonnerCascade(boucle).map((o) => o.element.id).sort()).toEqual(["a", "b"]);
  });

  it("`selection` : aria-current sur cette ligne seulement", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={200} pistes={PISTES} elements={ELEMENTS} selection="srv" />);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(ligne(html, "segment-srv")).toContain('aria-current="true"');
  });

  it("`href` : le libellé est un lien", () => {
    const html = renderToStaticMarkup(
      <Cascade totalMs={200} pistes={PISTES} elements={[el("a", "neutre", { href: "/tracing/t?span=a" })]} />,
    );
    expect(ligne(html, "segment-a")).toMatch(/<a [^>]*href="\/tracing\/t\?span=a"/);
  });
});

describe("Cascade — axe, instants, repères", () => {
  it("un instant (durée null) est un losange, « instant », pas « — »", () => {
    const html = renderToStaticMarkup(
      <Cascade totalMs={1000} pistes={PISTES} elements={[el("clic", "erreur", { dureeMs: null, debutMs: 400 })]} />,
    );
    const l = ligne(html, "segment-clic");
    expect(l).toContain("rotate-45");
    expect(texte(l)).toContain("instant");
    expect(l).toContain("left:40%");
  });

  it("rien ne sort de l'axe : l'échelle s'étend à ce qu'on lui donne, les barres restent dans [0 ; 100 %]", () => {
    const html = renderToStaticMarkup(
      <Cascade
        totalMs={100}
        pistes={PISTES}
        elements={[el("long", "neutre", { debutMs: 50, dureeMs: 150 }), el("avant", "neutre", { debutMs: -20, dureeMs: 10 })]}
      />,
    );
    // Axe étendu à 200 ms : « long » commence à 25 % et couvre 75 %.
    expect(ligne(html, "segment-long")).toMatch(/left:25%;width:75%/);
    expect(ligne(html, "segment-avant")).toContain("left:0%");
    expect(texte(html)).toContain("200 ms");
    expect(html).not.toMatch(/NaN|Infinity|-\d+(\.\d+)?%/);
  });

  it("repères : verdict lu dans lib/rating.ts, écrit en texte ; sans vital, pas de verdict", () => {
    const html = renderToStaticMarkup(
      <Cascade
        totalMs={5000}
        pistes={PISTES}
        elements={[el("a", "neutre", { dureeMs: 4000 })]}
        marqueurs={[
          { t: 1200, libelle: "FCP", vital: "FCP", valeur: 1200 },
          { t: 2700, libelle: "LCP", vital: "LCP", valeur: 2700 },
          { t: 4500, libelle: "Chargement" },
        ]}
      />,
    );
    const t = texte(html);
    expect(t).toContain("FCP 1,2 s · Bon");
    expect(t).toContain("LCP 2,7 s · À améliorer");
    expect(t).toContain("Chargement à 4,5 s");
    expect(t).not.toContain("Chargement à 4,5 s ·");
    // Dans l'alternative aussi : une ligne par repère.
    expect(html.match(/scope="row"[^>]*>Repère /g)).toHaveLength(3);
  });

  it("durées : « < 1 ms » sous la milliseconde, minutes au-delà d'une minute", () => {
    expect(texteDuree(0.4)).toBe("< 1 ms");
    expect(texte(texteDuree(372_000))).toBe("6 min 12 s");
    expect(texteDuree(null)).toBe("—");
  });
});

describe("Cascade — aperçu par piste et hauteur réduite", () => {
  const ELEMENTS = [el("a", "neutre", { piste: "nav" }), el("b", "warn", { piste: "srv" }), el("c", "neutre", { piste: "inconnue" })];

  it("aperçu : une ligne par piste occupée, dans l'ordre déclaré, pistes non déclarées ensuite ; nommé en texte", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={200} pistes={PISTES} elements={ELEMENTS} />);
    // Depuis l'ouverture de la balise : role et aria-label la précèdent.
    const apercu = html.slice(html.lastIndexOf("<div", html.indexOf('data-testid="cascade-apercu"')), html.indexOf('data-testid="cascade-elements"'));
    expect(apercu).toContain('role="img"');
    expect(texte(apercu)).not.toContain("Base de données"); // piste vide : pas de ligne
    const nav = apercu.indexOf(">Navigateur<");
    const srv = apercu.indexOf(">Serveur<");
    const autre = apercu.indexOf(">inconnue<");
    expect(nav).toBeGreaterThan(-1);
    expect(srv).toBeGreaterThan(nav);
    expect(autre).toBeGreaterThan(srv);
    expect(apercu).toMatch(/aria-label="Aperçu par piste[^"]*Navigateur, 1 élément/);
  });

  it("une seule piste : pas d'aperçu (il doublerait la liste)", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={200} pistes={PISTES} elements={[el("a", "neutre"), el("b", "neutre")]} />);
    expect(html).not.toContain("cascade-apercu");
  });

  it("réduite : l'aperçu seul, pas de liste détaillée ; l'alternative reste", () => {
    const html = renderToStaticMarkup(<Cascade totalMs={200} pistes={PISTES} elements={ELEMENTS} hauteur="reduite" />);
    expect(html).toContain('data-hauteur="reduite"');
    expect(html).toContain("cascade-apercu");
    expect(html).not.toContain("cascade-elements");
    expect(html.match(/scope="row"/g)).toHaveLength(3);
  });
});
