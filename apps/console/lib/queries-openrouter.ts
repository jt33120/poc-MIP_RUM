// Solde OpenRouter — couche I/O (UTI-C). Lecture du dernier relevé (endpoint
// /api/v1/ai/credits + poll), insertion d'un snapshot, et enregistrement de
// l'alerte « solde bas » au franchissement / après cooldown. L'alerte réutilise
// l'infra existante : alert_event + route_alert (webhook/slack via pg_net ;
// e-mail = stub existant). route_alert est best-effort (jamais bloquant).
import { q } from "./db";
import type { BalanceStatus } from "./openrouter";

/** Préfixe de message qui identifie nos alertes de solde (pour le cooldown). */
const ALERT_MSG_PREFIX = "Solde OpenRouter bas";

export interface BalanceRow {
  id: number;
  checked_at: string;
  total_credits: number | null;
  total_usage: number | null;
  balance: number;
  threshold: number;
  currency: string;
  status: BalanceStatus;
}

/** Dernier relevé connu (null si aucun). */
export async function latestBalance(): Promise<BalanceRow | null> {
  const [r] = await q<BalanceRow>(
    `select id, checked_at, total_credits, total_usage, balance, threshold, currency, status
     from openrouter_balance order by checked_at desc limit 1`,
  );
  return r ?? null;
}

export interface BalanceSnapshot {
  total_credits: number | null;
  total_usage: number | null;
  balance: number;
  threshold: number;
  currency: string;
  status: BalanceStatus;
}

/** Enregistre un relevé. */
export async function insertBalance(s: BalanceSnapshot): Promise<void> {
  await q(
    `insert into openrouter_balance (total_credits, total_usage, balance, threshold, currency, status)
     values ($1, $2, $3, $4, $5, $6)`,
    [s.total_credits, s.total_usage, s.balance, s.threshold, s.currency, s.status],
  );
}

/** Une alerte « solde bas » a-t-elle été émise dans les `hours` dernières heures ? */
export async function lowAlertWithin(hours: number): Promise<boolean> {
  const [r] = await q<{ n: number }>(
    `select count(*)::int as n from alert_event
     where message like $1 and fired_at > now() - ($2 || ' hours')::interval`,
    [`${ALERT_MSG_PREFIX}%`, String(hours)],
  );
  return (r?.n ?? 0) > 0;
}

/**
 * Enregistre l'alerte « solde bas » : alert_event (visible dans /alerts) + tentative
 * de routage vers les canaux (webhook/slack). route_alert est best-effort — une
 * absence de droit d'EXECUTE ne doit jamais casser le poll.
 */
export async function recordLowBalanceAlert(
  balance: number,
  threshold: number,
  currency: string,
  appId: string | null,
): Promise<void> {
  const text = `${ALERT_MSG_PREFIX} : ${balance.toFixed(2)} ${currency} (seuil ${threshold} ${currency}) — OpenRouter`;
  const [ev] = await q<{ id: number }>(
    `insert into alert_event (value, message, severity) values ($1, $2, 'warning') returning id`,
    [balance, text],
  );
  if (!ev) return;
  const payload = JSON.stringify({
    source: "mip-rum",
    kind: "openrouter_balance",
    balance,
    threshold,
    currency,
    text: `[MIP RUM] ${text}`,
  });
  try {
    await q(`select route_alert($1, $2, 'warning', $3, $4::jsonb)`, [ev.id, appId, `[MIP RUM] ${text}`, payload]);
  } catch (e) {
    // canaux non routés (droits/pg_net) : l'événement reste enregistré et visible.
    console.warn("[openrouter] route_alert non exécuté:", (e as Error).message);
  }
}
