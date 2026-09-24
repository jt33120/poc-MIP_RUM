// VALIDER UNE ENTRÉE : des combinateurs, pas une bibliothèque.
//
// Chacun rend `Verdict<T>` — la valeur, ou l'erreur et le champ en cause. Le
// service refuse en 400 `entree_invalide` AVANT le traitement ; le traitement ne
// reçoit que des valeurs typées. Même forme que `Parsed<T>` du contrat de requête
// de la console (`value` / `error`), pour que les deux se rejoignent quand
// `query-contract.ts` entrera dans ce paquet.

export interface ErreurEntree {
  readonly champ: string;
  readonly message: string;
}

export type Verdict<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ErreurEntree };

export type Validateur<T> = (brut: unknown, champ: string) => Verdict<T>;

const ok = <T>(value: T): Verdict<T> => ({ ok: true, value });
const non = (champ: string, message: string): Verdict<never> => ({ ok: false, error: { champ, message } });

/** Une chaîne, bornée, éventuellement à un motif. */
export function chaine(opts: { min?: number; max: number; motif?: RegExp; description?: string }): Validateur<string> {
  return (brut, champ) => {
    if (typeof brut !== "string") return non(champ, "chaîne attendue");
    if (brut.length < (opts.min ?? 1) || brut.length > opts.max) return non(champ, `longueur de ${opts.min ?? 1} à ${opts.max} caractères`);
    if (opts.motif && !opts.motif.test(brut)) return non(champ, opts.description ?? "format invalide");
    return ok(brut);
  };
}

/** Un entier en base 10, borné. Accepte le texte d'une query string. */
export function entier(opts: { min: number; max: number }): Validateur<number> {
  return (brut, champ) => {
    const texte = typeof brut === "number" ? String(brut) : brut;
    if (typeof texte !== "string" || !/^-?\d{1,15}$/.test(texte)) return non(champ, "entier attendu");
    const n = Number(texte);
    if (n < opts.min || n > opts.max) return non(champ, `entier de ${opts.min} à ${opts.max}`);
    return ok(n);
  };
}

/** Une valeur parmi une liste fermée. */
export function parmi<const V extends string>(valeurs: readonly V[]): Validateur<V> {
  return (brut, champ) =>
    typeof brut === "string" && (valeurs as readonly string[]).includes(brut) ? ok(brut as V) : non(champ, `valeur parmi ${valeurs.join(", ")}`);
}

/** Absent → `undefined` ; présent → validé. */
export function facultatif<T>(v: Validateur<T>): Validateur<T | undefined> {
  return (brut, champ) => (brut === undefined || brut === null || brut === "" ? ok(undefined) : v(brut, champ));
}

type Forme<S> = { [K in keyof S]: S[K] extends Validateur<infer T> ? T : never };

/**
 * Un objet aux champs connus. Un champ INCONNU est refusé : une entrée qui porte
 * plus que ce que le traitement lit est une erreur d'appel, pas un détail.
 */
export function objet<S extends Record<string, Validateur<unknown>>>(schema: S): Validateur<Forme<S>> {
  return (brut, champ) => {
    if (typeof brut !== "object" || brut === null || Array.isArray(brut)) return non(champ, "objet attendu");
    const entree = brut as Record<string, unknown>;
    for (const cle of Object.keys(entree)) if (!(cle in schema)) return non(cle, "champ inconnu");
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(schema)) {
      const verdict = v(entree[cle], cle);
      if (!verdict.ok) return verdict;
      if (verdict.value !== undefined) sortie[cle] = verdict.value;
    }
    return ok(sortie as Forme<S>);
  };
}
