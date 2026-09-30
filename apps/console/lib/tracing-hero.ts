// Hero de l'écran Tracing (§ 5.8, T6, F60) : « Appels API les plus lents, et la
// part médiane du serveur ». Construction PURE des lignes du classement, testée
// (tests/unit/tracing-hero.test.ts), sans lecture.
//
// UNE LONGUEUR, UNE SEULE MESURE (DF2). La barre vaut le p75 vu du navigateur, et
// rien d'autre. L'ancien hero la coupait en « serveur = back_p75 » et « réseau =
// front_p75 − back_p75 » : une différence de deux p75 n'est le p75 de rien (ils ne
// tombent pas sur le même appel, et le second ne porte que sur les appels suivis).
// Aucune ligne n'a donc de `segments`.
//
// LA PART SERVEUR EST UNE PROPORTION. Médiane, appel par appel, de durée serveur /
// durée navigateur (`apiCallsDecomposition`) : elle s'affiche sur sa propre échelle
// 0-100 % (`ShareBar`), à côté de la barre — jamais convertie en millisecondes,
// jamais empilée. Ainsi aucune longueur ne se lit « le serveur prend X ms ».
//
// COULEUR DE LA RÈGLE MIP (amendement de R-S, 29/09/2026). Aucun seuil n'est publié
// pour une durée d'API ; la barre d'un appel porte la note de `SEUILS_MIP.API`
// (`noteMip("API", p75)`), la forme précède la valeur, et l'écran écrit la règle en
// tête du classement (`REGLE_HERO`). La ligne « Ensemble » garde la couleur de la
// référence (gris) : c'est un repère, pas un appel. À NE PAS CONFONDRE avec
// `REGLE_SANTE_API` (`lib/map.ts`), la santé d'un nœud de la carte des services.
//
// Écrit sans JSX (`createElement`) : un module de `lib/`, importable d'un test sans
// transformation particulière.
import { createElement, Fragment, type ReactNode } from "react";
import Link from "next/link";
import type { RankDatum } from "@/components/charts/RankBar";
import { ShareBar } from "@/components/tracing/ShareBar";
import { formater } from "./fmt-ids";
import { SERIE } from "./palette";
import { noteAffichee, texteNote } from "./notes-mip";
import { texteRegleMip } from "./seuils";

/** La règle écrite en tête du classement, à côté des valeurs colorées. */
export const REGLE_HERO = texteRegleMip("API");
import type { ApiCallDecomposition } from "./queries-tracing";
import type { Appel } from "./tracing-ancres";

/** Au plus dix appels au classement (un top N, P14) : les dix premières lignes de « Tous les appels API ». */
export const APPELS_HERO = 10;

/** Ligne « Ensemble » : la population entière de la plage (T3, T4). */
export interface EnsembleHero {
  front_p75: number | null;
  back_p75: number | null;
  /** Appels suivis jusqu'au serveur. */
  correlated: number;
}

export interface OptionsHero {
  /** Lien du libellé : la ligne de « Tous les appels API » (`…#appel-<hash>`), paramètres courants gardés. */
  hrefAppel: (appel: Appel) => string;
  /** « Traces de cet appel » : « Traces les plus lentes » filtrées (`appel=`), ancre `#traces`. */
  hrefTraces: (appel: Appel) => string;
  /** Ligne « Ensemble » en tête ; absente si la couverture n'a pas pu être lue. */
  ensemble?: EnsembleHero | null;
  max?: number;
}

export interface LignesHero {
  lignes: RankDatum[];
  /** Appels du top sans durée p75 : exclus du classement, comptés dans la méta. */
  exclues: number;
}

const pluriel = (n: number, mot: string) => `${formater("count", n)} ${mot}${n > 1 ? "s" : ""}`;

/**
 * Fragment d'URL qui mène à l'élément `id` (une ligne `appel-<hash>`, déjà encodée
 * par `ancreAppel`). Next.js DÉCODE le fragment une fois avant `getElementById`
 * (routeur de l'app, `handle-mutable`) : écrit tel quel, « appel-GET%20%2Fapi »
 * devenait « appel-GET /api », introuvable, et la page remontait en haut au lieu
 * d'aller à la ligne. Encodé une seconde fois, Next retrouve l'identifiant exact ;
 * un navigateur sans JavaScript aussi (il essaie le fragment brut, puis décodé :
 * HTML, « find a potential indicated element »).
 */
export function fragmentVers(id: string): string {
  return `#${encodeURIComponent(id)}`;
}

/** Libellé d'un appel : « GET /api/panier » ; un span sans URL garde sa méthode seule. */
export function libelleAppel(a: Pick<ApiCallDecomposition, "method" | "url">): string {
  return a.url ? `${a.method} ${a.url}` : `${a.method} (sans URL)`;
}

/** Part serveur affichable (0-100, entier) ; `null` quand rien n'a été décomposé. */
export function partServeur(a: Pick<ApiCallDecomposition, "n_suivis" | "part_serveur_p50">): number | null {
  if (a.n_suivis <= 0 || a.part_serveur_p50 == null || !Number.isFinite(a.part_serveur_p50)) return null;
  return Math.round(Math.min(Math.max(a.part_serveur_p50, 0), 1) * 100);
}

/** Texte de la décomposition, tel que l'alternative et l'infobulle l'écrivent. */
export function texteDecomposition(a: Pick<ApiCallDecomposition, "n" | "n_suivis" | "part_serveur_p50">): string {
  const part = partServeur(a);
  if (part === null) return "non décomposé : aucun jumeau serveur";
  return `part serveur ${part}\u00a0% (médiane, ${suivisSur(a)})`;
}

/** « 120 appels suivis sur 150 », accordé (« 1 appel suivi sur 3 »). */
function suivisSur(a: Pick<ApiCallDecomposition, "n" | "n_suivis">): string {
  return `${pluriel(a.n_suivis, "appel")} suivi${a.n_suivis > 1 ? "s" : ""} sur ${formater("count", a.n)}`;
}

/** Une ligne de « Traces les plus lentes » : une trace, ou ce qui en est replié pour son appel. */
export type LigneTraceLente<T> = { kind: "trace"; trace: T } | { kind: "reste"; appel: Appel; n: number };

/**
 * « Traces les plus lentes » regroupées par appel (recette du 26/09/2026) : les
 * vingt lignes étaient toutes « GET /api/demo/items/42 ». Au plus `max` traces par
 * appel, dans l'ordre lu (durée décroissante) ; les suivantes sont comptées sur une
 * ligne qui mène à toutes les traces de l'appel. Filtré sur un appel (`appel=`),
 * l'écran passe `max = Infinity` : rien n'est replié.
 *
 * Le plafond est posé EN SQL (`slowTraces`) : chaque trace porte alors `traces_appel`,
 * le nombre de traces de son appel sur toute la plage, qui fait le compte du reste.
 * Sans lui (lignes d'un autre lecteur), le compte se fait sur les lignes reçues.
 */
export function tracesParAppel<T extends { method: string; url: string; traces_appel?: number }>(
  traces: readonly T[],
  max: number,
): LigneTraceLente<T>[] {
  const cle = (t: T) => `${t.method} ${t.url}`;
  const totaux = new Map<string, number>();
  for (const t of traces) totaux.set(cle(t), (totaux.get(cle(t)) ?? 0) + 1);
  for (const t of traces) if (t.traces_appel !== undefined) totaux.set(cle(t), Math.max(totaux.get(cle(t)) ?? 0, t.traces_appel));
  const vues = new Map<string, number>();
  const lignes: LigneTraceLente<T>[] = [];
  for (const t of traces) {
    const k = cle(t);
    const n = (vues.get(k) ?? 0) + 1;
    vues.set(k, n);
    if (n > max) continue;
    lignes.push({ kind: "trace", trace: t });
    const total = totaux.get(k) ?? 0;
    if (n === max && total > max) lignes.push({ kind: "reste", appel: { method: t.method, url: t.url }, n: total - max });
  }
  return lignes;
}

/**
 * Sous le libellé, trois lignes courtes (la colonne des libellés fait 7 rem à
 * 390 px) : l'effectif et le lien vers ses traces ; la part serveur sur son échelle
 * 0-100 % ; sa définition (médiane, sur combien d'appels suivis).
 */
function sousLigne(a: ApiCallDecomposition, hrefTraces: string): ReactNode {
  const part = partServeur(a);
  // Hors littéral : un attribut `data-*` n'est admis sans vérification qu'en JSX.
  const lien = { href: hrefTraces, className: "text-perf underline-offset-2 hover:underline", "data-testid": "traces-appel" };
  return createElement(
    Fragment,
    null,
    createElement("span", { className: "block truncate" }, `${pluriel(a.n, "appel")} · `, createElement(Link, lien, "Traces de cet appel")),
    part === null
      ? createElement("span", { className: "block truncate" }, "non décomposé : aucun jumeau serveur")
      : createElement(
          Fragment,
          null,
          createElement(ShareBar, { share: part }),
          createElement(
            "span",
            { className: "block truncate" },
            `médiane, ${suivisSur(a)}`,
          ),
        ),
  );
}

/**
 * Les lignes du hero, dans l'ordre de gravité de `apiCallsDecomposition` (les
 * appels d'au moins 30 occurrences d'abord, puis le p75 décroissant). Ce sont les
 * `max` premières lignes de la table « Tous les appels API » : un clic sur un libellé
 * mène à SA ligne, jamais cachée dans le `<details>`. Un appel sans p75 est exclu du
 * dessin (une barre nulle se lirait « le plus rapide ») et compté.
 */
export function lignesHero(appels: readonly ApiCallDecomposition[], options: OptionsHero): LignesHero {
  const top = appels.slice(0, options.max ?? APPELS_HERO);
  const mesures = top.filter((a) => a.front_p75 != null && Number.isFinite(a.front_p75));
  const lignes: RankDatum[] = [];

  const e = options.ensemble;
  if (e && e.front_p75 != null && mesures.length > 0) {
    lignes.push({
      label: "Ensemble",
      value: e.front_p75,
      display: formater("ms", e.front_p75),
      color: SERIE.reference,
      sub:
        e.correlated > 0
          ? `serveur : p75 ${formater("ms", e.back_p75)} sur ${pluriel(e.correlated, "appel")} suivi${e.correlated > 1 ? "s" : ""}`
          : "serveur : aucun appel suivi",
      title: "Tous les appels API de la plage",
    });
  }

  for (const a of mesures) {
    const appel: Appel = { method: a.method, url: a.url };
    const libelle = libelleAppel(a);
    const note = noteAffichee("API", a.front_p75);
    lignes.push({
      label: libelle,
      value: a.front_p75,
      display: texteNote(note, formater("ms", a.front_p75)),
      color: note?.jeton ?? SERIE.principale,
      href: options.hrefAppel(appel),
      sub: sousLigne(a, options.hrefTraces(appel)),
      title: `${libelle} — p75 ${formater("ms", a.front_p75)} vu du navigateur${note ? ` (${note.libelle}, ${note.regle})` : ""}, ${pluriel(a.n, "appel")} ; ${texteDecomposition(a)}`,
    });
  }
  return { lignes, exclues: top.length - mesures.length };
}
