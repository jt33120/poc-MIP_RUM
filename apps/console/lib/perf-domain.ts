// Règles de valeur du domaine performance (F10, plan § 4.4) — logique PURE, testée
// (tests/unit/perf-domain.test.ts). Les lectures sont dans lib/queries.ts et
// lib/queries-errors.ts ; ici, ce que l'écran a le droit d'en tirer.
//
// Un chiffre sans dénominateur est `null` avec sa raison (V3), jamais 0 : « 0 pour
// 100 vues » sur une période sans vue, ou « 0 % de sessions touchées » sur une base
// vide, se liraient comme une bonne nouvelle.
import { queryOf, type FiltersLike } from "./filters";
import { intersectQuery, type Dimension } from "./query-contract";

/** Une valeur, ou `null` avec la phrase qui le dit (la `raisonNull` d'une tuile). */
export type ValeurOuRaison = { valeur: number; raison: null } | { valeur: null; raison: string };

export const RAISON_BASE_VIDE = "aucune session avec vue";
export const RAISON_ECHANTILLONNAGE =
  "erreurs et vues échantillonnées différemment : part non calculable";
export const RAISON_AUCUNE_VUE = "aucune page vue : ratio non calculable";

/**
 * « Part des sessions touchées » (§ 5.3.2) à partir de `partSessionsTouchees`.
 *
 *   - base vide → `null` « aucune session avec vue sur <plage> » ;
 *   - `tauxMin < 1` (ou inconnu sur une base non vide) → `null` : CP15, une session
 *     tirée hors `sampleRate` n'entre dans la base QUE si elle porte une erreur (le
 *     SDK la promeut alors), et le rapport observé surestime la part réelle ;
 *   - sinon `touchees / base`, borné à [0, 1] : la lecture garantit déjà
 *     `touchees ≤ base` (jointure sur la base), la borne rend l'invariant visible.
 */
export function partTouchees(
  lu: { base: number; touchees: number; tauxMin: number | null },
  plage?: string,
): ValeurOuRaison {
  if (!(lu.base > 0)) {
    return { valeur: null, raison: plage ? `${RAISON_BASE_VIDE} sur ${plage}` : RAISON_BASE_VIDE };
  }
  if (lu.tauxMin === null || !Number.isFinite(lu.tauxMin) || lu.tauxMin < 1) {
    return { valeur: null, raison: RAISON_ECHANTILLONNAGE };
  }
  const part = lu.touchees / lu.base;
  return { valeur: Math.min(1, Math.max(0, Number.isFinite(part) ? part : 0)), raison: null };
}

/**
 * « Occurrences d'erreurs pour 100 pages vues » : `100 × occurrences / vues`. C'est
 * un RATIO de deux comptes, pas une part : il peut dépasser 100 (30 occurrences
 * pour 20 vues → 150) et s'affiche au format `pour100`, jamais en « % ». Sans vue,
 * aucun dénominateur : `null`.
 */
export function ratioPour100(occurrences: number | null, vues: number | null): number | null {
  if (occurrences == null || vues == null || !Number.isFinite(occurrences) || !(vues > 0)) return null;
  return (100 * occurrences) / vues;
}

/**
 * Le même ratio seau par seau, pour la sparkline de la tuile (§ 5.1.2) : deux
 * séries posées sur la MÊME grille (`errorSeries(f).points`, `pageviewSeries(f)`),
 * rapprochées par début de seau. Un seau sans vue est un trou (`null`), pas un 0 ;
 * un seau absent de l'une des deux séries aussi.
 */
export function serieRatioPour100(
  erreurs: { bucket: string; navigateur: number }[],
  vues: { bucket: string; chargements: number; spa: number; inconnu: number }[],
): { bucket: string; ratio: number | null }[] {
  const parSeau = new Map(erreurs.map((e) => [Date.parse(e.bucket), e.navigateur]));
  return vues.map((v) => {
    const total = v.chargements + v.spa + v.inconnu;
    const n = parSeau.get(Date.parse(v.bucket));
    return { bucket: v.bucket, ratio: n === undefined ? null : ratioPour100(n, total) };
  });
}

/**
 * Intersecte les filtres d'un écran avec une condition locale (`route=/checkout`,
 * `release=1.4.2`) : une série « sur cette route » (§ 5.2.3) ou « sur la release
 * B » (§ 3.2, `cmp=release`) lit la MÊME fenêtre et le MÊME périmètre, resserrés.
 * Même dimension = ET (`intersectQuery`), jamais un remplacement : un filtre global
 * `route=/a` intersecté avec `/b` donne une population vide, pas `/b`.
 */
export function avecCondition<F extends FiltersLike>(f: F, dimension: Dimension, valeur: string): F {
  return {
    ...f,
    query: intersectQuery(queryOf(f), { conditions: [{ dimension, operator: "eq", value: valeur }] }),
  };
}

// ─────────────────────────────── Erreurs (F18) ───────────────────────────────

/**
 * « Autres groupes (somme) » du hero de `/errors` (§ 5.3.2) : par seau, la tendance
 * de la population MOINS les groupes dessinés — jamais la somme des groupes
 * suivants de la liste, qui ne couvre pas la population. Borné à 0 : séries et
 * tendance viennent de deux lectures, une ingestion concurrente peut les faire
 * diverger, et un empilement ne dessine jamais une quantité négative. Un seau
 * absent d'une série compte 0 (des comptes).
 */
export function autresGroupes(trend: readonly number[], series: readonly (readonly number[])[]): number[] {
  return trend.map((total, i) => {
    const dessine = series.reduce((somme, s) => somme + (Number.isFinite(s[i]) ? s[i] : 0), 0);
    const reste = (Number.isFinite(total) ? total : 0) - dessine;
    return reste > 0 ? reste : 0;
  });
}

/** Longueur du message dans une légende du hero (§ 5.3.2). */
export const LEGENDE_MESSAGE_MAX = 40;

/**
 * Libellé de légende d'un groupe d'erreurs : le MESSAGE, tronqué à 40 caractères,
 * puis l'empreinte courte — jamais le seul type (« ● Error » ×5 ne distinguait
 * rien, `console-ecrans-1.md` L191). L'app s'ajoute quand l'écran en lit plusieurs :
 * une même empreinte peut exister dans deux apps.
 */
export function libelleGroupeErreur(g: { message: string | null; fingerprint: string; app_id?: string | null }): string {
  const brut = (g.message ?? "").replace(/\s+/g, " ").trim();
  const message =
    brut === "" ? "(sans message)" : brut.length > LEGENDE_MESSAGE_MAX ? `${brut.slice(0, LEGENDE_MESSAGE_MAX - 1)}…` : brut;
  return [message, g.fingerprint.slice(0, 8), g.app_id ?? null].filter(Boolean).join(" · ");
}

const PRECEDENTE_PAR_PRESET: Record<string, string> = {
  "1h": "vs heure précédente",
  "24h": "vs 24 h précédentes",
  "7d": "vs 7 j précédents",
};

/**
 * Référence écrite d'une tuile en `cmp=prev` (§ 3.12) : « vs 24 h précédentes
 * (20/09 14:00 → 21/09 14:00 UTC) ». La plage précédente est DATÉE : un delta
 * sans période nommée ne dit pas à quoi il se compare (P4).
 */
export function referencePeriodePrecedente(range: { from: string; to: string; preset: string | null }): string {
  const debut = Date.parse(range.from);
  const duree = Date.parse(range.to) - debut;
  const fmt = new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const tete = (range.preset && PRECEDENTE_PAR_PRESET[range.preset]) || "vs période précédente";
  return `${tete} (${fmt.format(new Date(debut - duree))} → ${fmt.format(new Date(debut))} UTC)`;
}

// ─────────────────────────────── Interactions (F22) ───────────────────────────────
import { classerParGravite } from "./impact";

/** État d'une surface de frustration, de forme compatible avec `Etat` (components/states). */
export type EtatCapteurFrustration =
  | { kind: "non_collecte"; manque: string }
  | { kind: "partiel"; raison: string };

export const MANQUE_CAPTEUR_MOBILE = "le SDK mobile n'émet pas de signaux de frustration";
export const RAISON_RUNTIME_ABSENT =
  "capteur non identifiable (colonne runtime absente) : un 0 peut venir d'un capteur qui n'émet pas";

/**
 * Garde de capteur des signaux de frustration (R-F, CP16), dans l'ordre :
 *   - colonne `runtime` absente → comptes affichés, `partiel` (on ne sait pas qui écoute) ;
 *   - sessions dans la base mais aucune dont le capteur émet → `non_collecte` : les
 *     comptes ne sont PAS affichés, un « 0 » dirait « personne ne s'acharne » ;
 *   - base mixte → `partiel` « compté sur les sessions navigateur seulement (N sur M) » ;
 *   - sinon rien : un 0 est un vide réel.
 * `masquer` : les comptes ne doivent pas être rendus.
 */
export function etatCapteurFrustration(capteur: {
  sessionsCouvertes: number;
  sessionsTotal: number;
  runtimeLu: boolean;
}): { etat: EtatCapteurFrustration | null; masquer: boolean } {
  if (!capteur.runtimeLu) return { etat: { kind: "partiel", raison: RAISON_RUNTIME_ABSENT }, masquer: false };
  if (capteur.sessionsTotal > 0 && capteur.sessionsCouvertes === 0) {
    return { etat: { kind: "non_collecte", manque: MANQUE_CAPTEUR_MOBILE }, masquer: true };
  }
  if (capteur.sessionsCouvertes > 0 && capteur.sessionsCouvertes < capteur.sessionsTotal) {
    const n = capteur.sessionsCouvertes.toLocaleString("fr-FR");
    const m = capteur.sessionsTotal.toLocaleString("fr-FR");
    return { etat: { kind: "partiel", raison: `compté sur les sessions navigateur seulement (${n} sur ${m})` }, masquer: false };
  }
  return { etat: null, masquer: false };
}

/** Une route du hero « Routes les plus frustrantes », avec son taux. */
export interface RouteFrustranteClassee {
  route: string | null;
  rage: number;
  dead: number;
  error: number;
  sessionsTouchees: number;
  sessionsRoute: number;
  /** Part des sessions de la route ayant au moins un signal ; `null` sans session de la route. */
  taux: number | null;
}

/**
 * Classe les routes par GRAVITÉ (§ 5.4.2) : le pilote est la part des sessions de la
 * route qui portent un signal — un taux, pas un compte, qui classerait par trafic.
 * Une route vue par moins de 30 sessions ne passe pas devant (échantillon faible,
 * `classerParGravite`) : 3 sessions sur 3 touchées se rangent APRÈS 40 sur 400. Une
 * route sans session de vue (signal seul) n'a pas de taux : « — », en dernier.
 */
export function classerRoutesFrustrantes(
  rows: readonly Omit<RouteFrustranteClassee, "taux">[],
  tri: "gravite" | "volume",
): { lignes: RouteFrustranteClassee[]; faibles: number } {
  const avecTaux = rows.map((r) => ({ ...r, taux: r.sessionsRoute > 0 ? Math.min(1, r.sessionsTouchees / r.sessionsRoute) : null }));
  return classerParGravite(avecTaux, {
    pilote: (r) => r.taux,
    effectif: (r) => r.sessionsRoute,
    tri,
    volume: (r) => r.sessionsRoute,
  });
}

/**
 * Taux de référence « Ensemble » du hero par route : Σ sessions touchées / Σ sessions
 * de la route, sur les MÊMES couples session × route que chaque ligne. Comparer une
 * route à « sessions touchées n'importe où / sessions avec une vue » opposerait deux
 * populations : une session qui voit /panier et /, et ne se trompe que sur /, ferait
 * paraître /panier meilleure que l'ensemble sans rien lui devoir. `null` sans couple.
 */
export function tauxEnsembleRoutes(rows: readonly { sessionsTouchees: number; sessionsRoute: number }[]): {
  taux: number | null;
  touchees: number;
  couples: number;
} {
  const touchees = rows.reduce((s, r) => s + r.sessionsTouchees, 0);
  const couples = rows.reduce((s, r) => s + r.sessionsRoute, 0);
  return { taux: couples > 0 ? Math.min(1, touchees / couples) : null, touchees, couples };
}

/** Écart d'une route au taux de l'ensemble, en points : « +25 pts vs ensemble » ; `null` sans l'un des deux taux. */
export function ecartAuTauxEnsemble(taux: number | null, ensemble: number | null): { valeur: number; affichage: string } | null {
  if (taux === null || ensemble === null) return null;
  const pts = Math.round((taux - ensemble) * 1000) / 10;
  const texte = Math.abs(pts).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return { valeur: taux - ensemble, affichage: `${pts > 0 ? "+" : pts < 0 ? "−" : ""}${texte} pt${Math.abs(pts) > 1 ? "s" : ""} vs ensemble` };
}

// ═══════════════════ F14 — Pages : KPI, sélecteur de vital, hero classé ═══════════════════
//
// Le classement des routes de `/pages` (§ 5.2.2) fusionne les trois listes d'avant
// (hero à huit barres, découpage « Web Vitals par dimension », table « Par route ») :
// UNE liste, celle des groupes de `vitalsBreakdown(f, "route", 200)`, classée par le
// p75 du vital choisi. Vues et tâches longues viennent d'une autre lecture
// (`slowRoutes`) et s'y joignent par route, côté serveur.
import type { Ecart, IntervalleP75 } from "./stats/incertitude";
import type { RouteRow, SlowResource } from "./queries";
import type { VitalsBreakdownRow } from "./queries-breakdowns";
import { ecartALaReference, estFaible, SEUIL_ECHANTILLON_FAIBLE } from "./impact";
import { formatDuVital, formater, type VitalName } from "./fmt-ids";
import { PRESET_LABELS, previousRange, type ResolvedRange } from "./query-contract";
import { THRESHOLDS } from "./rating";

/** Vitals que le découpage par route sait classer : ni FCP ni TTFB (CP2, backend B11). */
export const VITAUX_CLASSES_PAR_ROUTE = ["LCP", "INP", "CLS"] as const;
export type VitalClasseParRoute = (typeof VITAUX_CLASSES_PAR_ROUTE)[number];

/**
 * Le vital choisi peut-il classer les routes ? `vitalsBreakdown` ne lit que LCP, INP
 * et CLS (`where m.name in ('LCP','INP','CLS')`) : sous `vital=FCP` ou `vital=TTFB`,
 * le classement est désactivé AVEC sa raison — jamais rempli des « — » d'une colonne
 * qui n'a pas été lue, ni retrié en silence sur le LCP.
 */
export function classementParRoute(
  vital: VitalName,
): { disponible: true; vital: VitalClasseParRoute } | { disponible: false; raison: string } {
  return (VITAUX_CLASSES_PAR_ROUTE as readonly string[]).includes(vital)
    ? { disponible: true, vital: vital as VitalClasseParRoute }
    : { disponible: false, raison: `classement ${vital} non disponible : le découpage ne lit que LCP, INP, CLS` };
}

/** Une ligne du hero de `/pages` : le groupe du découpage, et ce que les autres lectures en disent. */
export type RoutePages = VitalsBreakdownRow & {
  /** Pages vues de la route (`slowRoutes`) ; `null` : route absente de cette lecture, ou lecture en échec. */
  vues: number | null;
  /** Tâches longues de la route (`slowRoutes`) ; `null` : idem. */
  tachesLongues: number | null;
  /**
   * Ressources bloquant le rendu parmi les trois plus lentes de la route
   * (`slowResourcesByRoute`) ; 0 si aucune n'est collectée ; `null` : lecture en
   * échec, ou groupe « Inconnu » (sans route, donc sans ressource rattachée).
   */
  bloquantes: number | null;
};

/**
 * Jointure `vitalsBreakdown(f, "route", 200)` × `slowRoutes(f)` (+ ressources lentes),
 * par route, côté serveur (§ 5.2.2). JOINTURE À GAUCHE : la population du classement
 * est celle du découpage (les 200 groupes les plus mesurés, CP1) ; une route que
 * l'autre lecture ne rend pas (elle garde les 200 routes au LCP le plus lent) reçoit
 * `null` — « — » à l'écran —, jamais 0 : ne pas l'avoir lue n'est pas n'en avoir
 * aucune. L'ordre reçu est gardé : le classement vient après (`classerParGravite`).
 *
 * @param routes `null` : lecture en échec (vues et tâches longues inconnues)
 * @param ressources `null` : lecture en échec (ressources bloquantes inconnues)
 */
export function joindreRoutesPages(
  decoupe: readonly VitalsBreakdownRow[],
  routes: readonly RouteRow[] | null,
  ressources: ReadonlyMap<string, readonly SlowResource[]> | null,
): RoutePages[] {
  const parRoute = new Map((routes ?? []).map((r) => [r.route, r]));
  return decoupe.map((g) => {
    const lue = g.valeur === null || routes === null ? undefined : parRoute.get(g.valeur);
    const liste = g.valeur === null || ressources === null ? null : (ressources.get(g.valeur) ?? []);
    return {
      ...g,
      vues: lue ? Number(lue.views) : null,
      tachesLongues: lue ? Number(lue.longtasks) : null,
      bloquantes: liste === null ? null : liste.filter((r) => r.render_blocking === true).length,
    };
  });
}

/** p75 et effectif d'un vital classable sur une ligne du découpage. */
export function p75DeLaRoute(ligne: VitalsBreakdownRow, vital: VitalClasseParRoute): { p75: number | null; n: number } {
  if (vital === "LCP") return { p75: ligne.lcp_p75, n: ligne.lcp_n };
  if (vital === "INP") return { p75: ligne.inp_p75, n: ligne.inp_n };
  return { p75: ligne.cls_p75, n: ligne.cls_n };
}

function plurielPages(n: number, un: string, plusieurs: string): string {
  return `${n.toLocaleString("fr-FR")} ${n > 1 ? plusieurs : un}`;
}

/**
 * Tuile « Routes au-delà de « Bon » » (§ 5.2.2) : routes dont le p75 du vital dépasse
 * la borne basse de `THRESHOLDS`, comptées SUR LES ROUTES NON FAIBLES (au moins 30
 * mesures, P3) — un p75 sur 12 mesures ne fait pas une route « lente ». Le groupe
 * « Inconnu » (mesures sans route) n'est pas une route : il n'entre dans aucun compte.
 *
 * Le dénominateur s'écrit dans la tuile (`lecture`) : « sur 14 routes classées, 3 à
 * faible effectif ». Aucune route classée → `null` avec sa raison, jamais « 0 » (un
 * zéro dirait que toutes les routes vont bien).
 */
export function tuileRoutesAuDelaDeBon(
  lignes: readonly VitalsBreakdownRow[],
  vital: VitalClasseParRoute,
  seuilFaible: number = SEUIL_ECHANTILLON_FAIBLE,
): { valeur: number | null; raison: string | null; classees: number; faibles: number; sansMesure: number; lecture: string } {
  const borne = THRESHOLDS[vital][0];
  let classees = 0;
  let auDela = 0;
  let faibles = 0;
  let sansMesure = 0;
  for (const l of lignes) {
    if (l.valeur === null) continue;
    const { p75, n } = p75DeLaRoute(l, vital);
    if (!(n > 0)) sansMesure++;
    else if (estFaible(n, seuilFaible)) faibles++;
    else {
      classees++;
      if (p75 != null && Number.isFinite(p75) && p75 > borne) auDela++;
    }
  }
  const lecture = [
    `p75 ${vital} au-delà de ${formater(formatDuVital(vital), borne)}`,
    `sur ${plurielPages(classees, "route classée", "routes classées")}, ${faibles.toLocaleString("fr-FR")} à faible effectif`,
    ...(sansMesure > 0 ? [`${sansMesure.toLocaleString("fr-FR")} sans mesure ${vital}`] : []),
  ].join(", ");
  if (classees === 0) {
    const raison = faibles === 0 ? "aucune route mesurée" : `aucune route avec au moins ${seuilFaible} mesures ${vital}`;
    return { valeur: null, raison, classees, faibles, sansMesure, lecture };
  }
  return { valeur: auDela, raison: null, classees, faibles, sansMesure, lecture };
}

/**
 * Écart d'une route au p75 de l'ensemble, écrit : « +1,2 s vs ensemble », « −40 ms vs
 * ensemble », « ±0 ms vs ensemble ». Un ÉCART de p75 (V5), jamais une contribution.
 */
export function ecartAEnsemblePages(
  valeur: number | null,
  ensemble: number | null,
  vital: VitalClasseParRoute,
): { valeur: number | null; affichage: string } {
  const ecart = ecartALaReference(valeur, ensemble);
  if (ecart === null) return { valeur: null, affichage: "écart non calculable" };
  const signe = ecart > 0 ? "+" : ecart < 0 ? "−" : "±";
  return { valeur: ecart, affichage: `${signe}${formater(formatDuVital(vital), Math.abs(ecart))} vs ensemble` };
}

const FORMAT_REFERENCE_PAGES = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** La période précédente nommée, accordée : « 1 h précédente », « 24 h précédentes », « 7 j précédents ». */
const PERIODE_PRECEDENTE_PAGES: Record<string, string> = {
  "1h": `${PRESET_LABELS["1h"]} précédente`,
  "24h": `${PRESET_LABELS["24h"]} précédentes`,
  "7d": `${PRESET_LABELS["7d"]} précédents`,
};

/**
 * Référence d'une tuile en `cmp=prev` (§ 3.12), en toutes lettres et datée en UTC :
 * « vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC) ». Une plage personnalisée
 * dit « période précédente » avec ses bornes.
 */
export function referencePrecedentePages(range: ResolvedRange): string {
  const p = previousRange(range);
  const nom = (range.preset && PERIODE_PRECEDENTE_PAGES[range.preset]) || "période précédente";
  return `vs ${nom} (${FORMAT_REFERENCE_PAGES.format(new Date(p.from))} → ${FORMAT_REFERENCE_PAGES.format(new Date(p.to))} UTC)`;
}

/**
 * L'écart de p75 entre deux RELEASES (`cmp=release`) est-il établi (P*.1) ? Même règle
 * que `ecartP75` (intervalles à 95 % comparés : chevauchement → non établi), mais
 * libellée par la release de référence — `ecartP75` parle de « période précédente »,
 * ce qui serait faux ici.
 */
export function ecartP75EntreReleases(
  candidate: IntervalleP75 | undefined,
  reference: IntervalleP75 | undefined,
  relA: string,
  fmt: (v: number) => string = String,
): Ecart | null {
  if (!candidate || !reference) return null;
  if ("indisponible" in candidate || "indisponible" in reference) {
    return { etabli: false, regle: "écart non établi : intervalle non calculable sur l'une des deux releases" };
  }
  const autre = `release ${relA} entre ${fmt(reference.bas)} et ${fmt(reference.haut)}`;
  return candidate.bas <= reference.haut && reference.bas <= candidate.haut
    ? { etabli: false, regle: `écart non établi : intervalles à 95 % qui se chevauchent (${autre})` }
    : { etabli: true, regle: `intervalles à 95 % disjoints (${autre})` };
}

// ═══════════════════ F15 — Pages : distributions, percentiles, TTFB, navigation ═══════════════════
import { VITAL_CAP } from "./distribution";

/**
 * Les trois distributions de `/pages` (§ 5.2.2) : LCP, INP, CLS ; sous `vital=FCP` ou
 * `vital=TTFB`, la troisième laisse sa place au vital choisi (ses plafonds existent,
 * `VITAL_CAP`) — le vital qui pilote l'écran a toujours sa forme sous les yeux.
 */
export function distributionsAffichees(vital: VitalName): [VitalName, VitalName, VitalName] {
  return vital === "FCP" || vital === "TTFB" ? ["LCP", "INP", vital] : ["LCP", "INP", "CLS"];
}

/**
 * Plafond d'affichage d'une distribution (§ 5.2.2). `VITAL_CAP` par défaut ; quand
 * la population est concentrée TRÈS en dessous (`p95 < VITAL_CAP / 10`), le p99
 * arrondi au multiple supérieur de 100 ms (0,05 pour le CLS) : sans quoi toute la
 * démo (LCP p75 44 ms) tombe dans le premier des vingt bacs et la forme disparaît.
 * Le plafond retenu est DIT (`libelle`) sous l'axe et dans l'alternative ; les
 * valeurs au-delà rejoignent la barre « ≥ plafond », jamais écartées.
 */
export function plafondAffichage(
  vital: VitalName,
  p: { p95: number | null; p99: number | null } | null,
): { plafond: number; libelle: string | null } {
  const defaut = VITAL_CAP[vital];
  if (!p || p.p95 == null || p.p99 == null || !Number.isFinite(p.p95) || !Number.isFinite(p.p99) || !(p.p95 < defaut / 10)) {
    return { plafond: defaut, libelle: null };
  }
  const pas = vital === "CLS" ? 0.05 : 100;
  // Arrondi au millième : 0,05 × 3 ne doit pas s'écrire 0,15000000000000002.
  const arrondi = Math.max(pas, Math.round(Math.ceil(p.p99 / pas - 1e-9) * pas * 1000) / 1000);
  if (arrondi >= defaut) return { plafond: defaut, libelle: null };
  return { plafond: arrondi, libelle: `plafond d'affichage : p99 arrondi (${formater(formatDuVital(vital), arrondi)})` };
}

/** Les phases réseau qui précèdent le premier octet, dans l'ordre chronologique. */
export const PHASES_TTFB = [
  { cle: "REDIRECT", libelle: "Redirection" },
  { cle: "DNS", libelle: "DNS" },
  { cle: "TCP", libelle: "Connexion TCP" },
  { cle: "TLS", libelle: "TLS" },
  { cle: "REQUEST", libelle: "Requête" },
  { cle: "RESPONSE", libelle: "Réponse" },
] as const;

export interface PhaseTtfb {
  cle: (typeof PHASES_TTFB)[number]["cle"];
  libelle: string;
  /** p75 de la phase mesurée à part ; `null` : aucune mesure (navigateur qui ne l'expose pas). */
  p75: number | null;
  n: number;
}

/**
 * « D'où vient le TTFB » (§ 5.2.2) : les six phases, lues dans `vitalsP75` (son
 * `group by m.name` rend aussi les phases, qui voyagent sur `rum_metric`). Toujours
 * six lignes, dans l'ordre : une phase absente est une ligne « — » avec n = 0, pas
 * une ligne retirée — son absence est une information (navigateur qui ne l'expose
 * pas). Les Web Vitals et tout autre nom sont écartés.
 *
 * Les six p75 NE S'ADDITIONNENT PAS : chacun est le 75ᵉ centile d'une phase mesurée
 * à part, et la somme de six p75 n'est pas le p75 du TTFB. Aucun total n'est rendu.
 */
export function phasesTtfb(lignes: readonly { name: string; p75: number | null; n: number }[]): PhaseTtfb[] {
  const parNom = new Map(lignes.map((l) => [l.name, l]));
  return PHASES_TTFB.map(({ cle, libelle }) => {
    const l = parNom.get(cle);
    const n = l && Number.isFinite(Number(l.n)) ? Number(l.n) : 0;
    const p75 = l && n > 0 && l.p75 != null && Number.isFinite(Number(l.p75)) ? Number(l.p75) : null;
    return { cle, libelle, p75, n };
  });
}

/**
 * Effectif sous lequel l'écart d'un p75 de phase n'est pas affiché : celui des tuiles
 * Web Vitals du même écran (§ 3.12, `faibleSous` 100 pour un vital ; `KpiTile`).
 */
export const FAIBLE_SOUS_PHASE_TTFB = 100;
export const TEXTE_ECART_PHASE_FAIBLE = "écart non affiché : échantillon faible sur l'une des deux périodes";
export const TEXTE_ECART_PHASE_SANS_MESURE = "aucune mesure de cette phase sur la période précédente";

/**
 * Écart du p75 d'une phase du TTFB à la période précédente (`cmp=prev`), avec la MÊME
 * garde que les tuiles de l'écran : un écart sur 3 mesures ne s'écrit pas comme sur
 * 3 000. Dans l'ordre :
 *   - pas de période précédente (autre mode, ou période incomplète) ou pas de valeur
 *     courante → `null` : rien à écrire ;
 *   - phase non mesurée sur la période précédente → silence, dit ;
 *   - effectif sous `faibleSous` sur l'UNE des deux périodes → silence « échantillon
 *     faible », jamais un chiffre ;
 *   - sinon l'écart signé (un écart de percentiles en ms, pas un pourcentage).
 */
export function ecartPhaseTtfb(
  courante: Pick<PhaseTtfb, "p75" | "n">,
  precedente: Pick<PhaseTtfb, "p75" | "n"> | null | undefined,
  faibleSous: number = FAIBLE_SOUS_PHASE_TTFB,
): { kind: "ecart"; valeur: number; affichage: string } | { kind: "silence"; texte: string } | null {
  if (!precedente || courante.p75 == null || !Number.isFinite(courante.p75)) return null;
  if (precedente.p75 == null || !Number.isFinite(precedente.p75)) return { kind: "silence", texte: TEXTE_ECART_PHASE_SANS_MESURE };
  if (!(courante.n >= faibleSous) || !(precedente.n >= faibleSous)) return { kind: "silence", texte: TEXTE_ECART_PHASE_FAIBLE };
  const d = courante.p75 - precedente.p75;
  return { kind: "ecart", valeur: d, affichage: `${d > 0 ? "+" : d < 0 ? "−" : "±"}${formater("ms", Math.abs(d))}` };
}
