import { defineConfig } from "vitest/config";

// Alias `@/` → apps/console (aligné sur le tsconfig de la console) pour permettre
// aux tests d'importer les route handlers Next qui utilisent `@/...`. Les
// `test:unit` tournent depuis la racine du repo (process.cwd() = racine).
//
// Alias `@mip/rum-core` → sa SOURCE. Les tests unitaires importent les SDK par
// chemin relatif (`packages/rum-sdk/src/index.ts`), c'est-à-dire du TypeScript
// non compilé : les faire résoudre le cœur partagé vers `dist/` imposerait un
// build avant toute exécution de `pnpm test:unit`, y compris sur un clone neuf.
// L'artefact PUBLIÉ, lui, ne pointe jamais vers la source : son `exports` va sur
// `dist/`, et c'est le mini-consommateur isolé (`scripts/verify-sdk-packaging.mjs`)
// qui vérifie ce chemin-là, sur les paquets réellement construits.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${process.cwd()}/apps/console/` },
      { find: /^@mip\/rum-core$/, replacement: `${process.cwd()}/packages/rum-core/src/index.ts` },
    ],
  },
});
