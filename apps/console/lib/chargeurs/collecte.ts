// LE CHARGEUR DES FENÊTRES HORS COLLECTE — la source des hachures « non mesuré ».
//
// Un écran qui dessine une série temporelle passe ses fenêtres à `ThresholdSeries`
// ou `StackedBars` (prop `fenetresCollecte`) : un seau entièrement couvert par une
// fenêtre `interrompue` y devient « non mesuré » au lieu d'un zéro (`series.ts`,
// `collecteDesSeaux`). La lecture vit ici, derrière un chargeur, pour tenir le
// cliquet « Console sans base » : ni la page ni le composant n'atteignent la base.
//
// Deux formes :
//   · `sectionFenetresCollecte(query)` : pour le chargeur d'un écran, qui a déjà sa
//     requête résolue — une section de plus dans sa sortie ;
//   · `chargerFenetresCollecte` : un chargeur autonome (principal, paramètres d'URL)
//     pour un écran qui n'en a pas d'autre.
// La plage lue couvre la période affichée ET la précédente : la même lecture sert
// aux hachures et à la comparaison (`comparaison.ts`, sixième règle).
import type { Section } from "@mip/console-contract";
import { analyserFiltres } from "../filtres-ecran";
import { lireFenetresCollecte } from "../queries-collecte";
import { previousRange, type AnalyticsQuery } from "../query-contract";
import type { FenetreCollecte } from "../series";
import { section, type Chargeur } from "./commun";

export type { FenetreCollecte };

/** Plage lue : la période précédente et la période affichée, bout à bout. */
export function plageDesFenetres(query: AnalyticsQuery): { from: string; to: string } {
  return { from: previousRange(query.range).from, to: query.range.to };
}

/** Les fenêtres d'une requête résolue, en section (un échec de lecture se dit, jamais un `[]` inventé). */
export function sectionFenetresCollecte(query: AnalyticsQuery): Promise<Section<FenetreCollecte[]>> {
  return section(() => lireFenetresCollecte(plageDesFenetres(query), query.scope.effectiveApps));
}

/**
 * Les fenêtres d'un graphique dont l'axe ne suit PAS la plage du filtre (quatorze
 * jours de `/forecast`, trente de `/alerts`, vingt-quatre heures de `/logs`) : la
 * plage lue est celle de l'axe, `duree` jusqu'à maintenant plus un jour de marge
 * (un jour de l'axe se lit dans le fuseau de l'application). Le périmètre reste
 * celui de la requête.
 */
export function sectionFenetresCollecteRecentes(
  query: AnalyticsQuery,
  dureeMs: number,
  maintenant: number = Date.now(),
): Promise<Section<FenetreCollecte[]>> {
  const from = new Date(maintenant - dureeMs - 86_400_000).toISOString();
  return section(() => lireFenetresCollecte({ from, to: new Date(maintenant).toISOString() }, query.scope.effectiveApps));
}

/**
 * Chargeur autonome : les fenêtres de la plage et du périmètre de l'URL. `chemin`
 * est l'écran qui l'appelle (ses capacités de filtrage décident du refus d'un filtre).
 */
export function chargeurFenetresCollecte(chemin: string) {
  return (async (principal, sp) => {
    if (!principal) return { etat: "sans_session" } as const;
    const ecran = await analyserFiltres(principal, sp, chemin);
    if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
    return { etat: "ok", fenetres: await sectionFenetresCollecte(ecran.query) } as const;
  }) satisfies Chargeur<unknown>;
}
