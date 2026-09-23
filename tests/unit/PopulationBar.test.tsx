// PopulationBar (F36, § 4.2, W-B1) : la population lue, au-dessus d'une grille de
// cartes. Rendu SSR réel — on vérifie ce qui sera LU, pas la structure des props.
//
// Ce que ces tests empêchent : qu'une barre reste muette parce qu'aucune condition
// n'est posée (« rien d'écrit » se lit « je ne sais pas sur quoi portent ces
// chiffres »), et qu'une puce non retirable ressemble à un lien — un geste promis
// qui n'existe pas se paie plus cher qu'un geste absent.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PopulationBar } from "@/components/PopulationBar";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();

describe("PopulationBar", () => {
  it("écrit la plage, le fuseau d'axe et chaque puce, même sans aucun filtre", () => {
    const html = renderToStaticMarkup(
      <PopulationBar
        puces={[{ libelle: "Toutes les apps autorisées" }, { libelle: "Tous les visiteurs" }, { libelle: "Robots exclus" }]}
        plage="24 h"
        fuseau="UTC"
      />,
    );
    const lu = texte(html);
    expect(lu).toContain("Population lue");
    expect(lu).toContain("24 h");
    expect(lu).toContain("axes en UTC");
    expect(lu).toContain("Toutes les apps autorisées");
    expect(lu).toContain("Robots exclus");
    // Aucune puce n'est retirable ici : aucun lien n'est rendu.
    expect(html).not.toContain("<a ");
  });

  it("une puce retirable est un lien vers la même page sans elle ; les autres n'en sont pas", () => {
    const html = renderToStaticMarkup(
      <PopulationBar
        puces={[
          { libelle: "Navigateur = Firefox", retirerHref: "/dashboards/7?app=demo-app" },
          { libelle: "Robots exclus" },
        ]}
        plage="7 j"
        fuseau="UTC"
      />,
    );
    expect(html).toContain('href="/dashboards/7?app=demo-app"');
    expect(html).toContain('title="Retirer : Navigateur = Firefox"');
    // Une seule ancre : « Robots exclus » ne se retire pas, il ne se clique pas.
    expect(html.match(/<a /g)).toHaveLength(1);
  });
});
