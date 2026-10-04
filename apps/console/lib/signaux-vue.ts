// Les signaux de VUE du SDK web ≥ 0.6 (04/10/2026) — définitions pures, sans la base.
//
// POURQUOI CE FICHIER. Le SDK envoie cinq mesures par page vue sur le canal des Web
// Vitals (`webvital.<NOM>`, donc `rum_metric`) : l'ingestion n'a pas changé. Or
// `rum_metric.name` est du texte libre, et une lecture qui groupe par nom sans liste
// les montrerait comme des Web Vitals (ou les compterait dans la population des
// mesures de performance). Ce fichier donne LA liste, et le fragment SQL qui les
// écarte ; les lectures qui les veulent (`queries-engagement.ts`) les nomment.
//
// Une ligne par vue et par nom (contrainte `(session_id, name, metric_uid)`, la plus
// grande valeur gardée) : le SDK envoie des CUMULS, la ligne porte la valeur finale.
import { mesuresMinimales } from "@mip/stats/incertitude";
import { pluriel } from "./format";

export const MESURES_DE_VUE = ["TIME_SPENT", "SCROLL_DEPTH", "SPA_LOAD", "RESOURCE_COUNT", "RESOURCE_BYTES"] as const;
export type MesureDeVue = (typeof MESURES_DE_VUE)[number];

export function estMesureDeVue(nom: string): nom is MesureDeVue {
  return (MESURES_DE_VUE as readonly string[]).includes(nom);
}

/**
 * ` and <colonne> <> all('{TIME_SPENT,…}')` : la condition qui rend à une lecture de
 * `rum_metric` sa population d'avant le 04/10/2026. Expression constante du code,
 * aucune valeur venue de la requête.
 */
export function sqlHorsMesuresDeVue(colonne: string): string {
  return ` and ${colonne} <> all('{${MESURES_DE_VUE.join(",")}}'::text[])`;
}

/** La version du SDK web qui émet ces mesures : un écran vide le dit. */
export const VERSION_SDK_SIGNAUX_VUE = "0.6";

/** Ce qu'écrit une section vide : l'absence vient souvent d'un SDK plus ancien. */
export const TEXTE_SANS_SIGNAL_VUE = `aucune donnée : le SDK web ≥ ${VERSION_SDK_SIGNAUX_VUE} les envoie, une version antérieure non`;

/**
 * Sous cet effectif, ni médiane ni p75 : 13, le plus petit nombre de mesures pour
 * lequel la p75 a un intervalle à 95 % (`mesuresMinimales`, @mip/stats). La valeur
 * devient `null` et la ligne dit ce qui manque (« 7 vues, 13 requises »), jamais 0.
 */
export const EFFECTIF_MIN_SIGNAL_VUE = mesuresMinimales();

/** Défilement « profond » : la part des vues qui atteignent ce pourcentage. */
export const SEUIL_DEFILEMENT_PROFOND = 75;

/** « 7 vues, 13 requises » quand l'effectif manque ; `null` sinon. */
export function manqueEffectif(n: number, unite: "vue" | "mesure" | "chargement", requis = EFFECTIF_MIN_SIGNAL_VUE): string | null {
  if (n >= requis) return null;
  return `${pluriel(n, unite)}, ${requis} requis${unite === "vue" || unite === "mesure" ? "es" : ""}`;
}

/** D'où vient un repère : `performance.mark`, `performance.measure`, ou `addTiming` (manuel). */
export type SourceRepere = "mark" | "measure" | "manuel";

export function sourceRepere(nom: string): SourceRepere {
  if (nom.startsWith("mark:")) return "mark";
  if (nom.startsWith("measure:")) return "measure";
  return "manuel";
}

export const LIBELLE_SOURCE_REPERE: Record<SourceRepere, string> = {
  mark: "performance.mark",
  measure: "performance.measure",
  manuel: "addTiming",
};

/** Ce que mesure la valeur d'un repère selon sa source. */
export const SENS_VALEUR_REPERE: Record<SourceRepere, string> = {
  mark: "instant depuis le début de la vue",
  measure: "durée",
  manuel: "durée déclarée",
};
