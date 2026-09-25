// LE CHARGEUR DE L'ÉCRAN « Actions » (C3) — `app/actions/page.tsx`.
//
// Ce que la page lisait elle-même, déplacé ici tel quel : les filtres de l'écran,
// la présence de `rum_action`, puis chaque section indépendante (§ 3.8). La page
// ne garde que ce qui se calcule de l'URL et de ce résultat (liens, libellés).
// Sans la table, rien n'est lu — sinon des zéros s'afficheraient « 0 action » là
// où rien n'a jamais été collecté (V3).
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { analyserFiltres } from "../filtres-ecran";
import {
  actionsDisponible,
  etatActions,
  parseActionsPage,
  topActions,
  topActionsSummary,
} from "../queries-actions";
import { paramReader, type AnalyticsQuery } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { lireEtatDeVue } from "../view-state";
import { section, urlDeLaPage, type Chargeur } from "./commun";

/** Lignes du hero ; la suite se lit dans la table (§ 5.4.3). */
export const LIGNES_HERO = 12;

/** Les actions se comptent : leur période précédente est sensible au retard d'ingestion. */
const SOURCE_ACTIONS: SourceComparaison = { table: "rum_action", colonneTemps: "ts", additive: true };

/** Première couverture incomplète des sources sous filtres, sinon « complète » (§ 3.2). */
async function couvertureDe(query: AnalyticsQuery, source: SourceComparaison): Promise<CouverturePrecedente> {
  const couvertures = await Promise.all(sourcesSousFiltres(query, source).map((s) => couverturePrecedente(query, s)));
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null };
}

export const chargerActions = (async (principal, sp) => {
  // Le périmètre signé est appliqué avant même de construire le SQL : demander
  // explicitement ?app=B hors de sa liste est refusé, jamais rabattu sur A.
  const ecran = await analyserFiltres(principal, sp, "/actions");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const { filters: f, query, label } = ecran;
  const page = parseActionsPage(urlDeLaPage(sp));
  const prev = lireEtatDeVue("/actions", paramReader(sp)).etat.cmp === "prev";

  // Sans la table, les lectures rendraient des zéros : on ne les lance pas.
  const nonCollecte = etatActions(await actionsDisponible());
  if (nonCollecte) return { etat: "non_collecte", nonCollecte } as const;

  // CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8) : une section en échec le dit sans
  // emporter les autres — et jamais par un « 0 ».
  const pageLargeAuDebut = page.offset === 0 && page.limit >= LIGNES_HERO;
  const [lignes, heroSeul, resume, resumePrec, couverture, schema] = await Promise.all([
    section(() => topActions(f, page)),
    // La page 1 contient déjà les lignes du hero : on ne relit pas la même chose.
    pageLargeAuDebut ? Promise.resolve(null) : section(() => topActions(f, { limit: LIGNES_HERO, offset: 0 })),
    section(() => topActionsSummary(f)),
    prev ? section(() => topActionsSummary(f, true)) : Promise.resolve(null),
    prev ? couvertureDe(query, SOURCE_ACTIONS) : Promise.resolve(null),
    dimensionSchema(),
  ]);
  const hero = heroSeul ?? (lignes.ok ? { ok: true as const, data: lignes.data.slice(0, LIGNES_HERO) } : lignes);
  return {
    etat: "ok",
    query,
    label,
    page,
    prev,
    lignes,
    hero,
    resume,
    resumePrec,
    couverture,
    schema: [...schema].sort(),
  } as const;
}) satisfies Chargeur<unknown>;

export type ChargeActions = Awaited<ReturnType<typeof chargerActions>>;
