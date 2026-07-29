// Facade xSOM AI Guard — SOURCE des métriques IA (XSOM_AI_URL + XSOM_AI_TOKEN).
// Renvoie le sous-objet IA du RumSummary, ou `null` si non configuré / erreur /
// timeout — l'appelant marque alors la section IA « unavailable » (AUCUN recalcul
// local ; rum_ai n'est plus la source, cf. ADR-0001). Ne lève jamais.
import type {
  SummaryAiModel,
  SummaryAiOperation,
  SummaryAiSeriesPoint,
  SummaryAiUser,
} from "./queries-summary";
import type { SummaryWindow } from "./read-tokens";

/** Le sous-ensemble IA exact du RumSummary (ce que xSOM renvoie et ce que le
 *  calcul local produit). */
export interface XsomAiFields {
  ai_calls: number;
  ai_tokens: number;
  ai_cost_usd: number;
  ai_p75_latency_ms: number | null;
  ai_error_rate: number | null;
  ai_by_model: SummaryAiModel[];
  ai_top_users: SummaryAiUser[];
  ai_by_operation: SummaryAiOperation[];
  ai_series: SummaryAiSeriesPoint[];
}

const TIMEOUT_MS = Number(process.env.XSOM_AI_TIMEOUT_MS ?? 4000);

/** Interroge xSOM `/ai/summary?app=&window=` avec un read token (Bearer). Renvoie
 *  les champs IA, ou null → section IA « unavailable » (aucun repli local, cf.
 *  ADR-0001). Jamais d'exception propagée. */
export async function fetchAiSummary(
  app: string,
  windowKey: SummaryWindow,
): Promise<XsomAiFields | null> {
  const base = process.env.XSOM_AI_URL;
  const token = process.env.XSOM_AI_TOKEN;
  if (!base || !token) return null; // non configuré → section IA « unavailable »

  const url =
    `${base.replace(/\/+$/, "")}/ai/summary` +
    `?app=${encodeURIComponent(app)}&window=${encodeURIComponent(windowKey)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const d = (await res.json()) as Partial<XsomAiFields>;
    // Garde de forme minimale : un payload inattendu → section « unavailable ».
    if (typeof d.ai_calls !== "number" || !Array.isArray(d.ai_by_operation)) return null;
    return {
      ai_calls: d.ai_calls,
      ai_tokens: d.ai_tokens ?? 0,
      ai_cost_usd: d.ai_cost_usd ?? 0,
      ai_p75_latency_ms: d.ai_p75_latency_ms ?? null,
      ai_error_rate: d.ai_error_rate ?? null,
      ai_by_model: d.ai_by_model ?? [],
      ai_top_users: d.ai_top_users ?? [],
      ai_by_operation: d.ai_by_operation,
      ai_series: d.ai_series ?? [],
    };
  } catch {
    return null; // réseau / timeout / JSON invalide → dégradation douce
  } finally {
    clearTimeout(timer);
  }
}
