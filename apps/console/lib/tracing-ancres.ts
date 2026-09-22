// Identité d'un appel API sur l'écran Tracing (§ 5.8, F59) — logique pure.
//
// UNE SEULE CHAÎNE POUR DEUX USAGES. Un appel est le couple (méthode, chemin) tel
// que `apiCallsDecomposition` le rend : `method` et `url` (origine retirée en SQL),
// sans autre normalisation. La chaîne `<méthode> <chemin>` est à la fois la valeur
// du paramètre d'écran `appel=` (qui filtre « Traces les plus lentes ») et, une
// fois encodée, le suffixe de l'ancre `#appel-…` d'une ligne de « Tous les appels
// API ». Un classement qui renvoie vers une ligne et un filtre qui la retrouve ne
// peuvent donc pas diverger : ils lisent la même chaîne.
//
// POURQUOI COUPER AU PREMIER ESPACE. Une méthode HTTP n'en contient jamais ; un
// chemin, si (« /api/a b » reste un chemin reçu tel quel). Le premier espace est
// donc le seul séparateur non ambigu.
import type { SearchParams } from "./filters";

export interface Appel {
  method: string;
  url: string;
}

/**
 * Identifiant DOM d'une ligne d'appel : `appel-` + `encodeURIComponent("<méthode> <chemin>")`.
 * Le lien du classement écrit ce fragment tel quel (déjà encodé) ; un test le
 * retrouve par `document.getElementById`, jamais par un sélecteur CSS.
 */
export function ancreAppel(method: string, url: string): string {
  return `appel-${encodeURIComponent(`${method} ${url}`)}`;
}

/**
 * Lit le paramètre d'écran `appel=<méthode> <chemin>`. `null` quand il est absent,
 * sans espace, sans méthode, ou répété avec des valeurs différentes : un filtre
 * ambigu n'est pas choisi au hasard (même règle que `ambiguous_parameter` du
 * contrat). Un chemin vide reste lisible : `apiCallsDecomposition` rend « » pour
 * un span sans URL, et le filtre doit pouvoir le retrouver.
 */
export function lireAppel(sp: SearchParams): Appel | null {
  const brut = sp.appel;
  const valeurs = Array.isArray(brut) ? [...new Set(brut)] : brut === undefined ? [] : [brut];
  if (valeurs.length !== 1) return null;
  const [valeur] = valeurs;
  const espace = valeur.indexOf(" ");
  if (espace <= 0) return null;
  return { method: valeur.slice(0, espace), url: valeur.slice(espace + 1) };
}
