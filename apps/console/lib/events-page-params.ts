import type { Pagination } from "./api/pagination";
import type { SearchParams } from "./filters";
import { hrefWithQuery, type AnalyticsQuery } from "./query-contract";

/**
 * Next représente les query params répétés par des tableaux. L'Explorer refuse
 * ces entrées ambiguës au lieu d'en choisir silencieusement une valeur.
 */
export function eventSearchParams(sp: SearchParams): URLSearchParams | null {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(sp)) {
    if (Array.isArray(value)) return null;
    if (typeof value === "string") url.set(key, value);
  }
  return url;
}

/** Un curseur est absolu : un offset résiduel ne doit jamais s'y ajouter. */
export function eventPagePagination(page: Pagination, cursor: unknown | null): Pagination {
  return cursor == null ? page : { ...page, offset: 0 };
}

/**
 * Retire les filtres propres aux événements (nom, attribut, curseur) sans perdre le
 * contexte global : app, plage, appareil, dimensions, segment, bots, apps internes.
 */
export function eventResetHref(query: AnalyticsQuery): string {
  return hrefWithQuery("/events", query);
}

// ─────────────────────────── F25 — liens du Journal ───────────────────────────

/** Diagnostic de `exploreEvents` quand la projection elle-même manque (v65). */
export const SANS_PROJECTION = "migration v65 absente";

/**
 * Total du journal, ou `null` s'il n'a pas été CALCULÉ : sans projection (v65),
 * `exploreEvents` rend 0 par défaut ; sans enrichissements (v68), il rend 0 sous un
 * filtre de nom ou d'attribut. Ces zéros ne sont pas des comptes (V3) : la tuile
 * « Total observé » et la méta du volume lisent cette MÊME décision.
 */
export function totalJournal(
  r: { total: number; enrichment: { available: boolean; diagnostic: string | null } },
  query: { name: string | null; attribute: unknown },
): number | null {
  if (r.enrichment.available) return r.total;
  if ((r.enrichment.diagnostic ?? "").startsWith(SANS_PROJECTION)) return null;
  return query.name || query.attribute ? null : r.total;
}

/** Lignes par page du Journal (§ 5.23.2) ; `limit` explicite dans l'URL l'emporte. */
export const LIGNES_JOURNAL = 50;

/**
 * Pagination du Journal : 50 lignes par défaut (l'API garde son défaut de 100),
 * curseur absolu (`eventPagePagination`).
 */
export function paginationJournal(url: URLSearchParams, page: Pagination, cursor: unknown | null): Pagination {
  const lue = url.has("limit") ? page : { ...page, limit: LIGNES_JOURNAL };
  return eventPagePagination(lue, cursor);
}

/**
 * Lien du Journal depuis l'URL courante : mêmes filtres (contrat ET filtres
 * d'événements), avec des changements (`null` retire le paramètre). Un changement de
 * filtre repart de la première page et ferme le panneau : l'ancien curseur et
 * l'événement ouvert appartiennent à une autre liste.
 */
export function lienJournal(courant: URLSearchParams, changements: Record<string, string | null>): string {
  const p = new URLSearchParams(courant);
  for (const nom of ["cursor", "offset", "panel"]) p.delete(nom);
  for (const [nom, valeur] of Object.entries(changements)) {
    if (valeur === null) p.delete(nom);
    else p.set(nom, valeur);
  }
  const qs = p.toString();
  return qs ? `/events?${qs}` : "/events";
}

/**
 * Lien d'ouverture (ou de fermeture, `panel: null`) du panneau d'un événement : la
 * MÊME liste — curseur compris —, seul `panel` change.
 */
export function lienPanneauJournal(courant: URLSearchParams, panel: string | null): string {
  const p = new URLSearchParams(courant);
  if (panel === null) p.delete("panel");
  else p.set("panel", panel);
  const qs = p.toString();
  return qs ? `/events?${qs}` : "/events";
}

/**
 * Clé d'attribut choisie depuis la facette « Attributs fréquents » : `attr_source`
 * et `attr_key` posés, SANS `attr_value` ni type autre que le défaut du formulaire.
 * Ce n'est pas un filtre (aucune valeur à comparer) : l'écran pré-remplit le
 * formulaire et propose les valeurs de la clé. Rend la clé, et l'URL à lire sans
 * elle ; `null` si l'URL n'est pas dans ce cas (filtre complet, ou rien).
 */
export function cleSansValeur(url: URLSearchParams): {
  cle: { source: string; key: string };
  sansCle: URLSearchParams;
} | null {
  const source = url.get("attr_source");
  const key = url.get("attr_key");
  const type = url.get("attr_type");
  if (!source || !key || url.has("attr_value")) return null;
  if (type !== null && type !== "" && type !== "string") return null;
  const sansCle = new URLSearchParams(url);
  for (const nom of ["attr_source", "attr_key", "attr_type"]) sansCle.delete(nom);
  return { cle: { source, key }, sansCle };
}
