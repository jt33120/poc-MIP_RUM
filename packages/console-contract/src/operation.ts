// UNE OPÉRATION DE console-api, DÉCLARÉE UNE FOIS.
//
// La console l'appelle (`lib/backend.ts`, C0b), le service la sert
// (`@mip/console-api`, `servir(operation, politique, traitement)`). Les deux
// partent du MÊME descripteur : identifiant, méthode, chemin. Ses quatre types —
// paramètres de chemin P, de requête Q, corps B, réponse R — sont FANTÔMES : ils
// n'existent qu'au typage. Un appel côté console et un traitement côté service
// qui divergent ne compilent pas ; rien n'est validé en plus à l'exécution (les
// tests de parité vérifient les formes réelles).
//
// Pas de génération de code, pas de zod : le dépôt n'en a pas, et une douzaine
// d'opérations par lot se déclarent plus lisiblement à la main.

export type Methode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Chemin d'opération : toujours sous `/v1`, paramètres entre accolades (`/v1/dashboards/{id}`). */
export type Chemin = `/v1/${string}`;

declare const FANTOME: unique symbol;

/** Ce qu'aucun paramètre n'a : `{}` fermé. */
export type Aucun = Record<string, never>;

export interface Operation<P = Aucun, Q = Aucun, B = never, R = unknown> {
  /** Identifiant stable, `domaine.nom` : il nomme la ligne de la matrice d'autorisations et la doc. */
  readonly id: string;
  readonly methode: Methode;
  readonly chemin: Chemin;
  /** Types fantômes : jamais présents à l'exécution. */
  readonly [FANTOME]?: { readonly p: P; readonly q: Q; readonly b: B; readonly r: R };
}

const ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;
const SEGMENT = /^(\{[a-z][a-zA-Z0-9_]*\}|\.?[a-z0-9][a-z0-9._-]*)$/;

/** Déclare une opération. Lève si l'identifiant ou le chemin est mal formé : au chargement du module, pas en production. */
export function operation<P = Aucun, Q = Aucun, B = never, R = unknown>(
  id: string,
  methode: Methode,
  chemin: Chemin,
): Operation<P, Q, B, R> {
  if (!ID.test(id)) throw new Error(`opération : identifiant « ${id} » invalide (attendu domaine.nom)`);
  const segments = chemin.slice(1).split("/");
  if (segments[0] !== "v1" || segments.length < 2 || !segments.slice(1).every((s) => SEGMENT.test(s))) {
    throw new Error(`opération ${id} : chemin « ${chemin} » invalide`);
  }
  return Object.freeze({ id, methode, chemin });
}

/** Les noms des paramètres de chemin, dans l'ordre : `/v1/a/{x}/b/{y}` → `["x", "y"]`. */
export function parametresDe(chemin: Chemin): string[] {
  return [...chemin.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]);
}

export type ParametresDe<O> = O extends Operation<infer P, infer _Q, infer _B, infer _R> ? P : never;
export type RequeteDe<O> = O extends Operation<infer _P, infer Q, infer _B, infer _R> ? Q : never;
export type CorpsDe<O> = O extends Operation<infer _P, infer _Q, infer B, infer _R> ? B : never;
export type ReponseDe<O> = O extends Operation<infer _P, infer _Q, infer _B, infer R> ? R : never;
