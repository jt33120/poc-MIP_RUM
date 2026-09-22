import { createRequire } from "node:module";
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
//
// RENDU DES COMPOSANTS DE LA CONSOLE (F02). Un test `tests/unit/Z.test.tsx` rend un
// composant SSR par `renderToStaticMarkup` (plan § 0.4). Deux obstacles, levés ici :
//
//   1. Le JSX. Le tsconfig de la console garde le JSX tel quel (`jsx: "preserve"` :
//      c'est Next qui le compile), et le transformateur de Vite suit ce tsconfig —
//      un `.tsx` de `apps/console` arrivait donc au moteur de tests avec du JSX
//      brut. On impose ici le runtime AUTOMATIQUE (`react/jsx-runtime`), celui que
//      Next emploie : aucun `import React` n'est exigé dans les composants.
//      Portée : les tests seulement ; `next build` ne lit pas ce fichier.
//
//   2. React. `react` et `react-dom` sont des dépendances de la CONSOLE, pas de la
//      racine : depuis `tests/unit/`, `react-dom/server` et `react/jsx-runtime` ne
//      se résolvent pas. On les résout depuis `apps/console` — les MÊMES fichiers
//      que ceux que Next charge (une seule instance de React : deux copies
//      casseraient les hooks). `require.resolve` applique les conditions
//      d'export de Node (`react-dom/server` → `server.node.js`).
//
// Les tests existants n'importent ni React ni JSX : ils ne voient aucune différence.
const depuisConsole = createRequire(`${process.cwd()}/apps/console/package.json`);
const REACT = ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom", "react-dom/server"];

export default defineConfig({
  oxc: {
    jsx: { runtime: "automatic", importSource: "react" },
  },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${process.cwd()}/apps/console/` },
      { find: /^@mip\/rum-core$/, replacement: `${process.cwd()}/packages/rum-core/src/index.ts` },
      ...REACT.map((specifier) => ({
        find: new RegExp(`^${specifier.replace("/", "\\/")}$`),
        replacement: depuisConsole.resolve(specifier),
      })),
    ],
  },
});
