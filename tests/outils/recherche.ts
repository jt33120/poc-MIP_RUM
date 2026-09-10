// CHERCHER UNE CHAÎNE DANS LE DÉPÔT, SANS QU'UN ÉCHEC RESSEMBLE À UNE ABSENCE.
//
// ─────────────────────── LE DÉFAUT QUE CE MODULE CORRIGE ─────────────────────
//
// Plusieurs tests du dépôt affirment qu'une chaîne a DISPARU du code : « plus un
// seul fingerprint anonymisé dans la console », « plus de percentile_cont non
// pondéré ». Ces gardes valent ce que vaut la recherche qui les alimente.
//
// La première version enveloppait `grep` dans un `try { … } catch { return "" }`.
// Or `grep` sort en 1 quand il ne trouve rien — mais AUSSI en 2 quand il ne peut
// pas lire une cible, et `execFileSync` lève quand la sortie dépasse son tampon
// d'un mégaoctet, ou quand le système refuse de forker sous charge. Les quatre
// cas rendaient la même chaîne vide, donc la même conclusion : « absent ».
//
// Conséquences constatées, pas supposées :
//   • un fichier renommé faisait passer la garde AU VERT pour toujours, alors
//     qu'elle ne cherchait plus rien ;
//   • sous la suite complète, l'assertion anti-tautologie du même test tombait
//     par intermittence — deux fois — parce que `grep` échouait à s'exécuter et
//     que son échec se lisait « rien trouvé ».
//
// Les deux se reproduisent à volonté : cf. tests/unit/recherche.test.ts.
//
// ────────────────────────────── CE QU'ON FAIT ────────────────────────────────
//
// Le code de sortie 1 est le SEUL qui vaut « rien trouvé ». Tout le reste lève,
// avec le message de `grep`. Et on n'explore ni `node_modules` ni `.next` : ce
// sont des sorties de construction, pas du code source — les balayer coûtait
// 350 Mo par appel, ce qui est précisément ce qui rendait l'échec probable.
import { execFileSync } from "node:child_process";

/** Répertoires jamais explorés : ce ne sont pas des sources. */
export const EXCLUS = ["node_modules", ".next", ".git", "dist", "build", ".turbo", "coverage"] as const;

/** 32 Mo : au-delà, c'est que la recherche est trop large, et on veut le savoir. */
const TAMPON = 32 * 1024 * 1024;

export class EchecRecherche extends Error {
  constructor(
    readonly motif: string,
    readonly cibles: readonly string[],
    readonly code: number | null,
    readonly stderr: string,
  ) {
    super(
      `la recherche de « ${motif} » dans ${cibles.join(", ")} n'a pas pu s'exécuter ` +
        `(code ${code ?? "?"}) : ${stderr.trim() || "aucun message"}. ` +
        "Ce n'est PAS une absence — une garde qui lirait ce résultat comme « rien trouvé » " +
        "passerait au vert sans avoir rien cherché.",
    );
    this.name = "EchecRecherche";
  }
}

/**
 * `grep -RIn` sur des cibles du dépôt.
 *
 * @returns les lignes trouvées, ou "" quand il n'y en a AUCUNE (code 1).
 * @throws EchecRecherche pour tout autre échec — cible illisible, tampon
 *         dépassé, fork refusé. Un test ne doit jamais conclure d'un outil muet.
 */
export function chercher(motif: string, cibles: string[], racine: string): string {
  const args = ["-RIn", ...EXCLUS.flatMap((d) => ["--exclude-dir", d]), "--", motif, ...cibles];
  try {
    return execFileSync("grep", args, { cwd: racine, encoding: "utf8", maxBuffer: TAMPON });
  } catch (err) {
    const e = err as { status?: number | null; stderr?: string | Buffer; message?: string };
    // 1 = aucune correspondance. C'est le SEUL cas où le vide veut dire vide.
    if (e.status === 1) return "";
    throw new EchecRecherche(motif, cibles, e.status ?? null, String(e.stderr ?? e.message ?? ""));
  }
}

/** Les lignes trouvées, hors archive. */
export function lignesTrouvees(motif: string, cibles: string[], racine: string, options: { horsArchive?: boolean } = {}): string[] {
  const brut = chercher(motif, cibles, racine);
  const lignes = brut.split("\n").filter((l) => l !== "");
  // `/archive/` n'importe où dans la ligne, pas en préfixe : la sortie de grep
  // n'est relative que parce qu'on lui fixe un répertoire courant, et faire
  // dépendre le filtre de cette relativité le casse au premier déplacement.
  return options.horsArchive === false ? lignes : lignes.filter((l) => !l.includes("/archive/"));
}
