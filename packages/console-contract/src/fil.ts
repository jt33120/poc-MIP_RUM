// CE QU'UN TYPE DEVIENT SUR LE FIL.
//
// Une réponse de console-api traverse JSON. Une `Date` y devient une chaîne ISO,
// un `bigint` une chaîne ; une `Map` ou un `Set` n'y passent pas (`{}`). `Fil<T>`
// le dit au compilateur : un écran qui appellerait `.getTime()` sur une date
// reçue de console-api ne compile pas, au lieu de planter au rendu. Un DTO qui
// contient une Map rend `never` : il faut le changer, pas le transmettre.
export type Fil<T> = T extends Date
  ? string
  : T extends bigint
    ? string
    : T extends Map<unknown, unknown> | Set<unknown>
      ? never
      : T extends (...args: never[]) => unknown
        ? never
        : T extends readonly unknown[]
          ? // Type mappé sur un tableau : un tuple reste un tuple (`[clé, valeur][]`).
            { [K in keyof T]: Fil<T[K]> }
          : T extends object
            ? { [K in keyof T]: Fil<T[K]> }
            : T;
