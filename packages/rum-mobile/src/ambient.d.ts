// Surface ambiante AUTORISÉE dans le runtime React Native.
//
// Le tsconfig n'inclut ni la lib « DOM » ni `@types/node` : `document`,
// `window`, `navigator` et `process` ne compilent pas. Les globals réellement
// fournis par Hermes/JSC et par React Native sont déclarés ici, au plus juste.
// `global` (fetch, Headers, ErrorUtils, require) reste typé en `any` dans
// index.ts : ces surfaces varient d'une version de RN à l'autre, et un typage
// strict y donnerait une fausse garantie.

declare const console: {
  warn(...args: unknown[]): void;
};

/** RN renvoie un identifiant opaque ; `unref` n'existe que sous Node. */
declare function setInterval(handler: () => void, ms: number): { unref?: () => void };
declare function clearInterval(handle: unknown): void;
declare function setTimeout(handler: () => void, ms: number): { unref?: () => void };
declare function clearTimeout(handle: unknown): void;

/**
 * P7.2 — mesure d'octets et abandon de requête. Les deux sont OPTIONNELS : le
 * code teste leur présence avant usage, parce qu'aucun des moteurs JS visés ne
 * les garantit tous les deux.
 */
declare class TextEncoder {
  encode(input: string): { length: number };
}

declare var crypto:
  | {
      randomUUID?: () => string;
      getRandomValues?: (array: Uint8Array) => Uint8Array;
    }
  | undefined;
