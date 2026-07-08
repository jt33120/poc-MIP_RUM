// Solde OpenRouter — logique PURE et testée (UTI-C). Le poll (cron) et l'endpoint
// /api/v1/ai/credits partagent ces helpers : parsing de la réponse crédits, calcul
// du solde, statut vs seuil, et détection du front « ok -> bas » pour n'alerter
// qu'au franchissement (le re-rappel après cooldown est géré côté requêtage).

/** Endpoint crédits OpenRouter (réponse { data: { total_credits, total_usage } }). */
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

/** Seuil bas par défaut (unité native du compte OpenRouter = USD). Surchargé par env. */
export const DEFAULT_LOW_BALANCE = 5;

export interface CreditsSnapshot {
  total_credits: number;
  total_usage: number;
  balance: number;
}

export type BalanceStatus = "ok" | "low";

/**
 * Parse la réponse de /api/v1/credits. Tolère la forme historique /auth/key
 * ({ data: { limit, usage, limit_remaining } }). Renvoie null si illisible.
 */
export function parseCredits(json: unknown): CreditsSnapshot | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== "object") return null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

  const totalCredits = num(data.total_credits);
  const totalUsage = num(data.total_usage);
  if (totalCredits != null && totalUsage != null) {
    return { total_credits: totalCredits, total_usage: totalUsage, balance: totalCredits - totalUsage };
  }
  // Forme /auth/key : limit (crédit total, peut être null=illimité) + usage + limit_remaining
  const limit = num(data.limit);
  const usage = num(data.usage);
  const remaining = num(data.limit_remaining);
  if (remaining != null) {
    return { total_credits: limit ?? remaining + (usage ?? 0), total_usage: usage ?? 0, balance: remaining };
  }
  return null;
}

/** Statut du solde vs seuil : « low » si strictement sous le seuil. */
export function balanceStatus(balance: number, threshold: number): BalanceStatus {
  return balance < threshold ? "low" : "ok";
}

/**
 * Faut-il alerter maintenant ? Uniquement au FRANCHISSEMENT vers « low » : le statut
 * courant est « low » et le précédent ne l'était pas (ok, ou aucun historique).
 * Le re-rappel périodique tant que ça reste bas est décidé côté requêtage (cooldown).
 */
export function crossedIntoLow(prev: BalanceStatus | null, curr: BalanceStatus): boolean {
  return curr === "low" && prev !== "low";
}
