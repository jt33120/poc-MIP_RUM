// P**.3 — La partie 1 de la vitrine, « Ce qu'il contient » (plan § 8.2, PS2 à PS6),
// en rendu SSR réel (`renderToStaticMarkup`).
//
// Ce que ces tests tiennent :
//   - les capteurs ne sont plus un `h2` : la partie le porte, ils sont un bloc `h3` ;
//   - les textes exacts du plan, avec des versions LUES dans les paquets.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Capteurs } from "@/components/presentation/Capteurs";
import { EXT_VERSION } from "@/lib/specs";
import { RN_VERSION } from "@/lib/versions";

/**
 * Texte lisible : balises retirées (sans espace, comme presentation-ossature : un
 * `<code>` au milieu d'une phrase ne la coupe pas), entités et espaces insécables
 * normalisés. Deux blocs voisins se collent : on lit donc une cellule par cellule.
 */
const lisible = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/\s+/g, " ");

/** Les titres `hN` d'un rendu, dans l'ordre : [niveau, texte]. */
function titres(html: string): [number, string][] {
  return [...html.matchAll(/<h([2-5])[^>]*>(.*?)<\/h\1>/g)].map((m) => [Number(m[1]), lisible(m[2]).trim()]);
}

describe("PS2 — les capteurs", () => {
  const html = renderToStaticMarkup(<Capteurs />);
  const texte = lisible(html);

  it("le titre passe en h3 ; les cartes en h4, leurs rubriques en h5", () => {
    expect(html).not.toContain("<h2");
    expect(titres(html)).toEqual([
      [3, "Extension navigateur ou SDK embarqué"],
      [4, "Extension navigateur"],
      [5, "Spécifications"],
      [5, "À qui ça s'adresse"],
      [4, "SDK embarqué"],
      [5, "Spécifications"],
      [5, "À qui ça s'adresse"],
    ]);
    expect(html).toContain('<section id="contient-capteurs" aria-labelledby="contient-capteurs-titre"');
  });

  it("la limite du SDK, texte exact du plan, version lue dans lib/versions.ts", () => {
    expect(texte).toContain(
      `Demande une mise en production côté client. Web ; React Native en paquet privé (v${RN_VERSION}), jamais exécuté sur un appareil ni un simulateur ; pas de SDK iOS ou Android natif.`,
    );
  });

  it("la version de l'extension, lue dans lib/specs.ts, et sa non-publication", () => {
    const version = /<dt[^>]*>Version<\/dt><dd[^>]*>(.*?)<\/dd>/.exec(html)?.[1] ?? "";
    expect(lisible(version)).toBe(`${EXT_VERSION}, non publiée au Chrome Web Store`);
  });

  it("sous les cartes, les agents côté serveur (texte exact du plan)", () => {
    expect(texte).toContain(
      "Côté serveur : un agent Node (packages/agent-node) et un middleware FastAPI (integrations/fastapi) relient un appel du navigateur à son exécution serveur, sur un seul saut.",
    );
  });

  it("les flèches gardent la classe que coupe le mouvement réduit (TP12)", () => {
    expect(html).toContain("mip-fleche");
  });

  it("aucun texte en ink-faint (§ 3.9), aucun libellé d'écran périmé", () => {
    expect(html).not.toContain("text-ink-faint");
    expect(texte).not.toContain("pages lentes");
  });
});
