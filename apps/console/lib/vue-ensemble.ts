// Vue d'ensemble `/` (F11-F13, plan § 5.1) — logique PURE, testée
// (tests/unit/vue-ensemble.test.ts), sans accès base. L'écran lit, ce module décide
// ce qu'il a le droit d'en écrire : la référence d'un écart, le sous-texte du ratio
// d'erreurs, et les constats automatiques à règle publiée.
import type { Constat } from "@/components/InsightStrip";
import { formater } from "./fmt-ids";
import type { AnomalyRow } from "./health";
import type { AlertFiringRow } from "./queries-v2";
import { verdictDeploiement, type DeployImpact } from "./queries-deploys";
import { RAISON_MOINS_DE_DEUX_RELEASES, type ChoixReleases } from "./presets";
import type { AnalyticsQuery, ResolvedRange } from "./query-contract";

// ─────────────────────────────── Références (§ 3.12) ───────────────────────────────

const JJMM_HHMM = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const NOM_PRECEDENTE: Record<string, string> = {
  "1h": "heure précédente",
  "24h": "24 h précédentes",
  "7d": "7 jours précédents",
};

/**
 * Référence d'un écart `cmp=prev`, écrite EN TOUTES LETTRES à côté du delta (P4,
 * § 3.12) : « vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC) ». La plage est
 * celle de `previousRange` : même durée, immédiatement avant.
 */
export function referencePrecedente(range: Pick<ResolvedRange, "from" | "to" | "preset">): string {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const debut = new Date(from - (to - from));
  const nom = (range.preset && NOM_PRECEDENTE[range.preset]) ?? "période précédente";
  return `vs ${nom} (${JJMM_HHMM.format(debut)} → ${JJMM_HHMM.format(new Date(from))} UTC)`;
}

/** Référence d'un écart `cmp=release` : même fenêtre, la release A (§ 3.12). */
export function referenceRelease(relA: string): string {
  return `vs release ${relA} (même fenêtre)`;
}

// ─────────────────────── Occurrences d'erreurs pour 100 pages vues ───────────────────────

/**
 * Sous-texte de la tuile « Occurrences d'erreurs pour 100 pages vues » (§ 5.1.2,
 * CP14) : ce que le numérateur laisse de côté, chiffré — seulement ce qui est > 0.
 * La somme `serveur` réunit toute source déclarée hors navigateur (Node, Python,
 * OpenTelemetry, mobile) : elle s'écrit « hors navigateur », pas « serveur » (F10).
 * Sans la colonne de source (v69), le numérateur porte toutes les sources et le dit.
 */
export function lectureErreursPour100(e: {
  restreint: boolean;
  sansSource: number;
  serveur: number;
}): string {
  if (!e.restreint) return "toutes sources : inclut les erreurs serveur sans page vue (colonne de source absente)";
  const exclues = [
    e.sansSource > 0 ? `${formater("count", e.sansSource)} occurrence(s) sans source déclarée` : null,
    e.serveur > 0 ? `${formater("count", e.serveur)} occurrence(s) hors navigateur (serveur, mobile)` : null,
  ].filter((x): x is string => x !== null);
  return exclues.length
    ? `erreurs navigateur seulement ; ${exclues.join(" et ")} non comptée(s)`
    : "erreurs navigateur seulement";
}

// ─────────────────────────────── Releases ───────────────────────────────

/**
 * La requête sans ses conditions de release. `choisirReleases` (F08) doit voir TOUTES
 * les releases de la fenêtre : sous `release=B`, la lecture des versions n'en verrait
 * qu'une et la vue « Nouvelle release vs précédente » se dirait indisponible.
 */
export function sansConditionRelease(query: AnalyticsQuery): AnalyticsQuery {
  const { release: _release, ...reste } = query.filters;
  return { ...query, filters: { ...reste, segments: query.filters.segments.filter((c) => c.dimension !== "release") } };
}

export type ReleasesComparees =
  | { ok: true; relA: string; relB: string; regle: string }
  | { ok: false; raison: string };

/**
 * Releases comparées en `cmp=release` : celles de l'URL (`rel_a`, `rel_b`) quand
 * elles y sont, sinon la règle du § 3.2 (`choisirReleases`, F08), et la règle
 * APPLIQUÉE, écrite sous le titre de chaque comparaison. Moins de deux releases
 * distinctes : pas de comparaison, et sa raison.
 */
export function releasesComparees(
  url: { relA: string | null; relB: string | null },
  choix: ChoixReleases | null,
): ReleasesComparees {
  // Une release manquante dans l'URL est complétée par la règle, dans son ordre
  // (candidate puis référence), sans jamais reprendre celle que l'URL a déjà posée.
  const candidates = [choix?.relB, choix?.relA].filter((v): v is string => !!v);
  const relB = url.relB ?? candidates.find((v) => v !== url.relA) ?? null;
  const relA = url.relA ?? candidates.find((v) => v !== relB) ?? null;
  if (relA === null || relB === null || relA === relB) {
    return { ok: false, raison: choix?.indisponible ?? RAISON_MOINS_DE_DEUX_RELEASES };
  }
  const origine = (v: string, parametre: "rel_a" | "rel_b", deLUrl: boolean) =>
    deLUrl ? `${v} : choisie dans l'URL (${parametre})` : `${v} : complétée par la règle du dernier déploiement`;
  const regle =
    url.relA === null && url.relB === null && choix
      ? choix.regle
      : `${origine(relB, "rel_b", url.relB !== null)} ; ${origine(relA, "rel_a", url.relA !== null)}`;
  return { ok: true, relA, relB, regle };
}

// ─────────────────────────────── Constats (§ 5.1.2, zone 4) ───────────────────────────────

/**
 * Les constats d'alerte PAR ÉVÉNEMENT (`/alerts?evt=<id>`) attendent que `/alerts`
 * sache mettre un événement en évidence (paramètre `evt`, lots F64 et F67). Avant,
 * un lien `evt=` mènerait à une liste où rien ne le désigne : le repli du plan est
 * UN constat « N alertes non acquittées » → `/alerts`. Passer à `true` avec F67.
 */
export const ALERTES_PAR_EVENEMENT = false;

/** Au plus trois alertes nommées, puis « et N autres » (§ 5.1.2). */
export const MAX_ALERTES_NOMMEES = 3;
/** Au plus cinq groupes régressés nommés, puis « et N autres ». */
export const MAX_REGRESSIONS_NOMMEES = 5;

export const REGLE_ANOMALIE = "z-score > 3 sur la moyenne horaire des 7 derniers jours, au moins 5 h d'historique (24 h fixes)";
export const REGLE_ANOMALIE_SOUS_FILTRE =
  "anomalies LCP : non cherchées sous un filtre de population (la détection ne connaît que l'app et la route)";
export const REGLE_DEPLOIEMENT =
  "dernier déploiement : +20 % ou plus sur le LCP p75 ou les occurrences d'erreurs, ±2 h autour du marqueur, filtres de population non appliqués";
export const REGLE_ALERTES = "alertes déclenchées et non acquittées, toutes dates";
export const REGLE_REGRESSION = "groupe d'erreurs marqué résolu qui réapparaît sur la période";

export const FENETRE_CONSTATS = "anomalies : 24 h fixes ; déploiement : ±2 h ; erreurs : période choisie ; alertes : en cours";

/** Une source de constats lue, ou en échec (sa section le dit, les autres restent). */
export type LuOuEchec<T> = { ok: true; data: T } | { ok: false };

export interface EntreesConstats {
  /** `healthScore(f).anomalies` (24 h fixes) ; `filtrees` : non cherchées sous filtre. */
  anomalies: LuOuEchec<{ lignes: AnomalyRow[]; filtrees: boolean }>;
  /** Dernier déploiement (`latestDeployImpact`) et la version précédente (marqueur d'avant). */
  deploiement: LuOuEchec<{ impact: DeployImpact; versionPrecedente: string | null } | null>;
  /**
   * Alertes non acquittées : un compte (`unackedAlertCount`, repli d'avant F67) ou les
   * événements (`alertFirings(f, 1)`, champs `event_id`, `acknowledged`).
   */
  alertes: LuOuEchec<{ mode: "compte"; n: number } | { mode: "evenements"; lignes: AlertFiringRow[] }>;
  /** Groupes d'erreurs régressés de la période (`listErrorGroups`, `regressed`). */
  regresses: LuOuEchec<
    { app_id: string; fingerprint: string; sample_message: string | null; error_type: string | null; occurrences: number }[]
  >;
}

export interface LiensConstats {
  /** Anomalie → `/pages?route=…&from=…&to=…` (l'heure de l'anomalie). */
  anomalie: (a: AnomalyRow) => string;
  /** Déploiement → `?cmp=release&rel_b=v&rel_a=v-1`. */
  deploiement: (relB: string | null, relA: string | null) => string;
  /** `/alerts`, sans identifiant d'événement. */
  alertes: string;
  /** `/alerts?evt=<id>` — jamais `fired=` (§ 3.1). */
  alerte: (eventId: number) => string;
  /** Groupe régressé → `panel=error:<fp>`. */
  erreur: (g: { app_id: string; fingerprint: string }) => string;
  /** Tous les groupes régressés → `/errors?statut=regressed`. */
  regresses: string;
}

export interface ConstatsCalcules {
  constats: Constat[];
  /** Règles évaluées : citées quand il n'y a aucun constat. */
  regles: string[];
  /** Sources non lues : « Constats partiels » les nomme. */
  echecs: string[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v} %`);

/** « 22/09 14:00 UTC » */
function horodatage(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${JJMM_HHMM.format(d)} UTC`;
}

function constatDeploiement(
  impact: DeployImpact,
  versionPrecedente: string | null,
  liens: LiensConstats,
): Constat | null {
  const verdict = verdictDeploiement(impact);
  if (verdict.etat !== "regression") return null;
  const signaux = [
    verdict.lcp.regressed ? `LCP p75 ${pct(verdict.lcp.deltaPct)}` : null,
    verdict.erreurs.regressed ? `occurrences d'erreurs ${pct(verdict.erreurs.deltaPct)}` : null,
    verdict.erreursApparues ? `erreurs apparues (0 avant, ${formater("count", impact.errors_after)} après)` : null,
  ].filter((s): s is string => s !== null);
  const nom = impact.version ? `Déploiement ${impact.version}` : "Déploiement sans version";
  // Les effectifs des deux côtés, toujours : un « +40 % » sur 12 pages vues n'est pas
  // celui d'un « +40 % » sur 12 000.
  const effectifs = `${formater("count", impact.pageviews_before)} pages vues avant, ${formater("count", impact.pageviews_after)} après`;
  return {
    type: "regression",
    titre: `${nom} : ${signaux.join(", ")} (${effectifs})`,
    regle: REGLE_DEPLOIEMENT,
    href: liens.deploiement(impact.version, versionPrecedente),
  };
}

function constatsAlertes(
  alertes: { mode: "compte"; n: number } | { mode: "evenements"; lignes: AlertFiringRow[] },
  liens: LiensConstats,
): Constat[] {
  if (alertes.mode === "compte") {
    if (!(alertes.n > 0)) return [];
    return [
      {
        type: "alerte",
        titre: `${formater("count", alertes.n)} alerte(s) non acquittée(s)`,
        regle: REGLE_ALERTES,
        href: liens.alertes,
      },
    ];
  }
  const ouvertes = alertes.lignes
    .filter((l) => !l.acknowledged)
    .sort((a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());
  const nommees: Constat[] = ouvertes.slice(0, MAX_ALERTES_NOMMEES).map((l) => ({
    type: "alerte",
    titre: `${l.libelle} — déclenchée le ${horodatage(l.fired_at)}`,
    regle: REGLE_ALERTES,
    href: liens.alerte(l.event_id),
  }));
  const reste = ouvertes.length - nommees.length;
  if (reste > 0) {
    nommees.push({
      type: "alerte",
      titre: `et ${formater("count", reste)} autre(s) alerte(s) non acquittée(s)`,
      regle: REGLE_ALERTES,
      href: liens.alertes,
    });
  }
  return nommees;
}

/**
 * Constats automatiques de la Vue d'ensemble, dans l'ordre : anomalies, dernier
 * déploiement, alertes, erreurs régressées. Chaque constat porte sa règle et son
 * lien ; une source illisible est NOMMÉE dans `echecs` (jamais un « aucun
 * constat » qui masquerait une lecture en échec).
 */
export function constatsVueEnsemble(e: EntreesConstats, liens: LiensConstats): ConstatsCalcules {
  const constats: Constat[] = [];
  const regles: string[] = [];
  const echecs: string[] = [];

  if (!e.anomalies.ok) {
    echecs.push("anomalies LCP");
    regles.push(REGLE_ANOMALIE);
  } else if (e.anomalies.data.filtrees) {
    regles.push(REGLE_ANOMALIE_SOUS_FILTRE);
  } else {
    regles.push(REGLE_ANOMALIE);
    for (const a of e.anomalies.data.lignes) {
      constats.push({
        type: "anomalie",
        titre: `LCP ${a.route ?? "(toutes routes)"} : ${formater("ms", a.p75)} à ${horodatage(a.bucket)} (moyenne 7 j : ${formater("ms", a.mean_7d)})`,
        regle: `z-score ${a.z_score.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} > 3 sur la moyenne horaire des 7 derniers jours`,
        href: liens.anomalie(a),
      });
    }
  }

  regles.push(REGLE_DEPLOIEMENT);
  if (!e.deploiement.ok) echecs.push("dernier déploiement");
  else if (e.deploiement.data) {
    const c = constatDeploiement(e.deploiement.data.impact, e.deploiement.data.versionPrecedente, liens);
    if (c) constats.push(c);
  }

  regles.push(REGLE_ALERTES);
  if (!e.alertes.ok) echecs.push("alertes non acquittées");
  else constats.push(...constatsAlertes(e.alertes.data, liens));

  regles.push(REGLE_REGRESSION);
  if (!e.regresses.ok) echecs.push("groupes d'erreurs régressés");
  else {
    const groupes = e.regresses.data;
    for (const g of groupes.slice(0, MAX_REGRESSIONS_NOMMEES)) {
      const nom = g.sample_message ?? g.error_type ?? `empreinte ${g.fingerprint.slice(0, 8)}`;
      constats.push({
        type: "regression",
        titre: `Erreur réapparue : ${nom} (${formater("count", g.occurrences)} occurrence(s) sur la période)`,
        regle: REGLE_REGRESSION,
        href: liens.erreur(g),
      });
    }
    const reste = groupes.length - MAX_REGRESSIONS_NOMMEES;
    if (reste > 0) {
      constats.push({
        type: "regression",
        titre: `et ${formater("count", reste)} autre(s) groupe(s) d'erreurs régressé(s)`,
        regle: REGLE_REGRESSION,
        href: liens.regresses,
      });
    }
  }

  return { constats, regles, echecs };
}
