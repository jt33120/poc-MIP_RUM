// Lecture du modèle de capacités mobiles (P7.5) — logique PURE, testée, sans base.
//
// CE QUE CE MODULE EXISTE POUR EMPÊCHER. Une console qui ne reçoit aucun crash
// natif ne peut pas distinguer « cette application ne plante pas » de « rien ne
// mesure ses plantages ». Les deux rendent zéro ligne. Afficher « 0 crash » ou
// « 100 % sans crash » sur le second est un mensonge par omission, et c'est
// exactement ce que P7 laisse ouvert : aucun module natif n'existe avant P8.5.
//
// D'où trois états, et trois seulement :
//   `active`      une release DÉCLARE collecter — le chiffre a un sens ;
//   `unavailable` une release déclare NE PAS collecter — « Non collecté » ;
//   `unknown`     personne n'a rien déclaré — « Inconnu », jamais 0.
//
// ET UNE QUATRIÈME INFORMATION, ORTHOGONALE : `verified_at`. Une capacité
// déclarée active dit ce que le SDK croit avoir installé. Elle ne dit pas qu'un
// signal a été reçu, écrit et affiché — cela s'établit par une recette
// d'opérateur, la seule à écrire cette colonne (cf. migration-v82).
import { MOBILE_CAPABILITIES } from "ingest/shared/mobile-capabilities.mjs";

export type MobileCapability = (typeof MOBILE_CAPABILITIES)[number];

/** Le vocabulaire fermé, dans l'ordre d'affichage. Il vient du serveur, pas d'ici. */
export const CAPABILITIES: readonly MobileCapability[] = MOBILE_CAPABILITIES;

export const CAPABILITY_LABELS: Record<MobileCapability, string> = {
  js_errors: "Erreurs JavaScript",
  native_crashes: "Crashes natifs",
  anr: "ANR (application ne répond plus)",
  native_start: "Démarrage natif",
  offline_persistence: "Reprise hors ligne",
  screen_tracking: "Suivi des écrans",
};

/**
 * Ce que l'absence de signal veut dire pour chaque capacité. Affiché sous le
 * badge : un exploitant qui lit « Non collecté » doit savoir ce qu'il ne voit pas.
 */
export const CAPABILITY_NOTES: Record<MobileCapability, string> = {
  js_errors:
    "Erreurs JavaScript non interceptées et rejets de promesses. Sans elle, l'absence d'erreur n'est pas une absence d'erreur.",
  native_crashes:
    "Plantages du processus natif (signal, exception Objective-C, SIGABRT). Aucun module natif MIP n'existe : ils appartiennent à P8.5.",
  anr:
    "Fil principal bloqué au-delà du seuil du système. Un compteur JavaScript ne sait pas distinguer un blocage d'une application au repos.",
  native_start:
    "Démarrage du processus, pré-main et écran de lancement. Le SDK ne mesure que le temps JS jusqu'au premier écran déclaré.",
  offline_persistence:
    "File durable sur le stockage de l'appareil. Désactivée, les signaux émis hors ligne sont perdus à la fermeture.",
  screen_tracking:
    "Adaptateur de navigation abonné au routeur. Sans lui, seul un appel manuel à screen() alimente les écrans : la couverture n'est pas garantie.",
};

/** Une ligne de `mobile_capabilities`, telle que la lecture la rend. */
export interface CapabilityDeclaration {
  capability: MobileCapability;
  runtime: string;
  /** `null` = l'application ne déclare pas de version. « Inconnue », pas « ». */
  release: string | null;
  declared: boolean;
  first_declared_at: string;
  last_declared_at: string;
  /** Recette d'opérateur uniquement. Jamais posé par l'ingestion. */
  verified_at: string | null;
  verified_by: string | null;
}

export type CapabilityState = "active" | "unavailable" | "unknown";

export interface CapabilityStatus {
  capability: MobileCapability;
  label: string;
  note: string;
  state: CapabilityState;
  /** Releases qui déclarent la capacité ACTIVE, triées ; `null` pour « sans release ». */
  declared_by: (string | null)[];
  /** Date de recette opérateur la plus récente, ou `null` : jamais vérifiée. */
  verified_at: string | null;
  verified_by: string | null;
  /** Dernière déclaration reçue, toutes releases confondues. `null` si aucune. */
  last_declared_at: string | null;
}

/**
 * État d'une capacité sur un périmètre de releases.
 *
 * `active` dès qu'UNE release la déclare active : la capacité existe alors dans
 * le parc, et l'annoncer indisponible masquerait les signaux qu'elle produit.
 * `unavailable` seulement si toutes les déclarations reçues disent le contraire.
 * Aucune déclaration : `unknown` — un SDK antérieur au modèle ne dit rien, et un
 * silence n'est pas un refus.
 */
export function capabilityStatus(
  capability: MobileCapability,
  declarations: readonly CapabilityDeclaration[],
): CapabilityStatus {
  const pour = declarations.filter((d) => d.capability === capability);
  const actives = pour.filter((d) => d.declared);
  const state: CapabilityState = actives.length ? "active" : pour.length ? "unavailable" : "unknown";
  // La vérification la plus RÉCENTE : une recette passée sur la release courante
  // dit davantage qu'une recette passée sur une release retirée du parc.
  const verifiees = pour
    .filter((d) => d.verified_at !== null)
    .sort((a, b) => String(b.verified_at).localeCompare(String(a.verified_at)));
  const derniere = pour.map((d) => d.last_declared_at).sort().at(-1) ?? null;
  return {
    capability,
    label: CAPABILITY_LABELS[capability],
    note: CAPABILITY_NOTES[capability],
    state,
    declared_by: actives.map((d) => d.release).sort((a, b) => String(a).localeCompare(String(b))),
    verified_at: verifiees[0]?.verified_at ?? null,
    verified_by: verifiees[0]?.verified_by ?? null,
    last_declared_at: derniere,
  };
}

/** Les six capacités, dans l'ordre du vocabulaire. Aucune n'est omise : une case vide est une information. */
export function capabilityMatrix(declarations: readonly CapabilityDeclaration[]): CapabilityStatus[] {
  return CAPABILITIES.map((c) => capabilityStatus(c, declarations));
}

/** Libellé du badge. « Non collecté » n'est jamais « 0 », et « Inconnu » n'est jamais « Non ». */
export const STATE_LABELS: Record<CapabilityState, string> = {
  active: "Collecté",
  unavailable: "Non collecté",
  unknown: "Inconnu",
};

/**
 * Pourquoi le taux de sessions sans erreur JS peut ne pas être calculable.
 *
 * `capability_unavailable` et `capability_unknown` NE SONT PAS des cas
 * théoriques : ce sont les deux situations où un « 100 % » serait faux. Une
 * application sans gestionnaire d'erreurs installé n'a pas zéro erreur, elle
 * n'en a aucune d'observée — et un taux calculé sur ce zéro annoncerait
 * exactement l'inverse de la vérité.
 */
export type ErrorFreeUnavailable = "no_sessions" | "capability_unavailable" | "capability_unknown";

export const ERROR_FREE_REASONS: Record<ErrorFreeUnavailable, string> = {
  no_sessions: "Aucune session React Native observée sur la fenêtre : le taux n'a pas de dénominateur.",
  capability_unavailable:
    "Les erreurs JavaScript ne sont pas collectées sur ce périmètre : l'absence d'erreur ne prouverait rien.",
  capability_unknown:
    "Aucune release de ce périmètre ne déclare collecter les erreurs JavaScript : on ne sait pas si l'absence d'erreur en est une.",
};

/**
 * Taux de sessions SANS erreur JS observée.
 *
 * LE LIBELLÉ NE DIT PAS « CRASH-FREE », et le calcul non plus. Une erreur
 * JavaScript non interceptée arrête le bundle ; elle ne tue pas le processus
 * natif. Une application peut afficher 100 % ici et planter à chaque
 * démarrage sur un `SIGABRT` que rien ne mesure. Les deux populations sont
 * disjointes, et la seconde n'est pas collectée avant P8.5.
 *
 * Même cohorte, même fenêtre : le dénominateur est le nombre de sessions React
 * Native commencées dans la fenêtre, le numérateur le nombre de CES sessions
 * portant au moins une erreur JavaScript de la même fenêtre.
 */
export function errorFreeSessionRate(input: {
  sessions: number;
  sessionsWithJsError: number;
  jsErrorsState: CapabilityState;
}): { rate: number | null; reason: ErrorFreeUnavailable | null } {
  // L'absence de session vient EN PREMIER, et c'est un choix de lecture : quand
  // le périmètre est vide, « aucune session observée » explique la page entière,
  // tandis que « aucune release ne déclare collecter » enverrait chercher un
  // défaut d'instrumentation là où il n'y a simplement rien à mesurer.
  if (input.sessions <= 0) return { rate: null, reason: "no_sessions" };
  if (input.jsErrorsState === "unavailable") return { rate: null, reason: "capability_unavailable" };
  if (input.jsErrorsState === "unknown") return { rate: null, reason: "capability_unknown" };
  const touchees = Math.min(input.sessionsWithJsError, input.sessions);
  return { rate: 1 - touchees / input.sessions, reason: null };
}

// ───────────────────────────── Filtre plateforme ─────────────────────────────
//
// `platform` n'est pas une dimension NOUVELLE : c'est le système d'exploitation
// du contrat P6, restreint aux deux valeurs qu'un runtime React Native peut
// rendre. L'exposer comme un filtre à part entière créerait une seconde vérité
// à maintenir ; le traduire en condition `os` la réutilise telle quelle, y
// compris son intersection avec un `os=` déjà présent dans l'URL.

export const PLATFORMS = ["ios", "android"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Valeur stockée par l'ingestion pour chaque plateforme (cf. `dimensions.mjs`). */
export const PLATFORM_OS: Record<Platform, string> = { ios: "iOS", android: "Android" };
export const PLATFORM_LABELS: Record<Platform, string> = { ios: "iOS", android: "Android" };

/**
 * Motif écrit par `mobileSummary` dans `unavailable` quand la migration v82 manque :
 * sans colonne `runtime`, aucune cohorte React Native ne peut être isolée.
 */
export const RAISON_SANS_RUNTIME =
  "migration v82 absente : le runtime des sessions n'est pas encore collecté, aucune cohorte React Native ne peut être isolée";

/**
 * Sessions React Native à AFFICHER (F30, CE9). Sans v82, la lecture rend
 * `sessions: 0` — ce n'est pas « aucune session », c'est « rien n'a pu être
 * compté ». L'écran affiche alors « — » avec la raison, jamais « 0 ».
 */
export function sessionsCohorte(data: {
  sessions: { sessions: number };
  unavailable: readonly string[];
}): { valeur: number | null; raison: string | null } {
  if (data.unavailable.includes(RAISON_SANS_RUNTIME)) {
    return { valeur: null, raison: "runtime non collecté (migration v82) : la cohorte React Native ne peut pas être isolée" };
  }
  return { valeur: data.sessions.sessions, raison: null };
}

/** `?platform=ios` → `ios`, sinon `null` (toutes). Une valeur inconnue vaut « toutes ». */
export function parsePlatform(raw: string | null | undefined): Platform | null {
  const value = raw?.trim().toLowerCase();
  return (PLATFORMS as readonly string[]).includes(value ?? "") ? (value as Platform) : null;
}
