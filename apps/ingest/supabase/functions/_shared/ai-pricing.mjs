// Table de prix LLM (USD par 1M tokens) : coût ESTIMÉ calculé à l'ingestion, comme
// xsom-ai-guard (core/pricing). JS pur (Node local + edge Deno).
// Forme : provider -> { "<model-prefix>": [in, out], "": [in, out] (défaut provider) }.
// Match par PRÉFIXE de modèle (tolère les suffixes de version). Modèle inconnu d'un
// provider connu -> tarif "" ; provider inconnu -> 0 (tokens quand même conservés).
// Si l'émetteur fournit un coût réel (gen_ai.usage.cost, ex. OpenRouter), il PRIME.
const PRICING = {
  openai: {
    "gpt-4o-mini": [0.15, 0.6],
    "gpt-4o": [2.5, 10],
    "gpt-4.1-mini": [0.4, 1.6],
    "gpt-4.1": [2, 8],
    "o3": [2, 8],
    "": [2.5, 10],
  },
  anthropic: {
    "claude-opus-4": [15, 75],
    "claude-sonnet-4": [3, 15],
    "claude-3-7-sonnet": [3, 15],
    "claude-3-5-haiku": [0.8, 4],
    "claude-3-haiku": [0.25, 1.25],
    "": [3, 15],
  },
  mistral: {
    "mistral-large": [2, 6],
    "mistral-small": [0.2, 0.6],
    "codestral": [0.3, 0.9],
    "": [1, 3],
  },
  google: { "gemini-2.5-pro": [1.25, 10], "gemini-2.5-flash": [0.3, 2.5], "": [1.25, 10] },
  openrouter: { "": [0, 0] }, // coût réel via gen_ai.usage.cost inline
};

/** Coût estimé (USD, 6 déc.) d'un appel selon provider/model et tokens. */
export function aiCostUsd(provider, model, promptTokens, completionTokens) {
  const table = PRICING[String(provider ?? "").toLowerCase()];
  if (!table) return 0;
  const m = String(model ?? "").toLowerCase();
  let rate = table[""] ?? [0, 0];
  let best = -1;
  for (const key of Object.keys(table)) {
    if (key && m.startsWith(key) && key.length > best) {
      rate = table[key];
      best = key.length; // préfixe le plus spécifique gagne
    }
  }
  const inTok = Number(promptTokens) || 0;
  const outTok = Number(completionTokens) || 0;
  const cost = (inTok / 1e6) * rate[0] + (outTok / 1e6) * rate[1];
  return Math.round(cost * 1e6) / 1e6;
}
