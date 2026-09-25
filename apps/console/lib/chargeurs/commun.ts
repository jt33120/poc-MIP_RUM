// CE QUE PARTAGENT LES CHARGEURS D'ÉCRANS (C3 → C5).
//
// Un chargeur reçoit ce que reçoit la page — le principal, les paramètres d'URL,
// ceux du chemin — et rend ce que la page affiche, une SECTION par lecture. Il
// tourne à deux endroits : dans la console aujourd'hui (`lib/ecran-local.ts`), et
// dans console-api, qui l'embarque tel quel (`services/console-api/server.mjs`).
// Deux règles en découlent, et ce module les porte :
//
//   1. Sa sortie traverse JSON. `versLeFil` fait EN LOCAL exactement ce que fait
//      le service : la page lit donc dès aujourd'hui la forme qu'elle recevra
//      demain (`Fil<…>` : une date y est une chaîne, un `Set` n'y passe pas), et
//      le compilateur refuse l'écran qui l'oublierait ;
//   2. Une section en échec ne porte pas sa raison. `section()` est `lire()` —
//      l'échec journalisé côté serveur, le refus de filtre relancé —, mais la
//      raison reste au journal : sur le fil ne passe que `lecture_en_echec`.
import type { Fil, Section } from "@mip/console-contract";
import { couverturePrecedente, sourcesSousFiltres, type CouverturePrecedente, type SourceComparaison } from "../comparaison";
import { catalogueDe, lireChoix } from "../dashboard-blocs";
import type { AnalyticsQuery, SearchParamsRecord } from "../query-contract";
import { lire } from "../lecture";

/** Le principal d'un chargeur : celui de la session (console) ou relu en base (console-api). `null` : aucune session. */
export interface PrincipalEcran {
  readonly email: string;
  readonly role: "admin" | "viewer";
  /** `null` = toutes les applications ; `[]` = aucune. */
  readonly apps: string[] | null;
  readonly demo?: boolean;
}

/** Les paramètres d'URL de la page, `app` compris. */
export type ParametresEcran = SearchParamsRecord;

/** Les paramètres du chemin d'une page de détail (`/sessions/[id]` → `{ id }`). */
export type CheminEcran = Readonly<Record<string, string>>;

export type Chargeur<R> = (principal: PrincipalEcran | null, sp: ParametresEcran, chemin: CheminEcran) => Promise<R>;

/** Une lecture de section : `lire()`, sans la raison (journalisée, jamais transmise). */
export async function section<T>(fn: () => Promise<T>): Promise<Section<T>> {
  const l = await lire(fn);
  return l.ok ? { ok: true, data: l.data } : { ok: false, code: "lecture_en_echec" };
}

/** Une section qu'on ne lit pas (réglage absent, cas sans objet) : sa valeur par défaut, lue d'avance. */
export function sansSection<T>(data: T): Promise<Section<T>> {
  return Promise.resolve({ ok: true, data });
}

/** Une section déjà lue, réduite à une autre forme (même échec). */
export function mapSection<T, U>(s: Section<T>, f: (data: T) => U): Section<U> {
  return s.ok ? { ok: true, data: f(s.data) } : s;
}

/** Ce que JSON fait d'une valeur — ce que fait console-api en la servant. */
export function versLeFil<T>(valeur: T): Fil<T> {
  return JSON.parse(JSON.stringify(valeur)) as Fil<T>;
}

/** Les paramètres d'URL en chaînes seules (la première valeur d'un paramètre répété), comme `URLSearchParams`. */
export function urlDeLaPage(sp: ParametresEcran): URLSearchParams {
  return new URLSearchParams(
    Object.entries(sp).flatMap(([cle, valeur]) => (typeof valeur === "string" ? [[cle, valeur] as [string, string]] : [])),
  );
}

/**
 * LA COMPOSITION D'UN ÉCRAN (`/`, `/sessions`, `/slo`) : quels blocs sont
 * allumés. Elle vit dans un cookie de la console — qu'un chargeur ne lit pas :
 * la page la lui passe en PARAMÈTRE (`blocs`, même forme que le cookie), et un
 * bloc éteint ne lance pas sa lecture, ici comme avant. Une valeur de l'URL sous
 * ce nom est remplacée par celle du cookie (`lib/ecran-local.ts`).
 */
export const PARAM_BLOCS = "blocs";

/** Les blocs allumés d'un écran, d'après ses paramètres (défauts du catalogue si absents). */
export function blocsDe(sp: ParametresEcran, href: string): Record<string, boolean> {
  const cat = catalogueDe(href);
  if (!cat) throw new Error(`écran sans catalogue de blocs : ${href}`);
  const brut = sp[PARAM_BLOCS];
  return lireChoix(cat, typeof brut === "string" ? brut : undefined);
}

/**
 * La couverture de la période précédente d'une rangée de sources (§ 3.2) : la
 * première incomplète, sinon « complète ». Un delta contre une période à moitié
 * mesurée mesurerait la collecte, pas le site.
 */
export async function couvertureDesSources(
  query: AnalyticsQuery,
  sources: SourceComparaison | readonly SourceComparaison[],
): Promise<CouverturePrecedente> {
  const liste = Array.isArray(sources) ? sources : [sources as SourceComparaison];
  const couvertures = await Promise.all(
    liste.flatMap((s) => sourcesSousFiltres(query, s)).map((s) => couverturePrecedente(query, s)),
  );
  return couvertures.find((c) => c.etat !== "complete") ?? { etat: "complete", raison: null };
}
