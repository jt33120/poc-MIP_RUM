// Écran /slo (F63, plan § 5.18) : ce que la page tire de `slo_status()`, sans accès
// base. Module pur, testé (tests/unit/slo.test.ts).
//
// CE QUE CALCULE VRAIMENT `slo_status()` (migration-v64) — et que l'écran écrit :
//   - un vital : part des mesures notées Bon sur `window_days` jours glissants
//     jusqu'à MAINTENANT, sans filtre de population ;
//   - `error_rate` : 1 − occurrences d'erreurs / pages vues. Pas une part de pages
//     sans erreur : dès qu'il y a plus d'occurrences que de pages vues, l'atteinte
//     devient NÉGATIVE, et n'est pas interprétable ;
//   - consommé = (1 − atteinte) / (1 − objectif) × 100, borné à [0, 999] ;
//   - burn rapide : 1 − atteinte sur la DERNIÈRE HEURE ≥ 14,4 × budget ; `null` sans
//     mesure sur l'heure. Une seule fenêtre : sensible aux pics courts.
// Un SLO sans aucune mesure rend `attainment = null` : ni tenu ni manqué (V3).
import type { BudgetLigne } from "../components/charts/BudgetBars";
import { formater } from "./fmt-ids";
import type { SloStatusRow } from "./queries-alerting";
import type { AlertFiringRow } from "./queries-v2";

/** Métriques SLO qui sont des Web Vitals (part des mesures notées Bon). */
const VITAUX: readonly string[] = ["LCP", "INP", "CLS", "FCP", "TTFB"];

export const FORMULE_SLO =
  "LCP, INP, CLS, FCP, TTFB : part des mesures notées Bon sur la fenêtre. error_rate : 1 − occurrences d'erreurs ÷ pages vues sur la fenêtre (négatif s'il y a plus d'occurrences que de pages vues).";

/** Facteur du burn rapide de `slo_status()` (migration-v64) ; origine non documentée dans le dépôt. */
export const FACTEUR_BURN_RAPIDE = 14.4;

/** La métrique en clair : sa formule, pas son identifiant (« Taux d'erreur JS » disparaît). */
export function metriqueEnClair(metric: string): string {
  if (VITAUX.includes(metric)) return `Part des mesures ${metric} notées Bon`;
  if (metric === "error_rate") return "1 − occurrences d'erreurs par page vue";
  return metric;
}

/** Pourquoi un SLO n'a pas de budget lisible ; `undefined` s'il en a un. */
export function raisonSlo(s: Pick<SloStatusRow, "metric" | "window_days" | "attainment">): string | undefined {
  if (s.attainment == null) {
    return s.metric === "error_rate"
      ? `aucune page vue sur ${s.window_days} j`
      : `aucune mesure ${s.metric} sur ${s.window_days} j`;
  }
  if (s.attainment < 0) return "plus d'occurrences d'erreurs que de pages vues : atteinte non interprétable";
  return undefined;
}

/**
 * Drill « qu'est-ce qui consomme ce budget ? » (§ 5.18.1) : pour un vital, les pages
 * de la route sur ce vital ; pour `error_rate`, les erreurs de la route. L'app du
 * SLO est posée : sous `app=all`, la route seule ne désignerait pas la bonne app.
 */
export function hrefConsommation(s: Pick<SloStatusRow, "app_id" | "metric" | "route">): string {
  const p = new URLSearchParams({ app: s.app_id });
  if (VITAUX.includes(s.metric)) p.set("vital", s.metric);
  if (s.route) p.set("route", s.route);
  return `${s.metric === "error_rate" ? "/errors" : "/pages"}?${p.toString()}`;
}

/** Lien « Créer une alerte sur ce SLO » (admin) : paramètres `regle_*` du § 3.1, jamais `route`. */
export function hrefCreerAlerte(s: Pick<SloStatusRow, "metric" | "route">): string {
  const p = new URLSearchParams({ regle_metrique: s.metric });
  if (s.route) p.set("regle_route", s.route);
  return `/alerts?${p.toString()}#nouvelle-regle`;
}

/** « LCP · /checkout · 28 j · objectif 95,0 % » : ce que mesure une barre. */
export function detailSlo(s: Pick<SloStatusRow, "metric" | "route" | "window_days" | "objective">): string {
  const metrique = s.metric === "error_rate" ? "erreurs par page vue" : s.metric;
  return `${metrique} · ${s.route ?? "toutes routes"} · ${s.window_days} j · objectif ${formater("pct", s.objective)}`;
}

/**
 * Lignes du hero « Budget d'erreur consommé, par SLO » : consommé décroissant, les
 * SLO non mesurables en dernier (jamais une barre à 0 %).
 */
export function lignesBudget(statuts: readonly SloStatusRow[]): BudgetLigne[] {
  // −1 : sous tout consommé réel (0 compris), donc en dernier.
  const cleTri = (s: SloStatusRow) => (s.attainment == null || s.burned_pct == null ? -1 : s.burned_pct);
  return [...statuts]
    .sort((a, b) => cleTri(b) - cleTri(a) || a.name.localeCompare(b.name))
    .map((s) => ({
      cle: String(s.slo_id),
      libelle: s.name,
      detail: detailSlo(s),
      // Sans mesure, `slo_status()` rend déjà `burned_pct = null` ; on ne s'y fie pas
      // seul : une atteinte inconnue n'a jamais de budget consommé.
      consomme: s.attainment == null ? null : s.burned_pct,
      atteinte: s.attainment,
      objectif: s.objective,
      brule: s.fast_burn,
      raison: raisonSlo(s),
      href: hrefConsommation(s),
    }));
}

export interface ComptesSlo {
  actifs: number;
  /** Consommé ≥ 100 % : seule définition (R-S). */
  epuises: number;
  /** `fast_burn = true`. */
  brulent: number;
  /** `attainment = null` : aucune mesure sur la fenêtre. */
  nonMesurables: number;
  /** Mesurés sur la fenêtre, mais aucune mesure sur la dernière heure : burn inconnu. */
  burnInconnu: number;
}

/** Les quatre tuiles (SL1, SL2, SL2b, SL2c) : un SLO non mesurable n'est compté nulle part ailleurs. */
export function comptesSlo(statuts: readonly Pick<SloStatusRow, "attainment" | "burned_pct" | "fast_burn">[]): ComptesSlo {
  const mesures = statuts.filter((s) => s.attainment != null);
  return {
    actifs: statuts.length,
    epuises: mesures.filter((s) => s.burned_pct != null && s.burned_pct >= 100).length,
    brulent: mesures.filter((s) => s.fast_burn === true).length,
    nonMesurables: statuts.length - mesures.length,
    burnInconnu: mesures.filter((s) => s.fast_burn == null).length,
  };
}

/** Déclenchements par SLO sur la fenêtre lue (colonne « Alertes sur 7 j »). */
export function alertesParSlo(lignes: readonly Pick<AlertFiringRow, "source" | "source_id">[]): Map<number, number> {
  const parSlo = new Map<number, number>();
  for (const l of lignes) {
    if (l.source !== "slo") continue;
    const id = Number(l.source_id);
    if (Number.isSafeInteger(id)) parSlo.set(id, (parSlo.get(id) ?? 0) + 1);
  }
  return parSlo;
}
