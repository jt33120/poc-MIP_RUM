// Les sources d'erreurs et leurs libellés, SANS la base.
//
// Séparé de `queries-errors.ts` le 24/09/2026 (cliquet de la piste C,
// docs/architecture/console-api/README.md) : un badge qui écrit « JavaScript
// navigateur » n'a pas à importer le pool de la console. Tant qu'il passait par
// `queries-errors.ts`, son graphe d'import atteignait `lib/db.ts`, et il comptait
// parmi ce que la console doit encore sortir de la base.

// Copie de l'énumération d'ingestion (`ERROR_SOURCES` d'otlp.mjs), même ordre :
// la console ne peut pas typer proprement un module .mjs. Deux listes finissent
// par diverger ; tests/unit/queries-errors.test.ts compare donc les deux.
export const ERROR_SOURCES = [
  "browser_js",
  "browser_console",
  "browser_resource",
  "browser_csp",
  "browser_network",
  "node",
  "python",
  "react_native_js",
  "native",
  "otel",
] as const;

export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  browser_js: "JavaScript navigateur",
  browser_console: "Console navigateur",
  browser_resource: "Ressource navigateur",
  browser_csp: "CSP navigateur",
  browser_network: "Réseau navigateur",
  node: "Node.js",
  python: "Python",
  react_native_js: "JavaScript React Native",
  native: "Natif mobile",
  otel: "OpenTelemetry",
};

/**
 * Une source map de release ne décrit que le JavaScript livré au navigateur ou à
 * React Native. Appliquée à une stack Node, elle réécrirait une frame serveur qui
 * porte le même nom de fichier ; à une stack Python ou JVM, elle ne décrirait
 * rien. Source inconnue (émetteur non typé, ligne antérieure à v69) : le
 * comportement historique est conservé.
 */
export function stackSymbolisable(source: ErrorSource | null): boolean {
  return source === null || source.startsWith("browser_") || source === "react_native_js";
}
