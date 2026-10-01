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
import { estDureeDeMetrique, estPartDeMetrique, libelleCourtMetrique, libelleSeverite } from "./alertes-metriques";
import { formater } from "./fmt-ids";
import { metricLabel, type AlertDayRow, type AlertEventRow, type AlertFiringRow, type AlertRuleRow } from "./queries-v2";
import type { PisteDeclenchements, Severite } from "../components/charts/FriseDeclenchements";
import type { PointSerie } from "./series";
import { PHRASE_FENETRE } from "../components/ReleaseCompare";

// Bornes des lectures de l'écran : dans `lib/alerting.ts` (sans rendu), que le
// chargeur de l'écran (`lib/chargeurs/alertes.ts`) lit aussi.
export { JOURS_DECLENCHEMENTS, PLAFOND_DECLENCHEMENTS, PLAFOND_FLUX } from "./alerting";
export { libelleSeverite } from "./alertes-metriques";
import { JOURS_DECLENCHEMENTS } from "./alerting";
import { pluriel } from "./format";

/**
 * Pourquoi le délai d'acquittement n'est pas affiché (B50) : la base ne garde qu'un
 * booléen, pas l'heure (`alert_event.acknowledged_at` n'existe pas). Le nom de la
 * colonne reste ici : l'écran dit le manque en mots (recette du 26/09/2026).
 */
export const MOTIF_MTTA = "Le délai d'acquittement n'est pas encore enregistré : seul le fait d'avoir acquitté est gardé, pas l'heure.";

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

const VITAUX: readonly string[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

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
  /** `no_data` + `hors_collecte` + jamais évaluées : aucune n'est `ok` (A4). */
  sansDonnees: number;
  /** Dont jamais évaluées (ou base antérieure à migration-v73) : écrit sous la tuile. */
  jamaisEvaluees: number;
  /** Dont hors collecte (migration-v105) : la collecte était coupée sur leur fenêtre. */
  horsCollecte: number;
}

/**
 * Les comptes de règles des tuiles A3 et A4. Seules les règles ACTIVES comptent :
 * une règle désactivée ne s'évalue plus, son dernier état est une photo périmée.
 */
export function comptesRegles(regles: readonly Pick<AlertRuleRow, "active" | "last_state">[]): ComptesRegles {
  const actives = regles.filter((r) => r.active);
  const jamaisEvaluees = actives.filter((r) => r.last_state == null).length;
  const horsCollecte = actives.filter((r) => r.last_state === "hors_collecte").length;
  return {
    actives: actives.length,
    franchies: actives.filter((r) => r.last_state === "breached").length,
    sansDonnees: actives.filter((r) => r.last_state === "no_data").length + jamaisEvaluees + horsCollecte,
    jamaisEvaluees,
    horsCollecte,
  };
}

/**
 * La phrase sous la tuile « Règles sans données » : ce qui manque, et pourquoi.
 * Une règle hors collecte ne manque pas d'historique : la collecte était coupée.
 */
export function lectureSansDonnees(c: ComptesRegles): string {
  if (c.sansDonnees === 0) return "toutes les règles actives ont assez d'historique";
  if (c.horsCollecte === c.sansDonnees) {
    return "collecte interrompue sur leur fenêtre : rien n'a pu être mesuré, aucune alerte ne part";
  }
  const dont = [
    c.jamaisEvaluees > 0 ? pluriel(c.jamaisEvaluees, "règle jamais évaluée", "règles jamais évaluées") : null,
    c.horsCollecte > 0 ? `${c.horsCollecte} hors collecte (collecte interrompue)` : null,
  ].filter(Boolean);
  return `pas assez d'historique pour conclure${dont.length ? `, dont ${dont.join(" et ")}` : ""}`;
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
    legende: `Déclenchements par jour et par sévérité, sur ${JOURS_DECLENCHEMENTS} jours fixes.`,
    colonnes: ["Jour", ...SEVERITES_AFFICHEES.map((s) => s.libelle), "Total"],
    lignes: points.map((p) => {
      const valeurs = SEVERITES_AFFICHEES.map((s) => Number(p[s.cle]) || 0);
      // Le jour calendaire du compte, écrit à la française (« 26/09 », pas « 2026-09-26 »).
      return [
        `${p.t.slice(8, 10)}/${p.t.slice(5, 7)}`,
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
  hors_collecte: { libelle: "Hors collecte", ton: "neutre" },
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

/** Ce que la ligne d'une règle dit de ses déclenchements sur la fenêtre de la frise. */
export interface DeclenchementsDeRegle {
  /** Instant ISO du plus récent ; `null` : aucun sur la fenêtre. */
  dernier: string | null;
  /** Un compte par jour de la grille (du plus ancien au plus récent). */
  parJour: number[];
}

/**
 * Les déclenchements de chaque RÈGLE, jour par jour, sur la grille des barres (recette
 * du 30/09/2026 : « règle en une ligne, dernier déclenchement »). Lu dans les lignes
 * DÉJÀ lues pour la frise (`alertFirings`) : aucune lecture de plus, et les deux ne
 * peuvent pas se contredire. Une ligne hors de la grille (plus ancienne que son
 * premier jour) compte pour le dernier déclenchement, pas pour les barres.
 * Clé : l'identifiant de la règle, en texte (celui de `source_id`).
 */
export function declenchementsParRegle(
  lignes: readonly Pick<AlertFiringRow, "source" | "source_id" | "fired_at">[],
  grille: readonly string[],
): Map<string, DeclenchementsDeRegle> {
  const debuts = grille.map((t) => Date.parse(t));
  const resultat = new Map<string, DeclenchementsDeRegle>();
  for (const l of lignes) {
    if (l.source !== "regle") continue;
    const ms = new Date(l.fired_at).getTime();
    if (!Number.isFinite(ms)) continue;
    const r = resultat.get(l.source_id) ?? { dernier: null, parJour: debuts.map(() => 0) };
    if (r.dernier === null || ms > Date.parse(r.dernier)) r.dernier = new Date(ms).toISOString();
    // Le jour de la grille qui contient l'instant : le dernier début qui le précède.
    for (let i = debuts.length - 1; i >= 0; i--) {
      if (ms >= debuts[i]) {
        if (ms < debuts[i] + 86_400_000) r.parJour[i] += 1;
        break;
      }
    }
    resultat.set(l.source_id, r);
  }
  return resultat;
}

/** « LCP (ms) · /checkout » : la règle nommée comme la frise la nomme (`alertFirings`). */
export function libelleDeRegle(r: Pick<AlertRuleRow, "metric" | "route">): string {
  return `${metricLabel(r.metric)}${r.route ? ` · ${r.route}` : ""}`;
}

/**
 * Le seuil d'une règle dans l'unité de SA métrique. `formater("count")` arrondissait
 * à l'entier : le seuil 0,1 d'un taux d'erreur s'affichait « > 0 », une règle qui
 * semblait se déclencher à la première erreur (recette du 26/09/2026). Un taux
 * s'écrit en pour cent, un CLS avec ses trois décimales, le reste sans perdre ses
 * décimales.
 */
export function seuilDeRegle(metric: string, seuil: number): string {
  // Vague 4 : les parts de sessions (clics rageurs…) s'écrivent en pour cent comme
  // le taux d'erreur.
  if (estPartDeMetrique(metric)) return formater("pct", seuil);
  if (metric === "CLS") return formater("cls", seuil);
  return Number.isFinite(seuil) ? seuil.toLocaleString("fr-FR", { maximumFractionDigits: 3 }) : "—";
}

/** Le mode d'une règle en mots (le formulaire dit « Écart à l'habitude », pas « baseline »). */
function modeEnClair(mode: string): string {
  return mode === "baseline" ? "écart à l'habitude" : mode === "release" ? "régression de release" : "seuil";
}

/** Ce que la règle évalue, en une phrase : mode, seuil ou sensibilité, fenêtre, env. */
export function reglageDeRegle(
  r: Pick<AlertRuleRow, "metric" | "mode" | "comparator" | "threshold" | "sensitivity" | "window_minutes" | "severity" | "env">,
): string {
  const severite = `sévérité ${libelleSeverite(r.severity)}`;
  // B52 : une règle de release compare deux p75 ; son seuil est une hausse EN POUR
  // CENT (décimales gardées : « +12,5 % » n'est pas « +13 % »), et la phrase du
  // § 3.2 l'accompagne partout où elle s'affiche.
  if (r.mode === "release") {
    return `${modeEnClair(r.mode)} : p75 en hausse de +${r.threshold.toLocaleString("fr-FR")} % ou plus contre la release précédente, sur ${formater("count", r.window_minutes)} min · ${severite} · ${PHRASE_FENETRE}`;
  }
  // `sensitivity` multiplie l'écart absolu médian des semaines passées (MAD, `check_alerts`) :
  // « 3 sigma » n'était ni français ni exact.
  const declenche =
    r.mode === "baseline"
      ? `${r.comparator === "<" ? "baisse" : "hausse"} au-delà de ${formater("count", r.sensitivity)} fois l'écart habituel`
      : `${r.comparator} ${seuilDeRegle(r.metric, r.threshold)}`;
  const env = r.env ? ` · env ${r.env}` : "";
  return `${modeEnClair(r.mode)} : ${declenche} sur ${formater("count", r.window_minutes)} min · ${severite}${env}`;
}

/**
 * Une valeur d'alerte dans l'unité de SA métrique, pour une phrase : un taux en pour
 * cent sans décimale inutile (« 37 % »), un vital avec son unité, un compte en
 * chiffres français (« 16 », pas « 16.0 »).
 */
export function valeurDeMetrique(metric: string, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (estPartDeMetrique(metric)) return `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}\u00a0%`;
  if (metric === "CLS") return formater("cls", v);
  // Vague 4 : phases réseau, tâches longues, ressources, API — des millisecondes.
  if (VITAUX.includes(metric) || estDureeDeMetrique(metric)) return formater("ms", v);
  if (metric === "DOWNLINK") return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}\u00a0Mbit/s`;
  return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
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
      detail: `${pluriel(e.delivered, "notification livrée", "notifications livrées")} — code 2xx confirmé`,
    };
  }
  if (e.pending > 0) {
    return {
      etat: "en_attente",
      libelle: `en attente ×${formater("count", e.pending)}`,
      detail: `${pluriel(e.pending, "notification transmise", "notifications transmises")}, résultat pas encore confirmé`,
    };
  }
  return { etat: "non_livree", libelle: "non livrée", detail: "Aucune notification n'est partie pour cette alerte" };
}

// Les messages que `check_alerts`, `check_slo_burn` et `check_new_errors` écrivent en
// base (migrations v45, v74, v86) sont des expressions techniques : « error_rate >
// 0.4 (seuil 0.1, fenêtre 60 min, app demo) ». Ils partent tels quels dans les
// webhooks ; l'écran, lui, en tire une phrase (recette du 26/09/2026). Un message
// qu'aucun motif ne reconnaît reste affiché tel quel plutôt que perdu.
const NOMBRE = "(-?\\d+(?:\\.\\d+)?)";
const MSG_SEUIL = new RegExp(`^(\\S+) ([<>]) ${NOMBRE} \\(seuil ${NOMBRE},`);
const MSG_HABITUDE = new RegExp(`^(\\S+) ([<>]) ${NOMBRE} anormal \\(normal(?: stable)?≈${NOMBRE}`);
const MSG_RELEASE = new RegExp(
  `^(\\S+) p75 en hausse de ${NOMBRE} % d'une release à l'autre : (.+?) = ${NOMBRE} contre (.+?) = ${NOMBRE} \\(seuil \\+${NOMBRE} %`,
);
const MSG_SLO = new RegExp(`^SLO « (.+) » en burn rapide : atteinte ${NOMBRE}% \\(objectif ${NOMBRE}%`);
const MSG_NOUVELLE_ERREUR = /^nouvelle erreur \S+ \/ app \S+ — (.+) \((\d+) occurrence\(s\) depuis \d\d:\d\d\)$/s;

const pctMessage = (v: string) => `${Number(v).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}\u00a0%`;

/**
 * Le titre d'un événement, en phrase : « Taux d'erreur JS : 37 % (seuil 10 %) ». La
 * valeur et le seuil viennent de la règle et de l'événement, sinon du message ; la
 * sévérité est dite par son badge, à côté.
 */
export function titreEvenement(
  e: Pick<AlertEventRow, "message" | "metric" | "rule_id" | "slo_id"> & Partial<Pick<AlertEventRow, "value">>,
  source?: Pick<AlertFiringRow, "source" | "libelle">,
  regle?: Pick<AlertRuleRow, "mode" | "comparator" | "threshold"> | null,
): string {
  const message = e.message ?? "";
  const seuil = MSG_SEUIL.exec(message);
  const habitude = MSG_HABITUDE.exec(message);
  const release = MSG_RELEASE.exec(message);
  const metrique = e.metric ?? seuil?.[1] ?? habitude?.[1] ?? release?.[1] ?? null;

  if (metrique && (e.rule_id != null || seuil || habitude || release)) {
    const libelle = libelleCourtMetrique(metrique);
    const mode = regle?.mode ?? (release ? "release" : habitude ? "baseline" : seuil ? "threshold" : null);
    const valeur = valeurDeMetrique(metrique, e.value ?? (seuil ?? habitude ? Number((seuil ?? habitude)![3]) : null));
    if (mode === "release") {
      if (release) {
        return `${libelle} : p75 en hausse de ${pctMessage(release[2])} d'une release à l'autre, ${release[3]} à ${valeurDeMetrique(metrique, Number(release[4]))} contre ${release[5]} à ${valeurDeMetrique(metrique, Number(release[6]))} (seuil +${pctMessage(release[7])}) — ${PHRASE_FENETRE}`;
      }
      // La phrase du § 3.2 accompagne toute comparaison de releases, ici comme dans le réglage.
      return `${libelle} : p75 en hausse d'une release à l'autre${regle ? ` (seuil +${pctMessage(String(regle.threshold))})` : ""} — ${PHRASE_FENETRE}`;
    }
    if (mode === "baseline") {
      const habituel = habitude ? `, habituellement ${valeurDeMetrique(metrique, Number(habitude[4]))}` : "";
      return `${libelle} : ${valeur}, inhabituel${habituel}`;
    }
    if (mode === "threshold") {
      const comparateur = regle?.comparator ?? seuil?.[2] ?? ">";
      const s = regle?.threshold ?? (seuil ? Number(seuil[4]) : null);
      const texteSeuil = s == null ? "" : ` (seuil${comparateur === "<" ? " bas" : ""} ${valeurDeMetrique(metrique, s)})`;
      return `${libelle} : ${valeur}${texteSeuil}`;
    }
  }

  const slo = MSG_SLO.exec(message);
  if (slo) return `SLO « ${slo[1]} » : le budget brûle trop vite, atteinte ${pctMessage(slo[2])} pour un objectif de ${pctMessage(slo[3])}`;
  const nouvelle = MSG_NOUVELLE_ERREUR.exec(message);
  if (nouvelle) return `Nouvelle erreur : ${nouvelle[1]} (${pluriel(Number(nouvelle[2]), "occurrence")})`;
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
