// CORS de l'API v1 : liste blanche d'origines via CONSOLE_API_ALLOWED_ORIGINS
// (séparées par des virgules ; "*" pour tout autoriser, à éviter en prod).
// Le front Angular MIP étant servi sur une autre origine, son origine doit y figurer.
// Helper PUR : prend l'en-tête Origin brut, renvoie les en-têtes CORS à appliquer.
// Sans Origin (appel serveur-à-serveur) ou origine non autorisée : aucun en-tête CORS
// (le navigateur bloque ; un appel serveur sans Origin n'en a pas besoin).

function allowedOrigins(): string[] {
  return (process.env.CONSOLE_API_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  const list = allowedOrigins();
  const h: Record<string, string> = {};
  if (list.includes("*")) {
    h["Access-Control-Allow-Origin"] = "*";
  } else if (list.includes(origin)) {
    h["Access-Control-Allow-Origin"] = origin;
    h["Vary"] = "Origin";
    h["Access-Control-Allow-Credentials"] = "true"; // autorise le cookie de session cross-origin
  } else {
    return {}; // origine non listée -> pas de CORS
  }
  h["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  h["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  h["Access-Control-Max-Age"] = "600";
  return h;
}
