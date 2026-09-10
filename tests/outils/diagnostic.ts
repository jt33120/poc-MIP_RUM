// CE QUE DIT UN TEST QUAND IL ÉCHOUE.
//
// LE PROBLÈME. Un test qui tombe rend « expected false to be true ». Sur une
// assertion de forme — une chaîne absente d'un fichier SQL, un seau qui n'a pas
// l'index attendu — cette ligne ne dit ni sur quelle donnée, ni contre quelle
// version du fichier, ni avec quel écart. Celui qui lit le journal de CI trois
// semaines plus tard n'a que le nom du test. Il relance en local, ça passe, et
// l'échec devient « un flake » alors que personne n'a regardé.
//
// CE QUE FAIT CE MODULE. `surEchec` enregistre un CONTEXTE, évalué SEULEMENT si
// le test échoue, et l'imprime sous une forme stable et grepable :
//
//   ┌─ DIAGNOSTIC ── nom du test
//   │ cle : valeur
//   └───
//
// Le contexte est une fonction, pas un objet : le construire coûte parfois une
// lecture de fichier ou une requête, et un test qui passe ne doit rien payer.
//
// CE QU'IL NE FAIT PAS. Il ne rattrape pas l'échec et ne le transforme pas en
// avertissement. Un test qui échoue échoue ; on lui ajoute seulement de quoi
// comprendre pourquoi.
import { onTestFailed } from "vitest";

/** Une paire clé/valeur du diagnostic. Les valeurs sont rendues lisibles. */
export type Contexte = Record<string, unknown>;

const MAX_LONGUEUR = 600;

/** Rend une valeur lisible sur une ligne, tronquée, sans jamais lever. */
export function rendreValeur(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") {
    // Les sauts de ligne cassent la grepabilité : un diagnostic se lit en
    // filtrant un journal, pas en le faisant défiler.
    const plat = v.replace(/\s*\n\s*/g, " ⏎ ");
    return plat.length > MAX_LONGUEUR ? `${plat.slice(0, MAX_LONGUEUR)}… (+${plat.length - MAX_LONGUEUR} car.)` : plat;
  }
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  try {
    const j = JSON.stringify(v);
    if (j === undefined) return Object.prototype.toString.call(v);
    return j.length > MAX_LONGUEUR ? `${j.slice(0, MAX_LONGUEUR)}… (+${j.length - MAX_LONGUEUR} car.)` : j;
  } catch {
    // Référence circulaire, getter qui lève, Proxy hostile : on ne laisse JAMAIS
    // le diagnostic emporter le test qu'il documente.
    return Object.prototype.toString.call(v);
  }
}

/** Le bloc de diagnostic, en texte. Pur, donc testable sans faire échouer un test. */
export function formaterDiagnostic(titre: string, contexte: Contexte): string {
  const entrees = Object.entries(contexte);
  const largeur = entrees.reduce((m, [k]) => Math.max(m, k.length), 0);
  const lignes = entrees.map(([k, v]) => `│ ${k.padEnd(largeur)} : ${rendreValeur(v)}`);
  return [`┌─ DIAGNOSTIC ── ${titre}`, ...lignes, "└───"].join("\n");
}

/**
 * Enregistre un contexte à imprimer SI le test courant échoue.
 *
 * À appeler au DÉBUT du test, avant les assertions : `onTestFailed` doit être
 * enregistré pendant l'exécution du test, et un contexte posé après l'assertion
 * qui casse ne serait jamais enregistré.
 *
 * @param titre   ce qu'on cherchait à prouver, en clair
 * @param donnees fonction rendant le contexte — évaluée seulement à l'échec
 */
export function surEchec(titre: string, donnees: () => Contexte, sortie: Pick<Console, "error"> = console): void {
  onTestFailed(() => {
    let contexte: Contexte;
    try {
      contexte = donnees();
    } catch (err) {
      // Le collecteur de contexte a lui-même échoué : c'est une information, pas
      // une raison de se taire.
      contexte = { "collecte du contexte": `ÉCHEC — ${String((err as Error)?.message ?? err)}` };
    }
    sortie.error(formaterDiagnostic(titre, contexte));
  });
}

/**
 * Contexte standard d'une assertion « cette chaîne doit être dans ce fichier ».
 *
 * C'est la forme d'assertion la plus fréquente du dépôt (verrouiller une
 * migration, un commentaire, un invariant de code) et la plus muette à l'échec :
 * sans ça on sait qu'une chaîne manque, jamais laquelle ni dans quel état est le
 * fichier.
 */
export function contexteFichier(chemin: string, contenu: string, attendu: string): Contexte {
  const lignes = contenu.split("\n");
  // La ligne la plus proche : on montre où le fichier parle du sujet, même quand
  // la chaîne exacte a bougé. C'est ce qui distingue « supprimé » de « reformulé ».
  const jeton = attendu.split(/\s+/).filter((m) => m.length > 4)[0] ?? attendu.slice(0, 12);
  const proche = lignes.findIndex((l) => l.includes(jeton));
  return {
    fichier: chemin,
    "lignes du fichier": lignes.length,
    "chaîne attendue": attendu,
    présente: contenu.includes(attendu),
    "jeton cherché": jeton,
    "ligne la plus proche": proche >= 0 ? `${proche + 1}: ${lignes[proche].trim()}` : "aucune ligne ne contient ce jeton",
  };
}
