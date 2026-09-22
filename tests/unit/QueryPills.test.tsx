// QueryPills (F31, § 4.3) : la requête appliquée en pastilles. Rendu SSR réel.
//
// Ce qui compte pour l'utilisateur : le groupe porte la phrase complète (fenêtre
// et périmètre compris) ; une pastille retirable est UN lien, nommé ; une pastille
// obligatoire n'a pas de lien et dit pourquoi, dans le texte — pas seulement dans
// une bulle.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { QueryPills } from "@/components/explorer/QueryPills";
import type { Pastille } from "@/lib/explorer-page-params";

const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");

const PASTILLES: Pastille[] = [
  { cle: "jeu", libelle: "Jeu : Erreurs", retirerHref: null, raison: "une analyse porte toujours sur un jeu de données" },
  { cle: "mesure", libelle: "Somme — Occurrences", retirerHref: null, raison: "une analyse mesure toujours quelque chose" },
  { cle: "condition-0", libelle: "Release = 1.4.2", retirerHref: "/explorer?app=demo&dataset=errors&run=1" },
];
const RESUME = "Somme — occurrences sur erreurs · fenêtre 24 h · application demo · Release = 1.4.2 · robots exclus.";

describe("QueryPills", () => {
  const html = renderToStaticMarkup(<QueryPills pastilles={PASTILLES} resume={RESUME} />);

  it("le groupe est nommé par le résumé complet (fenêtre et périmètre compris)", () => {
    expect(html).toContain('role="group"');
    expect(html).toContain(`aria-label="${RESUME}"`);
  });

  it("une pastille par élément, dans l'ordre fourni", () => {
    const t = texte(html);
    const positions = PASTILLES.map((p) => t.indexOf(p.libelle));
    expect(positions.every((i) => i >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("une pastille retirable est UN lien, qui nomme ce qu'il retire", () => {
    const liens = html.match(/<a [^>]*>/g) ?? [];
    expect(liens).toHaveLength(1);
    expect(liens[0]).toContain('href="/explorer?app=demo&amp;dataset=errors&amp;run=1"');
    expect(liens[0]).toContain("Retirer « Release = 1.4.2 »");
  });

  it("une pastille obligatoire n'a pas de lien, et sa raison est dans le texte", () => {
    const t = texte(html);
    expect(t).toContain("non retirable : une analyse porte toujours sur un jeu de données");
    expect(t).toContain("non retirable : une analyse mesure toujours quelque chose");
  });

  it("une valeur longue est tronquée à l'écran mais reste entière dans le titre", () => {
    const long = "x".repeat(400);
    const rendu = renderToStaticMarkup(
      <QueryPills pastilles={[{ cle: "c", libelle: `Route = ${long}`, retirerHref: "/explorer?run=1" }]} resume="r" />,
    );
    expect(rendu).toContain("truncate");
    expect(rendu).toContain(`title="Route = ${long}"`);
  });
});
