// Priorité et table des sessions (F42, plan § 5.11.4) — logique PURE, testée
// (tests/unit/sessions-priorite.test.ts), sans accès base.
//
// CE QUE CES FONCTIONS REFUSENT D'AFFIRMER :
//   - un classement de la fenêtre déduit des 50 lignes de la page courante : la
//     liste est chronologique et paginée par curseur ; trier ce qu'on en voit
//     produirait « les plus graves » d'un échantillon arbitraire. Tant que B30
//     manque, le hero dit `RAISON_PRIORITE` et NE CLASSE RIEN ;
//   - « 0 signal de frustration » quand la lecture par session n'existe pas :
//     l'absence de LECTURE s'écrit « — », jamais un zéro (V3) ;
//   - « pas de rejeu » quand l'existence n'a pas été lue : `rejeu: null` rend
//     « ▶ — » avec sa raison, distinct de `rejeu: false` (aucun rejeu) ;
//   - un navigateur DÉDUIT présenté comme un navigateur COLLECTÉ : la colonne
//     `browser` (v75) prime, et une déduction faite sur l'user-agent est dite.
//
// Les occurrences d'erreur d'une session viennent de `SessionRow.err_count`, qui
// est un `sum(occurrences)` (`listSessions`, `lib/queries.ts`) : V1 est tenu à la
// source, et le libellé de la colonne dit « Occurrences d'erreur ».
import { browserFromUA } from "./format";
import type { SessionRow } from "./queries";

/** Texte du hero tant que `sessionsAPrioriser` (B30, § 6.3) n'est pas livrée. */
export const RAISON_PRIORITE = "classement indisponible : lecture à créer (B30)";

/** Texte des cellules Frustration / Rejeu et des filtres rapides avant B30. */
export const SIGNAUX_A_CREER = "lecture à créer (B30)";

/** Ce qu'une raison de priorité énumère, tel que B30 le rendra (§ 5.11.4). */
export interface RaisonPriorite {
  erreurs: { type: string; occurrences: number }[];
  frustration: { kind: string; cible: string; n: number }[];
  api: { methode: string; chemin: string; statut: number | null }[];
}

/** Une ligne du hero « À regarder d'abord » (B30 `sessionsAPrioriser`). */
export type SessionPrioritaire = SessionRow & {
  /** Nombre de signaux `frustration.*` de la session. */
  frustration: number;
  /** Appels API en échec de la session. */
  api_echecs: number;
  /** Horodatage ISO de la première erreur ; `null` = aucune erreur datée. */
  premiere_erreur_ts: string | null;
  /** `true` / `false` = existence LUE ; `null` = existence non lue. */
  rejeu: boolean | null;
  raison: RaisonPriorite;
};

/** Signaux d'une ligne de la table ; `null` = non lu (B30 absent), jamais 0. */
export interface SignauxLigne {
  frustration: number | null;
  rejeu: boolean | null;
}

export type LigneSessions = SessionRow & SignauxLigne;

/**
 * Ordre du hero (§ 5.11.4) : occurrences d'erreur, puis signaux de frustration,
 * puis appels API en échec, puis récence. Chaque critère départage le précédent —
 * jamais de score composite, qui mêlerait trois populations en un chiffre sans
 * unité et rendrait l'ordre inexplicable à l'écran.
 *
 * Tri STABLE et sans effet de bord : la liste reçue n'est pas modifiée.
 */
export function ordonnerPrioritaires<T extends Pick<SessionPrioritaire, "err_count" | "frustration" | "api_echecs" | "last_seen_at">>(
  lignes: readonly T[],
  limite = 10,
): T[] {
  const ms = (d: Date | string) => new Date(d).getTime();
  return [...lignes]
    .sort(
      (a, b) =>
        b.err_count - a.err_count ||
        b.frustration - a.frustration ||
        b.api_echecs - a.api_echecs ||
        ms(b.last_seen_at) - ms(a.last_seen_at),
    )
    .slice(0, Math.max(0, limite));
}

const PLURIEL_FRUSTRATION: Record<string, [string, string]> = {
  rage: ["clic de rage", "clics de rage"],
  dead: ["clic mort", "clics morts"],
  error: ["erreur perçue", "erreurs perçues"],
};

function libelleFrustration(kind: string, n: number): string {
  const paire = PLURIEL_FRUSTRATION[kind];
  if (!paire) return `${n} signal(aux) ${kind}`;
  return `${n} ${n > 1 ? paire[1] : paire[0]}`;
}

/**
 * La raison ÉCRITE d'une ligne, fragment par fragment (« 3 occurrences de
 * TypeError », « 2 clics de rage sur « Payer » », « 1 appel POST /api/panier en
 * 500 »). Ce que Datadog ne fait pas : la ligne dit POURQUOI elle est première.
 *
 * Un fragment dont la valeur manque le dit (« cible inconnue », « sans statut
 * lu ») : rien n'est comblé par une valeur vraisemblable.
 */
export function raisonEcrite(raison: RaisonPriorite): string[] {
  const fragments: string[] = [];
  for (const e of raison.erreurs) {
    const type = e.type.trim() || "type inconnu";
    fragments.push(`${e.occurrences} occurrence${e.occurrences > 1 ? "s" : ""} de ${type}`);
  }
  for (const fr of raison.frustration) {
    const cible = fr.cible.trim();
    fragments.push(`${libelleFrustration(fr.kind, fr.n)} ${cible ? `sur « ${cible} »` : "sur une cible inconnue"}`);
  }
  for (const a of raison.api) {
    const chemin = a.chemin.trim() || "(sans chemin)";
    fragments.push(`1 appel ${a.methode} ${chemin} ${a.statut === null ? "sans statut lu" : `en ${a.statut}`}`);
  }
  return fragments;
}

/**
 * Durée OBSERVÉE d'une session, en millisecondes : écart entre la première et la
 * dernière observation (définition de `lib/engagement.ts`), pas du temps actif.
 * Un écart négatif (horloges client désaccordées) n'est pas affiché comme une
 * durée : il rend `null`.
 */
export function dureeObservee(s: Pick<SessionRow, "started_at" | "last_seen_at">): number | null {
  const debut = new Date(s.started_at).getTime();
  const fin = new Date(s.last_seen_at).getTime();
  if (!Number.isFinite(debut) || !Number.isFinite(fin) || fin < debut) return null;
  return fin - debut;
}

/** Parcours d'une session : première → dernière route, et le reste compté. */
export function parcoursResume(routes: string[] | null): { premiere: string; derniere: string | null; reste: number } | null {
  const vues = (routes ?? []).filter((r) => typeof r === "string" && r.length > 0);
  if (vues.length === 0) return null;
  return {
    premiere: vues[0],
    derniere: vues.length > 1 ? vues[vues.length - 1] : null,
    // « +N » = les vues intermédiaires, celles que le raccourci ne montre pas.
    reste: Math.max(0, vues.length - 2),
  };
}

/**
 * Navigateur d'une session. La colonne `browser` (migration-v75) est la valeur
 * COLLECTÉE — la même que le découpage « Qui sont ces sessions » — et prime ;
 * sans elle, l'user-agent est lu, et `deduit` le dit à l'écran (infobulle), pour
 * qu'une ligne ne se compare pas silencieusement à un groupe d'une autre source.
 */
export function navigateurDeSession(s: Pick<SessionRow, "browser" | "user_agent">): { texte: string; deduit: boolean } {
  const collecte = s.browser?.trim();
  if (collecte) return { texte: collecte, deduit: false };
  const deduit = browserFromUA(s.user_agent ?? null);
  return deduit === "—" ? { texte: "Inconnu", deduit: false } : { texte: deduit, deduit: true };
}

/** Valeur d'une dimension de session, « Inconnu » quand elle manque (V3). */
export function valeurOuInconnu(v: string | null | undefined): string {
  const texte = v?.trim();
  return texte ? texte : "Inconnu";
}

const DATE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** Instant daté en UTC (V6) : la fenêtre de l'écran est UTC, ses lignes aussi. */
export function instantUtc(d: Date | string | null | undefined): string {
  if (d == null) return "—";
  const ms = new Date(d).getTime();
  return Number.isFinite(ms) ? DATE_UTC.format(ms) : "—";
}

/**
 * Instant du rejeu (`?tab=replay&at=<ms>`) : la PREMIÈRE ERREUR de la session,
 * jamais le début de la session. Sans erreur datée, `null` — le lien mène alors
 * au rejeu sans position, plutôt qu'à une position inventée.
 */
export function instantPremiereErreur(ts: string | null): number | null {
  if (!ts) return null;
  const ms = new Date(ts).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Liens d'une ligne du hero, calculés CÔTÉ SERVEUR (aucune fonction en prop) :
 * `panel` mène au panneau de session — à sa page tant que F43 n'existe pas — et
 * `rejeu` au rejeu calé sur la première erreur (`?tab=replay&at=<ms>`).
 *
 * `rejeu` vaut `null` dès que l'existence du rejeu n'est pas LUE et vraie : le
 * composant rend alors « ▶ — » (non lu) ou rien (lu absent), jamais un lien mort.
 */
export function hrefsPriorite(
  lignes: readonly SessionPrioritaire[],
  hrefDePage: Record<string, string>,
): Record<string, { panel: string; rejeu: string | null }> {
  const out: Record<string, { panel: string; rejeu: string | null }> = {};
  for (const s of lignes) {
    const base = hrefDePage[s.session_id];
    if (base === undefined) continue;
    const at = instantPremiereErreur(s.premiere_erreur_ts);
    const sep = base.includes("?") ? "&" : "?";
    out[s.session_id] = {
      panel: base,
      rejeu: s.rejeu === true ? `${base}${sep}tab=replay${at === null ? "" : `&at=${at}`}` : null,
    };
  }
  return out;
}
