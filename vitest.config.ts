import { defineConfig } from "vitest/config";

// Alias `@/` → apps/console (aligné sur le tsconfig de la console) pour permettre
// aux tests d'importer les route handlers Next qui utilisent `@/...`. Les
// `test:unit` tournent depuis la racine du repo (process.cwd() = racine).
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${process.cwd()}/apps/console/` }],
  },
});
