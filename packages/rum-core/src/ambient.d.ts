// Surface ambiante AUTORISÉE dans le cœur pur — déclarée ici, et nulle part
// ailleurs.
//
// Le tsconfig de ce package n'inclut ni la lib « DOM » ni `@types/node` : toute
// utilisation de `document`, `window`, `navigator`, `localStorage`, `process` ou
// d'un module `node:*` échoue donc à la COMPILATION, pas à la relecture. Ce
// fichier est la liste — volontairement courte — des globals universels
// (ECMAScript / WinterCG) dont les primitives dépendent réellement, chacun lu
// derrière un `typeof … !== "undefined"` parce qu'aucun n'est garanti sous
// Hermes.

declare class TextEncoder {
  encode(input: string): Uint8Array;
}

declare var crypto:
  | {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    }
  | undefined;
