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
