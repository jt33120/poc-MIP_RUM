// Les globales que le backend teste avant de les lire (`typeof X !== "undefined"`),
// pour `tsconfig.backend.json`. `limits.mjs` lit l'environnement sous Deno quand
// il existe ; le décrire ici évite d'installer ses types pour une seule ligne.
declare const Deno: { env: { get(nom: string): string | undefined } } | undefined;
