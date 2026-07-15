// POST/GET /api/cron/openrouter-balance — poll du solde OpenRouter (UTI-C).
// Déclenché par Vercel Cron (en-tête Authorization: Bearer $CRON_SECRET). Lit le
// solde via l'API OpenRouter (clé OPENROUTER_API_KEY en env), enregistre un relevé,
// et émet une alerte « solde bas » au franchissement / après cooldown. Ne renvoie
// jamais 500 sur un hoquet réseau (le prochain tick réessaiera).
import { bearerMatches } from "@/lib/api/auth";
import { balanceStatus, crossedIntoLow, DEFAULT_LOW_BALANCE, OPENROUTER_CREDITS_URL, parseCredits } from "@/lib/openrouter";
import { insertBalance, latestBalance, lowAlertWithin, recordLowBalanceAlert } from "@/lib/queries-openrouter";

export const dynamic = "force-dynamic";

function envNum(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : fallback;
}

async function poll(req: Request): Promise<Response> {
  // Auth : Vercel Cron ajoute Authorization: Bearer $CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  if (!secret) return json({ error: "CRON_SECRET non configuré" }, 503);
  if (!bearerMatches(req.headers.get("authorization"), secret))
    return json({ error: "non autorisé" }, 401);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return json({ skipped: "OPENROUTER_API_KEY absent" }, 200);

  const threshold = envNum("OPENROUTER_LOW_BALANCE", DEFAULT_LOW_BALANCE);
  const currency = process.env.OPENROUTER_CURRENCY ?? "USD";
  const cooldownH = envNum("OPENROUTER_ALERT_COOLDOWN_HOURS", 24);
  const appId = process.env.OPENROUTER_ACCOUNT_APP || null;

  // Appel OpenRouter (timeout court ; échec réseau => 200 sans relevé).
  let json0: unknown;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(t);
    if (!res.ok) return json({ error: `OpenRouter ${res.status}` }, 200);
    json0 = await res.json();
  } catch (e) {
    return json({ error: `OpenRouter injoignable: ${(e as Error).message}` }, 200);
  }

  const credits = parseCredits(json0);
  if (!credits) return json({ error: "réponse OpenRouter illisible" }, 200);

  const status = balanceStatus(credits.balance, threshold);
  const prev = await latestBalance();
  await insertBalance({
    total_credits: credits.total_credits,
    total_usage: credits.total_usage,
    balance: credits.balance,
    threshold,
    currency,
    status,
  });

  // Alerte au franchissement ok->low, ou re-rappel si toujours bas après cooldown.
  let alerted = false;
  if (status === "low") {
    const crossed = crossedIntoLow(prev?.status ?? null, status);
    if (crossed || !(await lowAlertWithin(cooldownH))) {
      await recordLowBalanceAlert(credits.balance, threshold, currency, appId);
      alerted = true;
    }
  }

  return json({ balance: credits.balance, threshold, currency, status, alerted }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const GET = poll;
export const POST = poll;
