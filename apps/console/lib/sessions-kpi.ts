// Rangée de KPI, volume et répartition de `/sessions` (F41, plan § 5.11) — logique
// PURE, testée (tests/unit/sessions-kpi.test.ts), sans accès base.
//
// CE QUE CES FONCTIONS REFUSENT D'AFFIRMER :
//   - « 0 visiteur » quand des sessions ont commencé sans identifiant aléatoire :
//     le nombre de visiteurs est alors INCONNU, pas nul (V3) ;
//   - un taux d'occurrences sans session au dénominateur (« — », jamais « 0 ») ;
//   - un delta contre une période précédente dont UNE des sources est incomplète :
//     la première raison rencontrée gagne, elle s'écrit sous la tuile ;
//   - une série de référence alignée par INSTANT : la période précédente se pose
//     rang de seau contre rang de seau, sur la grille courante (§ 3.2).
import {
  PRESET_LABELS,
  hrefWithQuery,
  intersectQuery,
  type AnalyticsQuery,
  type Dimension,
  type ResolvedRange,
} from "./query-contract";
import { BREAKDOWN_DIMENSIONS, breakdownDrillHref, groupLabel, type BreakdownDimension } from "./breakdowns";
import type { CouverturePrecedente, SourceComparaison } from "./comparaison";
import { dimensionSupport, type DimensionSchema } from "./query-compiler";
import { formater } from "./fmt-ids";
import { fmtPlage } from "./format";
import type { ErreursParSessionCommencee } from "./queries-sessions";

// ─────────────────────────────── Comparaison ─────────────────────────────────

const DUREES_PRESET: Record<NonNullable<ResolvedRange["preset"]>, string> = {
  "1h": "1 h précédente",
  "24h": `${PRESET_LABELS["24h"]} précédentes`,
  "7d": "7 jours précédents",
};

/**
 * Référence d'un delta `cmp=prev`, écrite en toutes lettres à côté du chiffre
 * (§ 3.12, P4) : « vs 24 h précédentes (20/09 14:00 → 21/09 14:00) », heure de
 * Paris. La plage datée est celle de la période PRÉCÉDENTE, pas la fenêtre lue.
 */
export function referencePrecedente(precedente: ResolvedRange): string {
  const duree = precedente.preset ? DUREES_PRESET[precedente.preset] : "période précédente";
  return `vs ${duree} (${fmtPlage(precedente.from, precedente.to)})`;
}

/**
 * Source de comparaison de la tuile « Visiteurs distincts » : elle compte
 * `visitor_id`, collecté depuis v57 (09/09/2026) seulement. `colonneRequise` fait
 * lire à la couverture le premier `started_at` d'une session IDENTIFIÉE : sans elle,
 * le premier `started_at` de toute session déclarait complète une période précédente
 * à peine identifiée — plage 12/09 → 22/09, précédente 02/09 → 12/09 avec trois
 * jours d'identifiants : « +230 % » sur une audience stable (revue F41).
 */
export const SOURCE_VISITEURS: SourceComparaison = {
  table: "rum_session",
  colonneTemps: "started_at",
  colonneRequise: "visitor_id",
  additive: true,
};

/**
 * Couverture d'une tuile qui lit plusieurs sources (le taux d'occurrences lit les
 * sessions ET les erreurs ; un filtre sur une colonne récente en ajoute une) : la
 * PREMIÈRE source incomplète décide, avec sa raison ; sinon complète. `n` porte
 * l'effectif de la période précédente, pour la règle d'échantillon faible.
 */
export function couvertureCombinee(couvertures: readonly CouverturePrecedente[], n: number | null): CouverturePrecedente {
  const incomplete = couvertures.find((c) => c.etat !== "complete");
  if (incomplete) return { ...incomplete, n };
  return { etat: "complete", raison: null, n };
}

// ─────────────────────────────── Tuiles ──────────────────────────────────────

/** Une valeur de tuile : un nombre, ou `null` et sa raison (V3). */
export interface ValeurTuile {
  valeur: number | null;
  raisonNull?: string;
}

/**
 * Visiteurs distincts (identifiant aléatoire) à afficher.
 *
 * Aucune session commencée : 0 est un VRAI zéro. Des sessions commencées mais aucune
 * portant un identifiant aléatoire : on ne sait pas combien de visiteurs elles
 * représentent — « — », jamais « 0 visiteur » à côté de « 12 sessions ».
 */
export function visiteursAffiches(visiteurs: number | null, sessionsCommencees: number | null): ValeurTuile {
  if (visiteurs == null) return { valeur: null, raisonNull: "aucune session identifiée" };
  if (visiteurs === 0 && sessionsCommencees != null && sessionsCommencees > 0) {
    return { valeur: null, raisonNull: "aucune session identifiée : aucune ne porte d'identifiant aléatoire" };
  }
  return { valeur: visiteurs };
}

/** Occurrences d'erreur par session commencée (B39) : `null` sans session au dénominateur. */
export function occurrencesParSession(e: Pick<ErreursParSessionCommencee, "sessions" | "occurrences"> | null): ValeurTuile {
  if (!e || !(e.sessions > 0)) return { valeur: null, raisonNull: "aucune session commencée : taux non calculable" };
  return { valeur: e.occurrences / e.sessions };
}

/**
 * Sous-texte de la tuile B39 : ce qui est exclu (erreurs sans session) et ce qui
 * peut encore bouger (sessions encore actives, dont les erreurs arrivent encore).
 */
export function lectureOccurrences(e: Pick<ErreursParSessionCommencee, "sansSession"> | null, encoreActives: number | null): string | undefined {
  const morceaux: string[] = [];
  if (e && e.sansSession > 0) {
    morceaux.push(
      `${formater("count", e.sansSession)} occurrence${e.sansSession > 1 ? "s" : ""} sans session rattachée, exclue${e.sansSession > 1 ? "s" : ""}`,
    );
  }
  if (encoreActives != null && encoreActives > 0) {
    morceaux.push(
      `peut encore augmenter : ${formater("count", encoreActives)} session${encoreActives > 1 ? "s" : ""} encore active${encoreActives > 1 ? "s" : ""}`,
    );
  }
  return morceaux.length ? `${morceaux.join(" ; ")}.` : undefined;
}

// ─────────────────────────────── Volume ──────────────────────────────────────

/**
 * Série de la période précédente posée sur la grille courante PAR RANG de seau
 * (§ 3.2) : le 1er seau précédent en face du 1er seau courant. Un seau précédent
 * absent reste `null` (rien n'est inventé) ; un seau de trop est ignoré.
 */
export function parRang(grille: readonly string[], precedent: readonly (number | null)[]): (number | null)[] {
  return grille.map((_, i) => (i < precedent.length ? precedent[i] : null));
}

// ─────────────────────────────── Répartition ─────────────────────────────────

/** Onglets de « Qui sont ces sessions », dans l'ordre du plan (§ 5.11.4). */
export const DIMENSIONS_REPARTITION = ["device", "browser", "os", "country", "source"] as const;
export type DimensionRepartition = (typeof DIMENSIONS_REPARTITION)[number];

export const LIBELLES_REPARTITION: Record<DimensionRepartition, string> = {
  device: "Appareil",
  browser: "Navigateur",
  os: "Système",
  country: "Pays estimé",
  source: "Capteur",
};

/** Libellé d'une valeur du capteur (`collection_source`) ; les autres dimensions gardent leur valeur. */
const LIBELLES_CAPTEUR: Record<string, string> = { sdk: "SDK", extension: "Extension navigateur" };

export function libelleGroupe(dimension: DimensionRepartition, valeur: string | null): string {
  if (valeur !== null && dimension === "source") return LIBELLES_CAPTEUR[valeur] ?? valeur;
  return groupLabel(valeur);
}

function estBreakdown(dimension: DimensionRepartition): dimension is DimensionRepartition & BreakdownDimension {
  return (BREAKDOWN_DIMENSIONS as readonly string[]).includes(dimension);
}

/** L'onglet demandé (`split`), s'il est disponible ; sinon le premier disponible (Appareil d'abord). */
export function lireRepartition(
  brut: string | null,
  disponibles: readonly DimensionRepartition[],
): DimensionRepartition | null {
  const demande = DIMENSIONS_REPARTITION.find((d) => d === brut);
  if (demande && disponibles.includes(demande)) return demande;
  return disponibles[0] ?? null;
}

/** Une dimension se groupe-t-elle sur les sessions de cette base (colonne présente) ? */
export function disponibiliteRepartition(
  dimension: DimensionRepartition,
  schema: DimensionSchema,
): { available: boolean; reason: string | null } {
  const support = dimensionSupport("sessions", dimension as Dimension, schema);
  return support.supported ? { available: true, reason: null } : { available: false, reason: support.message };
}

/**
 * Lien d'un groupe : l'écran filtré sur lui, même plage, filtres conservés (ET).
 * « Inconnu » devient `seg=v2:<dim>:is_null`, jamais une chaîne qui pourrait être
 * une valeur déclarée ; le capteur passe par `seg` (il n'a pas de paramètre dédié).
 */
export function hrefGroupe(
  query: AnalyticsQuery,
  dimension: DimensionRepartition,
  valeur: string | null,
  schema: DimensionSchema,
): string {
  if (estBreakdown(dimension)) return breakdownDrillHref("/sessions", query, dimension, valeur, schema);
  return hrefWithQuery(
    "/sessions",
    intersectQuery(query, {
      conditions: [valeur === null ? { dimension, operator: "is_null", value: null } : { dimension, operator: "eq", value: valeur }],
    }),
  );
}

/** Part d'un groupe dans le tout, écrite (« 42,0 % ») ; sans tout, « — ». */
export function partDuTout(sessions: number, total: number): string {
  return formater("pct", total > 0 ? sessions / total : null);
}

// ─────────────────────── Provenance du pays (collecte directe) ───────────────────────
//
// « L'ÉCRAN DOIT LE DIRE. » Une application dont le code de suivi passe par la
// console n'a JAMAIS de pays tiré de l'adresse IP : le relais ne la transmet pas
// (ADR 0005). Seule la collecte directe au collecteur en donne — et une
// application dont la CSP fige `connect-src` sur la console reste en relais.
// Sans cette ligne, l'onglet « Pays estimé » d'une telle application se lirait
// comme une géolocalisation manquée, ou pire, comme une géolocalisation.

/** Sessions commencées selon d'où vient leur pays. */
export interface PartsProvenancePays {
  total: number;
  /** Base IP→pays du collecteur, sur l'adresse d'une requête reçue en direct. */
  adresseIp: number;
  /** Fuseau horaire du terminal, ou pays transmis par le relais de la console. */
  estime: number;
  /** Pas de pays, ou un pays écrit avant que sa provenance ne soit collectée. */
  inconnu: number;
}

/**
 * Les trois parts, depuis la répartition par provenance (`country_source`).
 * « Inconnu » est le RESTE du tout, pas le seul groupe sans valeur : un groupe
 * hors registre ou une troncature ne gonfle jamais une part connue.
 */
export function partsProvenancePays(
  groupes: readonly { valeur: string | null; sessions: number }[],
  total: number,
): PartsProvenancePays {
  let adresseIp = 0;
  let estime = 0;
  for (const g of groupes) {
    if (g.valeur === "geoip") adresseIp += g.sessions;
    else if (g.valeur === "timezone" || g.valeur === "cdn") estime += g.sessions;
  }
  return { total, adresseIp, estime, inconnu: Math.max(0, total - adresseIp - estime) };
}

/** La phrase affichée sous l'onglet « Pays estimé » ; `null` sans session commencée. */
export function phraseProvenancePays(p: PartsProvenancePays): string | null {
  if (p.total <= 0) return null;
  const parts =
    `Pays tiré de l'adresse IP : ${partDuTout(p.adresseIp, p.total)} des sessions ; ` +
    `estimé (fuseau horaire du terminal, ou pays transmis par la console) : ${partDuTout(p.estime, p.total)} ; ` +
    `inconnu : ${partDuTout(p.inconnu, p.total)}.`;
  if (p.adresseIp > 0) {
    return `${parts} Seules les mesures envoyées directement au collecteur donnent un pays par l'adresse IP.`;
  }
  return (
    `${parts} Aucune de ces sessions n'a de pays tiré de l'adresse IP : leurs mesures passent par la console, ` +
    `qui ne transmet pas l'adresse. La collecte directe au collecteur le permet, sauf pour un site dont la ` +
    `politique de sécurité (CSP) n'autorise que la console.`
  );
}

/**
 * Ce que la troncature laisse hors de l'écran, en sessions : un COMPTE s'additionne,
 * donc le reste est exact (total − groupes affichés). Rien à dire sans troncature.
 */
export function resteNonAffiche(total: number, groupes: readonly { sessions: number }[], tronque: boolean): number | null {
  if (!tronque) return null;
  const affiche = groupes.reduce((s, g) => s + g.sessions, 0);
  return Math.max(0, total - affiche);
}

/**
 * Visiteurs distincts d'UN seau du panneau « Volume » — même règle que la tuile
 * (`visiteursAffiches`) : aucune session → 0, un vrai zéro ; des sessions TOUTES sans
 * identifiant aléatoire → `null` (trou : le nombre de visiteurs est inconnu, pas nul) ;
 * sinon, le compte des visiteurs identifiés. Seau absent de la lecture (qui rend
 * toute la grille, zéros compris) : aucune session commencée, donc 0 — comme les
 * barres des sessions, où un seau absent vaut 0.
 */
export function visiteursDuSeau(
  seau: { visitors: number; sessions: number; sans_identifiant: number } | null | undefined,
): number | null {
  if (!seau) return 0;
  if (seau.sessions > 0 && seau.sans_identifiant >= seau.sessions) return null;
  return seau.visitors;
}
