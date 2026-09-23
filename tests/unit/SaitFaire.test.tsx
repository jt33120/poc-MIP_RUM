// P**.4 — La partie 2 de la vitrine, rendue (plan § 8.2, PS7 à PS9 ; recette TP3 et
// TP4 du § 8.5 pour la page elle-même).
//
// Ce que ces tests tiennent, en rendu SSR réel (`renderToStaticMarkup`) :
//   - PS7 : une carte par entrée, au verdict LU dans le document et écrit une fois,
//     « Limites : » puis une puce par identifiant, sa pastille en tête, sa phrase
//     entière — rien de replié ; ni D12 ni D14 nulle part dans la partie ; le renvoi
//     « (voir R3) » mène à une ancre qui existe dans « Ce qui reste » ;
//   - V-E : une case par capacité, une légende qui écrit chaque nombre et son
//     verdict, un `role="img"` qui dit la même chose, une alternative textuelle ;
//     aucune teinte de verdict de mesure (vert, ambre, rouge) ;
//   - PS8 : les quatre énoncés ;
//   - PS9 : l'en-tête et la phrase exacts, aucune cellule « rapporté (prudence) »,
//     rien sur Datadog, des sources qui existent dans le dépôt.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CouvertureBarre } from "@/components/presentation/CouvertureBarre";
import { EN_TETE_EKARA, POSITIONNEMENT, Positionnement } from "@/components/presentation/Positionnement";
import { Reste } from "@/components/presentation/Reste";
import { SaitFaire, ancreDuPoint } from "@/components/presentation/SaitFaire";
import { CAPACITES, RELEVE, SHA, VERDICT_LABEL, compte } from "@/lib/couverture";
import { DEPLOYEES_INERTES, lireFichierCite } from "@/lib/couverture-controle";
import { CATEGORIELLE, RATING_HEX } from "@/lib/palette";
import { POINTS_RESTE } from "@/lib/presentation-reste";
import { CARTES, METHODE, repartitionCouverture } from "@/lib/presentation-sait-faire";
import { idTitre } from "@/lib/presentation-parties";

const RACINE = join(__dirname, "..", "..");

/** Texte lisible : balises retirées, entités et espaces insécables normalisés. */
const texte = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Les `<article>` de la partie, dans l'ordre (ils ne s'imbriquent pas). */
const articles = (html: string) =>
  html
    .split("<article")
    .slice(1)
    .map((s) => `<article${s.slice(0, s.indexOf("</article>"))}</article>`);

const PARTIE = renderToStaticMarkup(<SaitFaire />);

describe("la partie 2 — titre, chapeau, ordre des blocs", () => {
  it("section #sait-faire, titre h2 exact, chapeau du plan", () => {
    expect(PARTIE).toContain(`<section id="sait-faire" aria-labelledby="${idTitre("sait-faire")}"`);
    expect(texte(PARTIE)).toContain("Ce qu'il sait faire");
    expect(texte(PARTIE)).toContain(
      "Ne figurent ici que les capacités que le document de couverture classe « déployé, non éprouvé » : le code est en service et ses tests passent, mais il n'a jamais rencontré de données réellement ingérées. Aucune capacité n'a encore de meilleur verdict. Chacune est donnée avec sa limite.",
    );
  });

  it("barre de couverture, puis les capacités, la méthode et le positionnement ; h3 sous le h2, h4 pour les cartes", () => {
    const ordre = ["couverture-barre", "Les capacités", "Une façon de compter", "Où se situe ce POC"].map((m) =>
      PARTIE.indexOf(m),
    );
    expect(ordre.every((i) => i > 0)).toBe(true);
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect([...PARTIE.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map((m) => texte(m[1]))).toEqual([
      "Les capacités",
      "Une façon de compter",
      "Où se situe ce POC",
    ]);
    expect(PARTIE.match(/<h4 /g)).toHaveLength(CARTES.length);
  });
});

describe("PS7 — les cartes rendues (pendant unitaire de TP3)", () => {
  const cartes = articles(PARTIE);

  it("une carte par entrée, dans l'ordre, au verdict du document écrit une seule fois", () => {
    expect(cartes).toHaveLength(CARTES.length);
    cartes.forEach((html, i) => {
      const c = CARTES[i];
      expect(html).toContain(`data-testid="capacite" data-carte="${c.id}" data-verdict="deploye_non_eprouve"`);
      expect(html.split(VERDICT_LABEL.deploye_non_eprouve).length - 1, c.id).toBe(1);
      expect(texte(html)).toContain(texte(c.titre));
      expect(texte(html)).toContain(texte(c.faitQuoi));
      expect(html.split("Limites :").length - 1, c.id).toBe(1);
    });
  });

  it("une puce par identifiant, pastille en tête puis la phrase entière ; rien de replié", () => {
    cartes.forEach((html, i) => {
      const c = CARTES[i];
      const puces = [...html.matchAll(/<li data-testid="capacite-limite" data-id="([A-Z]\d+)"[^>]*>(.*?)<\/li>/g)];
      expect(puces.map((m) => m[1]), c.id).toEqual(c.limites.map((l) => l.id));
      puces.forEach((m, j) => {
        const pastille = /^<span[^>]*>([^<]+)<\/span>/.exec(m[2]);
        expect(pastille?.[1], `${c.id} ${m[1]}`).toBe(m[1]);
        expect(texte(m[2].slice(pastille![0].length)), `${c.id} ${m[1]}`).toBe(texte(c.limites[j].texte));
      });
      expect(html).not.toMatch(/<details|voir plus/i);
    });
  });

  it("toutes les lignes « déployé, non éprouvé » sauf les inertes, une fois chacune, dont A4", () => {
    const ids = [...PARTIE.matchAll(/data-testid="capacite-limite" data-id="([A-Z]\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(compte("deploye_non_eprouve") - DEPLOYEES_INERTES.length);
    expect(ids).toContain("A4");
  });

  it("TP4, côté partie 2 : ni D12 ni D14, ni en pastille ni dans le texte", () => {
    for (const id of DEPLOYEES_INERTES) {
      expect(PARTIE).not.toContain(`data-id="${id}"`);
      expect(texte(PARTIE)).not.toMatch(new RegExp(`\\b${id}\\b`));
    }
  });

  it("une colonne à 390 px, deux à 768, trois à 1440", () => {
    expect(PARTIE).toContain('class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"');
  });

  it("un renvoi « (voir R3) » est un lien vers la carte de ce point, qui existe dans « Ce qui reste »", () => {
    const renvois = [...new Set(CARTES.flatMap((c) => c.limites).flatMap((l) => [...l.texte.matchAll(/\(voir (R\d+)\)/g)].map((m) => m[1])))];
    expect(renvois).toEqual(["R3"]); // A6 : le branchement dans la CI d'un client
    const reste = renderToStaticMarkup(<Reste />);
    for (const id of renvois) {
      const titre = POINTS_RESTE.find((p) => p.id === id)!.titre;
      expect(PARTIE).toContain(`<a href="#${ancreDuPoint(id)}" title="Ce qui reste : ${titre.replace(/'/g, "&#x27;")}"`);
      expect(reste, `${id} : ancre absente de Reste.tsx`).toContain(`id="${ancreDuPoint(id)}"`);
    }
    // Le texte lu reste celui du plan.
    const a6 = /<li data-testid="capacite-limite" data-id="A6"[^>]*>(.*?)<\/li>/.exec(PARTIE)?.[1] ?? "";
    expect(texte(a6)).toContain("n'est pas fait (voir R3).");
  });
});

describe("V-E — la barre de couverture", () => {
  const html = renderToStaticMarkup(<CouvertureBarre />);
  const parts = repartitionCouverture();

  it("une case par capacité, dans une figure `role=img` qui dit les décomptes", () => {
    expect(html.match(/<rect /g)).toHaveLength(CAPACITES.length);
    const label = /<svg role="img" aria-label="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(texte(label)).toContain(`Barre de couverture du ${RELEVE} : ${CAPACITES.length} capacités`);
    for (const p of parts) expect(texte(label)).toContain(`${p.nombre} ${p.libelle}`);
  });

  it("la légende écrit chaque nombre et son verdict, dans l'ordre du dessin", () => {
    const legende = /<ul data-testid="couverture-legende"[^>]*>(.*?)<\/ul>/.exec(html)?.[1] ?? "";
    const items = [...legende.matchAll(/<li[^>]*>(.*?)<\/li>/g)].map((m) => texte(m[1]));
    expect(items).toEqual(parts.map((p) => `${p.nombre} ${p.libelle}`));
    expect(items[0]).toBe(`${compte("deploye_non_eprouve")} déployées, non éprouvées`);
  });

  it("l'alternative textuelle : une ligne par groupe dessiné, relevé et commit en légende", () => {
    const alt = /<details[^>]*data-testid="alternative"[^>]*>(.*?)<\/details>/.exec(html)?.[1] ?? "";
    expect(texte(alt)).toContain(`Capacités du document de couverture par verdict, relevé du ${RELEVE} sur ${SHA}`);
    expect(alt).toContain('<th scope="col"');
    const lignes = [...alt.matchAll(/<tr[^>]*><th scope="row"[^>]*>([^<]+)<\/th><td[^>]*>([^<]+)<\/td><\/tr>/g)];
    expect(lignes.map((m) => [texte(m[1]), Number(texte(m[2]))])).toEqual(
      parts.map((p) => [VERDICT_LABEL[p.verdict], p.nombre]),
    );
  });

  it("des teintes catégorielles, jamais celles d'un verdict de mesure", () => {
    const teintes = new Set([...html.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]));
    expect(teintes.size).toBe(parts.length);
    for (const t of teintes) {
      expect(CATEGORIELLE).toContain(t);
      expect(Object.values(RATING_HEX)).not.toContain(t);
    }
    expect(html).not.toMatch(/\b(bg|text|fill)-(good|warn|bad)\b/);
  });
});

describe("PS8 — une façon de compter, rendue", () => {
  it("les quatre énoncés, l'énoncé en gras puis son explication", () => {
    const bloc = /<div data-testid="methode"[^>]*>(.*?)<\/ul><\/div>/.exec(PARTIE)?.[1] ?? "";
    const items = [...bloc.matchAll(/<li[^>]*><strong[^>]*>([^<]+)<\/strong>(.*?)<\/li>/g)];
    expect(items.map((m) => [texte(m[1]), texte(m[2])])).toEqual(METHODE.map((e) => [texte(e.titre), texte(e.texte)]));
  });
});

describe("PS9 — où se situe ce POC", () => {
  const html = renderToStaticMarkup(<Positionnement />);
  const lu = texte(html);

  it("en-tête de colonne et phrase sous la table, textes exacts du plan", () => {
    expect(EN_TETE_EKARA).toBe("IP-Label Ekara, d'après ses pages publiques consultées en septembre 2026");
    expect([...html.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => texte(m[1]))).toEqual([
      "Critère",
      EN_TETE_EKARA,
      "Ce POC",
    ]);
    expect(lu).toContain("Cette table compare ce qui est publié, pas ce qui a été essayé : nous n'avons pas utilisé Ekara.");
  });

  it("quatre critères, dans l'ordre ; la colonne Ekara ne dit que « documenté »", () => {
    const lignes = [...html.matchAll(/<th scope="row"[^>]*>([^<]+)<\/th><td[^>]*>([^<]+)<\/td><td[^>]*>([^<]+)<\/td>/g)];
    expect(lignes.map((m) => texte(m[1]))).toEqual([
      "Découpage par opérateur et type de réseau",
      "Robots synthétiques rapprochés du RUM",
      "Extension navigateur pour postes gérés",
      "Hébergement en UE",
    ]);
    for (const m of lignes) expect(texte(m[2])).toMatch(/^Documenté( |$)/);
    expect(lignes.map((m) => texte(m[3]))).toEqual(POSITIONNEMENT.map((l) => l.poc));
  });

  it("aucune cellule « rapporté (prudence) », rien sur Datadog, aucun superlatif", () => {
    expect(lu).not.toMatch(/rapporté|prudence|non repris|datadog/i);
    expect(lu).not.toMatch(/meilleur|mieux|plus complet|leader|seul du marché/i);
    // Le SDK mobile natif (source « rapporté (prudence) ») n'est pas un critère.
    expect(lu).not.toMatch(/iOS|Android/);
  });

  it("chaque source existe dans le dépôt, avec les lignes citées", () => {
    for (const l of POSITIONNEMENT) {
      for (const s of [l.sources.ekara, ...l.sources.poc]) {
        const cite = lireFichierCite(s);
        expect(cite, s).not.toBeNull();
        const chemin = join(RACINE, cite!.chemin);
        expect(existsSync(chemin), s).toBe(true);
        expect(readFileSync(chemin, "utf8").split("\n").length, s).toBeGreaterThanOrEqual(cite!.fin);
      }
    }
  });

  it("la table défile dans un conteneur positionné, première colonne fixée", () => {
    expect(html).toMatch(/<div class="relative [^"]*overflow-x-auto[^"]*"><table /);
    expect(html.match(/<th scope="(col|row)" class="sticky left-0/g)).toHaveLength(1 + POSITIONNEMENT.length);
  });
});
