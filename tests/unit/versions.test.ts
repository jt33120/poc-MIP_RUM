// Comparaison des versions déployées — les décisions de lecture.
//
// Chacune de celles vérifiées ici répond à une question où l'erreur NE LÈVE
// RIEN et se lit comme un résultat : un tableau de comparaison qui ne compare
// qu'une ligne, une référence choisie sur un critère qui n'en est pas un, un
// « +0,0 pt » face à soi-même, ou un « 0 % d'erreur » qui veut en réalité dire
// « aucune session ». Ce sont les fautes qui survivent le plus longtemps,
// parce qu'un écran qui affiche un nombre a l'air de fonctionner.
import { describe, expect, it } from "vitest";
import {
  comparable,
  ecartPoints,
  tauxErreur,
  versionReference,
  type VersionRow,
} from "../../apps/console/lib/queries-deploys";
import { decouperUrlScript } from "../../apps/console/lib/format";

const v = (over: Partial<VersionRow> & { version: string }): VersionRow => ({
  sessions: 100,
  lcp: 2000,
  inp: 150,
  erreurs: 0,
  sessionsEnErreur: 0,
  ...over,
});

describe("comparable — y a-t-il quelque chose à comparer ?", () => {
  it("non sous deux versions", () => {
    expect(comparable([])).toBe(false);
    // Le cas qui compte : une app qui ne renseigne pas `release` produit
    // exactement UNE ligne, « (non renseignée) ». L'afficher présenterait une
    // absence de donnée comme un résultat de comparaison.
    expect(comparable([v({ version: "(non renseignée)" })])).toBe(false);
  });

  it("oui à partir de deux", () => {
    expect(comparable([v({ version: "1.4.2" }), v({ version: "1.5.0" })])).toBe(true);
  });
});

describe("versionReference — la plus VUE, pas la plus récente", () => {
  // « La plus récente » n'est pas calculable : « 1.10 » vient après « 1.9 »
  // alors que l'ordre alphabétique dit l'inverse, et un SHA git n'a aucun ordre.
  // La requête classe par volume décroissant ; la référence est la première.
  it("prend la première ligne, celle du plus gros volume", () => {
    const rows = [v({ version: "1.9", sessions: 900 }), v({ version: "1.10", sessions: 12 })];
    expect(versionReference(rows)?.version).toBe("1.9");
  });

  it("ne se laisse pas piéger par un numéro qui paraît plus grand", () => {
    const rows = [v({ version: "1.4.2", sessions: 500 }), v({ version: "1.10.0", sessions: 3 })];
    expect(versionReference(rows)?.version).toBe("1.4.2");
  });

  it("rend null sur une liste vide", () => {
    expect(versionReference([])).toBeNull();
  });
});

describe("tauxErreur — la part de sessions touchées", () => {
  it("compte les SESSIONS touchées, pas les erreurs", () => {
    // 300 erreurs pour 3 sessions touchées sur 100 : 3 %, pas 300 %.
    expect(tauxErreur(v({ version: "a", sessions: 100, erreurs: 300, sessionsEnErreur: 3 }))).toBe(0.03);
  });

  // Le piège : 0/0 vaut NaN, et `(NaN * 100).toFixed(1)` affiche « NaN % » ;
  // mais un repli naïf sur 0 afficherait « 0,0 % », c'est-à-dire « aucune
  // erreur » — une affirmation, sur une version dont on ne sait rien.
  it("rend null sans session, plutôt que 0 %", () => {
    expect(tauxErreur(v({ version: "a", sessions: 0, sessionsEnErreur: 0 }))).toBeNull();
  });

  it("rend 0 quand il y a des sessions et aucune erreur — là, c'est une mesure", () => {
    expect(tauxErreur(v({ version: "a", sessions: 50, sessionsEnErreur: 0 }))).toBe(0);
  });
});

describe("ecartPoints — l'écart face à la référence", () => {
  const ref = v({ version: "1.4.2", sessions: 1000, sessionsEnErreur: 20 }); // 2 %
  const pire = v({ version: "1.5.0", sessions: 500, sessionsEnErreur: 25 }); // 5 %
  const mieux = v({ version: "1.5.1", sessions: 500, sessionsEnErreur: 5 }); // 1 %

  it("s'exprime en POINTS de pourcentage, pas en pourcentage relatif", () => {
    // 5 % contre 2 % : +3 points. En relatif ce serait +150 %, ce qui n'a pas
    // le même sens et ne se compare pas d'une version à l'autre.
    expect(ecartPoints(pire, ref)).toBeCloseTo(3, 10);
    expect(ecartPoints(mieux, ref)).toBeCloseTo(-1, 10);
  });

  it("ne compare pas la référence à elle-même", () => {
    // « +0,0 pt » face à soi-même se lit comme une mesure, alors que c'est une
    // tautologie — et colorerait une ligne pour rien.
    expect(ecartPoints(ref, ref)).toBeNull();
  });

  it("rend null dès qu'un des deux taux manque", () => {
    const vide = v({ version: "1.6.0", sessions: 0, sessionsEnErreur: 0 });
    // Sans ce garde-fou, l'écart vaudrait le taux de l'autre, présenté comme
    // une différence.
    expect(ecartPoints(vide, ref)).toBeNull();
    expect(ecartPoints(pire, vide)).toBeNull();
  });
});

// Le découpage d'une URL de script pour la colonne « Script » de /ux.
//
// Une troncature de FIN sur `https://app.exemple.fr/static/js/panier.a1b2.js`
// donne « https://app.… » : le préfixe est identique pour tous les scripts d'un
// même site, donc la seule partie affichée est la seule qui n'apprend rien.
// Constaté à l'écran avant correction.
describe("decouperUrlScript — ce qu'on lit dans une colonne étroite", () => {
  it("met le nom de fichier en avant et garde l'hôte à part", () => {
    expect(decouperUrlScript("https://app.exemple.fr/static/js/panier.a1b2c3.js")).toEqual({
      fichier: "panier.a1b2c3.js",
      hote: "app.exemple.fr",
    });
  });

  it("garde le port, qui distingue deux origines", () => {
    expect(decouperUrlScript("http://localhost:3000/a/b.js").hote).toBe("localhost:3000");
  });

  it("rend une URL inanalysable telle quelle plutôt qu'une cellule vide", () => {
    expect(decouperUrlScript("pas-une-url")).toEqual({ fichier: "pas-une-url", hote: null });
  });

  it("survit à une URL sans chemin", () => {
    expect(decouperUrlScript("https://cdn.exemple.fr").fichier).toBe("/");
  });

  it("ne rend jamais une chaîne vide", () => {
    for (const u of [null, "", "https://x/", "https://x/a/"])
      expect(decouperUrlScript(u).fichier.length, String(u)).toBeGreaterThan(0);
  });
});
