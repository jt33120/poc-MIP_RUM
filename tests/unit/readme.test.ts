// P**.9 — Le README de la racine ne contredit plus la vitrine.
//
// Ses sections « Architecture » et « Statut » sont des zones générées par
// scripts/readme-sections.mjs, depuis les mêmes sources que la vitrine :
// apps/console/lib/presentation-topologie.ts (hébergeurs lus dans lib/legal.ts) et
// apps/console/lib/couverture.generated.json (le document de couverture). Ce fichier
// vérifie :
//   1. que les zones du README versionné SONT leur régénération — depuis le JSON
//      versionné, depuis une extraction fraîche du document (un nouveau relevé rougit
//      le README comme il rougit le site), et par la commande elle-même, qui lit le
//      TypeScript par Node et non par vitest ;
//   2. que les trois sections qui ont menti ne nomment plus Supabase, Deno, une
//      edge function, une version v0.x ni un produit « souverain » ;
//   3. que chaque paire de marqueurs existe, une fois.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as topologie from "../../apps/console/lib/presentation-topologie";
import { DOCUMENT, extraireCouverture } from "../../scripts/couverture-extraire.mjs";
import {
  COUVERTURE,
  FERMETURE,
  README,
  ZONES,
  ouverture,
  remplacerZones,
  zones,
} from "../../scripts/readme-sections.mjs";

const RACINE = join(__dirname, "..", "..");
const lire = (chemin: string) => readFileSync(join(RACINE, chemin), "utf8");
const TEXTE = lire(README);

describe("1 — les zones du README sont leur régénération", () => {
  it("depuis le JSON versionné du document de couverture", () => {
    const attendu = remplacerZones(TEXTE, zones({ topologie, couverture: JSON.parse(lire(COUVERTURE)) }));
    expect(TEXTE === attendu, `${README} n'a plus ses zones à jour : relancer \`node scripts/readme-sections.mjs\``).toBe(true);
  });

  it("depuis une extraction fraîche du document : un nouveau relevé rougit le README", () => {
    const attendu = remplacerZones(TEXTE, zones({ topologie, couverture: extraireCouverture(lire(DOCUMENT)) }));
    expect(
      TEXTE === attendu,
      `${DOCUMENT} a changé depuis la génération du README : relancer \`node scripts/couverture-extraire.mjs\` puis \`node scripts/readme-sections.mjs\``,
    ).toBe(true);
  });

  it("la commande de régénération lit le même TypeScript, par Node, et trouve le README à jour", () => {
    // Le test ci-dessus importe la topologie par vitest ; la commande l'évalue par le
    // retrait de types de Node et son crochet de résolution. Si ce chemin-là casse,
    // personne ne pourra régénérer le README : on le joue ici.
    const sortie = execFileSync(process.execPath, ["scripts/readme-sections.mjs", "--verifier"], {
      cwd: RACINE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(sortie.trim()).toBe(`${README} à jour.`);
  });
});

/** Sections `## Titre` du Markdown, sans leurs blocs de code clôturés. */
function sectionsHorsCode(texte: string): Map<string, { numero: number; ligne: string }[]> {
  const sections = new Map<string, { numero: number; ligne: string }[]>();
  let courante: { numero: number; ligne: string }[] | null = null;
  let dansCode = false;
  texte.split("\n").forEach((ligne, i) => {
    if (/^\s*(```|~~~)/.test(ligne)) {
      dansCode = !dansCode;
      return;
    }
    if (dansCode) return;
    const titre = /^## (.+?)\s*$/.exec(ligne);
    if (titre) {
      courante = [];
      sections.set(titre[1], courante);
      return;
    }
    courante?.push({ numero: i + 1, ligne });
  });
  return sections;
}

describe("2 — lexique des sections « Pourquoi celui-là », « Architecture » et « Statut »", () => {
  // Hors de ces trois sections, le README peut nommer une ancienne version dans un
  // lien d'archive (docs/archive/ROADMAP_V02.md…) : la limitation est voulue.
  const TITRES = ["Pourquoi celui-là", "Architecture", "Statut"];
  const INTERDITS = [/Supabase/, /\bDeno\b/, /edge function/i, /\bv0\.\d\b/, /\bsouverain\b/i];

  it("les trois sections existent et ont un contenu hors code : sans elles, le contrôle ne vérifierait rien", () => {
    const sections = sectionsHorsCode(TEXTE);
    for (const titre of TITRES) {
      const lignes = sections.get(titre) ?? [];
      expect(lignes.some((l) => l.ligne.trim() !== ""), `section « ## ${titre} » absente ou vide`).toBe(true);
    }
  });

  it("aucun motif interdit hors des blocs de code", () => {
    const sections = sectionsHorsCode(TEXTE);
    const fautes = TITRES.flatMap((titre) =>
      (sections.get(titre) ?? []).flatMap(({ numero, ligne }) =>
        INTERDITS.filter((m) => m.test(ligne)).map((m) => `${README}:${numero} (« ${titre} ») : ${m} — ${ligne.trim()}`),
      ),
    );
    expect(fautes, fautes.join("\n")).toEqual([]);
  });

  it("« souveraine » n'est admis que dans la phrase de PS4, réécrite à la main dans « Pourquoi celui-là »", () => {
    const PHRASE = "Données hébergées en UE ; hébergeurs de droit américain ; ce POC n'est pas une offre souveraine.";
    const sections = sectionsHorsCode(TEXTE);
    const pourquoi = (sections.get("Pourquoi celui-là") ?? []).map((l) => l.ligne).join("\n");
    expect(pourquoi).toContain(PHRASE);
    const ailleurs = TITRES.flatMap((titre) =>
      (sections.get(titre) ?? [])
        .filter(({ ligne }) => /souverain/i.test(ligne.split(PHRASE).join("")))
        .map(({ numero, ligne }) => `${README}:${numero} : ${ligne.trim()}`),
    );
    expect(ailleurs, ailleurs.join("\n")).toEqual([]);
  });
});

describe("3 — les deux paires de marqueurs existent, une fois chacune", () => {
  const compter = (motif: string) => TEXTE.split(motif).length - 1;

  it("une ouverture par zone, autant de fermetures que de zones", () => {
    for (const zone of ZONES) expect(compter(ouverture(zone)), ouverture(zone)).toBe(1);
    expect(compter(FERMETURE), FERMETURE).toBe(ZONES.length);
  });

  it("chaque zone est fermée avant que la suivante ne s'ouvre, dans l'ordre du README", () => {
    const positions = ZONES.map((zone) => {
      const debut = TEXTE.indexOf(ouverture(zone));
      return { zone, debut, fin: TEXTE.indexOf(FERMETURE, debut) };
    });
    positions.forEach(({ zone, debut, fin }, i) => {
      expect(fin, `${zone} n'est pas fermée`).toBeGreaterThan(debut);
      const suivante = positions[i + 1];
      if (suivante) expect(fin, `${zone} déborde sur ${suivante.zone}`).toBeLessThan(suivante.debut);
    });
  });

  it("chaque zone vit sous le titre qu'elle génère", () => {
    const titreAvant = (zone: string) => {
      const avant = TEXTE.slice(0, TEXTE.indexOf(ouverture(zone))).split("\n");
      return avant.reverse().find((l) => l.startsWith("## "));
    };
    expect(titreAvant("readme-architecture")).toBe("## Architecture");
    expect(titreAvant("readme-statut")).toBe("## Statut");
  });

  it("un marqueur absent ou dédoublé fait échouer la régénération en le nommant", () => {
    const contenus = { "readme-architecture": "a", "readme-statut": "s" };
    expect(() => remplacerZones(TEXTE.replace(ouverture("readme-statut"), ""), contenus)).toThrow(
      `${README} — « ${ouverture("readme-statut")} » trouvé 0 fois, 1 attendu`,
    );
    expect(() => remplacerZones(`${TEXTE}\n${ouverture("readme-architecture")}\n`, contenus)).toThrow(
      `${README} — « ${ouverture("readme-architecture")} » trouvé 2 fois, 1 attendu`,
    );
    // Sans sa fermeture, la première zone engloutirait la seconde : refusé.
    const i = TEXTE.indexOf(FERMETURE);
    const sansFin = TEXTE.slice(0, i) + TEXTE.slice(i + FERMETURE.length);
    expect(() => remplacerZones(sansFin, contenus)).toThrow(`« ${ouverture("readme-architecture")} » n'est pas fermé`);
  });
});
