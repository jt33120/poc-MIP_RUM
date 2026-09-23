// P**.6 — Les cellules du document de couverture se lisent telles qu'il les écrit.
//
// L'annexe de la vitrine affiche le document « tel quel » : son Markdown en ligne
// (code, gras, italique) est rendu, jamais montré brut, et rien d'autre n'est
// interprété. Le dernier bloc joue la lecture sur TOUTES les cellules du relevé
// versionné : un nouveau relevé qui emploierait une syntaxe non lue échoue ici.
import { describe, expect, it } from "vitest";
import { CAPACITES } from "@/lib/couverture";
import { lireEnLigne, texteDe, type Noeud } from "@/lib/markdown-en-ligne";

const texte = (t: string): Noeud => ({ type: "texte", texte: t });
const code = (t: string): Noeud => ({ type: "code", texte: t });

describe("ce qui est lu", () => {
  it("un texte sans délimiteur reste un seul nœud de texte", () => {
    expect(lireEnLigne("Aucune adresse IP n'est stockée.")).toEqual([texte("Aucune adresse IP n'est stockée.")]);
    expect(lireEnLigne("")).toEqual([]);
  });

  it("le code, le gras et l'italique", () => {
    expect(lireEnLigne("rend `no_data`, jamais un zéro")).toEqual([
      texte("rend "),
      code("no_data"),
      texte(", jamais un zéro"),
    ]);
    expect(lireEnLigne("dans la **même** app")).toEqual([
      texte("dans la "),
      { type: "gras", enfants: [texte("même")] },
      texte(" app"),
    ]);
    expect(lireEnLigne("est compté *desktop*.")).toEqual([
      texte("est compté "),
      { type: "italique", enfants: [texte("desktop")] },
      texte("."),
    ]);
  });

  it("le gras peut contenir du code, et du code peut contenir des astérisques", () => {
    expect(lireEnLigne("**Tout ce qui précède v75 a ses dimensions à `NULL`**, affichées « Inconnu ».")).toEqual([
      { type: "gras", enfants: [texte("Tout ce qui précède v75 a ses dimensions à "), code("NULL")] },
      texte(", affichées « Inconnu »."),
    ]);
    expect(lireEnLigne("le motif `**/*.md` est ignoré")).toEqual([texte("le motif "), code("**/*.md"), texte(" est ignoré")]);
  });

  it("une série de deux accents graves se ferme par deux, et garde l'accent qu'elle contient", () => {
    expect(lireEnLigne("``a`b``")).toEqual([code("a`b")]);
    expect(lireEnLigne("`` `x` ``")).toEqual([code("`x`")]);
  });
});

describe("ce qui reste du texte", () => {
  it("un délimiteur sans fermeture, ou suivi d'une espace, n'ouvre rien", () => {
    for (const s of ["5 * 3 = 15", "un **gras jamais fermé", "un `code jamais fermé", "a ** b ** c"]) {
      expect(lireEnLigne(s), s).toEqual([texte(s)]);
    }
  });

  it("une barre oblique inverse rend la ponctuation littérale", () => {
    expect(lireEnLigne("\\*pas italique\\* et \\`pas code\\`")).toEqual([texte("*pas italique* et `pas code`")]);
  });

  it("une balise ou un lien restent des chaînes : rien n'est interprété comme du HTML", () => {
    const s = "<img src=x onerror=alert(1)> et [lien](https://exemple.test)";
    expect(lireEnLigne(s)).toEqual([texte(s)]);
  });

  it("le texte lu est la cellule sans ses délimiteurs", () => {
    expect(texteDe(lireEnLigne("Un seul saut : **ni** span `DB`, *ni* propagation."))).toBe(
      "Un seul saut : ni span DB, ni propagation.",
    );
  });
});

describe("le relevé versionné, cellule par cellule", () => {
  // Tout délimiteur restant dans le TEXTE lu est une syntaxe que l'annexe ne sait pas
  // rendre : elle s'afficherait brute. Le document n'emploie aujourd'hui aucun
  // astérisque ni accent grave littéral dans ces deux colonnes.
  const restes = (source: string): string[] => {
    const trouves: string[] = [];
    const visiter = (noeuds: Noeud[]) => {
      for (const n of noeuds) {
        if (n.type === "texte" && /[`*]/.test(n.texte)) trouves.push(n.texte);
        if (n.type === "gras" || n.type === "italique") visiter(n.enfants);
      }
    };
    visiter(lireEnLigne(source));
    return trouves;
  };

  it("aucune cellule « Capacité » ni « Limite » ne garde un délimiteur non lu", () => {
    const fautes = CAPACITES.flatMap((c) => [
      ...restes(c.capacite).map((t) => `${c.id} (capacité) : ${t}`),
      ...restes(c.limite).map((t) => `${c.id} (limite) : ${t}`),
    ]);
    expect(fautes).toEqual([]);
  });

  it("le relevé emploie bien les trois formes lues : le test ci-dessus n'est pas vide de sens", () => {
    const types = new Set<string>();
    const visiter = (noeuds: Noeud[]) => {
      for (const n of noeuds) {
        types.add(n.type);
        if (n.type === "gras" || n.type === "italique") visiter(n.enfants);
      }
    };
    for (const c of CAPACITES) visiter(lireEnLigne(c.limite));
    expect([...types].sort()).toEqual(["code", "gras", "italique", "texte"]);
  });
});
