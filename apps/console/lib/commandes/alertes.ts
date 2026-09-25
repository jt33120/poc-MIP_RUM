// L'ALERTING (C8) — `app/alerts/actions.ts` : règles, événements, SLO, canaux de notification.
//
// L'administrateur de l'application seul. Une règle et un SLO appartiennent à UNE
// application : règle `admin` + portée `app`, et chaque écriture filtre sa ligne
// par elle (`where id = $1 and app_id = $2`) — avant C8, basculer, acquitter ou
// supprimer filtrait par identifiant seul. Un canal peut être GLOBAL (`app_id`
// nul, toutes les applications) : ses commandes ont la portée `globale`, et la
// commande confronte le canal au périmètre du principal — un canal global est
// réservé à l'administrateur de la PLATEFORME (liste d'applications nulle). « Évaluer
// maintenant » évalue les règles de toutes les applications : administrateur de la
// plateforme.
//
// LES FORMULAIRES SONT DES CHAMPS. Le corps d'une règle, d'un SLO ou d'un canal est
// le dictionnaire des champs du formulaire (des chaînes, bornées) ; la commande le
// lit par les mêmes règles qu'avant C8 — un champ absent, vide, hors bornes est
// refusé en toutes lettres (`invalide`), jamais remplacé en silence.
//
// LES URL SORTANTES SONT JUGÉES À L'ÉCRITURE (P1). Le webhook d'une règle et la
// cible d'un canal webhook/Slack sont postés par le scheduler depuis le réseau
// privé Railway : `verifierUrlSortante` (le contrôle sans réseau de `safe-fetch`)
// refuse ici IP littérale, nom interne, identifiants, protocole — et la commande
// rend le CODE du motif, que la page traduit. Ce contrôle ne fait pas foi : à
// chaque livraison, `safeFetch` rejuge la cible.
import { booleen, chaine, dictionnaire, objet } from "@mip/console-contract";
import { verifierUrlSortante } from "@mip/backend/lib/net/safe-fetch.mjs";
import { ALERT_MODES, ALERT_SEVERITIES, CHANNEL_KINDS, RELEASE_METRICS, SEUIL_REGRESSION_DEFAUT } from "../alerting";
import { tx } from "../db";
import { hasSqlControlCharacters } from "../error-issue-workflow";
import { deleteChannel, deleteSlo, insertChannel, insertSlo, toggleChannel, toggleSlo, type ChannelInput, type SloInput } from "../queries-alerting";
import {
  acknowledgeAlertEvent,
  ALERT_COMPARATORS,
  insertAlertRule,
  isAlertMetric,
  runCheckAlerts,
  runCheckSloBurn,
  runRouteIssueNotifications,
  SLO_METRICS,
  toggleAlertRuleActive,
  updateAlertRule,
  type RuleInput,
} from "../queries-v2";
import { commande, MOTIF_ENTIER, type PrincipalCommande } from "./commun";

/** Les champs d'un formulaire : un petit dictionnaire de chaînes, rien d'autre. */
export const CHAMPS = dictionnaire({ max: 32, nom: /^[a-z][a-z0-9_]{0,39}$/, valeurMax: 4096 });
type Champs = Readonly<Record<string, string>>;
const CHEMIN_ID = objet({ id: chaine({ max: 18, motif: MOTIF_ENTIER, description: "identifiant entier" }) });

/** Un refus de formulaire, en toutes lettres : la commande le rend (`invalide`), sans rien écrire. */
class Invalide extends Error {}
/** Une URL sortante refusée : le code du motif (`safe-fetch`), que la page traduit. */
class UrlRefusee extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

const lire = (ch: Champs, nom: string): string | null => (nom in ch ? ch[nom] : null);
const texte = (ch: Champs, nom: string): string => (lire(ch, nom) ?? "").trim();

function refuserUrlSortante(url: string): void {
  const verdict = verifierUrlSortante(url);
  if (!verdict.ok) throw new UrlRefusee(verdict.code);
}

/** L'application demandée est-elle dans le périmètre du principal ? (`null` = toutes.) */
const dansLePerimetre = (p: PrincipalCommande, app: string) => p.apps === null || p.apps.includes(app);

/**
 * Hausse tolérée d'une règle de release, en pour cent. Absente du formulaire : la
 * valeur par défaut (+20 %). Saisie vide, nulle, négative ou démesurée : refusée —
 * jamais remplacée en silence.
 */
function hausseToleree(ch: Champs): number {
  const brute = lire(ch, "release_pct");
  if (brute === null) return SEUIL_REGRESSION_DEFAUT;
  const t = brute.trim();
  const pct = t === "" ? Number.NaN : Number(t);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 1000) {
    throw new Invalide("hausse tolérée invalide : un pourcentage strictement positif, 1 000 au plus");
  }
  return pct;
}

/** Une règle, lue de son formulaire (les mêmes refus qu'avant C8, au mot près). */
export function regleDesChamps(ch: Champs): RuleInput {
  const selectedMetric = texte(ch, "metric");
  const eventName = texte(ch, "event_name");
  const issueId = texte(ch, "issue_id").toLowerCase();
  const metric = selectedMetric === "event" ? `event:${eventName}` : selectedMetric === "issue" ? `issue:${issueId}` : selectedMetric;
  if (!isAlertMetric(metric)) throw new Invalide(`metric invalide : ${metric}`);
  // L'env filtre les occurrences d'une issue ; ailleurs il n'a pas de source et
  // serait ignoré en silence : refusé.
  const env = texte(ch, "env") || null;
  if (env && (!metric.startsWith("issue:") || env.length > 120 || hasSqlControlCharacters(env))) {
    throw new Invalide("env invalide : réservé aux alertes d'issue, 120 caractères au plus");
  }
  // P1 : mode (threshold|baseline) ; B52 : release (p75 d'un vital, release la plus
  // récente contre la précédente). Lu d'abord : il décide d'où vient le seuil.
  const mode = lire(ch, "mode") ?? "threshold";
  if (!(ALERT_MODES as readonly string[]).includes(mode)) throw new Invalide(`mode invalide : ${mode}`);
  const release = mode === "release";
  if (release && !(RELEASE_METRICS as readonly string[]).includes(metric)) {
    throw new Invalide("régression de release : réservée aux Web Vitals (LCP, INP, CLS, FCP, TTFB)");
  }
  // En mode release, le champ « Seuil » (masqué) n'a pas d'effet : la hausse
  // tolérée vient de son propre champ, et une hausse se compare toujours par « > ».
  const comparator = release ? ">" : (lire(ch, "comparator") ?? ">");
  if (!(ALERT_COMPARATORS as readonly string[]).includes(comparator)) throw new Invalide(`comparateur invalide : ${comparator}`);
  const threshold = release ? hausseToleree(ch) : Number(lire(ch, "threshold"));
  if (!Number.isFinite(threshold)) throw new Invalide("seuil invalide");
  const window_minutes = Math.min(Math.max(Math.trunc(Number(lire(ch, "window_minutes")) || 15), 1), 1440);
  const route = texte(ch, "route") || null;
  const webhook_url = texte(ch, "webhook_url") || null;
  if (webhook_url) refuserUrlSortante(webhook_url);
  const app_id = texte(ch, "app_id");
  if (!app_id) throw new Invalide("app_id requis");
  const severity = lire(ch, "severity") ?? "warning";
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity)) throw new Invalide(`sévérité invalide : ${severity}`);
  const rawSensitivity = Number(lire(ch, "sensitivity"));
  const sensitivity = Number.isFinite(rawSensitivity) && rawSensitivity > 0 ? rawSensitivity : 3;
  const baseline_weeks = Math.min(Math.max(Math.trunc(Number(lire(ch, "baseline_weeks")) || 4), 1), 12);
  return { app_id, metric, route, comparator, threshold, window_minutes, webhook_url, mode, severity, sensitivity, baseline_weeks, env };
}

function sloDesChamps(ch: Champs): SloInput {
  const app_id = texte(ch, "app_id");
  if (!app_id) throw new Invalide("app_id requis");
  const name = texte(ch, "name");
  if (!name) throw new Invalide("nom requis");
  const metric = lire(ch, "metric") ?? "";
  if (!(SLO_METRICS as readonly string[]).includes(metric)) throw new Invalide(`metric invalide pour un SLO : ${metric}`);
  // Le formulaire saisit l'objectif EN % (ex. 99) → converti en fraction ]0,1[.
  const objectivePct = Number(lire(ch, "objective"));
  if (!Number.isFinite(objectivePct) || objectivePct <= 0 || objectivePct >= 100) {
    throw new Invalide("objectif invalide (attendu en %, dans ]0,100[)");
  }
  const window_days = Math.min(Math.max(Math.trunc(Number(lire(ch, "window_days")) || 28), 1), 90);
  const route = texte(ch, "route") || null;
  return { app_id, name, metric, objective: objectivePct / 100, window_days, route };
}

function canalDesChamps(ch: Champs): ChannelInput {
  const kind = lire(ch, "kind") ?? "webhook";
  if (!(CHANNEL_KINDS as readonly string[]).includes(kind)) throw new Invalide(`type invalide : ${kind}`);
  const target = texte(ch, "target");
  if (!target) throw new Invalide("cible requise");
  // webhook/slack = URL http(s) publique ; email réservé (cible = adresse, non validée comme URL)
  if (kind === "webhook" || kind === "slack") refuserUrlSortante(target);
  const severity_min = lire(ch, "severity_min") ?? "warning";
  if (!(ALERT_SEVERITIES as readonly string[]).includes(severity_min)) throw new Invalide(`sévérité invalide : ${severity_min}`);
  const app_id = texte(ch, "app_id") || null;
  return { app_id, kind, target, severity_min };
}

/** Un formulaire lu : sa valeur, ou le refus que la commande rend tel quel. */
function lu<T>(f: () => T): { ok: true; valeur: T } | { ok: false; decision: { etat: "invalide"; message: string } | { etat: "url_refusee"; code: string } } {
  try {
    return { ok: true, valeur: f() };
  } catch (e) {
    if (e instanceof UrlRefusee) return { ok: false, decision: { etat: "url_refusee", code: e.code } };
    if (e instanceof Invalide) return { ok: false, decision: { etat: "invalide", message: e.message } };
    throw e;
  }
}

const detail = (d: Record<string, unknown>) => JSON.stringify(d);

// ─── Règles ──────────────────────────────────────────────────────────────────

export const creerRegle = commande(
  { regle: { auth: "admin", portee: "app", audit: "alert_rule.create" }, corps: CHAMPS },
  async ({ app, corps, auditer }) => {
    const r = lu(() => regleDesChamps(corps));
    if (!r.ok) return r.decision;
    // L'application de la règle EST la portée : le formulaire n'en choisit pas une autre.
    if (r.valeur.app_id !== app) return { etat: "invalide", message: "l'application de la règle n'est pas celle de la demande" } as const;
    const id = await tx(async (c) => {
      const cree = await insertAlertRule(r.valeur, c);
      await auditer(c, detail({ id: cree, metric: r.valeur.metric, mode: r.valeur.mode, webhook: r.valeur.webhook_url !== null }));
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

/**
 * Réécrit une règle de l'application de la portée. Elle peut être DÉPLACÉE vers une
 * autre application — seulement une du périmètre du principal : sans cela, un
 * administrateur d'une liste enverrait sa règle (et son webhook) chez un autre.
 */
export const modifierRegle = commande(
  { regle: { auth: "admin", portee: "app", audit: "alert_rule.update" }, chemin: CHEMIN_ID, corps: CHAMPS },
  async ({ principal, app, chemin, corps, auditer }) => {
    const r = lu(() => regleDesChamps(corps));
    if (!r.ok) return r.decision;
    if (!dansLePerimetre(principal, r.valeur.app_id)) return { etat: "hors_perimetre" } as const;
    const fait = await tx(async (c) => {
      if (!(await updateAlertRule(Number(chemin.id), app!, r.valeur, c))) return false;
      await auditer(c, detail({ id: chemin.id, metric: r.valeur.metric, mode: r.valeur.mode, app_id: r.valeur.app_id, avant: app }));
      return true;
    });
    return fait ? ({ etat: "ok" } as const) : ({ etat: "introuvable" } as const);
  },
);

export const activerRegle = commande(
  { regle: { auth: "admin", portee: "app", audit: "alert_rule.set_active" }, chemin: CHEMIN_ID, corps: objet({ active: booleen() }) },
  async ({ app, chemin, corps, auditer }) =>
    tx(async (c) => {
      if (!(await toggleAlertRuleActive(Number(chemin.id), app!, corps.active, c))) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id, active: corps.active }));
      return { etat: "ok" } as const;
    }),
);

export const acquitterEvenement = commande(
  { regle: { auth: "admin", portee: "app", audit: "alert_event.acknowledge" }, chemin: CHEMIN_ID },
  async ({ app, chemin, auditer }) =>
    tx(async (c) => {
      if (!(await acknowledgeAlertEvent(Number(chemin.id), app!, c))) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id }));
      return { etat: "ok" } as const;
    }),
);

/**
 * « Évaluer maintenant » : `check_alerts()` puis `check_slo_burn()`, sur TOUTES les
 * applications — un pic d'issue part dans l'outbox et est routé dans la foulée,
 * comme au tick. Administrateur de la plateforme.
 */
export const evaluerAlertes = commande(
  { regle: { auth: "admin-plateforme", portee: "globale", audit: "alert.evaluate" } },
  async ({ auditer }) => {
    const regles = await runCheckAlerts();
    await runRouteIssueNotifications();
    const slo = await runCheckSloBurn();
    await tx((c) => auditer(c, detail({ regles, slo })));
    return { etat: "ok", declenchees: regles + slo } as const;
  },
);

// ─── SLO ─────────────────────────────────────────────────────────────────────

export const creerSlo = commande(
  { regle: { auth: "admin", portee: "app", audit: "slo.create" }, corps: CHAMPS },
  async ({ app, corps, auditer }) => {
    const s = lu(() => sloDesChamps(corps));
    if (!s.ok) return s.decision;
    if (s.valeur.app_id !== app) return { etat: "invalide", message: "l'application du SLO n'est pas celle de la demande" } as const;
    const id = await tx(async (c) => {
      const cree = await insertSlo(s.valeur, c);
      await auditer(c, detail({ id: cree, name: s.valeur.name, metric: s.valeur.metric, objective: s.valeur.objective }));
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

export const activerSlo = commande(
  { regle: { auth: "admin", portee: "app", audit: "slo.set_active" }, chemin: CHEMIN_ID, corps: objet({ active: booleen() }) },
  async ({ app, chemin, corps, auditer }) =>
    tx(async (c) => {
      if (!(await toggleSlo(Number(chemin.id), app!, corps.active, c))) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id, active: corps.active }));
      return { etat: "ok" } as const;
    }),
);

export const supprimerSlo = commande(
  { regle: { auth: "admin", portee: "app", audit: "slo.delete" }, chemin: CHEMIN_ID },
  async ({ app, chemin, auditer }) =>
    tx(async (c) => {
      if (!(await deleteSlo(Number(chemin.id), app!, c))) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id }));
      return { etat: "ok" } as const;
    }),
);

// ─── Canaux de notification ──────────────────────────────────────────────────

/**
 * Un canal d'une application du périmètre, ou GLOBAL (toutes les applications) —
 * celui-ci réservé à l'administrateur de la plateforme : un administrateur d'une
 * liste ne notifie pas pour les applications des autres.
 */
export const creerCanal = commande(
  { regle: { auth: "admin", portee: "globale", audit: "notify_channel.create" }, corps: CHAMPS },
  async ({ principal, corps, auditer }) => {
    const canal = lu(() => canalDesChamps(corps));
    if (!canal.ok) return canal.decision;
    const app = canal.valeur.app_id;
    if (app === null ? principal.apps !== null : !dansLePerimetre(principal, app)) return { etat: "hors_perimetre" } as const;
    const id = await tx(async (c) => {
      const cree = await insertChannel(canal.valeur, c);
      await auditer(c, detail({ id: cree, kind: canal.valeur.kind, severity_min: canal.valeur.severity_min }), app);
      return cree;
    });
    return { etat: "cree", id } as const;
  },
);

export const activerCanal = commande(
  { regle: { auth: "admin", portee: "globale", audit: "notify_channel.set_active" }, chemin: CHEMIN_ID, corps: objet({ active: booleen() }) },
  async ({ principal, chemin, corps, auditer }) =>
    tx(async (c) => {
      const canal = await toggleChannel(Number(chemin.id), principal.apps, corps.active, c);
      if (!canal) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id, active: corps.active }), canal.app_id);
      return { etat: "ok" } as const;
    }),
);

export const supprimerCanal = commande(
  { regle: { auth: "admin", portee: "globale", audit: "notify_channel.delete" }, chemin: CHEMIN_ID },
  async ({ principal, chemin, auditer }) =>
    tx(async (c) => {
      const canal = await deleteChannel(Number(chemin.id), principal.apps, c);
      if (!canal) return { etat: "introuvable" } as const;
      await auditer(c, detail({ id: chemin.id }), canal.app_id);
      return { etat: "ok" } as const;
    }),
);
