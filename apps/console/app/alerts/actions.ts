"use server";
// Server Actions de la page /alerts — validation côté serveur puis SQL via lib/queries-v2.
//
// TOUTES réservées aux administrateurs. Ce fichier n'a longtemps porté AUCUNE
// garde : n'importe quel utilisateur connecté, y compris un viewer scopé sur une
// seule application, pouvait créer une règle ou un canal de notification portant
// une URL de webhook arbitraire, sur n'importe quel app_id. Deux défauts en un —
// une élévation de privilège (dans ce modèle, « viewer » veut dire lecture seule)
// et une écriture inter-tenant (aucun contrôle de l'app_id du formulaire) — le
// tout adossé à une primitive de requête sortante, donc utilisable comme relais.
//
// `ecrivain()` — `requireAdmin()` (redirige : /login si anonyme, / si viewer), puis
// refus d'une session de démonstration — est posé en première ligne : il coupe
// l'action avant toute lecture du formulaire. La démo était déjà arrêtée par le
// middleware (non-GET refusés) ; l'action ne s'en remet plus à lui (V9, piège 20).
// Une règle est de plus bornée au périmètre d'apps du principal (`authorizedAppsOf`).
//
// LES URL SORTANTES SONT JUGÉES À L'ÉCRITURE (P1). Le webhook d'une règle et la
// cible d'un canal webhook/Slack sont postés par le scheduler, depuis le réseau
// privé Railway. `refuserUrlSortante` applique le contrôle sans réseau de
// `safe-fetch` (IP littérale, `*.railway.internal`, `localhost`, nom sans
// domaine, identifiants, protocole) et renvoie sur /alerts avec le CODE du motif,
// que la page traduit. Pas d'exception : en production, Next la remplacerait par
// l'écran d'erreur générique, et l'administrateur ne saurait pas quoi corriger.
// Ce contrôle ne fait pas foi — le DNS peut changer après l'écriture : à chaque
// livraison, `safeFetch` rejuge la cible et solde `skipped` ce qu'il refuse.
import { redirect } from "next/navigation";
import { verifierUrlSortante } from "@mip/backend/lib/net/safe-fetch.mjs";
import { revalidatePath } from "@/lib/next-cache";
import { ALERT_MODES, ALERT_SEVERITIES, CHANNEL_KINDS } from "@/lib/alerting";
import { RELEASE_METRICS, SEUIL_REGRESSION_DEFAUT } from "@/lib/alerting";
import { requireAdmin, type SessionUser } from "@/lib/auth";
import { authorizedAppsOf } from "@/lib/query-contract";
import { hasSqlControlCharacters } from "@/lib/error-issue-workflow";
import {
  acknowledgeAlertEvent,
  ALERT_COMPARATORS,
  appDeRegle,
  isAlertMetric,
  insertAlertRule,
  runCheckAlerts,
  runCheckSloBurn,
  runRouteIssueNotifications,
  SLO_METRICS,
  toggleAlertRuleActive,
  updateAlertRule,
  type RuleInput,
} from "@/lib/queries-v2";
import {
  deleteChannel,
  deleteSlo,
  insertChannel,
  insertSlo,
  toggleChannel,
  toggleSlo,
  type ChannelInput,
  type SloInput,
} from "@/lib/queries-alerting";

/** Écriture réservée à un administrateur HORS démonstration (V9). */
async function ecrivain(): Promise<SessionUser> {
  const user = await requireAdmin();
  if (user.demo) throw new Error("session de démonstration : lecture seule");
  return user;
}

/** URL sortante refusée : retour sur /alerts avec le code du motif (lu par la page). */
function refuserUrlSortante(texte: string): void {
  const verdict = verifierUrlSortante(texte);
  if (!verdict.ok) redirect(`/alerts?url_refusee=${verdict.code}`);
}

/** Une règle ne s'écrit que sur une app du périmètre du principal (V7). */
function dansLePerimetre(user: SessionUser, appId: string | null): void {
  const autorisees = authorizedAppsOf(user);
  if (autorisees !== null && (appId === null || !autorisees.includes(appId))) {
    throw new Error(`app hors périmètre : ${appId ?? "règle inconnue"}`);
  }
}

/**
 * Hausse tolérée d'une règle de release, en pour cent. Absente du formulaire : la
 * valeur par défaut (+20 %). Saisie vide, nulle, négative ou démesurée : refusée —
 * jamais remplacée en silence.
 */
function hausseTolereeDe(fd: FormData): number {
  const brute = fd.get("release_pct");
  if (brute === null) return SEUIL_REGRESSION_DEFAUT;
  const texte = String(brute).trim();
  const pct = texte === "" ? Number.NaN : Number(texte);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
    throw new Error("hausse tolérée invalide : un pourcentage strictement positif, 1 000 au plus");
  }
  return pct;
}

function ruleFromForm(fd: FormData): RuleInput {
  const selectedMetric = String(fd.get("metric") ?? "");
  const eventName = String(fd.get("event_name") ?? "").trim();
  const issueId = String(fd.get("issue_id") ?? "").trim().toLowerCase();
  const metric =
    selectedMetric === "event" ? `event:${eventName}` : selectedMetric === "issue" ? `issue:${issueId}` : selectedMetric;
  if (!isAlertMetric(metric)) {
    throw new Error(`metric invalide : ${metric}`);
  }
  // L'env filtre les occurrences d'une issue ; ailleurs il n'a pas de source et
  // serait ignoré en silence : refusé.
  const env = String(fd.get("env") ?? "").trim() || null;
  if (env && (!metric.startsWith("issue:") || env.length > 120 || hasSqlControlCharacters(env))) {
    throw new Error("env invalide : réservé aux alertes d'issue, 120 caractères au plus");
  }
  // P1 : mode (threshold|baseline) ; B52 : release (p75 d'un vital, release la plus
  // récente contre la précédente). Lu d'abord : il décide d'où vient le seuil.
  const mode = String(fd.get("mode") ?? "threshold");
  if (!(ALERT_MODES as readonly string[]).includes(mode)) throw new Error(`mode invalide : ${mode}`);
  const release = mode === "release";
  if (release && !(RELEASE_METRICS as readonly string[]).includes(metric)) {
    throw new Error("régression de release : réservée aux Web Vitals (LCP, INP, CLS, FCP, TTFB)");
  }
  // En mode release, le champ « Seuil » (masqué) n'a pas d'effet : la hausse
  // tolérée vient de son propre champ, et une hausse se compare toujours par « > ».
  const comparator = release ? ">" : String(fd.get("comparator") ?? ">");
  if (!(ALERT_COMPARATORS as readonly string[]).includes(comparator)) {
    throw new Error(`comparateur invalide : ${comparator}`);
  }
  const threshold = release ? hausseTolereeDe(fd) : Number(fd.get("threshold"));
  if (!Number.isFinite(threshold)) throw new Error("seuil invalide");
  const window_minutes = Math.min(
    Math.max(Math.trunc(Number(fd.get("window_minutes")) || 15), 1),
    1440,
  );
  const route = String(fd.get("route") ?? "").trim() || null;
  const webhook_url = String(fd.get("webhook_url") ?? "").trim() || null;
  if (webhook_url) refuserUrlSortante(webhook_url);
  const app_id = String(fd.get("app_id") ?? "").trim();
  if (!app_id) throw new Error("app_id requis");
  // P1 : sévérité, paramètres baseline.
  const severity = String(fd.get("severity") ?? "warning");
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity)) {
    throw new Error(`sévérité invalide : ${severity}`);
  }
  const rawSensitivity = Number(fd.get("sensitivity"));
  const sensitivity = Number.isFinite(rawSensitivity) && rawSensitivity > 0 ? rawSensitivity : 3;
  const baseline_weeks = Math.min(
    Math.max(Math.trunc(Number(fd.get("baseline_weeks")) || 4), 1),
    12,
  );
  return {
    app_id, metric, route, comparator, threshold, window_minutes, webhook_url,
    mode, severity, sensitivity, baseline_weeks, env,
  };
}

export async function createRuleAction(fd: FormData): Promise<void> {
  const user = await ecrivain();
  const regle = ruleFromForm(fd);
  dansLePerimetre(user, regle.app_id);
  await insertAlertRule(regle);
  revalidatePath("/alerts");
}

export async function updateRuleAction(fd: FormData): Promise<void> {
  const user = await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const regle = ruleFromForm(fd);
  dansLePerimetre(user, regle.app_id);
  // La règle existante aussi : sans cela, un principal restreint déplacerait vers
  // son app la règle d'une autre. Un administrateur voit toutes les apps (V7) :
  // aucune lecture de plus dans ce cas.
  if (authorizedAppsOf(user) !== null) dansLePerimetre(user, await appDeRegle(id));
  await updateAlertRule(id, regle);
  revalidatePath("/alerts");
}

export async function toggleRuleAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await toggleAlertRuleActive(id);
  revalidatePath("/alerts");
}

export async function ackEventAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await acknowledgeAlertEvent(id);
  revalidatePath("/alerts");
}

/**
 * « Évaluer maintenant » : check_alerts() + check_slo_burn(), total affiché via
 * ?fired=N. Un pic d'issue part dans l'outbox : il est routé dans la foulée,
 * comme au tick, pour apparaître dans le flux affiché.
 */
export async function evaluateNowAction(fd: FormData): Promise<void> {
  await ecrivain();
  const a = await runCheckAlerts();
  await runRouteIssueNotifications();
  const b = await runCheckSloBurn();
  revalidatePath("/alerts");
  // qs = filtres globaux à préserver (app/period/device), fourni par la page
  const qs = String(fd.get("qs") ?? "");
  redirect(`/alerts${qs ? `${qs}&` : "?"}fired=${a + b}`);
}

// ---------------------------------------------------------------------------
// SLO (page /slo)
// ---------------------------------------------------------------------------

function sloFromForm(fd: FormData): SloInput {
  const app_id = String(fd.get("app_id") ?? "").trim();
  if (!app_id) throw new Error("app_id requis");
  const name = String(fd.get("name") ?? "").trim();
  if (!name) throw new Error("nom requis");
  const metric = String(fd.get("metric") ?? "");
  if (!(SLO_METRICS as readonly string[]).includes(metric)) {
    throw new Error(`metric invalide pour un SLO : ${metric}`);
  }
  // Le formulaire saisit l'objectif EN % (ex. 99) → converti en fraction ]0,1[.
  const objectivePct = Number(fd.get("objective"));
  if (!Number.isFinite(objectivePct) || objectivePct <= 0 || objectivePct >= 100) {
    throw new Error("objectif invalide (attendu en %, dans ]0,100[)");
  }
  const objective = objectivePct / 100;
  const window_days = Math.min(Math.max(Math.trunc(Number(fd.get("window_days")) || 28), 1), 90);
  const route = String(fd.get("route") ?? "").trim() || null;
  return { app_id, name, metric, objective, window_days, route };
}

export async function createSloAction(fd: FormData): Promise<void> {
  await ecrivain();
  await insertSlo(sloFromForm(fd));
  revalidatePath("/slo");
}

export async function toggleSloAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await toggleSlo(id);
  revalidatePath("/slo");
}

export async function deleteSloAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await deleteSlo(id);
  revalidatePath("/slo");
}

// ---------------------------------------------------------------------------
// Canaux de notification (section de la page /alerts)
// ---------------------------------------------------------------------------

function channelFromForm(fd: FormData): ChannelInput {
  const kind = String(fd.get("kind") ?? "webhook");
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) throw new Error(`type invalide : ${kind}`);
  const target = String(fd.get("target") ?? "").trim();
  if (!target) throw new Error("cible requise");
  // webhook/slack = URL http(s) publique ; email réservé (cible = adresse, non validée comme URL)
  if (kind === "webhook" || kind === "slack") refuserUrlSortante(target);
  const severity_min = String(fd.get("severity_min") ?? "warning");
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity_min)) {
    throw new Error(`sévérité invalide : ${severity_min}`);
  }
  const app_id = String(fd.get("app_id") ?? "").trim() || null;
  return { app_id, kind, target, severity_min };
}

export async function createChannelAction(fd: FormData): Promise<void> {
  await ecrivain();
  await insertChannel(channelFromForm(fd));
  revalidatePath("/alerts");
}

export async function toggleChannelAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await toggleChannel(id);
  revalidatePath("/alerts");
}

export async function deleteChannelAction(fd: FormData): Promise<void> {
  await ecrivain();
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  await deleteChannel(id);
  revalidatePath("/alerts");
}
