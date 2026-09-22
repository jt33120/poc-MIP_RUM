// Détail de session (F44, plan § 5.12) : en-tête, résumé chiffré, onglets —
// logique PURE, testée (tests/unit/session-detail.test.ts), sans accès base.
//
// CE QUE LE DÉTAIL REFUSE D'AFFIRMER :
//   - une identité : visiteur tronqué à 8 caractères, jamais `user_hash`,
//     `user_id_hash` ni `account_id_hash` (S5, V9) ;
//   - « 100 % » pour une session d'avant v58 : son `sample_rate` vaut 1 PAR
//     DÉFAUT, pas par mesure (« probabilité d'inclusion non enregistrée ») ;
//   - un compte tiré d'une chronologie TRONQUÉE à 500 lignes : le compte est
//     inconnu (« — », onglet « (—) »), pas le nombre de lignes lues ;
//   - « 0 signal de frustration » pour une session React Native : le SDK mobile
//     n'en émet pas (garde capteur R-F) ;
//   - des occurrences quand une ligne d'erreur ne les porte pas (schéma d'avant
//     v67) : le compte devient « Erreurs (lignes) », et le dit.
import { formater } from "./fmt-ids";
import { DEBUT_SAMPLE_RATE } from "./echantillonnage";
import { STILL_ACTIVE_MINUTES } from "./engagement";
import { geoSourceLabel } from "./geo";
import { CORE_VITALS } from "./rating";
import { LIMITE_CHRONOLOGIE } from "./recit-session";
import type { SessionMeta, TimelineItem } from "./queries";

// ─────────────────────────────── Onglets ─────────────────────────────────────

/**
 * Onglets du détail (§ 5.12.3). `cascade` s'ajoute avec F46 ; d'ici là, sa valeur
 * est un réglage ignoré, dit comme tel.
 */
export const ONGLETS_SESSION = ["deroule", "erreurs", "api", "vitals", "attributs"] as const;
export type OngletSession = (typeof ONGLETS_SESSION)[number];

export const LIBELLES_ONGLETS: Record<OngletSession, string> = {
  deroule: "Déroulé",
  erreurs: "Erreurs",
  api: "Appels API",
  vitals: "Web Vitals",
  attributs: "Attributs",
};

/** Anciennes valeurs, émises par des liens existants (`components/errors/error-view.ts`). */
const ALIAS_DEROULE = new Set(["replay", "timeline"]);

/**
 * `?tab=` → onglet. `replay` et `timeline` (liens existants) sont lus comme
 * `deroule` — l'instant `at` reste lu à part, il n'est pas perdu. Une valeur
 * inconnue retombe sur le Déroulé et rend la ligne qui le dit (§ 3.1, règle 3).
 */
export function lireOnglet(brut: string | null | undefined): { onglet: OngletSession; ignore: string | null } {
  if (brut == null || brut === "" || ALIAS_DEROULE.has(brut)) return { onglet: "deroule", ignore: null };
  if ((ONGLETS_SESSION as readonly string[]).includes(brut)) return { onglet: brut as OngletSession, ignore: null };
  const cite = brut.length > 40 ? `${brut.slice(0, 40)}…` : brut;
  return {
    onglet: "deroule",
    ignore: `Réglage d'affichage ignoré : tab=${cite} (valeurs acceptées : ${ONGLETS_SESSION.join(", ")}).`,
  };
}

/** `at` : instant epoch en ms, entier ; toute autre valeur est ignorée (le lecteur ne devine pas). */
export function lireInstant(brut: string | null | undefined): number | null {
  return typeof brut === "string" && /^\d{1,15}$/.test(brut) ? Number(brut) : null;
}

// ─────────────────────────────── Résumé ──────────────────────────────────────

/** Session React Native : le SDK mobile n'émet aucun signal de frustration (CP16). */
export const RUNTIME_MOBILE = "react_native";

export const RAISON_TRONQUEE = `chronologie tronquée à ${LIMITE_CHRONOLOGIE} événements : compte non établi`;
export const RAISON_FRUSTRATION_MOBILE = "Non collecté : le SDK mobile n'émet pas de signaux de frustration";

/**
 * Règles des signaux, telles que le SDK navigateur les applique
 * (`packages/rum-sdk/src/frustration.ts` : 3 clics en 1 s, 1 500 ms sans réaction ;
 * vérifié par le test unitaire).
 */
export const LECTURE_FRUSTRATION =
  "Clic de rage : 3 clics en 1 s sur la même cible ; clic sans réaction : rien dans les 1 500 ms ; erreur pendant l'action. Un SDK configuré sans détection envoie 0 sans que la console le sache.";

export interface ResumeSession {
  /** La chronologie a atteint sa limite : tout compte qui en vient est inconnu. */
  tronquee: boolean;
  /** Lignes d'erreur (une ligne peut regrouper plusieurs répétitions). */
  erreursLignes: number | null;
  /** `sum(occurrences)` des erreurs (V1) ; `null` si une ligne ne les porte pas, ou tronquée. */
  occurrences: number | null;
  /** Événements `frustration.*` ; `null` : session mobile (non collecté) ou chronologie tronquée. */
  frustration: number | null;
  /** Appels API en échec (statut ≥ 400 ou 0). */
  apiEchecs: number | null;
  /** Lignes des onglets comptés. */
  apiLignes: number | null;
  vitaux: number | null;
}

/** Un vital « Web » (LCP, INP, CLS, FCP, TTFB) — les phases réseau n'en sont pas. */
export function estWebVital(item: Pick<TimelineItem, "kind" | "title">): boolean {
  return item.kind === "vital" && item.title !== null && CORE_VITALS.includes(item.title);
}

export function estFrustration(item: Pick<TimelineItem, "kind" | "title">): boolean {
  return item.kind === "event" && typeof item.title === "string" && item.title.startsWith("frustration.");
}

export function resumeDeSession(
  timeline: readonly TimelineItem[],
  runtime: string | null | undefined,
): ResumeSession {
  const tronquee = timeline.length >= LIMITE_CHRONOLOGIE;
  const erreurs = timeline.filter((it) => it.kind === "error");
  const api = timeline.filter((it) => it.kind === "api");
  const occurrencesConnues = erreurs.every((it) => it.value != null && Number.isFinite(Number(it.value)));
  const compte = (n: number) => (tronquee ? null : n);
  return {
    tronquee,
    erreursLignes: compte(erreurs.length),
    occurrences: tronquee || !occurrencesConnues ? null : erreurs.reduce((s, it) => s + Number(it.value), 0),
    frustration: runtime === RUNTIME_MOBILE ? null : compte(timeline.filter(estFrustration).length),
    apiEchecs: compte(api.filter((it) => it.rating === "poor").length),
    apiLignes: compte(api.length),
    vitaux: compte(timeline.filter(estWebVital).length),
  };
}

/** Les occurrences sont-elles lisibles sur chaque ligne (schéma v67) ? Sinon, la tuile compte des lignes. */
export function occurrencesLisibles(timeline: readonly TimelineItem[]): boolean {
  return timeline.filter((it) => it.kind === "error").every((it) => it.value != null);
}

/** « Encore active » : vue dans les 30 dernières minutes (`STILL_ACTIVE_MINUTES`). */
export function encoreActive(lastSeen: Date | string, nowMs: number): boolean {
  return new Date(lastSeen).getTime() >= nowMs - STILL_ACTIVE_MINUTES * 60_000;
}

/** Durée observée en ms : écart entre deux observations, jamais négatif. */
export function dureeObservee(debut: Date | string, fin: Date | string): number {
  return Math.max(0, new Date(fin).getTime() - new Date(debut).getTime());
}

// ─────────────────────────────── Puces ───────────────────────────────────────

export interface PuceContexte {
  label: string;
  valeur: string;
  /** Provenance d'une valeur estimée (pays), écrite à côté. */
  provenance?: string;
  /** La puce est un lien (release → erreurs de cette release). */
  href?: string;
}

/** Colonnes de `rum_session` lues par l'en-tête (typées dans `SessionMeta`). */
export type MetaPuces = Pick<
  SessionMeta,
  | "app_id"
  | "device_type"
  | "geo_country"
  | "geo_source"
  | "collection_source"
  | "visitor_id"
  | "started_at"
  | "browser"
  | "browser_version"
  | "os"
  | "os_version"
  | "release"
  | "sample_rate"
  | "error_sample_rate"
  | "has_error"
>;

const INCONNU = "Inconnu";

function avecVersion(nom: string | null | undefined, version: string | null | undefined): string {
  if (!nom) return INCONNU;
  return version ? `${nom} ${version}` : nom;
}

/**
 * Probabilité d'inclusion de la session (migration-v58) : `sample_rate`, ou
 * `sample_rate + (1 − sample_rate) × error_sample_rate` si elle porte une erreur.
 * Commencée avant le 09/09/2026 (ou colonne absente) : non enregistrée.
 */
export function texteEchantillonnage(meta: Pick<MetaPuces, "started_at" | "sample_rate" | "error_sample_rate" | "has_error">): string {
  const debut = new Date(meta.started_at).getTime();
  const sr = meta.sample_rate == null ? null : Number(meta.sample_rate);
  if (sr == null || !Number.isFinite(sr) || debut < Date.parse(DEBUT_SAMPLE_RATE)) {
    return "probabilité d'inclusion non enregistrée";
  }
  const esr = meta.error_sample_rate == null ? 1 : Number(meta.error_sample_rate);
  const p = meta.has_error ? sr + (1 - sr) * esr : sr;
  return `retenue avec probabilité ${formater("pct", Math.min(1, Math.max(0, p)))}`;
}

/** Visiteur : identifiant ALÉATOIRE tronqué à 8 caractères ; sinon inconnu (jamais l'empreinte héritée). */
export function texteVisiteur(visitorId: string | null | undefined): { label: string; valeur: string } {
  if (visitorId) return { label: "Visiteur (aléatoire)", valeur: `${visitorId.slice(0, 8)}…` };
  return { label: "Visiteur", valeur: "Inconnu — classe d'appareil héritée, n'identifie pas une personne" };
}

/**
 * Les puces « qui / sur quoi / où » de l'en-tête (§ 5.12.4), dans l'ordre du plan.
 * `lienRelease` construit le lien de la release (écran Erreurs filtré).
 */
export function pucesDeSession(meta: MetaPuces, lienRelease: (release: string) => string): PuceContexte[] {
  const visiteur = texteVisiteur(meta.visitor_id);
  return [
    { label: "App", valeur: meta.app_id },
    { label: "Appareil", valeur: meta.device_type ?? INCONNU },
    { label: "Navigateur", valeur: avecVersion(meta.browser, meta.browser_version) },
    { label: "Système", valeur: avecVersion(meta.os, meta.os_version) },
    { label: "Pays estimé", valeur: meta.geo_country ?? INCONNU, provenance: geoSourceLabel(meta.geo_source) },
    { label: "Capteur", valeur: meta.collection_source === "extension" ? "Extension navigateur" : "SDK" },
    meta.release
      ? { label: "Release à l'ouverture", valeur: meta.release, href: lienRelease(meta.release) }
      : { label: "Release à l'ouverture", valeur: INCONNU },
    { label: visiteur.label, valeur: visiteur.valeur },
    { label: "Échantillonnage", valeur: texteEchantillonnage(meta) },
  ];
}

// ─────────────────────────────── Onglets de tables ────────────────────────────

/**
 * Route de la vue EN COURS au moment d'un événement : la dernière page vue qui le
 * précède (ou au même instant). `null` avant la première vue.
 */
export function routeEnCours(timeline: readonly TimelineItem[], index: number): string | null {
  for (let i = index; i >= 0; i--) {
    const it = timeline[i];
    if (it.kind === "pageview") return it.title;
  }
  return null;
}

/** Statut d'un appel API, lu sur la ligne (« 500 · serveur 45 ms ») ; 0 = réseau, jamais « 500 ». */
export function statutAppel(detail: string | null): { statut: string; serveur: string | null } {
  const [tete, ...reste] = (detail ?? "").split(" · ");
  const serveur = reste.find((r) => r.startsWith("serveur ")) ?? null;
  const statut = tete === "0" ? "réseau (statut 0)" : tete && tete !== "—" ? tete : "—";
  return { statut, serveur: serveur ? serveur.replace(/^serveur /, "") : null };
}

/** Attributs techniques (onglet repliable) : colonnes non identifiantes seulement. */
export const ATTRIBUTS_SESSION = [
  "session_id",
  "app_id",
  "collection_source",
  "runtime",
  "sample_rate",
  "error_sample_rate",
  "geo_db_version",
  "user_agent",
] as const;

export function attributsDeSession(meta: Partial<Record<(typeof ATTRIBUTS_SESSION)[number], unknown>>): { cle: string; valeur: string }[] {
  return ATTRIBUTS_SESSION.map((cle) => {
    const v = meta[cle];
    return { cle, valeur: v == null || v === "" ? INCONNU : String(v) };
  });
}
