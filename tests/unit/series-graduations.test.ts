// Séries temporelles — ce que la recette du 26/09/2026 a changé : graduations du
// temps à pas régulier, échelle y ronde, annotations regroupées, période en cours
// dite en français, collecte qui vient de commencer.
import { describe, expect, it } from "vitest";
import {
  echelleY,
  graduationsTemps,
  libellePeriodeEnCours,
  phrasePeuDePoints,
  premiereDonneeTardive,
  regrouperAnnotations,
  tranchesMesurees,
  type Annotation,
  type LignePreparee,
  type SerieDef,
} from "@/lib/series";

const HEURE = 3_600_000;
/** 25 débuts d'heure consécutifs, de 2026-09-25T12:00Z à 2026-09-26T12:00Z. */
const GRILLE_24H = Array.from({ length: 25 }, (_v, i) => new Date(Date.parse("2026-09-25T12:00:00Z") + i * HEURE).toISOString());

describe("graduationsTemps", () => {
  it("24 h en UTC : une graduation toutes les 3 h ROUNDES (00, 03, 06…), pas « 03:00 → 12:00 → 17:00 »", () => {
    const t = graduationsTemps(GRILLE_24H, 3600, "UTC");
    const heures = t.map((iso) => new Date(iso).getUTCHours());
    expect(heures.every((h) => h % 3 === 0)).toBe(true);
    // Pas régulier : 3 h entre deux graduations.
    const ecarts = t.slice(1).map((iso, i) => Date.parse(iso) - Date.parse(t[i]));
    expect(new Set(ecarts)).toEqual(new Set([3 * HEURE]));
    expect(t.length).toBeLessThanOrEqual(9);
  });

  it("heure de Paris : les graduations tombent sur des heures rondes LOCALES", () => {
    const t = graduationsTemps(GRILLE_24H, 3600, "Europe/Paris");
    const heuresParis = t.map((iso) => (new Date(iso).getUTCHours() + 2) % 24); // UTC+2 en septembre
    expect(heuresParis.every((h) => h % 3 === 0)).toBe(true);
  });

  it("jours : un sur sept (les lundis) sur 30 jours ; le dernier jour compté à rebours sinon", () => {
    const jours = Array.from({ length: 30 }, (_v, i) => new Date(Date.UTC(2026, 7, 28 + i)).toISOString().slice(0, 10));
    const lundis = graduationsTemps(jours, 86_400, "UTC");
    expect(lundis.every((j) => new Date(`${j}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
    const semaine = jours.slice(-7);
    expect(graduationsTemps(semaine, 86_400, "UTC")).toEqual(semaine);
  });

  it("grille courte : tous les éléments", () => {
    expect(graduationsTemps(GRILLE_24H.slice(0, 2), 3600, "UTC")).toEqual(GRILLE_24H.slice(0, 2));
  });
});

describe("echelleY", () => {
  const lignes = (vals: (number | null)[]): LignePreparee[] => vals.map((v, i) => ({ t: GRILLE_24H[i], v }));
  const S: SerieDef[] = [{ cle: "v", libelle: "V", role: "principale" }];

  it("compte : haut rond, depuis 0 (253 → 300)", () => {
    expect(echelleY(lignes([12, 253, 40]), S, "count")).toEqual({ haut: 300, valeurs: [0, 100, 200, 300], depassements: null });
  });

  // Recette du 26/09/2026 : un LCP à 92 ms s'écrasait sous une échelle de 0 à 2,8 s.
  // L'axe se cale sur les données ; la bande « Bon » en occupe alors toute la hauteur.
  it("vital : l'échelle suit les données (LCP tout bon → 0-125 ms), pas le seuil", () => {
    const e = echelleY(lignes([92, 120, null]), S, "ms", { vital: "LCP" });
    expect(e.haut).toBe(125);
    expect(e.valeurs[0]).toBe(0);
    expect(e.valeurs.at(-1)).toBe(125);
  });

  it("vital sans aucune donnée : la bande « Bon » entière reste lisible", () => {
    expect(echelleY(lignes([null, null]), S, "ms", { vital: "LCP" }).haut).toBeGreaterThanOrEqual(2750);
  });

  it("empilé : la plus haute PILE fait le haut de l'axe", () => {
    const l: LignePreparee[] = [{ t: GRILLE_24H[0], a: 150, b: 120 }];
    const series: SerieDef[] = [
      { cle: "a", libelle: "A", role: "categorie" },
      { cle: "b", libelle: "B", role: "categorie" },
    ];
    expect(echelleY(l, series, "count", { empile: true }).haut).toBe(300);
  });
});

describe("libellePeriodeEnCours : plus jamais « seau »", () => {
  it("selon la largeur du seau", () => {
    expect(libellePeriodeEnCours(3600)).toBe("heure en cours (incomplète)");
    expect(libellePeriodeEnCours(86_400)).toBe("jour en cours (incomplet)");
    expect(libellePeriodeEnCours(300, true)).toBe("jour en cours (incomplet)");
    expect(libellePeriodeEnCours(300)).toBe("période en cours (incomplète)");
    for (const s of [60, 300, 3600, 21_600, 86_400, 604_800]) expect(libellePeriodeEnCours(s)).not.toMatch(/seau/);
  });
});

describe("premiereDonneeTardive", () => {
  const lignes = (vals: (number | null)[]): LignePreparee[] => vals.map((v, i) => ({ t: GRILLE_24H[i], v }));

  it("seules les deux dernières tranches portent des données : l'indice de la première", () => {
    const vals: (number | null)[] = Array(25).fill(0);
    vals[24] = 12;
    expect(premiereDonneeTardive(lignes(vals), ["v"])).toBe(24);
    vals[23] = 3;
    expect(premiereDonneeTardive(lignes(vals), ["v"])).toBe(23);
  });

  it("des données plus tôt, aucune donnée, ou une grille courte : null", () => {
    const vals: (number | null)[] = Array(25).fill(null);
    expect(premiereDonneeTardive(lignes(vals), ["v"])).toBeNull();
    vals[20] = 5;
    vals[24] = 5;
    expect(premiereDonneeTardive(lignes(vals), ["v"])).toBeNull();
    expect(premiereDonneeTardive(lignes([0, 0, 4]), ["v"])).toBeNull();
  });
});

describe("regrouperAnnotations", () => {
  const a = (t: string, libelle: string, type: Annotation["type"] = "alerte", href?: string): Annotation => ({ t, libelle, type, href });

  it("trois alertes simultanées : une étiquette « 3 alertes à 14:14 »", () => {
    const t = "2026-09-26T12:14:00Z";
    const groupes = regrouperAnnotations(
      [
        { annotation: a(t, "Alerte LCP", "alerte", "/alerts?evt=1"), x: 300 },
        { annotation: a(t, "Alerte erreurs", "alerte", "/alerts?evt=2"), x: 300 },
        { annotation: a(t, "Alerte INP", "alerte", "/alerts?evt=3"), x: 301 },
      ],
      { ecart: 28, fuseau: "Europe/Paris" },
    );
    expect(groupes).toHaveLength(1);
    expect(groupes[0].libelle).toBe("3 alertes à 14:14");
    expect(groupes[0].annotations).toHaveLength(3);
    // Trois destinations différentes : le groupe n'en choisit aucune (la légende les liste).
    expect(groupes[0].href).toBeUndefined();
  });

  it("des types mêlés sur une plage : « 2 événements (14:14–14:40) »", () => {
    const groupes = regrouperAnnotations(
      [
        { annotation: a("2026-09-26T12:40:00Z", "v1.4.2", "deploiement"), x: 320 },
        { annotation: a("2026-09-26T12:14:00Z", "Alerte LCP"), x: 300 },
      ],
      { ecart: 28, fuseau: "Europe/Paris" },
    );
    expect(groupes.map((g) => g.libelle)).toEqual(["2 événements (14:14–14:40)"]);
  });

  it("des annotations éloignées gardent chacune leur libellé ; un groupe ne s'étire pas de proche en proche", () => {
    const groupes = regrouperAnnotations(
      [0, 20, 40, 60].map((x, i) => ({ annotation: a(`2026-09-26T0${i}:00:00Z`, `v${i}`, "deploiement", `/r${i}`), x })),
      { ecart: 28, fuseau: "UTC" },
    );
    expect(groupes.map((g) => g.annotations.length)).toEqual([2, 2]);
    const seules = regrouperAnnotations([{ annotation: a("2026-09-26T01:00:00Z", "v1.4.2", "deploiement", "/r"), x: 10 }], {
      ecart: 28,
      fuseau: "UTC",
    });
    expect(seules[0]).toMatchObject({ libelle: "v1.4.2", href: "/r" });
  });
});

describe("peu de points : une figure presque vide le dit", () => {
  const S: SerieDef[] = [{ cle: "v", libelle: "V", role: "principale" }];
  it("compte les tranches MESURÉES, les trous exclus", () => {
    const l: LignePreparee[] = GRILLE_24H.slice(0, 5).map((t, i) => ({ t, v: i === 2 ? 92 : null }));
    expect(tranchesMesurees(l, S.map((s) => s.cle))).toBe(1);
    expect(tranchesMesurees(l, [])).toBe(0);
  });

  it("la phrase s'accorde avec la tranche", () => {
    expect(phrasePeuDePoints(1, 3600)).toBe("Une seule heure mesurée sur la période");
    expect(phrasePeuDePoints(2, 86_400)).toBe("Deux jours mesurés sur la période");
    expect(phrasePeuDePoints(1, 300)).toBe("Une seule tranche mesurée sur la période");
  });
});

// Recette du 30/09/2026 : une tranche aberrante (un p75 de 166 s sur deux mesures)
// tassait toute la courbe. L'échelle robuste la rogne au sommet et le DIT.
describe("echelleY — échelle robuste", () => {
  const lignes = (vals: (number | null)[]): LignePreparee[] => vals.map((v, i) => ({ t: GRILLE_24H[i], v }));
  const S: SerieDef[] = [{ cle: "v", libelle: "V", role: "principale" }];
  const valeurs = [2100, 2400, 1800, 2600, 3000, 2200, 2500, 1900, 2300, 166_500];
  it("sans l'option : le maximum fixe le haut, rien n'est rogné", () => {
    const e = echelleY(lignes(valeurs), S, "ms", { vital: "LCP" });
    expect(e.haut).toBeGreaterThanOrEqual(166_500);
    expect(e.depassements).toBeNull();
  });
  it("robuste : le haut suit le gros des tranches, l'aberration est comptée", () => {
    const e = echelleY(lignes(valeurs), S, "ms", { vital: "LCP", robuste: true });
    expect(e.haut).toBeLessThan(10_000);
    expect(e.depassements).toEqual({ n: 1, max: 166_500 });
  });
  it("robuste sans aberration : identique au maximum", () => {
    const sages = [2100, 2400, 1800, 2600];
    expect(echelleY(lignes(sages), S, "ms", { robuste: true }).haut).toBe(echelleY(lignes(sages), S, "ms").haut);
  });
});
