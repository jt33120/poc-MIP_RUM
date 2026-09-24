// Moteur de symbolication source map v3 (P0 #3). Depuis P5.4, il vit dans le noyau
// partagé `@mip/backend/shared/sourcemap.mjs` : l'ingestion, les deux ports d'upload,
// le CLI de CI et la console décodent avec la MÊME implémentation. Ce module le
// réexporte pour les importateurs historiques de la console.
export {
  codeContext,
  createConsumer,
  parseStackLine,
  symbolicateStack,
} from "@mip/backend/shared/sourcemap.mjs";
export type { CodeContext, RawSourceMap, ResolvedFrame } from "@mip/backend/shared/sourcemap.mjs";
