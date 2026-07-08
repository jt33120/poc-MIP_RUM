// GET /api/v1/ai/credits — dernier solde OpenRouter connu + statut (UTI-C).
// Alimente le « warning rouge < seuil » côté front Admin UTI. Le relevé est
// produit par le cron /api/cron/openrouter-balance. Le compte OpenRouter est
// global (une clé = un compte) : pas de filtre app/période.
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { latestBalance } from "@/lib/queries-openrouter";

export const dynamic = "force-dynamic";

export const OPTIONS = preflight;

export const GET = handle(async () => {
  const latest = await latestBalance();
  if (!latest) {
    return { status: null, balance: null, checked_at: null, note: "aucun relevé de solde encore disponible" };
  }
  return {
    status: latest.status, // 'ok' | 'low' -> le front affiche le warning si 'low'
    balance: latest.balance,
    total_credits: latest.total_credits,
    total_usage: latest.total_usage,
    threshold: latest.threshold,
    currency: latest.currency,
    checked_at: latest.checked_at,
  };
});
