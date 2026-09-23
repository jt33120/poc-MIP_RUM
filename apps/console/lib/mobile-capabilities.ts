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
import { conditionsOf, hrefWithQuery, intersectQuery, type AnalyticsQuery, type FilterCondition } from "./query-contract";

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

// ───────────────────── État et taux PAR RELEASE (F38, CE14) ───────────────────
//
// `capabilityStatus` répond à « la capacité existe-t-elle dans le parc ? » : active
// dès qu'UNE release la déclare. C'est juste pour la matrice, et faux pour un taux.
// Le taux « sessions sans erreur JS » calculé sur tout le parc comptait au
// dénominateur les sessions d'une release qui NE déclare PAS collecter les erreurs
// JS — sessions dont l'absence d'erreur ne prouve rien — et les rangeait « sans
// erreur ». Le taux était gonflé, et une ligne par release sans garde propre aurait
// affiché « 0 % touchées » sur une release aveugle. D'où l'état PAR RELEASE, issu
// de ses seules déclarations, et un taux calculé sur les releases déclarantes.

/** Motif d'une part non calculable faute de `rum_error.error_source` (v69). */
export const RAISON_SANS_SOURCE_JS =
  "migration v69 absente : les erreurs JavaScript React Native ne sont pas distinguables";

/**
 * Une déclaration avec l'app qui l'a émise. Une release n'est un fait que DANS son
 * app : deux apps React Native en « 1.0.0 » sont deux binaires sans rapport.
 */
export type DeclarationApp = CapabilityDeclaration & { app_id: string };

/**
 * État d'une capacité pour UNE release D'UNE app, issu de ses seules
 * déclarations. Une release `null` (l'application ne déclare pas de version)
 * n'hérite pas des déclarations des autres : ses propres lignes `release is null`,
 * ou `unknown`.
 *
 * `app` : sous plusieurs apps (`app=all`), la « 1.0.0 » de A n'emprunte pas les
 * déclarations de la « 1.0.0 » de B — sinon B, qui ne déclare rien, passerait
 * « active » et ses sessions entreraient au dénominateur comme non touchées. Une
 * déclaration sans `app_id` ne correspond alors à aucune app : `unknown`, jamais
 * l'état d'une autre.
 */
export function etatCapaciteParRelease(
  declarations: readonly (CapabilityDeclaration & { app_id?: string })[],
  capability: MobileCapability,
  release: string | null,
  app?: string,
): CapabilityState {
  return capabilityStatus(
    capability,
    declarations.filter((d) => d.release === release && (app === undefined || d.app_id === app)),
  ).state;
}

/** Pourquoi le taux des releases déclarantes n'est pas calculable. */
export type RaisonTauxDeclarant = ErrorFreeUnavailable | "source_indisponible";

/** Texte d'une raison de `tauxSansErreurDeclarant`. */
export function texteRaisonTaux(raison: RaisonTauxDeclarant): string {
  return raison === "source_indisponible" ? RAISON_SANS_SOURCE_JS : ERROR_FREE_REASONS[raison];
}

/** Ce que le taux lit d'une ligne de `mobileParRelease` (type structurel : ce module reste sans base). */
export interface LigneTauxRelease {
  sessions: number;
  /** `null` : la source d'erreur n'est pas lisible (v69 absente). */
  sessions_touchees: number | null;
  etat_js_errors: CapabilityState;
}

/**
 * « Sessions sans erreur JS », calculé sur les releases qui DÉCLARENT collecter
 * les erreurs JS (W-M5, corrige CE14) : 1 − Σ touchées / Σ sessions des lignes
 * `active`. Une somme de comptes, jamais une moyenne des parts. `exclues` : les
 * sessions des releases non déclarantes, sorties du numérateur ET du dénominateur.
 *
 * Ordre des raisons : aucune session d'abord (comme `errorFreeSessionRate`), puis
 * aucune release déclarante — `capability_unavailable` seulement si TOUTES les
 * releases déclarent ne pas collecter —, puis la source illisible.
 */
export function tauxSansErreurDeclarant(lignes: readonly LigneTauxRelease[]): {
  rate: number | null;
  reason: RaisonTauxDeclarant | null;
  sessions: number;
  touchees: number;
  exclues: number;
} {
  const total = lignes.reduce((s, l) => s + Math.max(0, l.sessions), 0);
  if (total <= 0) return { rate: null, reason: "no_sessions", sessions: 0, touchees: 0, exclues: 0 };
  const actives = lignes.filter((l) => l.etat_js_errors === "active" && l.sessions > 0);
  const sessions = actives.reduce((s, l) => s + l.sessions, 0);
  const exclues = total - sessions;
  if (actives.length === 0) {
    const toutesRefusent = lignes.every((l) => l.sessions <= 0 || l.etat_js_errors === "unavailable");
    return {
      rate: null,
      reason: toutesRefusent ? "capability_unavailable" : "capability_unknown",
      sessions: 0,
      touchees: 0,
      exclues,
    };
  }
  if (actives.some((l) => l.sessions_touchees === null)) {
    return { rate: null, reason: "source_indisponible", sessions, touchees: 0, exclues };
  }
  // Même garde que `errorFreeSessionRate` : plus de sessions touchées que de
  // sessions (arrivée tardive) ne fait pas descendre le taux sous 0.
  const touchees = actives.reduce((s, l) => s + Math.min(l.sessions_touchees ?? 0, l.sessions), 0);
  return { rate: 1 - touchees / sessions, reason: null, sessions, touchees, exclues };
}

/**
 * Chaque release contre la PRÉCÉDENTE dans l'ordre de première session vue (W-M6)
 * — un ordre calculé ici, indépendant de l'ordre d'affichage : la plus récente en
 * tête. L'écart est en POINTS de part touchée, `null` si l'une des deux parts l'est.
 * Les sessions sans release ne forment pas une release : elles n'ont pas de
 * précédente et n'en servent à aucune. La précédente est cherchée DANS LA MÊME APP
 * (`app_id`) : sous plusieurs apps, la 2.0 de A ne se compare pas à la 1.9 de B.
 */
export function chainerReleases<
  T extends { app_id?: string; release: string | null; premiere_session: string; part_touchee: number | null },
>(lignes: readonly T[]): (T & { ecart_precedente_pts: number | null; release_precedente: string | null })[] {
  const triees = [...lignes].sort(
    (a, b) =>
      b.premiere_session.localeCompare(a.premiere_session) ||
      (a.release === null ? 1 : b.release === null ? -1 : b.release.localeCompare(a.release)) ||
      String(a.app_id ?? "").localeCompare(String(b.app_id ?? "")),
  );
  return triees.map((ligne, i) => {
    if (ligne.release === null) return { ...ligne, ecart_precedente_pts: null, release_precedente: null };
    const precedente = triees.slice(i + 1).find((l) => l.release !== null && l.app_id === ligne.app_id) ?? null;
    const ecart =
      precedente && ligne.part_touchee !== null && precedente.part_touchee !== null
        ? (ligne.part_touchee - precedente.part_touchee) * 100
        : null;
    return { ...ligne, ecart_precedente_pts: ecart, release_precedente: precedente?.release ?? null };
  });
}

/**
 * Release la plus récente des déclarations (vue produit « Dernière release
 * déclarée », § 3.6) : celle dont la PREMIÈRE déclaration est la plus récente — une
 * release nouvelle s'annonce la dernière ; une ancienne qui déclare encore n'est pas
 * « la dernière » pour autant. Les déclarations sans release n'en désignent aucune.
 */
export function derniereReleaseDeclaree(declarations: readonly CapabilityDeclaration[]): string | null {
  let meilleure: { release: string; premiere: string } | null = null;
  for (const d of declarations) {
    if (d.release === null || d.release.trim() === "") continue;
    if (
      !meilleure ||
      d.first_declared_at > meilleure.premiere ||
      (d.first_declared_at === meilleure.premiere && d.release > meilleure.release)
    ) {
      meilleure = { release: d.release, premiere: d.first_declared_at };
    }
  }
  return meilleure?.release ?? null;
}

/**
 * Zones de `/mobile`, dans l'ordre de rendu (§ 5.6.3). Nominal : la stabilité par
 * release est le hero, juste sous les tuiles. Repli, décidé À L'EXÉCUTION : si la
 * lecture par release est `disponible: false` (schéma sans runtime ou sans release
 * de session), les tuiles puis le démarrage forment le hero et la stabilité descend
 * sous le démarrage, avec sa raison. Une lecture en ÉCHEC ne déclenche pas le
 * repli : la section reste en place, en erreur, avec « Réessayer ».
 */
export type ZoneMobile =
  | "angles-morts"
  | "bandeaux"
  | "kpi"
  | "stabilite"
  | "demarrage-ecrans"
  | "requetes"
  | "temps"
  | "capacites"
  | "plus-loin";

export function ordreZonesMobile(parRelease: "disponible" | "indisponible" | "erreur"): ZoneMobile[] {
  const tete: ZoneMobile[] = ["angles-morts", "bandeaux", "kpi"];
  const fin: ZoneMobile[] = ["requetes", "temps", "capacites", "plus-loin"];
  return parRelease === "indisponible"
    ? [...tete, "demarrage-ecrans", "stabilite", ...fin]
    : [...tete, "stabilite", "demarrage-ecrans", ...fin];
}

// ───────────────────── F39 — dans le temps, et liens de la cohorte ─────────────────────

/**
 * B8 : la cohorte React Native, telle qu'un AUTRE écran du contrat la lit
 * (`seg=v2:runtime:eq:react_native`). /mobile, lui, la construit dans sa lecture.
 */
export const CONDITION_REACT_NATIVE: FilterCondition = { dimension: "runtime", operator: "eq", value: "react_native" };

/** Un lien vers la cohorte sur un autre écran, ou la raison pour laquelle il n'est pas rendu. */
export type LienCohorte = { href: string; raison: null } | { href: null; raison: string };

export const RAISON_LIEN_SANS_RUNTIME =
  "runtime non collecté (migration v82) : l'écran cible ne peut pas isoler la cohorte React Native";
export const RAISON_LIEN_SCHEMA_NON_LU = "schéma non lu : impossible de savoir si l'écran cible sait isoler la cohorte React Native";
export const RAISON_LIEN_RELEASE =
  "sous un filtre de release, ici lu sur la session : /sessions et l'Explorer ne filtrent pas la release d'une session, /pages la lit sur chaque page vue — retirez le filtre de release pour ouvrir la cohorte";

/**
 * Liens de /mobile vers la cohorte React Native sur /sessions (tuile W-M2, W-M12),
 * /pages (W-M8) et l'Explorer (W-M10) — levés par B8. Un lien n'est rendu que si
 * l'écran cible applique le filtre DE BOUT EN BOUT, périmètre compris : conditions
 * de /mobile (appareil, système), `seg=v2:runtime:eq:react_native`, apps du contrat.
 * Sinon, la raison est écrite à sa place — jamais un lien vers un refus.
 *
 * La release est l'exception : /mobile la lit sur la SESSION (fait exact d'un
 * binaire mobile), /sessions et le jeu `sessions` de l'Explorer la refusent, /pages
 * la lit sur chaque page vue. Sous un filtre de release, aucun lien n'est rendu.
 *
 * `runtimeLu` : `rum_session.runtime` présente (sonde de schéma) ; `null` = sonde en échec.
 */
export function lienCohorte(
  query: AnalyticsQuery,
  cible: "/sessions" | "/pages" | "/explorer",
  runtimeLu: boolean | null,
  extra: Record<string, string | null> = {},
): LienCohorte {
  if (runtimeLu === null) return { href: null, raison: RAISON_LIEN_SCHEMA_NON_LU };
  if (!runtimeLu) return { href: null, raison: RAISON_LIEN_SANS_RUNTIME };
  if (conditionsOf(query.filters).some((c) => c.dimension === "release")) return { href: null, raison: RAISON_LIEN_RELEASE };
  return { href: hrefWithQuery(cible, intersectQuery(query, { conditions: [CONDITION_REACT_NATIVE] }), extra), raison: null };
}

/** Un seau de la série W-M10, tel que `mobileSerie` le rend (type structurel : ce module reste sans base). */
export interface SeauMobileTemps {
  bucket: string | Date;
  sessions: number;
  occurrences: number | null;
}

export interface PointsMobileTemps {
  /** Un point par seau attendu, dans l'ordre de la grille. */
  points: { t: string; sessions: number; occurrences: number | null }[];
  /** Σ sessions commencées : la tuile W-M2. */
  totalSessions: number;
  /** Σ occurrences d'erreurs JS : la tuile W-M4 ; `null` si elles ne sont pas lues. */
  totalOccurrences: number | null;
  /** Lignes hors grille (ou en double), écartées et comptées — jamais redistribuées. */
  ignores: number;
}

/**
 * Pose les seaux de `mobileSerie` sur la grille du contrat (`bucketStarts`). Un seau
 * attendu sans ligne vaut 0 session et, si les occurrences sont lues, 0 occurrence :
 * ce sont des comptes (§ 3.10). Occurrences non lues : `null` partout, jamais 0.
 */
export function pointsMobileTemps(
  starts: readonly number[],
  seaux: readonly SeauMobileTemps[],
  erreursLues: boolean,
): PointsMobileTemps {
  const attendus = new Set(starts);
  const parInstant = new Map<number, SeauMobileTemps>();
  let ignores = 0;
  for (const seau of seaux) {
    const ms = new Date(seau.bucket).getTime();
    if (!attendus.has(ms) || parInstant.has(ms)) {
      ignores++;
      continue;
    }
    parInstant.set(ms, seau);
  }
  const points = starts.map((ms) => {
    const seau = parInstant.get(ms);
    return {
      t: new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z"),
      sessions: seau?.sessions ?? 0,
      occurrences: erreursLues ? (seau?.occurrences ?? 0) : null,
    };
  });
  return {
    points,
    totalSessions: points.reduce((s, p) => s + p.sessions, 0),
    totalOccurrences: erreursLues ? points.reduce((s, p) => s + (p.occurrences ?? 0), 0) : null,
    ignores,
  };
}
