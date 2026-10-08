// LA LECTURE SEULE D'UNE SESSION DE DÉMO, TENUE PAR POSTGRES (audit du 07/10/2026).
//
// Une session de démo est refusée sur toute écriture AVANT le traitement : par le
// pipeline de console-api (`demo: "refus"`), par le middleware de la console (toute
// méthode autre que GET). Ces gardes sont du code ; une lecture qui écrirait par
// effet de bord (une fonction SQL, un `insert … returning` glissé dans un chargeur)
// passerait entre elles. Défense en profondeur : ce qu'un chargeur exécute pour une
// démo part dans une transaction `READ ONLY`, et Postgres refuse lui-même toute
// écriture (SQLSTATE 25006, `read_only_sql_transaction`).
//
// Le drapeau voyage avec l'appel (AsyncLocalStorage), pas dans un paramètre : les
// chargeurs n'ont pas à le connaître. La couche de données le lit — `lib/db.ts` dans
// la console, `services/console-api/shims/db.mjs` dans le service — et chacune de
// ses requêtes s'ouvre alors par `begin transaction read only`.
import { AsyncLocalStorage } from "node:async_hooks";

const contexte = new AsyncLocalStorage<true>();

/** Exécute `fn` en lecture seule : chaque requête de la couche de données y est une transaction `READ ONLY`. */
export function enLectureSeule<T>(fn: () => Promise<T>): Promise<T> {
  return contexte.run(true, fn);
}

/** `fn` en lecture seule pour une démo ; tel quel sinon. */
export function lectureSeuleSiDemo<T>(demo: boolean | undefined, fn: () => Promise<T>): Promise<T> {
  return demo ? enLectureSeule(fn) : fn();
}

/** L'appel en cours est-il en lecture seule ? */
export function estEnLectureSeule(): boolean {
  return contexte.getStore() === true;
}

/** Le début de transaction qui convient à l'appel en cours. */
export function debutDeTransaction(): string {
  return estEnLectureSeule() ? "begin transaction read only" : "begin";
}
