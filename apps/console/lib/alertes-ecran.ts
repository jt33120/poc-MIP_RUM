// Écran /alerts (F64, plan § 5.19) : ce que la page tire des lectures d'alerte,
// sans accès base. Module pur, testé (tests/unit/alertes-ecran.test.ts).
//
// CE QUE L'ÉCRAN N'AFFIRME PAS.
//   - « Livrée » ne veut pas dire « partie » : trois états conservés (v49), et une
//     alerte transmise dont le code HTTP n'est pas connu n'est NI livrée ni perdue.
//   - Le délai d'acquittement (MTTA) n'est pas affiché : `alert_event` ne garde
//     qu'un booléen, pas d'horodatage d'acquittement (dépendance B50, § 6.3). La
//     raison est dite à l'écran plutôt que remplacée par une estimation.
//   - L'état d'une règle est celui de sa DERNIÈRE évaluation, pas un historique :
//     la base ne garde pas les évaluations (B51). D'où une frise de déclenchements
//     (un marqueur = un événement), jamais une « state timeline ».
//   - Les 30 jours de la frise et des barres sont FIXES : la plage de l'écran ne
//     s'y applique pas (une règle est évaluée sur SA fenêtre).
import { ruleModeLabel, type Severity } from "./alerting";
import { formater } from "./fmt-ids";
import { metricLabel, type AlertDayRow, type AlertEventRow, type AlertFiringRow, type AlertRuleRow } from "./queries-v2";
import type { PisteDeclenchements, Severite } from "../components/charts/FriseDeclenchements";
import type { PointSerie } from "./series";
import { PHRASE_FENETRE } from "../components/ReleaseCompare";

// Bornes des lectures de l'écran : dans `lib/alerting.ts` (sans rendu), que le
// chargeur de l'écran (`lib/chargeurs/alertes.ts`) lit aussi.
export { JOURS_DECLENCHEMENTS, PLAFOND_DECLENCHEMENTS, PLAFOND_FLUX } from "./alerting";
import { JOURS_DECLENCHEMENTS } from "./alerting";

/** Pourquoi le délai d'acquittement n'est pas affiché (B50). */
export const MOTIF_MTTA =
  "Délai d'acquittement non affiché : la base ne garde qu'un booléen d'acquittement, pas son horodatage (colonne alert_event.acknowledged_at absente).";

/**
 * Sévérité RAMENÉE aux trois sévérités du domaine (`ALERT_SEVERITIES`). La colonne
 * `alert_event.severity` est du texte libre côté base : des lignes anciennes portent
 * `page` ou `error`, que l'écran affichait déjà en rouge. Une valeur inconnue devient
 * `info` (le ton neutre) plutôt que de disparaître du comptage.
 */
export function severiteConnue(severity: string): Severite {
  if (severity === "critical" || severity === "page" || severity === "error") return "critical";
  if (severity === "warning" || severity === "warn") return "warning";
  return "info";
}

/** Libellé lisible d'une sévérité, dans l'ordre d'importance décroissante. */
export const SEVERITES_AFFICHEES: readonly { cle: Severite; libelle: string; ton: "bad" | "warn" | "neutre" }[] = [
  { cle: "critical", libelle: "Critique", ton: "bad" },
  { cle: "warning", libelle: "Avertissement", ton: "warn" },
  { cle: "info", libelle: "Information", ton: "neutre" },
];

// ─────────────────────────────── Tuiles (A1-A4b) ──────────────────────────────

export interface ComptesRegles {
  /** Règles actives du périmètre : le dénominateur des deux suivants. */
  actives: number;
  /** `last_state = 'breached'` à la dernière évaluation (A3). */
  franchies: number;
  /** `no_data` + jamais évaluées : `no_data` n'est PAS `ok` (A4). */
  sansDonnees: number;
  /** Dont jamais évaluées (ou base antérieure à migration-v73) : écrit sous la tuile. */
  jamaisEvaluees: number;
}

/**
 * Les comptes de règles des tuiles A3 et A4. Seules les règles ACTIVES comptent :
 * une règle désactivée ne s'évalue plus, son dernier état est une photo périmée.
 */
export function comptesRegles(regles: readonly Pick<AlertRuleRow, "active" | "last_state">[]): ComptesRegles {
  const actives = regles.filter((r) => r.active);
  const jamaisEvaluees = actives.filter((r) => r.last_state == null).length;
  return {
    actives: actives.length,
    franchies: actives.filter((r) => r.last_state === "breached").length,
    sansDonnees: actives.filter((r) => r.last_state === "no_data").length + jamaisEvaluees,
    jamaisEvaluees,
  };
}

// ──────────────────────────── Hero, barres par jour ───────────────────────────

/** Grille ISO UTC des jours rendus par `alertEventsByDay` (un seau = un jour). */
export function grilleDesJours(parJour: readonly AlertDayRow[]): string[] {
  return [...new Set(parJour.map((j) => j.jour))].sort().map((jour) => `${jour}T00:00:00Z`);
}

/**
 * Points empilés par jour et par sévérité : une clé par sévérité affichée, les
 * sévérités inconnues repliées sur les trois du domaine (`severiteConnue`), et
 * un jour sans déclenchement à 0 (un compte est additif, § 3.10).
 */
export function pointsParJour(parJour: readonly AlertDayRow[]): PointSerie[] {
  const parInstant = new Map<string, PointSerie>();
  for (const jour of grilleDesJours(parJour)) {
    parInstant.set(jour, { t: jour, critical: 0, warning: 0, info: 0 });
  }
  for (const ligne of parJour) {
    const point = parInstant.get(`${ligne.jour}T00:00:00Z`);
    if (!point) continue;
    const cle = severiteConnue(ligne.severity);
    point[cle] = (Number(point[cle]) || 0) + ligne.n;
  }
  return [...parInstant.values()];
}

/** Total des déclenchements de la fenêtre : la somme des barres, pas un plafond de lecture. */
export function totalDeclenchements(parJour: readonly Pick<AlertDayRow, "n">[]): number {
  return parJour.reduce((total, j) => total + j.n, 0);
}

/** Alternative textuelle des barres (P10) : une ligne par jour, une colonne par sévérité. */
export function alternativeParJour(parJour: readonly AlertDayRow[]) {
  const points = pointsParJour(parJour);
  return {
    legende: `Déclenchements par jour UTC et par sévérité, sur ${JOURS_DECLENCHEMENTS} jours fixes.`,
    colonnes: ["Jour (UTC)", ...SEVERITES_AFFICHEES.map((s) => s.libelle), "Total"],
    lignes: points.map((p) => {
      const valeurs = SEVERITES_AFFICHEES.map((s) => Number(p[s.cle]) || 0);
      return [
        p.t.slice(0, 10),
        ...valeurs.map((v) => formater("count", v)),
        formater(
          "count",
          valeurs.reduce((a, b) => a + b, 0),
        ),
      ];
    }),
  };
}

// ───────────────────────────── Hero, frise (A5 bas) ───────────────────────────

const ETATS_REGLE: Record<string, { libelle: string; ton: "good" | "bad" | "neutre" }> = {
  ok: { libelle: "Normale", ton: "good" },
  breached: { libelle: "Franchie", ton: "bad" },
  no_data: { libelle: "Données insuffisantes", ton: "neutre" },
};

/** État actuel d'une règle, tel que la frise et la table l'écrivent (jamais « 0 »). */
export function etatDeRegle(r: Pick<AlertRuleRow, "last_state" | "last_reason" | "active">): PisteDeclenchements["etatActuel"] {
  if (!r.active) return { libelle: "Désactivée", ton: "neutre", raison: "la règle ne s'évalue plus" };
  if (r.last_state == null) {
    return { libelle: "Données insuffisantes", ton: "neutre", raison: "jamais évaluée sur cette base" };
  }
  const etat = ETATS_REGLE[r.last_state] ?? { libelle: r.last_state, ton: "neutre" as const };
  return { libelle: etat.libelle, ton: etat.ton, raison: r.last_reason ?? undefined };
}

/** Lien de la piste d'une source : sa règle sur l'écran, son SLO, son issue. */
export function hrefDeSource(l: Pick<AlertFiringRow, "source" | "source_id">): string {
  if (l.source === "regle") return `#regle-${l.source_id}`;
  if (l.source === "slo") return "/slo#definitions";
  if (l.source === "issue") return `/errors/issues/${encodeURIComponent(l.source_id)}`;
  return "#a-traiter";
}

/** Lien d'un déclenchement : le paramètre `evt` (§ 3.1), JAMAIS `fired`. */
export function hrefEvenement(eventId: number): string {
  return `/alerts?evt=${eventId}#evt-${eventId}`;
}

/**
 * Les pistes de la frise (A5, bas) : une par source qui a déclenché sur la fenêtre,
 * plus les règles actuellement FRANCHIES qui n'ont pas déclenché sur la fenêtre —
 * une piste vide avec son état dit ce qu'un silence ne dirait pas.
 *
 * La piste « nouvelle erreur » (alerte de `check_new_errors`, sans règle, sans SLO
 * ni issue) est rangée avec les issues : elle relève de la même famille, et la frise
 * n'a que trois groupes.
 */
export function pistesDeDeclenchements(
  lignes: readonly AlertFiringRow[],
  regles: readonly AlertRuleRow[],
): PisteDeclenchements[] {
  const parRegle = new Map(regles.map((r) => [String(r.id), r]));
  const pistes = new Map<string, PisteDeclenchements>();
  for (const l of lignes) {
    const cle = `${l.source}:${l.source_id}`;
    let piste = pistes.get(cle);
    if (!piste) {
      const regle = l.source === "regle" ? parRegle.get(l.source_id) : undefined;
      piste = {
        cle,
        libelle: l.libelle,
        href: hrefDeSource(l),
        groupe: l.source === "regle" ? "regle" : l.source === "slo" ? "slo" : "issue",
        etatActuel: regle ? etatDeRegle(regle) : null,
        marqueurs: [],
      };
      pistes.set(cle, piste);
    }
    piste.marqueurs.push({
      t: new Date(l.fired_at).toISOString(),
      severite: severiteConnue(l.severity),
      livre: l.delivered > 0,
      enAttente: l.delivered === 0 && l.pending > 0,
      acquitte: l.acknowledged,
      href: hrefEvenement(l.event_id),
    });
  }
  // Une règle franchie qui n'a pas déclenché sur la fenêtre a quand même sa piste :
  // sinon l'écran montrerait une frise calme sous une tuile « 1 règle franchie ».
  for (const r of regles) {
    const cle = `regle:${r.id}`;
    if (!r.active || r.last_state !== "breached" || pistes.has(cle)) continue;
    pistes.set(cle, {
      cle,
      libelle: libelleDeRegle(r),
      href: `#regle-${r.id}`,
      groupe: "regle",
      etatActuel: etatDeRegle(r),
      marqueurs: [],
    });
  }
  // Ordre des GROUPES d'abord (celui de la frise : règles, SLO, issues), puis les
  // pistes les plus actives ; à égalité, l'ordre alphabétique. Sans cet ordre, le
  // plafond de pistes visibles (P14) couperait au milieu d'un groupe.
  const rang = { regle: 0, slo: 1, issue: 2 };
  return [...pistes.values()].sort(
    (a, b) =>
      rang[a.groupe] - rang[b.groupe] ||
      b.marqueurs.length - a.marqueurs.length ||
      a.libelle.localeCompare(b.libelle, "fr"),
  );
}

/** « LCP (ms) · /checkout » : la règle nommée comme la frise la nomme (`alertFirings`). */
export function libelleDeRegle(r: Pick<AlertRuleRow, "metric" | "route">): string {
  return `${metricLabel(r.metric)}${r.route ? ` · ${r.route}` : ""}`;
}

/** Ce que la règle évalue, en une phrase : mode, seuil ou sensibilité, fenêtre, env. */
export function reglageDeRegle(
  r: Pick<AlertRuleRow, "mode" | "comparator" | "threshold" | "sensitivity" | "window_minutes" | "severity" | "env">,
): string {
  // B52 : une règle de release compare deux p75 ; son seuil est une hausse EN POUR
  // CENT (décimales gardées : « +12,5 % » n'est pas « +13 % »), et la phrase du
  // § 3.2 l'accompagne partout où elle s'affiche.
  if (r.mode === "release") {
    return `${ruleModeLabel(r.mode)} : p75 en hausse de +${r.threshold.toLocaleString("fr-FR")} % ou plus contre la release précédente, sur ${formater("count", r.window_minutes)} min · sévérité ${r.severity} · ${PHRASE_FENETRE}`;
  }
  const declenche =
    r.mode === "baseline"
      ? `écart à l'habitude au-delà de ${formater("count", r.sensitivity)} sigma`
      : `${r.comparator} ${formater("count", r.threshold)}`;
  const env = r.env ? ` · env ${r.env}` : "";
  return `${ruleModeLabel(r.mode)} : ${declenche} sur ${formater("count", r.window_minutes)} min · sévérité ${r.severity}${env}`;
}

// ───────────────────────────── Flux « À traiter » (A6) ────────────────────────

/** Non acquittés d'abord, puis les plus récents (tri stable sur une liste déjà datée). */
export function fluxATraiter<T extends { acknowledged: boolean; fired_at: Date | string }>(events: readonly T[]): T[] {
  return [...events].sort(
    (a, b) =>
      Number(a.acknowledged) - Number(b.acknowledged) || new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime(),
  );
}

export type EtatLivraison = "livree" | "en_attente" | "non_livree";

/** Les TROIS états de livraison (v49) : transmis n'est pas livré, et l'inverse non plus. */
export function etatLivraison(e: Pick<AlertEventRow, "delivered" | "pending">): {
  etat: EtatLivraison;
  libelle: string;
  detail: string;
} {
  if (e.delivered > 0) {
    return {
      etat: "livree",
      libelle: `livrée ×${formater("count", e.delivered)}`,
      detail: `${e.delivered} notification(s) livrée(s) — code 2xx confirmé`,
    };
  }
  if (e.pending > 0) {
    return {
      etat: "en_attente",
      libelle: `en attente ×${formater("count", e.pending)}`,
      detail: `${e.pending} notification(s) transmise(s), résultat pas encore confirmé`,
    };
  }
  return { etat: "non_livree", libelle: "non livrée", detail: "Aucune notification n'est partie pour cette alerte" };
}

/** Le titre d'un événement : son message, sinon sa métrique et sa source. */
export function titreEvenement(
  e: Pick<AlertEventRow, "message" | "metric" | "rule_id" | "slo_id">,
  source?: Pick<AlertFiringRow, "source" | "libelle">,
): string {
  if (e.message) return e.message;
  if (e.metric) return metricLabel(e.metric);
  if (source) return source.libelle;
  return e.slo_id != null ? `SLO ${e.slo_id}` : "Déclenchement sans métrique";
}

export interface CibleMesure {
  /** Écran de la mesure ; `hrefWithQuery` y reporte la population de l'écran. */
  pathname: string;
  /** Paramètres ajoutés ; une valeur `null` RETIRE le paramètre (période remplacée par from/to). */
  extra: Record<string, string | null>;
  libelle: string;
  /** Ce que la fenêtre vaut, ou pourquoi elle n'est pas posée. */
  fenetre: string | null;
}

const VITAUX: readonly string[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];
const ISSUE_UUID = /^issue:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/**
 * « Voir la mesure » (§ 5.19.1) : l'écran de la métrique, sur la FENÊTRE ÉVALUÉE
 * `[fired_at − window_minutes, fired_at)` — pas sur la plage de l'écran, qui n'a
 * rien à voir avec l'évaluation.
 *
 * `fenetreMinutes` vient de la règle de l'événement (`alertRules`). Sans règle
 * connue (déclenchement de SLO ou d'issue), la fenêtre n'est pas posée et la ligne
 * le dit : mieux vaut une plage absente qu'une plage inventée.
 *
 * `issueId` répare un manque de `alertEvents` : un déclenchement d'issue SANS règle
 * (notification de `check_new_errors`, v73) n'a ni métrique ni identifiant d'issue
 * dans cette lecture ; `alertFirings` le porte, et la page le joint par `event_id`.
 */
export function cibleMesure(
  e: Pick<AlertEventRow, "metric" | "route" | "fired_at" | "slo_id">,
  fenetreMinutes: number | null,
  issueId: string | null = null,
): CibleMesure | null {
  const finMs = new Date(e.fired_at).getTime();
  const bornes: Record<string, string | null> =
    fenetreMinutes != null && Number.isFinite(finMs)
      ? {
          from: new Date(finMs - fenetreMinutes * 60_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
          to: new Date(finMs).toISOString().replace(/\.\d{3}Z$/, "Z"),
          period: null,
        }
      : {};
  const fenetre =
    fenetreMinutes != null && Number.isFinite(finMs)
      ? `fenêtre évaluée : ${formater("count", fenetreMinutes)} min avant le déclenchement`
      : "fenêtre d'évaluation inconnue : la plage n'est pas posée sur la destination";

  // Un déclenchement de SLO renvoie à sa définition : c'est elle qui porte la
  // fenêtre glissante et l'objectif, pas la fenêtre d'une règle.
  if (e.slo_id != null) {
    return { pathname: "/slo", extra: { from: null, to: null }, libelle: "Voir le SLO", fenetre: null };
  }

  const issue = issueId ?? (e.metric ? ISSUE_UUID.exec(e.metric)?.[1] : undefined);
  if (issue) {
    return {
      pathname: `/errors/issues/${encodeURIComponent(issue)}`,
      extra: bornes,
      libelle: "Voir l'issue",
      fenetre,
    };
  }
  if (!e.metric) return null;
  if (VITAUX.includes(e.metric)) {
    return {
      pathname: "/pages",
      extra: { ...bornes, vital: e.metric, route: e.route },
      libelle: "Voir la mesure",
      fenetre,
    };
  }
  if (e.metric === "error_rate") {
    return { pathname: "/errors", extra: { ...bornes, route: e.route }, libelle: "Voir les erreurs", fenetre };
  }
  if (e.metric.startsWith("event:")) {
    // Le journal ne filtre pas sur la route : n'y posons que ce qu'il applique.
    return {
      pathname: "/events",
      extra: { ...bornes, kind: "event", name: e.metric.slice(6) },
      libelle: "Voir les événements",
      fenetre,
    };
  }
  if (e.metric === "log_errors") {
    // `/logs` n'accepte que les presets de plage (lib/surfaces.ts) : aucune borne.
    return { pathname: "/logs", extra: { from: null, to: null }, libelle: "Voir les logs", fenetre: null };
  }
  return null;
}

/** Sévérité d'une règle proposée par défaut dans le formulaire. */
export const SEVERITE_PAR_DEFAUT: Severity = "warning";
