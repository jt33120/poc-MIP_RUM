// P**.0 — La vitrine ne dit rien que le document de couverture ne dise.
//
// Le document (docs/RUM_PARITY_STATUS.md) est extrait par
// scripts/couverture-extraire.mjs vers apps/console/lib/couverture.generated.json,
// que lit lib/couverture.ts. Ce fichier vérifie :
//   0. que l'extracteur découpe les cellules comme le document les écrit ;
//   1. que le JSON versionné EST l'extraction du document d'aujourd'hui ;
//   2. que les décomptes calculés égalent ceux que le document écrit en toutes lettres ;
//   3. et 4. que les contrôles de provenance des cartes nomment ce qui est faux
//      (branchés sur les vraies cartes par P**.4 et P**.5) ;
//   5. que le lexique de la vitrine n'affirme ni souveraineté, ni complétude, ni effet sur les ventes ;
//   6. qu'aucun décompte de couverture n'est tapé en dur dans un composant.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAPACITES,
  RELEVE,
  SHA,
  TESTS_SQL,
  TESTS_UNITAIRES,
  VERDICTS,
  compte,
  parFamille,
} from "../../apps/console/lib/couverture";
import {
  verifierCartes,
  verifierReste,
  type CarteCapacite,
  type ContexteControle,
  type PointReste,
} from "../../apps/console/lib/couverture-controle";
import { GLOSSARY } from "../../apps/console/lib/glossary";
import {
  DOCUMENT,
  SORTIE,
  VERDICTS as VERDICTS_EXTRACTEUR,
  cellules,
  extraireCouverture,
  serialiser,
} from "../../scripts/couverture-extraire.mjs";

const RACINE = join(__dirname, "..", "..");
const CONSOLE = join(RACINE, "apps/console");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const DOC = lire(DOCUMENT);
const FIXTURE = lire("tests/fixtures/couverture-cellules.md");

describe("0 — l'extracteur découpe les cellules comme le document les écrit", () => {
  it("un tube dans du code ou échappé ne sépare pas deux colonnes", () => {
    const ligne = FIXTURE.split("\n").find((l) => l.startsWith("| A1 "))!;
    const c = cellules(ligne);
    expect(c).toHaveLength(5);
    expect(c[3]).toBe('`grep -E "a|b" fichier.ts` ; tests `x.test.ts`');
    expect(c[4]).toBe("Un tube échappé | ne sépare rien ; `c|d` non plus.");
  });

  it("extrait la fixture entière : relevé, décomptes, capacités numérotées, rien hors du § 4", () => {
    const x = extraireCouverture(FIXTURE);
    expect(x.releve).toBe("03/03/2026");
    expect(x.sha).toBe("abc1234");
    expect(x.testsUnitaires).toEqual({ fichiers: 12, tests: 1234 });
    expect(x.testsSql).toEqual({ fichiers: 3, tests: 45 });
    expect(x.capacites.map((c: { id: string }) => c.id)).toEqual(["A1", "A2"]);
    const numeroA1 = FIXTURE.split("\n").findIndex((l) => l.startsWith("| A1 ")) + 1;
    expect(x.capacites[0]).toMatchObject({ famille: "Cellules piégées", verdict: "deploye_non_eprouve", ligne: numeroA1 });
  });

  it("une ligne à six cellules fait échouer l'extraction avec son numéro", () => {
    const lignes = FIXTURE.split("\n");
    const apres = lignes.findIndex((l) => l.startsWith("| A2 "));
    lignes.splice(apres + 1, 0, "| A3 | Six | `non_commence` | — | Une | de trop |");
    expect(() => extraireCouverture(lignes.join("\n"))).toThrow(`${DOCUMENT}:${apres + 2} — A3 : 6 cellules trouvées, 5 attendues`);
  });

  it("un verdict inconnu fait échouer l'extraction : un humain décide", () => {
    const texte = FIXTURE.replace("`non_commence`", "`eprouve_sur_donnee_reelle`");
    expect(() => extraireCouverture(texte)).toThrow("A2 : verdict inconnu « eprouve_sur_donnee_reelle »");
  });

  it("les sept verdicts de l'extracteur sont ceux du § 1 du document, et ceux du type", () => {
    const section = DOC.slice(DOC.indexOf("## 1."), DOC.indexOf("## 2."));
    const duDocument = [...section.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1]);
    expect(duDocument).toEqual(VERDICTS_EXTRACTEUR);
    expect([...VERDICTS]).toEqual(VERDICTS_EXTRACTEUR);
  });
});

describe("1 — le JSON versionné est l'extraction du document d'aujourd'hui", () => {
  it("aucun écart", () => {
    const attendu = serialiser(extraireCouverture(DOC));
    const versionne = lire(SORTIE);
    expect(versionne === attendu, `${SORTIE} n'est plus l'extraction de ${DOCUMENT} : relancer \`node scripts/couverture-extraire.mjs\``).toBe(true);
  });
});

describe("2 — les décomptes calculés sont ceux que le document écrit", () => {
  const section4 = DOC.slice(DOC.indexOf("## 4."));

  it("le nombre de capacités", () => {
    const total = Number(/\*\*(\d+) capacités\*\*/.exec(section4)![1]);
    expect(CAPACITES.length).toBe(total);
    expect(CAPACITES.length).toBe(49); // relevé du 18/09/2026 ; un nouveau relevé met à jour ce repère
  });

  it("la répartition des verdicts", () => {
    const phrase = section4.slice(section4.indexOf("Répartition des verdicts"), section4.indexOf("Le verdict `en_revue`"));
    const ecrits = Object.fromEntries([...phrase.matchAll(/`(\w+)` \*\*(\d+)\*\*/g)].map((m) => [m[1], Number(m[2])]));
    for (const v of VERDICTS) expect(compte(v), v).toBe(ecrits[v] ?? 0);
  });

  it("la répartition par famille, dans l'ordre du document", () => {
    const phrase = section4.slice(section4.indexOf("en six familles"), section4.indexOf("Répartition des verdicts"));
    const ecrits = [...phrase.matchAll(/\((\d+)\)/g)].map((m) => Number(m[1]));
    expect(parFamille().map((f) => f.capacites.length)).toEqual(ecrits);
  });

  it("date, commit et nombres de tests viennent du relevé", () => {
    expect(DOC.split("\n")[2]).toContain(SHA);
    expect(RELEVE).toBe("18/09/2026");
    expect(TESTS_UNITAIRES).toEqual({ fichiers: 168, tests: 2436 });
    expect(TESTS_SQL).toEqual({ fichiers: 28, tests: 413 });
  });
});

// Un fichier cité l'est depuis la racine du dépôt ou depuis la console (le plan
// écrit `components/…` pour `apps/console/components/…`).
function lignesDe(chemin: string): number | null {
  for (const base of [RACINE, CONSOLE]) {
    const p = join(base, chemin);
    if (existsSync(p)) return readFileSync(p, "utf8").split("\n").length;
  }
  return null;
}
const CTX: ContexteControle = { capacites: CAPACITES, lignesDocument: DOC.split("\n").length, lignesDe };

// Cartes de fixture sur les VRAIES lignes du document : la répartition du § 8.2
// (K1–K14), réduite à ses identifiants. Les cartes réelles arrivent avec P**.4.
const REPARTITION: Record<string, string[]> = {
  K1: ["A1"], K2: ["A2"], K3: ["A7", "A8", "A9", "A10"], K4: ["A3"], K5: ["A5", "A6"],
  K6: ["B1", "B2", "B3", "B4"], K7: ["B5", "B6", "B7", "B8"], K8: ["B9"],
  K9: ["A4", "C5", "C6"], K10: ["C7", "C8"], K11: ["D1", "D2", "D3", "D4"], K12: ["D5"], K13: ["D6"],
  K14: ["E1", "E2", "E3"],
};
function cartesFixture(): CarteCapacite[] {
  return Object.entries(REPARTITION).map(([id, ids]) => ({
    id,
    titre: `Carte ${id}`,
    faitQuoi: "fixture",
    limites: ids.map((i) => ({ id: i, texte: `limite de ${i}` })),
    sources: ids.map((i) => ({ ligne: i })),
  }));
}
const RESTE: PointReste[] = [
  { id: "R-fixture", titre: "Déployé, inerte", manque: "—", debloque: "—", decide: "—", sources: ["D12", "D14"] },
];
const carte = (cartes: CarteCapacite[], id: string) => cartes.find((c) => c.id === id)!;

describe("3 — les cartes de « Ce qu'il sait faire » ne dépassent pas le document", () => {
  it("la répartition du plan couvre exactement les 34 lignes « déployé, non éprouvé »", () => {
    expect(verifierCartes(cartesFixture(), RESTE, CTX)).toEqual([]);
  });

  it("3a — retirer la puce A4 de K9 nomme A4", () => {
    const cartes = cartesFixture();
    carte(cartes, "K9").limites = carte(cartes, "K9").limites.filter((l) => l.id !== "A4");
    const erreurs = verifierCartes(cartes, RESTE, CTX);
    expect(erreurs).toContain("identifiants « deploye_non_eprouve » absents des cartes : A4");
  });

  it("3a — une ligne d'un autre verdict, un doublon, un inerte oublié sont refusés", () => {
    const cartes = cartesFixture();
    carte(cartes, "K11").limites.push({ id: "D7", texte: "sauvegardes" });
    carte(cartes, "K12").limites.push({ id: "D1", texte: "doublon" });
    const erreurs = verifierCartes(cartes, [], CTX);
    expect(erreurs).toContain("K11 : D7 est « non_commence », pas « deploye_non_eprouve »");
    expect(erreurs).toContain("D1 figure dans deux cartes : K11 et K12");
    expect(erreurs).toContain("D12 (déployée, inerte) doit figurer dans « Ce qui reste »");
  });

  it("3b — ajouter { ligne: D7 } aux sources de K11 nomme K11 et D7", () => {
    const cartes = cartesFixture();
    carte(cartes, "K11").sources.push({ ligne: "D7" });
    const erreurs = verifierCartes(cartes, RESTE, CTX);
    expect(erreurs).toContain("K11 : source D7 (« non_commence ») — une réserve d'un autre verdict va en « Ce qui reste »");
  });

  it("3b — un passage qui tombe sur une ligne de capacité est traité comme cette ligne", () => {
    const d7 = CAPACITES.find((c) => c.id === "D7")!;
    const cartes = cartesFixture();
    carte(cartes, "K11").sources.push({ passage: d7.ligne }, { passage: 99_999 }, { fichier: "fichier/absent.ts:3" }, { fichier: "README.md:999999" });
    const erreurs = verifierCartes(cartes, RESTE, CTX);
    expect(erreurs).toContain(`K11 : passage :${d7.ligne} est la ligne D7 (« non_commence »)`);
    expect(erreurs.some((e) => e.startsWith("K11 : passage :99999 hors du document"))).toBe(true);
    expect(erreurs).toContain("K11 : fichier introuvable : fichier/absent.ts");
    expect(erreurs.some((e) => e.startsWith("K11 : README.md:999999 : le fichier n'a que"))).toBe(true);
    // Un passage hors table et un fichier réel, cité dans ses bornes, passent.
    const ok = cartesFixture();
    carte(ok, "K2").sources.push({ passage: 1 }, { fichier: "components/presentation/Specs.tsx:1-3" });
    expect(verifierCartes(ok, RESTE, CTX)).toEqual([]);
  });

  it("3c — une puce par identifiant cité, et chaque puce a un texte", () => {
    const cartes = cartesFixture();
    carte(cartes, "K5").sources = [{ ligne: "A5" }];
    carte(cartes, "K1").limites[0].texte = "  ";
    const erreurs = verifierCartes(cartes, RESTE, CTX);
    expect(erreurs).toContain("K5 : puce sans source { ligne } : A6");
    expect(erreurs).toContain("K1 : la puce A1 n'a pas de texte");
  });

  it.todo("3 — sur les vraies cartes de lib/presentation-sait-faire.ts (livrées par P**.4)");
});

describe("4 — chaque point de « Ce qui reste » cite une source qui existe", () => {
  it("identifiant du document ou fichier du dépôt, dans ses bornes", () => {
    const points: PointReste[] = [
      { ...RESTE[0] },
      { id: "R2", titre: "t", manque: "m", debloque: "d", decide: "x", sources: ["D7", "docs/CONFORMITE.md:1"] },
    ];
    expect(verifierReste(points, CTX)).toEqual([]);
    const fautifs: PointReste[] = [
      { id: "R3", titre: "t", manque: "m", debloque: "d", decide: "x", sources: [] },
      { id: "R4", titre: "t", manque: "m", debloque: "d", decide: "x", sources: ["Z9", "docs/absent.md:3"] },
    ];
    expect(verifierReste(fautifs, CTX)).toEqual([
      "R3 : aucune source",
      "R4 : Z9 n'est pas une ligne du document",
      "R4 : fichier introuvable : docs/absent.md",
    ]);
  });

  it.todo("4 — sur les vrais points de lib/presentation-reste.ts (livrés par P**.5)");
});

// Fichiers dont le texte est la vitrine.
function fichiersVitrine(): string[] {
  const presentation = readdirSync(join(CONSOLE, "components/presentation"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `apps/console/components/presentation/${f}`);
  const libs = readdirSync(join(CONSOLE, "lib"))
    .filter((f) => /^presentation-.*\.ts$/.test(f))
    .map((f) => `apps/console/lib/${f}`);
  return [...presentation, ...libs, "apps/console/components/AddClientCarousel.tsx"];
}

describe("5 — le lexique de la vitrine", () => {
  const INTERDITS: RegExp[] = [
    /\brobuste/i,
    /\bcomplète?s?\b/i,
    /100\s?%/,
    /prêt pour la production/i,
    /temps réel/i,
    /\bcertifié/i,
    /\bsouverain\b/i,
    /\bconverti(t|r|ssent)?\b/i,
    /\bconversion\b/i,
    /chiffre d'affaires/i,
  ];
  // « souveraine » n'est admis que dans la phrase exacte de PS4 (§ 8.2).
  const PHRASE_ADMISE = "Ce POC n'est pas une offre souveraine.";

  function fautes(nom: string, texte: string): string[] {
    const sortie: string[] = [];
    texte.split("\n").forEach((ligne, i) => {
      const sansPhrase = ligne.split(PHRASE_ADMISE).join("");
      for (const motif of [...INTERDITS, /\bsouveraine\b/i]) {
        if (motif.test(sansPhrase)) sortie.push(`${nom}:${i + 1} ${motif} — ${ligne.trim().slice(0, 90)}`);
      }
    });
    return sortie;
  }

  it("aucun mot qui promet plus que le document", () => {
    const trouvees = fichiersVitrine().flatMap((f) => fautes(f, lire(f)));
    expect(trouvees).toEqual([]);
  });

  it("ni dans la bulle « RUM » du glossaire, tous champs compris", () => {
    const { term, stack, business } = GLOSSARY.rum;
    expect([...fautes("rum.term", term), ...fautes("rum.stack", stack), ...fautes("rum.business", business)]).toEqual([]);
  });
});

describe("6 — aucun décompte de couverture tapé en dur", () => {
  it("ni 49 ni 34 dans les composants de la vitrine : ils viennent de lib/couverture.ts", () => {
    const trouves = fichiersVitrine()
      .filter((f) => f.includes("/components/presentation/"))
      .flatMap((f) =>
        lire(f).split("\n").flatMap((l, i) => (/\b(49|34)\b/.test(l) ? [`${f}:${i + 1} ${l.trim().slice(0, 90)}`] : [])),
      );
    expect(trouves).toEqual([]);
  });
});
