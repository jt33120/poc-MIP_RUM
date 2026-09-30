// La présentation publique (/presentation), réduite par la recette du 26/09/2026 à
// une vitrine de deux ou trois écrans : la promesse et le statut daté, trois preuves
// visuelles, le tableau « Où sont les données, et sous quel droit », l'invitation à
// la démo. Le détail est dans le dossier technique (tests : presentation-ossature,
// Contient, SaitFaire, Reste, Annexe, Specs).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) :
//   - l'hébergement : une ligne par hébergeur de lib/legal.ts, la phrase admise sur la
//     souveraineté, une seule fois sur la page (il s'écrivait à sept endroits) ;
//   - le statut : trois lignes datées, décomptes LUS dans le registre, jamais tapés ;
//   - les preuves : trois recadrages de vraies captures, chacun décrit (alt) ;
//   - aucun code interne, aucun chemin du code, aucune empreinte, aucune adresse
//     d'infrastructure, aucun journal de chantier ; une page courte ;
//   - le bandeau de la session de démonstration.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BandeauDemo } from "@/components/presentation/BandeauDemo";
import { Hebergement } from "@/components/presentation/Hebergement";
import { LandingArchive as Landing } from "@/components/presentation/archive/LandingArchive";
import { Preuves } from "@/components/presentation/Preuves";
import { RELEVE_PERIME_JOURS } from "@/components/presentation/Releve";
import { StatutPoc } from "@/components/presentation/StatutPoc";
import type { SessionUser } from "@/lib/auth";
import { CAPACITES, RELEVE, SHA, compte } from "@/lib/couverture";
import { HEBERGEMENT, TOPOLOGIE_RELEVEE } from "@/lib/presentation-topologie";

/** Texte lisible : balises retirées, entités et espaces insécables normalisés. */
const lisible = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/ ([.,])/g, "$1")
    .trim();

/** Les cellules d'une rangée de tableau, une par une. */
const cellules = (rangee: string) => [...rangee.matchAll(/<t[hd][^>]*>(.*?)<\/t[hd]>/gs)].map((m) => lisible(m[1]));

/** Minuit UTC du relevé « JJ/MM/AAAA », décalé de `jours` jours. */
function apresReleve(jours: number): Date {
  const [j, m, a] = RELEVE.split("/").map(Number);
  return new Date(Date.UTC(a, m - 1, j) + jours * 86_400_000);
}

const ADMIN: SessionUser = { email: "a@mip.test", role: "admin", apps: null };
const VISITEUR = renderToStaticMarkup(<Landing user={null} demoOuverte />);

describe("où sont les données, et sous quel droit — la seule source de l'hébergement", () => {
  const html = renderToStaticMarkup(<Hebergement />);

  it("une ligne par hébergeur, lue dans lib/legal.ts", () => {
    const table = /<table aria-labelledby="hebergement-titre".*?<\/table>/s.exec(html)?.[0] ?? "";
    const [entete, ...lignes] = [...table.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)].map((m) => cellules(m[1]));
    expect(entete).toEqual(["Pièce", "Hébergeur", "Région", "Droit de l'hébergeur"]);
    expect(lignes).toEqual(HEBERGEMENT.map((l) => [l.piece, l.hebergeur, l.lieu, l.droit]));
  });

  it("la phrase sous la table : la souveraineté (phrase admise), et une promesse sur l'adresse IP qui ne dépasse pas les mesures", () => {
    expect(lisible(html)).toContain(
      "La donnée et le calcul sont en Union européenne ; les trois hébergeurs relèvent d'un droit tiers. Ce POC n'est pas une offre souveraine. Les mesures ne conservent aucune adresse IP de visiteur : le pays est estimé.",
    );
    expect(lisible(html)).not.toContain("sous aucune forme");
  });

  it("la table défile dans un cadre qui le signale, jamais la page ; son titre est une ancre", () => {
    expect(html).toMatch(/<div role="region" aria-label="Hébergement des données"[^>]*class="relative overflow-x-auto/);
    expect(html).toContain('<section id="hebergement" aria-labelledby="hebergement-titre"');
    expect(html).toMatch(/<h2 id="hebergement-titre" tabindex="-1"/);
  });

  it("une seule fois sur la présentation, en-tête et pied de page compris", () => {
    expect(VISITEUR.split('data-testid="hebergement"').length - 1).toBe(1);
    expect(lisible(VISITEUR).split("Où sont les données, et sous quel droit").length - 1).toBe(1);
    // Les trois « américain » sont les trois cellules « Droit de l'hébergeur ».
    expect(lisible(VISITEUR).split("américain").length - 1).toBe(HEBERGEMENT.length);
  });
});

describe("où en est le POC — trois lignes datées", () => {
  it("les décomptes et les dates viennent du registre et de la topologie", () => {
    const html = renderToStaticMarkup(<StatutPoc maintenant={apresReleve(1)} />);
    const items = [...html.matchAll(/<li[^>]*>(.*?)<\/li>/gs)].map((m) => lisible(m[1]));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatch(new RegExp(`^${TOPOLOGIE_RELEVEE.railway} En production`));
    expect(items[1]).toBe(
      `${RELEVE} ${compte("deploye_non_eprouve")} capacités sur ${CAPACITES.length} déployées, chacune avec sa limite écrite dans le dossier technique.`,
    );
    expect(items[2]).toBe("Prochaine étape Les éprouver sur le trafic réel d'une application cliente.");
    expect(html).toMatch(/<a [^>]*href="\/presentation\/dossier"/);
    expect(html).not.toContain("presentation-statut-perime");
  });

  it(`au-delà de ${RELEVE_PERIME_JOURS} jours, le statut prévient que l'état a pu changer`, () => {
    const html = renderToStaticMarkup(<StatutPoc maintenant={apresReleve(RELEVE_PERIME_JOURS + 1)} />);
    expect(html).toContain('data-testid="presentation-statut-perime"');
  });
});

describe("trois preuves visuelles, lisibles", () => {
  const html = renderToStaticMarkup(<Preuves />);

  it("trois recadrages de vraies captures, chacun titré et décrit ; la variante sombre est muette", () => {
    const preuves = html.split('data-testid="preuve"').slice(1);
    expect(preuves).toHaveLength(3);
    for (const p of preuves) {
      expect(p).toMatch(/<h3[^>]*>[^<]+<\/h3>/);
      const images = [...p.matchAll(/<img [^>]*>/g)].map((m) => m[0]);
      expect(images.length).toBeGreaterThan(0);
      for (const img of images) {
        expect(img).toMatch(/src="[^"]*portail%2F|src="\/portail\//);
        expect(/alt=""/.test(img) ? /aria-hidden="true"/.test(img) : /alt="[^"]{20,}"/.test(img), img).toBe(true);
      }
    }
  });

  it("une seule légende, qui dit « jeu de démonstration »", () => {
    expect(html.split("Captures réelles de la console").length - 1).toBe(1);
    expect(lisible(html)).toContain("Les chiffres affichés viennent d'un jeu de démonstration");
  });
});

describe("la présentation : courte, sans jargon interne", () => {
  const texte = lisible(VISITEUR);

  it("h1, puis le statut, les preuves, l'hébergement et l'invitation, dans cet ordre", () => {
    expect(VISITEUR).toMatch(/<h1 /);
    const ordre = ['data-testid="presentation-statut"', 'id="preuves"', 'id="hebergement"', 'id="suite-titre"'].map((m) =>
      VISITEUR.indexOf(m),
    );
    expect(ordre.every((i) => i > 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
  });

  it("aucun code de lot ou de ligne, aucun chemin du code, aucune empreinte, aucune adresse d'infrastructure", () => {
    expect(texte).not.toMatch(/\b[A-FKR]\d{1,2}\b/);
    expect(texte).not.toMatch(/\bP\d+(\.\d+)?\b/);
    expect(texte).not.toMatch(/\b(apps|packages|services|docs|lib|scripts)\/[\w.-]+/);
    expect(texte).not.toContain(SHA);
    expect(texte).not.toMatch(/railway\.app|DATABASE_URL|europe-west4|schema_migration|scheduler_lease/);
    expect(texte).not.toMatch(/document de couverture|dépôt|\bdogfooding\b/i);
  });

  it("aucun journal de chantier : ni quota, ni coût, ni coupure, ni service supprimé", () => {
    expect(texte).not.toMatch(/quota|offre gratuite|\$|octobre|supprimé le|aucune éprouvée/i);
  });

  it("une vitrine, pas un dossier : moins de 700 mots", () => {
    expect(texte.split(/\s+/).length).toBeLessThan(700);
  });

  it("un lien vers le dossier technique ; des repères de test uniques pour chaque rangée d'actions", () => {
    expect(VISITEUR).toMatch(/<a [^>]*href="\/presentation\/dossier"/);
    for (const id of ["presentation-demo", "presentation-demo-top", "presentation-demo-fin", "presentation-login"]) {
      expect(VISITEUR.split(`data-testid="${id}"`).length - 1, id).toBe(1);
    }
    const connecte = renderToStaticMarkup(<Landing user={ADMIN} />);
    expect(connecte.split('data-testid="presentation-console"').length - 1).toBe(1);
    expect(connecte).not.toContain("presentation-demo");
  });

  it("le pied de page garde l'attribution GeoIP et ne renvoie plus à des conditions de vente", () => {
    expect(VISITEUR).not.toContain("/legal/cgv");
    expect(VISITEUR).toMatch(/<a [^>]*href="\/legal\/cgu"/);
  });
});

describe("le bandeau de la session de démonstration", () => {
  const html = renderToStaticMarkup(<BandeauDemo />);

  it("dit la démo et la lecture seule, propose trois pistes, et ramène à la présentation", () => {
    expect(lisible(html)).toContain("Démo · lecture seule · données de démonstration");
    const liens = [...html.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => [m[1], lisible(m[2])]);
    expect(liens).toHaveLength(4);
    expect(liens.at(-1)).toEqual(["/presentation", "← Présentation"]);
    expect(html).toContain('role="note"');
  });
});
