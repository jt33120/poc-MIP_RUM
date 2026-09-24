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
  TESTS_SQL_VERTS,
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
import { POINTS_RESTE } from "../../apps/console/lib/presentation-reste";
import { CARTES } from "../../apps/console/lib/presentation-sait-faire";
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
    expect(x.testsSql).toEqual({ fichiers: 3, tests: 45, ignores: { fichiers: 1, tests: 4 } });
    expect(x.capacites.map((c: { id: string }) => c.id)).toEqual(["A1", "A2"]);
    const numeroA1 = FIXTURE.split("\n").findIndex((l) => l.startsWith("| A1 ")) + 1;
    expect(x.capacites[0]).toMatchObject({ famille: "Cellules piégées", verdict: "deploye_non_eprouve", ligne: numeroA1 });
  });

  it("le décompte unitaire vient de la ligne de la commande vitest, pas d'un journal cité", () => {
    // La fixture cite d'abord « **22 fichiers, 314 tests verts » : il ne doit pas être retenu.
    expect(extraireCouverture(FIXTURE).testsUnitaires).toEqual({ fichiers: 12, tests: 1234 });
  });

  it("les tests SQL ignorés sont lus sur la ligne du total ; sans eux, ou sans suite verte, l'extraction échoue", () => {
    const numeroSql = FIXTURE.split("\n").findIndex((l) => l.includes("au total")) + 1;
    // Ne rien dire des ignorés n'est pas en déclarer zéro.
    const sansIgnores = FIXTURE.replace(", dont 1 fichier et 4 tests ignorés : un banc", "");
    expect(() => extraireCouverture(sansIgnores)).toThrow(`${DOCUMENT}:${numeroSql} — décompte des tests SQL ignorés introuvable`);
    // Une suite qui n'est pas dite verte : ses verts ne se déduisent pas du total.
    const rouge = FIXTURE.replace("**vert** —", "**rouge** —");
    expect(() => extraireCouverture(rouge)).toThrow(`${DOCUMENT}:${numeroSql} — la suite SQL n'y est pas dite **vert**`);
    // Le pluriel se lit aussi.
    const pluriel = FIXTURE.replace("dont 1 fichier et 4 tests", "dont 2 fichiers et 13 tests");
    expect(extraireCouverture(pluriel).testsSql.ignores).toEqual({ fichiers: 2, tests: 13 });
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
    expect(CAPACITES.length).toBe(49); // relevé du 23/09/2026 ; un nouveau relevé met à jour ce repère
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
    // Repères du relevé du 23/09/2026 sur 8a5f3d1 (P**.10) : ils ne changent qu'avec un nouveau relevé.
    expect(RELEVE).toBe("23/09/2026");
    expect(SHA).toBe("8a5f3d1");
    expect(TESTS_UNITAIRES).toEqual({ fichiers: 266, tests: 3815 });
    expect(TESTS_SQL).toEqual({ fichiers: 45, tests: 637, ignores: { fichiers: 2, tests: 13 } });
    // Revue de fin de vague 7 : les verts sont le total moins les ignorés (les deux bancs).
    expect(TESTS_SQL_VERTS).toBe(624);
    expect(compte("deploye_non_eprouve")).toBe(35); // 34 au 18/09 : F2 est passée « déployé, non éprouvé »
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
// (K1–K14), réduite à ses identifiants ; les cartes réelles (P**.4) passent le même
// contrôle à la fin de ce bloc. K15 n'est pas dans le plan : le relevé du 23/09/2026
// (P**.10) a fait passer F2 (« Vérifier les types ») à « déployé, non éprouvé », et
// la règle 1 du § 8.0 veut alors une carte pour elle ; ici, seul son identifiant
// compte.
const REPARTITION: Record<string, string[]> = {
  K1: ["A1"], K2: ["A2"], K3: ["A7", "A8", "A9", "A10"], K4: ["A3"], K5: ["A5", "A6"],
  K6: ["B1", "B2", "B3", "B4"], K7: ["B5", "B6", "B7", "B8"], K8: ["B9"],
  K9: ["A4", "C5", "C6"], K10: ["C7", "C8"], K11: ["D1", "D2", "D3", "D4"], K12: ["D5"], K13: ["D6"],
  K14: ["E1", "E2", "E3"],
  K15: ["F2"],
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
  it("la répartition du plan, plus K15, couvre exactement les lignes « déployé, non éprouvé »", () => {
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

  it("3a — D12 et D14, déployées mais inertes, sont refusées dans une carte", () => {
    const cartes = cartesFixture();
    carte(cartes, "K11").limites.push({ id: "D12", texte: "tickets" });
    carte(cartes, "K11").sources.push({ ligne: "D12" });
    expect(verifierCartes(cartes, RESTE, CTX)).toContain(
      "K11 : D12 est déployée mais inerte — elle va en « Ce qui reste », pas dans une carte",
    );
  });

  it("3c — un passage qui tombe sur une ligne de capacité exige sa puce", () => {
    const b2 = CAPACITES.find((c) => c.id === "B2")!;
    const cartes = cartesFixture();
    carte(cartes, "K8").sources.push({ passage: b2.ligne }); // B2 est dans K6, pas dans K8
    expect(verifierCartes(cartes, RESTE, CTX)).toContain("K8 : source sans puce de limite : B2");
  });

  it("3b — une source fichier doit citer une ligne, dans une plage non vide", () => {
    const cartes = cartesFixture();
    carte(cartes, "K2").sources.push({ fichier: "README.md" }, { fichier: "README.md:0" }, { fichier: "README.md:9-3" });
    const erreurs = verifierCartes(cartes, RESTE, CTX);
    for (const cite of ["README.md", "README.md:0", "README.md:9-3"]) {
      expect(erreurs).toContain(`K2 : ${cite} : une source fichier s'écrit « chemin:ligne » ou « chemin:début-fin »`);
    }
  });

  it("3 — sur les vraies cartes (P**.4) et les vrais points de « Ce qui reste » (P**.5)", () => {
    // Les trois contrôles d'un coup : identifiants (dont D12 et D14 dans
    // lib/presentation-reste.ts, et nulle part dans une carte), provenance de
    // chaque source, une puce par identifiant.
    expect(verifierCartes(CARTES, POINTS_RESTE, CTX)).toEqual([]);
    const puces = CARTES.flatMap((c) => c.limites.map((l) => l.id));
    expect(puces).toContain("A4");
    expect(puces.length).toBe(compte("deploye_non_eprouve") - 2); // toutes, sauf D12 et D14
  });
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
    // Un chemin sans numéro de ligne ne désigne rien de relisible.
    const sansLigne: PointReste[] = [{ id: "R5", titre: "t", manque: "m", debloque: "d", decide: "x", sources: ["docs/CONFORMITE.md"] }];
    expect(verifierReste(sansLigne, CTX)).toEqual([
      "R5 : docs/CONFORMITE.md : une source fichier s'écrit « chemin:ligne » ou « chemin:début-fin »",
    ]);
  });

  it("sur les vrais points de lib/presentation-reste.ts (P**.5) : R1 à R10, et chaque source existe", () => {
    expect(POINTS_RESTE.map((p) => p.id)).toEqual(["R1", "R2", "R3", "R4", "R5", "R6", "R7", "R8", "R9", "R10"]);
    expect(verifierReste(POINTS_RESTE, CTX)).toEqual([]);
    // Côté « Ce qui reste » du contrôle 3a : les déployées inertes y figurent. Sans
    // cartes, verifierCartes ne rend alors, pour elles, aucune erreur de ce genre.
    const inertesAbsentes = verifierCartes([], POINTS_RESTE, CTX).filter((e) => e.includes("doit figurer dans « Ce qui reste »"));
    expect(inertesAbsentes).toEqual([]);
  });
});

// Fichiers dont le texte est la vitrine : ses composants, ses contenus, la page
// elle-même et lib/specs.ts, qui fournit l'essentiel du texte public des Specs.
function fichiersVitrine(): string[] {
  const presentation = readdirSync(join(CONSOLE, "components/presentation"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `apps/console/components/presentation/${f}`);
  const libs = readdirSync(join(CONSOLE, "lib"))
    .filter((f) => /^presentation-.*\.ts$/.test(f))
    .map((f) => `apps/console/lib/${f}`);
  return [
    ...presentation,
    ...libs,
    "apps/console/components/AddClientCarousel.tsx",
    "apps/console/app/presentation/page.tsx",
    "apps/console/lib/specs.ts",
  ];
}

/**
 * Le texte tel qu'un lecteur le lit : entités et apostrophes typographiques
 * ramenées à leur caractère, espaces insécables à une espace. Sans cela,
 * `chiffre d&apos;affaires`, `100&nbsp;%` ou `temps&nbsp;réel` passeraient.
 */
export function normaliser(texte: string): string {
  return texte
    .replace(/&apos;|&#39;|&rsquo;|&lsquo;|[\u2018\u2019]/g, "'")
    .replace(/&nbsp;|&#160;|[\u00a0\u202f]/g, " ")
    .replace(/\{" "\}/g, " ");
}

// « souveraine » n'est admis que dans la phrase exacte de PS4 (§ 8.2).
const PHRASE_ADMISE = "Ce POC n'est pas une offre souveraine.";
// « anonyme » ne l'est que dans la puce D3 de K11, qui le dit comme une LIMITE de sa
// ligne : un événement totalement anonyme n'est rattachable à personne. Ailleurs, le
// mot promettait ce que le document refuse : le `visitor_id` est « un pseudonyme, pas
// une donnée anonyme » (RUM_PARITY_STATUS.md:266). Revue de fin de vague 7 : les Specs
// disaient « Sessions anonymes » et comptaient l'anonymat parmi les critères tenus.
const LIMITE_ANONYME_D3 = "un événement totalement anonyme n'est rattachable à personne.";
const INTERDITS: RegExp[] = [
  /\brobuste/i,
  /\bcompl[eè]t(e|s|es)?\b/i,
  /100\s?%/,
  /prêt pour la production/i,
  /temps réel/i,
  /\bcertifié/i,
  /\bsouverain(e|s|es)?\b/i,
  /\bconverti(t|r|ssent)?\b/i,
  /\bconversion\b/i,
  /chiffre d'affaires/i,
  /\banonym/i,
];

/**
 * Les fautes d'un texte, lu À PLAT : une phrase coupée par un retour à la ligne
 * (texte JSX indenté) se lit d'un seul tenant. Chaque faute porte le numéro de
 * la ligne où elle commence.
 */
function fautes(nom: string, texte: string): string[] {
  const debuts: number[] = [];
  let plat = "";
  for (const ligne of texte.split("\n")) {
    debuts.push(plat.length);
    plat += `${normaliser(ligne).trim()} `;
  }
  for (const admise of [PHRASE_ADMISE, LIMITE_ANONYME_D3]) plat = plat.split(admise).join(" ".repeat(admise.length));
  const ligneDe = (i: number) => debuts.filter((d) => d <= i).length;
  const sortie: string[] = [];
  for (const motif of INTERDITS) {
    for (const m of plat.matchAll(new RegExp(motif.source, `${motif.flags}g`))) {
      sortie.push(`${nom}:${ligneDe(m.index!)} ${motif} — ${plat.slice(Math.max(0, m.index! - 40), m.index! + 50).trim()}`);
    }
  }
  return sortie;
}

describe("5 — le lexique de la vitrine", () => {
  it("aucun mot qui promet plus que le document", () => {
    const trouvees = fichiersVitrine().flatMap((f) => fautes(f, lire(f)));
    expect(trouvees).toEqual([]);
  });

  it("ni dans la bulle « RUM » du glossaire, tous champs compris", () => {
    const { term, stack, business } = GLOSSARY.rum;
    expect([...fautes("rum.term", term), ...fautes("rum.stack", stack), ...fautes("rum.business", business)]).toEqual([]);
  });

  it("ne se contourne ni par une entité, ni par un retour à la ligne, ni par un accord", () => {
    const pieges = [
      "Le chiffre d&apos;affaires suit.",
      "Un chiffre d’affaires.",
      "Couverture 100&nbsp;%.",
      "En temps&nbsp;réel.",
      "Une mesure en temps\n        réel.",
      "Un relevé complet.",
      "Des hébergeurs souverains.",
      "Sessions anonymes",
      "poids, seuils, percentile, anonymat.",
    ];
    for (const p of pieges) expect(fautes("piège", p).length, p).toBeGreaterThan(0);
    // La phrase admise, écrite en JSX avec son entité, reste admise.
    expect(fautes("PS4", "<p>Ce POC n&apos;est pas une offre souveraine.</p>")).toEqual([]);
    // « souveraineté », « compléter » et « complètement » ne sont pas visés.
    expect(fautes("ok", "Rien ne change à la souveraineté ; mentions à compléter ; complètement.")).toEqual([]);
  });

  it("« anonyme » n'est admis que dans la puce D3, qui le dit comme une limite de sa ligne", () => {
    // La ligne D3 du document le dit en LIMITE : un tel événement n'est pas rattachable.
    const d3 = CAPACITES.find((c) => c.id === "D3")!;
    expect(d3.limite).toContain("Un événement totalement anonyme");
    expect(d3.limite).toContain("n'est pas rattachable");
    // La puce D3 de la vitrine reprend cette limite, mot pour mot sur ce point.
    const puce = CARTES.flatMap((c) => c.limites).find((l) => l.id === "D3")!;
    expect(puce.texte).toContain(LIMITE_ANONYME_D3);
    expect(fautes("K11", puce.texte)).toEqual([]);
    // Hors de cette phrase, le mot reste une faute, même dans la même puce.
    expect(fautes("piège", puce.texte.replace("totalement anonyme n'est", "anonyme est"))).not.toEqual([]);
  });
});

// Les décomptes de couverture que la vitrine affiche — le total des capacités et le
// nombre de chaque verdict — LUS dans lib/couverture.ts : un nouveau relevé met le
// motif à jour. (Revue de fin de vague 7 : il interdisait encore les littéraux 49 et
// 34, alors que la page affiche 35 capacités déployées.) Un décompte d'un seul chiffre
// ne se cherche pas dans du code — `mt-2`, `h-4`, `{1.5}` en contiennent partout — :
// seuls ceux de deux chiffres ou plus sont gardés. Un nombre collé à un tiret, à un
// point ou à une lettre (`py-14`, `0.35`, `12px`) est une classe ou une mesure, pas un
// décompte ; un point final de phrase ne l'excuse pas.
const DECOMPTES_GARDES = [...new Set([CAPACITES.length, ...VERDICTS.map((v) => compte(v))])]
  .filter((n) => n >= 10)
  .sort((a, b) => b - a);
const DECOMPTE_TAPE = new RegExp(`(?<![\\w.-])(?:${DECOMPTES_GARDES.join("|")})(?!\\w|\\.\\d)`);

describe("6 — aucun décompte de couverture tapé en dur", () => {
  it("le motif vient du document : le total et le décompte de chaque verdict, lus dans lib/couverture.ts", () => {
    expect(DECOMPTES_GARDES).toContain(CAPACITES.length);
    expect(DECOMPTES_GARDES).toContain(compte("deploye_non_eprouve"));
    // Il attrape un décompte écrit en toutes lettres, en fin de phrase comprise…
    expect(DECOMPTE_TAPE.test(`<p>${compte("deploye_non_eprouve")} capacités déployées</p>`)).toBe(true);
    expect(DECOMPTE_TAPE.test(`recensées : ${CAPACITES.length}.`)).toBe(true);
    // … pas une classe de mise en page, ni une décimale.
    expect(DECOMPTE_TAPE.test(`className="mt-${CAPACITES.length}"`)).toBe(false);
    expect(DECOMPTE_TAPE.test(`opacity={0.${compte("deploye_non_eprouve")}}`)).toBe(false);
  });

  it("aucun de ces décomptes dans les composants de la vitrine : ils viennent de lib/couverture.ts", () => {
    const trouves = fichiersVitrine()
      .filter((f) => f.includes("/components/presentation/"))
      .flatMap((f) =>
        lire(f).split("\n").flatMap((l, i) => (DECOMPTE_TAPE.test(l) ? [`${f}:${i + 1} ${l.trim().slice(0, 90)}`] : [])),
      );
    expect(trouves).toEqual([]);
  });
});
