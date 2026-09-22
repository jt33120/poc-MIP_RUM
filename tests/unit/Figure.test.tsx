// Figure (F03, plan § 4.2, P10, P11) : ce qu'une figure montre, sur quoi elle
// porte, la même chose sans les yeux — et un état qui REMPLACE le dessin.
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { Figure } from "@/components/charts/Figure";

// L'état « erreur » rend le bouton « Réessayer » (SectionErreur, client), qui lit le
// routeur de Next : hors application, on lui en donne un inerte. `next` est une
// dépendance de la CONSOLE, introuvable depuis la racine : le module simulé est
// désigné par son chemin résolu depuis apps/console, celui qu'importe SectionErreur.
const { NAVIGATION } = vi.hoisted(() => {
  const { createRequire } = process.getBuiltinModule("node:module") as typeof import("node:module");
  return { NAVIGATION: createRequire(`${process.cwd()}/apps/console/package.json`).resolve("next/navigation") };
});
vi.mock(NAVIGATION, () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));

const rendu = (el: ReactElement) => renderToStaticMarkup(el);
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ");

const DESSIN = <div data-testid="dessin">barres</div>;
const ALTERNATIVE = {
  legende: "LCP p75 par route, 24 h",
  colonnes: ["Route", "LCP p75", "Mesures"],
  lignes: [
    ["/checkout", "3,4 s", 412],
    ["/compte", null, 12],
  ],
};

describe("Figure — titre et zone graphique", () => {
  it("titre en h2, zone graphique étiquetée par le titre", () => {
    const html = rendu(
      <Figure titre="Quelles routes sont lentes ?" id="routes">
        {DESSIN}
      </Figure>,
    );
    expect(html).toMatch(/<h2 id="routes-titre"/);
    expect(html).toContain('role="figure" aria-labelledby="routes-titre"');
    expect(html).toContain('data-testid="dessin"');
    expect(html).toContain('id="routes"');
  });

  it("sans id, l'ancre dérive du titre (accents retirés)", () => {
    const html = rendu(<Figure titre="Éléments lents à l'INP">{DESSIN}</Figure>);
    expect(html).toContain('id="figure-elements-lents-a-l-inp"');
  });

  it("méta (P11), phrase de lecture et lien « Ouvrir dans l'Explorer »", () => {
    const html = rendu(
      <Figure
        titre="LCP"
        meta={<span>1 240 mesures · 24 h</span>}
        lecture="Ne montre pas les vues sans LCP."
        explorer="/explorer?dataset=vitals&run=1"
      >
        {DESSIN}
      </Figure>,
    );
    expect(html).toContain('data-testid="figure-meta"');
    expect(texte(html)).toContain("1 240 mesures · 24 h");
    expect(texte(html)).toContain("Ne montre pas les vues sans LCP.");
    expect(html).toContain('href="/explorer?dataset=vitals&amp;run=1"');
    expect(texte(html)).toContain("Ouvrir dans l'Explorer");
  });
});

describe("Figure — alternative textuelle (P10)", () => {
  it("tableau replié : légende, en-têtes de colonne et de ligne", () => {
    const html = rendu(
      <Figure titre="LCP par route" alternative={ALTERNATIVE}>
        {DESSIN}
      </Figure>,
    );
    expect(html).toContain("<details");
    expect(texte(html)).toContain("Alternative textuelle");
    expect(html).toContain("<caption");
    expect(texte(html)).toContain("LCP p75 par route, 24 h");
    expect(html.match(/scope="col"/g)).toHaveLength(3);
    expect(html.match(/scope="row"/g)).toHaveLength(2);
  });

  it("une cellule inconnue s'écrit « — », jamais 0 ni vide", () => {
    const html = rendu(
      <Figure titre="LCP par route" alternative={ALTERNATIVE}>
        {DESSIN}
      </Figure>,
    );
    expect(texte(html)).toMatch(/\/compte—12/);
    expect(texte(html)).toContain("412");
  });
});

describe("Figure — un état remplace le dessin", () => {
  it("vide : le texte de l'état, ni dessin ni alternative", () => {
    const html = rendu(
      <Figure titre="Erreurs par navigateur" etat={{ kind: "vide", population: "erreur", plage: "24 h" }} alternative={ALTERNATIVE}>
        {DESSIN}
      </Figure>,
    );
    expect(html).not.toContain('data-testid="dessin"');
    expect(html).not.toContain("<details");
    expect(texte(html)).toContain("Aucune erreur sur 24 h.");
    expect(html).toContain('data-etat="vide"');
  });

  it("erreur : « lecture en échec » et « Réessayer », jamais un axe vide", () => {
    const html = rendu(
      <Figure titre="Occurrences par heure" etat={{ kind: "erreur", titre: "Occurrences par heure" }}>
        {DESSIN}
      </Figure>,
    );
    expect(html).not.toContain('data-testid="dessin"');
    expect(texte(html)).toContain("Lecture en échec.");
    expect(texte(html)).toContain("Réessayer");
    expect(html).toContain('role="alert"');
  });

  it("partiel, non collecté, échantillonné, chargement : chacun son texte", () => {
    const partiel = texte(rendu(<Figure titre="Pays" etat={{ kind: "partiel", raison: "200 pays sur 212" }} />));
    expect(partiel).toContain("Partiel : 200 pays sur 212");
    const nc = texte(rendu(<Figure titre="Signaux" etat={{ kind: "non_collecte", manque: "le SDK mobile n'émet pas" }} />));
    expect(nc).toContain("Non collecté : le SDK mobile n'émet pas");
    const ech = texte(rendu(<Figure titre="Sessions" etat={{ kind: "echantillonne", probaMin: null, unite: "session" }} />));
    expect(ech).toContain("probabilité d'inclusion de chaque session inconnue");
    expect(ech).not.toMatch(/100\s*%/);
    const ch = rendu(<Figure titre="LCP" etat={{ kind: "chargement", titre: "LCP" }} />);
    expect(ch).toContain('aria-busy="true"');
  });
});
