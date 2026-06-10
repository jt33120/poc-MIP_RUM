"use server";
// Server Actions de la page /alerts — validation côté serveur puis SQL via lib/queries-v2.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acknowledgeAlertEvent,
  ALERT_COMPARATORS,
  ALERT_METRICS,
  insertAlertRule,
  runCheckAlerts,
  toggleAlertRuleActive,
  updateAlertRule,
  type RuleInput,
} from "@/lib/queries-v2";

function ruleFromForm(fd: FormData): RuleInput {
  const metric = String(fd.get("metric") ?? "");
  if (!(ALERT_METRICS as readonly string[]).includes(metric)) {
    throw new Error(`metric invalide : ${metric}`);
  }
  const comparator = String(fd.get("comparator") ?? ">");
  if (!(ALERT_COMPARATORS as readonly string[]).includes(comparator)) {
    throw new Error(`comparateur invalide : ${comparator}`);
  }
  const threshold = Number(fd.get("threshold"));
  if (!Number.isFinite(threshold)) throw new Error("seuil invalide");
  const window_minutes = Math.min(
    Math.max(Math.trunc(Number(fd.get("window_minutes")) || 15), 1),
    1440,
  );
  const route = String(fd.get("route") ?? "").trim() || null;
  const webhook_url = String(fd.get("webhook_url") ?? "").trim() || null;
  if (webhook_url && !/^https?:\/\//.test(webhook_url)) {
    throw new Error("webhook_url doit être une URL http(s)");
  }
  const app_id = String(fd.get("app_id") ?? "").trim();
  if (!app_id) throw new Error("app_id requis");
  return { app_id, metric, route, comparator, threshold, window_minutes, webhook_url };
}

export async function createRuleAction(fd: FormData): Promise<void> {
  await insertAlertRule(ruleFromForm(fd));
  revalidatePath("/alerts");
}

export async function updateRuleAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await updateAlertRule(id, ruleFromForm(fd));
  revalidatePath("/alerts");
}

export async function toggleRuleAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await toggleAlertRuleActive(id);
  revalidatePath("/alerts");
}

export async function ackEventAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await acknowledgeAlertEvent(id);
  revalidatePath("/alerts");
}

/** « Évaluer maintenant » : select check_alerts(), résultat affiché via ?fired=N. */
export async function evaluateNowAction(fd: FormData): Promise<void> {
  const fired = await runCheckAlerts();
  revalidatePath("/alerts");
  // qs = filtres globaux à préserver (app/period/device), fourni par la page
  const qs = String(fd.get("qs") ?? "");
  redirect(`/alerts${qs ? `${qs}&` : "?"}fired=${fired}`);
}
