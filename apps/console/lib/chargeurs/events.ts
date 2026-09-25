// LE CHARGEUR DU « Journal » (C3) — `app/events/page.tsx`.
//
// L'URL du Journal porte, en plus du contexte commun (plage, filtres), sa propre
// requête : nom, facette (source, clé, type, valeur), curseur. `demandeDuJournal`
// la lit — la MÊME fonction pour le chargeur (ce qu'il faut lire) et pour la page
// (ce qu'il faut afficher) : les deux ne peuvent pas lire deux URL différentes.
import { cleSansValeur, eventSearchParams, paginationJournal } from "../events-page-params";
import { analyserFiltres } from "../filtres-ecran";
import { listDeploys } from "../queries-deploys";
import {
  exploreEvents,
  parseEventAttribute,
  parseEventCursor,
  parseEventPage,
  parseEventQuery,
  type EventAttributeSource,
} from "../queries-events";
import { section, type Chargeur, type ParametresEcran } from "./commun";

/** La requête propre du Journal ; `null` : un filtre illisible (nom trop long, facette incomplète). */
export function demandeDuJournal(sp: ParametresEcran) {
  // L'URL telle quelle : base de TOUS les liens de l'écran (facettes, panneau, page
  // suivante), qui gardent donc population, plage et filtres d'événements.
  const brut = eventSearchParams(sp);
  // Clé choisie depuis une facette, sans valeur encore : elle pré-remplit le
  // formulaire et demande ses valeurs ; elle ne filtre rien.
  const choisie = brut ? cleSansValeur(brut) : null;
  const cle =
    choisie &&
    parseEventAttribute(
      new URLSearchParams({ attr_source: choisie.cle.source, attr_key: choisie.cle.key, attr_type: "null" }),
    )
      ? { source: choisie.cle.source as EventAttributeSource, key: choisie.cle.key }
      : null;
  const lu = brut ? new URLSearchParams(cle && choisie ? choisie.sansCle : brut) : null;
  if (lu && !lu.has("kind")) lu.set("kind", "event");
  const query = lu ? parseEventQuery(lu) : undefined;
  const cursor = lu ? parseEventCursor(lu.get("cursor")) : undefined;
  const page = lu && cursor !== undefined ? paginationJournal(lu, parseEventPage(lu), cursor) : undefined;
  if (!brut || !query || cursor === undefined || !page) return null;
  return { brut, cle, query, cursor, page };
}

export const chargerEvents = (async (principal, sp) => {
  const ecran = await analyserFiltres(principal, sp, "/events");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const contexte = { query: ecran.query, label: ecran.label, bucketLabel: ecran.bucketLabel };
  const demande = demandeDuJournal(sp);
  if (!demande) return { etat: "filtre_invalide", ...contexte } as const;
  const { query, page, cursor, cle } = demande;
  const [resultat, deploys] = await Promise.all([
    section(() => exploreEvents(ecran.deviceFilters, query, page, cursor, { valeursDe: cle })),
    section(() => listDeploys(ecran.filters, 20)),
  ]);
  return { etat: "ok", ...contexte, resultat, deploys } as const;
}) satisfies Chargeur<unknown>;
