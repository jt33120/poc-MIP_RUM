// Le Markdown EN LIGNE d'une cellule du document de couverture, lu sans bibliothèque.
//
// POURQUOI. L'annexe de la vitrine (components/presentation/Annexe.tsx) reproduit le
// document de couverture « tel quel » : ses cellules sont du Markdown brut
// (lib/couverture.ts). Afficher `**même**` avec ses astérisques, ou `null` avec ses
// accents graves, trahirait le document autant que de le réécrire.
//
// CE QUI EST LU, ET RIEN D'AUTRE : le code (`x`), le gras (**x**, qui peut contenir
// du code) et l'italique (*x*) — tout ce qu'emploient les colonnes « Capacité » et
// « Limite » du relevé. tests/unit/markdown-en-ligne.test.ts le vérifie sur le
// document réel : aucune cellule ne garde un délimiteur non lu, donc un nouveau
// relevé qui emploierait une autre syntaxe se voit en CI, pas sur la page.
//
// Tout le reste — un délimiteur sans fermeture, un lien, une balise — reste du
// TEXTE : l'arbre rendu ne contient que des chaînes, que React échappe. Rien n'est
// jamais interprété comme du HTML. Pas d'italique par `_x_` : il casserait les
// identifiants hors code (`low_confidence` écrit sans accents graves).

export type Noeud =
  | { type: "texte"; texte: string }
  | { type: "code"; texte: string }
  | { type: "gras"; enfants: Noeud[] }
  | { type: "italique"; enfants: Noeud[] };

type Delimiteur = "**" | "*";

/** Ponctuation ASCII qu'une barre oblique inverse rend littérale (CommonMark). */
const ECHAPPABLE = /[!-\/:-@\[-`{-~]/;

/** Longueur de la série de `c` qui commence à `i`. */
function serie(s: string, i: number, c: string): number {
  let n = 0;
  while (s[i + n] === c) n++;
  return n;
}

/** Début de la série fermante d'exactement `n` accents graves après `depuis`, ou -1. */
function fermetureCode(s: string, depuis: number, n: number): number {
  for (let i = depuis; i < s.length; ) {
    if (s[i] !== "`") {
      i++;
      continue;
    }
    const m = serie(s, i, "`");
    if (m === n) return i;
    i += m;
  }
  return -1;
}

/** Contenu d'un segment de code : une espace de chaque côté s'enlève si les deux y sont. */
function contenuCode(brut: string): string {
  return brut.length > 2 && brut.startsWith(" ") && brut.endsWith(" ") && brut.trim() !== ""
    ? brut.slice(1, -1)
    : brut;
}

function pousserTexte(noeuds: Noeud[], texte: string): void {
  const dernier = noeuds[noeuds.length - 1];
  if (dernier?.type === "texte") dernier.texte += texte;
  else noeuds.push({ type: "texte", texte });
}

/**
 * Lit `s` à partir de `i` jusqu'au délimiteur `attendu` (ou la fin). `ferme` dit si
 * le délimiteur a été trouvé : sans lui, l'appelant rend l'ouvrant au texte.
 */
function lire(s: string, i: number, attendu: Delimiteur | null): { noeuds: Noeud[]; fin: number; ferme: boolean } {
  const noeuds: Noeud[] = [];
  let tampon = "";
  const vider = () => {
    if (tampon) pousserTexte(noeuds, tampon);
    tampon = "";
  };

  while (i < s.length) {
    const c = s[i];

    if (c === "\\" && ECHAPPABLE.test(s[i + 1] ?? "")) {
      tampon += s[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const n = serie(s, i, "`");
      const fin = fermetureCode(s, i + n, n);
      if (fin === -1) {
        // Série sans fermeture : du texte, pas du code.
        tampon += s.slice(i, i + n);
        i += n;
        continue;
      }
      vider();
      noeuds.push({ type: "code", texte: contenuCode(s.slice(i + n, fin)) });
      i = fin + n;
      continue;
    }

    if (c === "*") {
      const delim: Delimiteur = s[i + 1] === "*" ? "**" : "*";
      if (delim === attendu) {
        vider();
        return { noeuds, fin: i + delim.length, ferme: true };
      }
      // Un ouvrant est suivi d'un caractère non blanc (« a * b » n'ouvre rien), et
      // n'ouvre que s'il se referme plus loin ; sinon il reste tel quel.
      const suivant = s[i + delim.length];
      if (suivant !== undefined && !/\s/.test(suivant)) {
        const dedans = lire(s, i + delim.length, delim);
        if (dedans.ferme && dedans.noeuds.length > 0) {
          vider();
          noeuds.push({ type: delim === "**" ? "gras" : "italique", enfants: dedans.noeuds });
          i = dedans.fin;
          continue;
        }
      }
      tampon += delim;
      i += delim.length;
      continue;
    }

    tampon += c;
    i++;
  }

  vider();
  return { noeuds, fin: i, ferme: false };
}

/** L'arbre d'une cellule : texte, code, gras, italique. */
export function lireEnLigne(source: string): Noeud[] {
  return lire(source, 0, null).noeuds;
}

/** Ce qu'un lecteur lit : le texte des nœuds, sans aucun délimiteur. */
export function texteDe(noeuds: Noeud[]): string {
  return noeuds
    .map((n) => (n.type === "texte" || n.type === "code" ? n.texte : texteDe(n.enfants)))
    .join("");
}
