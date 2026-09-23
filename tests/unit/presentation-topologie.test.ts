// P**.3 — Le chemin de la mesure (PS3) et l'hébergement (PS4) de la vitrine.
//
// Ce que ces tests tiennent :
//   - l'hébergement est LU dans les phrases de lib/legal.ts, pas retapé : si une
//     phrase cesse de se découper, le test le dit (et la vitrine montre la phrase
//     entière plutôt que d'inventer un morceau) ;
//   - la région de la console est celle que Vercel exécute (apps/console/vercel.json) ;
//   - « droit américain » et « les trois hébergeurs » disent ce que disent les Specs ;
//   - chaque date d'exploitation citée se lit encore dans docs/TOPOLOGIE_BACKEND.md et
//     dans le document de couverture — un nouveau relevé qui les change rougit ici ;
//   - le dessin tient dans ses boîtes (un texte SVG ne revient pas à la ligne).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HOSTS } from "../../apps/console/lib/legal";
import {
  ARIA_TOPOLOGIE,
  DROIT_HEBERGEURS,
  HEBERGEMENT,
  HEBERGEURS,
  INGEST_SUPPRIME_LE,
  LIAISONS,
  MIGRATIONS_CONSTATEES,
  PIECES,
  TOPOLOGIE_RELEVEE,
  lireHebergeur,
} from "../../apps/console/lib/presentation-topologie";
import { INFRA } from "../../apps/console/lib/specs";

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");

describe("PS4 — l'hébergement est lu dans lib/legal.ts, jamais retapé", () => {
  it("les trois phrases se découpent : société, infrastructure, région, ville, pays", () => {
    expect(HEBERGEURS.base).toMatchObject({
      phrase: HOSTS.data,
      societe: "Neon",
      marque: "Neon",
      infrastructure: "AWS",
      lieu: { region: "aws-eu-central-1", ville: "Francfort", pays: "Allemagne" },
    });
    expect(HEBERGEURS.console).toMatchObject({
      phrase: HOSTS.app,
      societe: "Vercel Inc.",
      marque: "Vercel",
      infrastructure: null,
      lieu: { region: "fra1", ville: "Francfort", pays: "Allemagne" },
    });
    expect(HEBERGEURS.railway).toMatchObject({
      phrase: HOSTS.backend,
      societe: "Railway Corp.",
      marque: "Railway",
      infrastructure: null,
      lieu: { region: "europe-west4", ville: "Amsterdam", pays: "Pays-Bas" },
    });
  });

  it("chaque morceau affiché est un extrait de sa phrase", () => {
    for (const h of Object.values(HEBERGEURS)) {
      for (const morceau of [h.societe, h.infrastructure, h.lieu?.region, h.lieu?.ville, h.lieu?.pays]) {
        if (morceau != null) expect(h.phrase, morceau).toContain(morceau);
      }
    }
  });

  it("une phrase qui ne se découpe plus n'invente rien : le lieu reste inconnu", () => {
    const h = lireHebergeur("Hébergeur X (quelque part en Europe)");
    expect(h.societe).toBe("Hébergeur X");
    expect(h.lieu).toBeNull();
    expect(h.infrastructure).toBeNull();
    // Sans parenthèse, la société est la phrase entière : rien n'est tronqué au jugé.
    expect(lireHebergeur("Sans parenthèse").societe).toBe("Sans parenthèse");
  });

  it("la région de la console est celle que Vercel exécute", () => {
    const vercel = JSON.parse(lire("apps/console/vercel.json")) as { regions: string[] };
    expect(vercel.regions).toContain(HEBERGEURS.console.lieu?.region);
  });

  it("« les trois hébergeurs » et « droit américain » : ce que disent les Specs", () => {
    expect(Object.keys(HOSTS)).toHaveLength(3);
    const souverainete = INFRA.flatMap((g) => g.lignes).find((l) => l.k === "Souveraineté");
    expect(souverainete?.v).toContain(`trois sociétés de droit ${DROIT_HEBERGEURS}`);
    for (const h of Object.values(HEBERGEURS)) expect(souverainete?.v).toContain(h.marque);
  });

  it("la table : une ligne par hébergeur, dans l'ordre de lib/legal.ts", () => {
    expect(HEBERGEMENT).toEqual([
      { piece: "Base de données", hebergeur: "Neon (sur AWS)", lieu: "Francfort, Allemagne (aws-eu-central-1)", droit: "américain" },
      { piece: "Console et collecteur", hebergeur: "Vercel Inc.", lieu: "Francfort, Allemagne (fra1)", droit: "américain" },
      { piece: "Travaux planifiés, serveur MCP", hebergeur: "Railway Corp.", lieu: "Amsterdam, Pays-Bas (europe-west4)", droit: "américain" },
    ]);
  });
});

describe("PS3 — le chemin de la mesure", () => {
  it("le libellé accessible est celui du plan, composé depuis les mêmes hébergeurs", () => {
    expect(ARIA_TOPOLOGIE).toBe(
      "Chemin de la mesure : du navigateur au collecteur de la console sur Vercel, puis à la base Neon à Francfort ; travaux planifiés et serveur MCP sur Railway à Amsterdam.",
    );
  });

  it("cinq pièces, reliées sans flèche du serveur MCP vers la base", () => {
    expect(PIECES.map((p) => p.id)).toEqual(["navigateur", "console", "base", "travaux", "mcp"]);
    const ids = new Set(PIECES.map((p) => p.id));
    for (const l of LIAISONS) {
      expect(ids.has(l.de), l.de).toBe(true);
      expect(ids.has(l.vers), l.vers).toBe(true);
    }
    expect(LIAISONS.some((l) => l.de === "mcp" && l.vers === "base")).toBe(false);
    expect(LIAISONS.find((l) => l.de === "navigateur")).toMatchObject({ vers: "console", libelle: "OTLP/HTTP JSON" });
  });

  it("chaque ligne de l'alternative a son hébergeur, sa région (sauf le poste du visiteur) et son rôle", () => {
    for (const p of PIECES) {
      expect(p.hebergeur.trim(), p.id).not.toBe("");
      expect(p.role.trim(), p.id).not.toBe("");
      if (p.id === "navigateur") expect(p.region).toBeNull();
      else expect(p.region, p.id).toMatch(/— .+, .+$/);
    }
    const texte = PIECES.flatMap((p) => [p.titre, p.hebergeur, p.region ?? ""]).join(" ");
    for (const mot of ["Vercel", "fra1", "Neon", "Railway"]) expect(texte).toContain(mot); // TP7
  });

  it("un texte SVG ne revient pas à la ligne : chaque ligne tient dans sa boîte", () => {
    // Boîtes de 262 unités, marge de 12 de chaque côté : 238 utiles. Titre en 13 gras,
    // lignes en 12 ; les polices de la CI Linux sont plus larges que celles de macOS.
    for (const p of PIECES) {
      expect(p.titre.length, p.titre).toBeLessThanOrEqual(28);
      for (const l of p.lignes) expect(l.length, l).toBeLessThanOrEqual(30);
    }
  });

  it("les faits d'exploitation cités se lisent encore dans leurs deux sources", () => {
    const topologie = lire("docs/TOPOLOGIE_BACKEND.md");
    const couverture = lire("docs/RUM_PARITY_STATUS.md");
    expect(topologie).toContain(`supprimé par l'opérateur le ${INGEST_SUPPRIME_LE}`);
    expect(couverture).toContain(`supprimé le ${INGEST_SUPPRIME_LE}`);
    expect(topologie).toContain(`(\`${MIGRATIONS_CONSTATEES.deploiement}\`)`);
    expect(topologie).toContain("migrations à jour");
    const [jour, mois] = MIGRATIONS_CONSTATEES.le.split("/");
    expect(couverture).toContain(`déploiement \`${MIGRATIONS_CONSTATEES.deploiement}\`, ${jour}/${mois}`);
    // Relevé par les API des hébergeurs : le 18/09 (Railway et Vercel), puis Railway seul (21/09, 23/09).
    const [j18, m18] = TOPOLOGIE_RELEVEE.railwayEtVercel.split("/");
    expect(couverture).toContain(`le ${j18}/${m18})`);
    expect(topologie).toContain("Vérifié le même jour\n> par l'API Railway");
    // Relevé Railway le plus récent : sa section existe dans TOPOLOGIE_BACKEND.md.
    expect(topologie).toContain(`## Relevé du ${TOPOLOGIE_RELEVEE.railway}`);
  });
});

// Revue de fin de vague 7 : la page a porté deux dates pour un même relevé Railway
// (21/09 dans la légende du chemin de la mesure, 22/09 dans les Specs). Les Specs
// lisent désormais chaque fait d'exploitation daté dans CES constantes, les mêmes que
// la légende — et que le test ci-dessus retrouve dans les deux documents.
describe("une seule source pour les dates d'exploitation Railway", () => {
  const backend = INFRA.find((g) => g.titre.startsWith("Backend"))!;
  const ligne = (k: string) => backend.lignes.find((l) => l.k === k)!;

  it("les Specs disent les dates de la légende : relevé, suppression d'ingest, migrations constatées", () => {
    expect(backend.sous).toContain(`relevé le ${TOPOLOGIE_RELEVEE.railway} par l'API Railway`);
    expect(ligne("ingest").v).toContain(`a été supprimé le ${INGEST_SUPPRIME_LE}.`);
    expect(ligne("scheduler").v).toContain(
      `vérifié le ${MIGRATIONS_CONSTATEES.le} sur un vrai déploiement (${MIGRATIONS_CONSTATEES.deploiement} :`,
    );
  });

  it("aucune de ces dates n'est retapée dans lib/specs.ts, hors commentaires", () => {
    const code = lire("apps/console/lib/specs.ts")
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l))
      .join("\n");
    const dates = [INGEST_SUPPRIME_LE, MIGRATIONS_CONSTATEES.le, TOPOLOGIE_RELEVEE.railwayEtVercel, "22/09/2026"];
    for (const d of dates) expect(code, d).not.toContain(d);
    expect(code).not.toContain(MIGRATIONS_CONSTATEES.deploiement);
  });
});
