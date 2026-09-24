// CE QU'UN TRAITEMENT REÇOIT : le principal, l'entrée validée, l'échéance, le journal.
//
// Un traitement ne lit JAMAIS la requête brute : ni en-têtes, ni cookies, ni
// corps non validé. Tout ce qu'il sait vient d'ici, posé par le pipeline dans
// l'ordre de ses gardes. C'est ce qui rend la matrice d'autorisations prouvable :
// le traitement ne peut pas contourner une garde qu'il ne voit pas.

/** Qui appelle. Le rôle et le périmètre viennent de la BASE (la ligne de session), jamais du jeton seul. */
export type Principal =
  | { readonly kind: "anonyme" }
  | {
      readonly kind: "session";
      readonly sessionId: string;
      /** `null` pour une session de démo. */
      readonly userId: string | null;
      readonly email: string;
      readonly role: "admin" | "viewer";
      /** Périmètre : `null` = toutes les applications. */
      readonly apps: readonly string[] | null;
      readonly demo: boolean;
    };

/** Le journal du service (celui du kit) : des champs, jamais une IP ni une identité brute. */
export interface Journal {
  info(message: string, champs?: Record<string, unknown>): void;
  warn(message: string, champs?: Record<string, unknown>): void;
  error(message: string, champs?: Record<string, unknown>): void;
}

/** La base, telle qu'un traitement la voit : un `query` (le pool du kit). */
export interface Lecteur {
  query<T = Record<string, unknown>>(texte: string, valeurs?: readonly unknown[]): Promise<{ rows: T[] }>;
}

export interface Contexte<P = unknown, Q = unknown, B = unknown> {
  readonly requestId: string;
  readonly principal: Principal;
  readonly params: P;
  readonly requete: Q;
  readonly corps: B;
  /** Instant (ms epoch) au-delà duquel l'appelant n'attend plus. */
  readonly echeance: number;
  /** Les applications EFFECTIVES d'une portée `app` (`app=all` résolu) ; `null` hors portée `app`. */
  readonly apps: readonly string[] | null;
  readonly journal: Journal;
}
