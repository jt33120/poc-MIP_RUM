// Vue d'ensemble `/` (F11-F13, plan § 5.1) — logique PURE, testée
// (tests/unit/vue-ensemble.test.ts), sans accès base. L'écran lit, ce module décide
// ce qu'il a le droit d'en écrire : la référence d'un écart, le sous-texte du ratio
// d'erreurs, et les constats automatiques à règle publiée.
import type { ImpactLigne } from "@/components/ImpactTable";
import type { Constat } from "@/components/InsightStrip";
import { formater } from "./fmt-ids";
import { classerParGravite, ecartALaReference, estFaible } from "./impact";
import type { AnomalyRow } from "./health";
import type { AlertFiringRow } from "./queries-v2";
import { verdictDeploiement, type DeployImpact } from "./deploys-verdict";
import { RAISON_MOINS_DE_DEUX_RELEASES, type ChoixReleases } from "./presets";
import type { AnalyticsQuery, ResolvedRange } from "./query-contract";

// ─────────────────────────────── Références (§ 3.12) ───────────────────────────────

const JJMM_HHMM = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const NOM_PRECEDENTE: Record<string, string> = {
  "1h": "heure précédente",
  "24h": "24 h précédentes",
  "7d": "7 jours précédents",
};

/**
 * Référence d'un écart `cmp=prev`, écrite EN TOUTES LETTRES à côté du delta (P4,
 * § 3.12) : « vs 24 h précédentes (20/09 14:00 → 21/09 14:00 UTC) ». La plage est
 * celle de `previousRange` : même durée, immédiatement avant.
 */
export function referencePrecedente(range: Pick<ResolvedRange, "from" | "to" | "preset">): string {
  const from = Date.parse(range.from);
  const to = Date.parse(range.to);
  const debut = new Date(from - (to - from));
  const nom = (range.preset && NOM_PRECEDENTE[range.preset]) ?? "période précédente";
  return `vs ${nom} (${JJMM_HHMM.format(debut)} → ${JJMM_HHMM.format(new Date(from))} UTC)`;
}

/** Référence d'un écart `cmp=release` : même fenêtre, la release A (§ 3.12). */
export function referenceRelease(relA: string): string {
  return `vs release ${relA} (même fenêtre)`;
}

// ─────────────────────── Occurrences d'erreurs pour 100 pages vues ───────────────────────

/**
 * Sous-texte de la tuile « Occurrences d'erreurs pour 100 pages vues » (§ 5.1.2,
 * CP14) : ce que le numérateur laisse de côté, chiffré — seulement ce qui est > 0.
 * La somme `serveur` réunit toute source déclarée hors navigateur (Node, Python,
 * OpenTelemetry, mobile) : elle s'écrit « hors navigateur », pas « serveur » (F10).
 * Sans la colonne de source (v69), le numérateur porte toutes les sources et le dit.
 */
export function lectureErreursPour100(e: {
  restreint: boolean;
  sansSource: number;
  serveur: number;
}): string {
  if (!e.restreint) return "toutes sources : inclut les erreurs serveur sans page vue (colonne de source absente)";
  const exclues = [
    e.sansSource > 0 ? `${formater("count", e.sansSource)} occurrence(s) sans source déclarée` : null,
    e.serveur > 0 ? `${formater("count", e.serveur)} occurrence(s) hors navigateur (serveur, mobile)` : null,
  ].filter((x): x is string => x !== null);
  return exclues.length
    ? `erreurs navigateur seulement ; ${exclues.join(" et ")} non comptée(s)`
    : "erreurs navigateur seulement";
}

// ─────────────────────────────── Releases ───────────────────────────────

/**
 * La requête sans ses conditions de release. `choisirReleases` (F08) doit voir TOUTES
 * les releases de la fenêtre : sous `release=B`, la lecture des versions n'en verrait
 * qu'une et la vue « Nouvelle release vs précédente » se dirait indisponible.
 */
export function sansConditionRelease(query: AnalyticsQuery): AnalyticsQuery {
  const { release: _release, ...reste } = query.filters;
  return { ...query, filters: { ...reste, segments: query.filters.segments.filter((c) => c.dimension !== "release") } };
}

export type ReleasesComparees =
  | { ok: true; relA: string; relB: string; regle: string }
  | { ok: false; raison: string };

/**
 * Releases comparées en `cmp=release` : celles de l'URL (`rel_a`, `rel_b`) quand
 * elles y sont, sinon la règle du § 3.2 (`choisirReleases`, F08), et la règle
 * APPLIQUÉE, écrite sous le titre de chaque comparaison. Moins de deux releases
 * distinctes : pas de comparaison, et sa raison.
 */
export function releasesComparees(
  url: { relA: string | null; relB: string | null },
  choix: ChoixReleases | null,
): ReleasesComparees {
  // Une release manquante dans l'URL est complétée par la règle, dans son ordre
  // (candidate puis référence), sans jamais reprendre celle que l'URL a déjà posée.
  const candidates = [choix?.relB, choix?.relA].filter((v): v is string => !!v);
  const relB = url.relB ?? candidates.find((v) => v !== url.relA) ?? null;
  const relA = url.relA ?? candidates.find((v) => v !== relB) ?? null;
  if (relA === null || relB === null || relA === relB) {
    return { ok: false, raison: choix?.indisponible ?? RAISON_MOINS_DE_DEUX_RELEASES };
  }
  const origine = (v: string, parametre: "rel_a" | "rel_b", deLUrl: boolean) =>
    deLUrl ? `${v} : choisie dans l'URL (${parametre})` : `${v} : complétée par la règle du dernier déploiement`;
  const regle =
    url.relA === null && url.relB === null && choix
      ? choix.regle
      : `${origine(relB, "rel_b", url.relB !== null)} ; ${origine(relA, "rel_a", url.relA !== null)}`;
  return { ok: true, relA, relB, regle };
}

// ─────────────────────── Séries du hero et de « Charge, erreurs et LCP » (F12) ───────────────────────

/** Un seau lu par `vitalSeriesN` : p75 des mesures brutes du seau et son effectif. */
export interface SeauVital {
  bucket: string;
  p75: number | null;
  n: number;
}

/** Les valeurs d'une série indexées par début de seau (ISO UTC sans millisecondes). */
function parSeau<T extends { bucket: string }>(lignes: readonly T[]): Map<number, T> {
  return new Map(lignes.map((l) => [Date.parse(l.bucket), l]));
}

/**
 * Points d'un petit multiple du hero (§ 5.1.2) sur la grille du contrat : `p75` et
 * `n` du seau (un seau absent reste un TROU : `p75: null`, `n: 0`). En `cmp=prev`,
 * la période précédente s'aligne PAR RANG de seau (§ 3.2) : le i-ème seau d'avant
 * face au i-ème seau d'aujourd'hui, même largeur ; au-delà de sa longueur, rien.
 */
export function pointsVital(
  grille: readonly string[],
  courant: readonly SeauVital[],
  precedent?: readonly SeauVital[] | null,
): { t: string; p75: number | null; n: number; precedent?: number | null }[] {
  const lus = parSeau(courant);
  return grille.map((t, i) => {
    const l = lus.get(Date.parse(t));
    const point = { t, p75: l?.p75 ?? null, n: l?.n ?? 0 };
    return precedent ? { ...point, precedent: precedent[i]?.p75 ?? null } : point;
  });
}

/**
 * Points de `cmp=release` (§ 3.2) : la release B (`b`, effectif `nb`) et la
 * référence A (`a`, `na`), deux lectures intersectées sur la MÊME fenêtre.
 */
export function pointsRelease(
  grille: readonly string[],
  b: readonly SeauVital[],
  a: readonly SeauVital[],
): { t: string; b: number | null; nb: number; a: number | null; na: number }[] {
  const lusB = parSeau(b);
  const lusA = parSeau(a);
  return grille.map((t) => {
    const ms = Date.parse(t);
    return { t, b: lusB.get(ms)?.p75 ?? null, nb: lusB.get(ms)?.n ?? 0, a: lusA.get(ms)?.p75 ?? null, na: lusA.get(ms)?.n ?? 0 };
  });
}

/** Une série sans aucune mesure sur la fenêtre : la figure dit « aucune mesure », elle ne dessine pas un axe vide. */
export function serieVide(points: readonly { [cle: string]: unknown }[], cles: readonly string[]): boolean {
  return points.every((p) => cles.every((c) => p[c] == null));
}

export interface PointCharge {
  t: string;
  /** `null` : la lecture des vues a échoué — jamais 0 pour une série non lue. */
  chargements: number | null;
  spa: number | null;
  inconnu: number | null;
  /** Occurrences navigateur ; `null` : lecture en échec. */
  erreurs: number | null;
  /** Occurrences sans source déclarée (hors du panneau, dites) ; `null` : lecture en échec. */
  sansSource: number | null;
  p75: number | null;
  /** Mesures LCP du seau ; `null` : lecture en échec. */
  n: number | null;
}

/**
 * Points des trois panneaux de « Charge, erreurs et LCP » (§ 5.1.2), sur UNE grille :
 * (1) vues de chargement / changements de route SPA / type inconnu (comptes, seau
 * vide = 0), (2) occurrences d'erreurs navigateur (compte), (3) LCP p75 et effectif
 * (mesure, seau vide = trou). Un seau absent d'une lecture de COMPTE vaut 0 ; absent
 * de la lecture du LCP, il reste `null`.
 *
 * UNE LECTURE EN ÉCHEC N'EST PAS UNE SÉRIE VIDE (V3) : passée `null`, ses champs
 * valent `null` dans chaque seau (« — » dans l'alternative, « non lu » en méta),
 * jamais 0 — sinon la figure écrirait « 0 occurrence » sur une fenêtre non lue.
 */
export function pointsCharge(
  grille: readonly string[],
  vues: readonly { bucket: string; chargements: number; spa: number; inconnu: number }[] | null,
  erreurs: readonly { bucket: string; navigateur: number; sansSource?: number }[] | null,
  lcp: readonly SeauVital[] | null,
): PointCharge[] {
  const v = vues ? parSeau(vues) : null;
  const e = erreurs ? parSeau(erreurs) : null;
  const l = lcp ? parSeau(lcp) : null;
  return grille.map((t) => {
    const ms = Date.parse(t);
    return {
      t,
      chargements: v ? (v.get(ms)?.chargements ?? 0) : null,
      spa: v ? (v.get(ms)?.spa ?? 0) : null,
      inconnu: v ? (v.get(ms)?.inconnu ?? 0) : null,
      erreurs: e ? (e.get(ms)?.navigateur ?? 0) : null,
      sansSource: e ? (e.get(ms)?.sansSource ?? 0) : null,
      p75: l ? (l.get(ms)?.p75 ?? null) : null,
      n: l ? (l.get(ms)?.n ?? 0) : null,
    };
  });
}

/** Somme d'une série lue ; `null` si la série n'a pas été lue (une case `null`). */
export function sommeLue(valeurs: readonly (number | null)[]): number | null {
  return valeurs.some((v) => v === null) ? null : valeurs.reduce<number>((a, b) => a + (b ?? 0), 0);
}

// ─────────────────────── Segments les plus dégradés (F13, zone 7) ───────────────────────

/** Vitals que le découpage lit (`vitalsBreakdown` ne porte que LCP, INP, CLS : CP2). */
export const VITAUX_DECOUPES = ["LCP", "INP", "CLS"] as const;
export type VitalDecoupe = (typeof VITAUX_DECOUPES)[number];

export function estVitalDecoupe(v: string | null | undefined): v is VitalDecoupe {
  return (VITAUX_DECOUPES as readonly string[]).includes(v ?? "");
}

/** Une ligne de `vitalsBreakdown` : les trois p75 et leurs effectifs. */
export interface LigneDecoupage {
  valeur: string | null;
  samples: number;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
  lcp_n: number;
  inp_n: number;
  cls_n: number;
}

const P75: Record<VitalDecoupe, "lcp_p75" | "inp_p75" | "cls_p75"> = { LCP: "lcp_p75", INP: "inp_p75", CLS: "cls_p75" };
const N: Record<VitalDecoupe, "lcp_n" | "inp_n" | "cls_n"> = { LCP: "lcp_n", INP: "inp_n", CLS: "cls_n" };

/** « +1,2 s vs ensemble », « −0,012 vs ensemble » : un écart de p75, jamais une contribution. */
function texteEcart(vital: VitalDecoupe, ecart: number): string {
  const signe = ecart > 0 ? "+" : ecart < 0 ? "−" : "±";
  const format = vital === "CLS" ? "cls" : "ms";
  return `${signe}${formater(format, Math.abs(ecart))} vs ensemble`;
}

/**
 * Lignes de l'`ImpactTable` « Segments les plus dégradés » (§ 5.1.2), CLASSÉES
 * côté serveur (P3) : pilote = p75 du vital choisi (`vital=`, défaut LCP), effectif
 * = ses mesures (une ligne sous 30 mesures passe en fin, « échantillon faible »),
 * écart de p75 à l'ensemble ; les trois p75 en colonnes, verdict posé sur chacun
 * (un p75 de vital, R-V). « Inconnu » est un groupe à part, jamais versé ailleurs.
 */
export function lignesSegments(
  rows: readonly LigneDecoupage[],
  opts: {
    vital: VitalDecoupe;
    tri: "gravite" | "volume";
    /** p75 du vital piloté sur toute la population filtrée (`vitalsP75`). */
    ensemble: number | null;
    libelle: (valeur: string | null) => string;
    lien: (valeur: string | null) => string | null;
    description: (valeur: string | null, mesures: number) => string;
  },
): { lignes: ImpactLigne[]; faibles: number } {
  const pilote = (r: LigneDecoupage) => r[P75[opts.vital]];
  const effectif = (r: LigneDecoupage) => r[N[opts.vital]];
  const { lignes, faibles } = classerParGravite(rows, { tri: opts.tri, pilote, effectif, volume: effectif });
  const cle = (v: string | null) => (v === null ? " inconnu" : `v:${v}`);
  return {
    faibles,
    lignes: lignes.map((r) => {
      const ecart = ecartALaReference(pilote(r), opts.ensemble);
      const mesure = (v: VitalDecoupe) => ({
        cle: v.toLowerCase(),
        valeur: r[P75[v]],
        affichage: formater(v === "CLS" ? "cls" : "ms", r[P75[v]]),
        vital: v,
        n: r[N[v]],
      });
      return {
        cle: cle(r.valeur),
        libelle: opts.libelle(r.valeur),
        href: opts.lien(r.valeur),
        description: opts.description(r.valeur, effectif(r)),
        pilote: pilote(r),
        volume: effectif(r),
        mesures: VITAUX_DECOUPES.map(mesure),
        ...(opts.ensemble == null ? {} : { ecart: { valeur: ecart, affichage: ecart == null ? "—" : texteEcart(opts.vital, ecart) } }),
        echantillonFaible: estFaible(effectif(r)),
      };
    }),
  };
}

// ─────────────────────── Heures × route en angle mort (F13, zone 6) ───────────────────────

/**
 * Compte EXACT des heures × route en angle mort (§ 5.1.2, CR9) : le robot dit « ok »
 * et le LCP p75 réel de la même heure est au-delà de la borne Bon (À améliorer ou
 * Mauvais). Lu dans la matrice de `correlationConcordance` (F57), jamais dans
 * `blindSpots`, plafonné à 50 lignes (CP13).
 */
export function heuresAngleMort(cellules: readonly { robot: string; reel: string; heures: number }[]): number {
  return cellules
    .filter((c) => c.robot === "ok" && (c.reel === "needs-improvement" || c.reel === "poor"))
    .reduce((total, c) => total + c.heures, 0);
}

/** La règle d'un angle mort, écrite avec la borne de `lib/rating.ts` (jamais recopiée). */
export function regleAngleMort(borneBon: number): string {
  return `Robot à l'état ok ET LCP p75 réel au-dessus de ${formater("ms", borneBon)} (borne Bon de lib/rating.ts) sur la même heure et la même route.`;
}

// ─────────────────────────────── Constats (§ 5.1.2, zone 4) ───────────────────────────────

/**
 * Les constats d'alerte PAR ÉVÉNEMENT (`/alerts?evt=<id>`) attendaient que
 * `/alerts` sache mettre un événement en évidence (paramètre `evt`, lots F64 et
 * F67). F67 l'a livré : chaque événement porte `id="evt-<id>"` et celui que `evt`
 * désigne est mis en évidence (`aria-current`), donc le lien par événement tient
 * sa promesse. Le repli (UN constat « N alertes non acquittées » → `/alerts`)
 * reste écrit à côté : il redevient vrai si la lecture `alertFirings` échoue.
 */
export const ALERTES_PAR_EVENEMENT = true;

/** Au plus trois alertes nommées, puis « et N autres » (§ 5.1.2). */
export const MAX_ALERTES_NOMMEES = 3;
/** Au plus cinq groupes régressés nommés, puis « et N autres ». */
export const MAX_REGRESSIONS_NOMMEES = 5;

export const REGLE_ANOMALIE = "z-score > 3 sur la moyenne horaire des 7 derniers jours, au moins 5 h d'historique (24 h fixes)";
export const REGLE_ANOMALIE_SOUS_FILTRE =
  "anomalies LCP : non cherchées sous un filtre de population (la détection ne connaît que l'app et la route)";
export const REGLE_DEPLOIEMENT =
  "dernier déploiement : +20 % ou plus sur le LCP p75 ou les occurrences d'erreurs, ±2 h autour du marqueur, filtres de population non appliqués";
export const REGLE_ALERTES = "alertes déclenchées et non acquittées, toutes dates";
/**
 * Règle d'une alerte NOMMÉE (F67) : la source des lignes nommées est
 * `alertFirings(f, 1)`, le jour calendaire UTC en cours — pas « toutes dates ».
 * Le compte, lui, reste celui de `unackedAlertCount` (toutes dates) : c'est lui
 * qui porte le « et N autres », sans quoi une alerte non acquittée d'avant-hier
 * disparaîtrait des constats à minuit UTC.
 */
export const REGLE_ALERTES_NOMMEE =
  "alerte déclenchée et non acquittée, nommée parmi les déclenchements du jour calendaire UTC en cours";
export const REGLE_REGRESSION = "groupe d'erreurs marqué résolu qui réapparaît sur la période";

export const FENETRE_CONSTATS = "anomalies : 24 h fixes ; déploiement : ±2 h ; erreurs : période choisie ; alertes : en cours";

/** Une source de constats lue, ou en échec (sa section le dit, les autres restent). */
export type LuOuEchec<T> = { ok: true; data: T } | { ok: false };

export interface EntreesConstats {
  /** `healthScore(f).anomalies` (24 h fixes) ; `filtrees` : non cherchées sous filtre. */
  anomalies: LuOuEchec<{ lignes: AnomalyRow[]; filtrees: boolean }>;
  /** Dernier déploiement (`latestDeployImpact`) et la version précédente (marqueur d'avant). */
  deploiement: LuOuEchec<{ impact: DeployImpact; versionPrecedente: string | null } | null>;
  /**
   * Alertes non acquittées : un compte (`unackedAlertCount`, repli d'avant F67) ou
   * les événements (`alertFirings(f, 1)`, champs `event_id`, `acknowledged`) AVEC
   * le compte total non acquitté (`unackedAlertCount`, toutes dates) — les lignes
   * nommées viennent du jour UTC en cours, le reste vient du compte.
   */
  alertes: LuOuEchec<
    { mode: "compte"; n: number } | { mode: "evenements"; lignes: AlertFiringRow[]; total: number }
  >;
  /** Groupes d'erreurs régressés de la période (`listErrorGroups`, `regressed`). */
  regresses: LuOuEchec<
    { app_id: string; fingerprint: string; sample_message: string | null; error_type: string | null; occurrences: number }[]
  >;
}

export interface LiensConstats {
  /** Anomalie → `/pages?route=…&from=…&to=…` (l'heure de l'anomalie). */
  anomalie: (a: AnomalyRow) => string;
  /** Déploiement → `?cmp=release&rel_b=v&rel_a=v-1`. */
  deploiement: (relB: string | null, relA: string | null) => string;
  /** `/alerts`, sans identifiant d'événement. */
  alertes: string;
  /** `/alerts?evt=<id>` — jamais `fired=` (§ 3.1). */
  alerte: (eventId: number) => string;
  /** Groupe régressé → `/errors` avec son panneau ouvert (`panel=error:<fp>`, F20). */
  erreur: (g: { app_id: string; fingerprint: string }) => string;
  /** Tous les groupes régressés → `/errors?statut=regressed` (F19), pas seulement en tête de liste. */
  regresses: string;
}

export interface ConstatsCalcules {
  constats: Constat[];
  /** Règles évaluées : citées quand il n'y a aucun constat. */
  regles: string[];
  /** Sources non lues : « Constats partiels » les nomme. */
  echecs: string[];
}

const pct = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v} %`);

/** « 22/09 14:00 UTC » */
function horodatage(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return `${JJMM_HHMM.format(d)} UTC`;
}

function constatDeploiement(
  impact: DeployImpact,
  versionPrecedente: string | null,
  liens: LiensConstats,
): Constat | null {
  const verdict = verdictDeploiement(impact);
  if (verdict.etat !== "regression") return null;
  const signaux = [
    verdict.lcp.regressed ? `LCP p75 ${pct(verdict.lcp.deltaPct)}` : null,
    verdict.erreurs.regressed ? `occurrences d'erreurs ${pct(verdict.erreurs.deltaPct)}` : null,
    verdict.erreursApparues ? `erreurs apparues (0 avant, ${formater("count", impact.errors_after)} après)` : null,
  ].filter((s): s is string => s !== null);
  const nom = impact.version ? `Déploiement ${impact.version}` : "Déploiement sans version";
  // Les effectifs des deux côtés, toujours : un « +40 % » sur 12 pages vues n'est pas
  // celui d'un « +40 % » sur 12 000.
  const effectifs = `${formater("count", impact.pageviews_before)} pages vues avant, ${formater("count", impact.pageviews_after)} après`;
  return {
    type: "regression",
    titre: `${nom} : ${signaux.join(", ")} (${effectifs})`,
    regle: REGLE_DEPLOIEMENT,
    href: liens.deploiement(impact.version, versionPrecedente),
  };
}

function constatsAlertes(
  alertes: { mode: "compte"; n: number } | { mode: "evenements"; lignes: AlertFiringRow[]; total: number },
  liens: LiensConstats,
): Constat[] {
  if (alertes.mode === "compte") {
    if (!(alertes.n > 0)) return [];
    return [
      {
        type: "alerte",
        titre: `${formater("count", alertes.n)} alerte(s) non acquittée(s)`,
        regle: REGLE_ALERTES,
        href: liens.alertes,
      },
    ];
  }
  const ouvertes = alertes.lignes
    .filter((l) => !l.acknowledged)
    .sort((a, b) => new Date(b.fired_at).getTime() - new Date(a.fired_at).getTime());
  const nommees: Constat[] = ouvertes.slice(0, MAX_ALERTES_NOMMEES).map((l) => ({
    type: "alerte",
    titre: `${l.libelle} — déclenchée le ${horodatage(l.fired_at)}`,
    regle: REGLE_ALERTES_NOMMEE,
    href: liens.alerte(l.event_id),
  }));
  // Le reste se compte sur le TOTAL non acquitté (toutes dates), jamais sur les
  // seules lignes du jour : une alerte d'avant-hier compte encore, et le compte
  // reste celui du badge de `/alerts`. Jamais négatif (les deux lectures ne sont
  // pas simultanées).
  const reste = Math.max(0, alertes.total - nommees.length);
  if (reste > 0) {
    // « et N autres » n'a de sens qu'après des alertes NOMMÉES. Rien ne s'est
    // déclenché aujourd'hui alors qu'il en reste d'hier — le cas ordinaire après
    // minuit UTC — donnerait sinon un constat orphelin : « et 3 autres » que quoi ?
    nommees.push({
      type: "alerte",
      titre:
        nommees.length > 0
          ? `et ${formater("count", reste)} autre(s) alerte(s) non acquittée(s)`
          : `${formater("count", reste)} alerte(s) non acquittée(s)`,
      regle: REGLE_ALERTES,
      href: liens.alertes,
    });
  }
  return nommees;
}

/**
 * Constats automatiques de la Vue d'ensemble, dans l'ordre : anomalies, dernier
 * déploiement, alertes, erreurs régressées. Chaque constat porte sa règle et son
 * lien ; une source illisible est NOMMÉE dans `echecs` (jamais un « aucun
 * constat » qui masquerait une lecture en échec).
 */
export function constatsVueEnsemble(e: EntreesConstats, liens: LiensConstats): ConstatsCalcules {
  const constats: Constat[] = [];
  const regles: string[] = [];
  const echecs: string[] = [];

  if (!e.anomalies.ok) {
    echecs.push("anomalies LCP");
    regles.push(REGLE_ANOMALIE);
  } else if (e.anomalies.data.filtrees) {
    regles.push(REGLE_ANOMALIE_SOUS_FILTRE);
  } else {
    regles.push(REGLE_ANOMALIE);
    for (const a of e.anomalies.data.lignes) {
      constats.push({
        type: "anomalie",
        titre: `LCP ${a.route ?? "(toutes routes)"} : ${formater("ms", a.p75)} à ${horodatage(a.bucket)} (moyenne 7 j : ${formater("ms", a.mean_7d)})`,
        regle: `z-score ${a.z_score.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} > 3 sur la moyenne horaire des 7 derniers jours`,
        href: liens.anomalie(a),
      });
    }
  }

  regles.push(REGLE_DEPLOIEMENT);
  if (!e.deploiement.ok) echecs.push("dernier déploiement");
  else if (e.deploiement.data) {
    const c = constatDeploiement(e.deploiement.data.impact, e.deploiement.data.versionPrecedente, liens);
    if (c) constats.push(c);
  }

  regles.push(REGLE_ALERTES);
  if (!e.alertes.ok) echecs.push("alertes non acquittées");
  else constats.push(...constatsAlertes(e.alertes.data, liens));

  regles.push(REGLE_REGRESSION);
  if (!e.regresses.ok) echecs.push("groupes d'erreurs régressés");
  else {
    const groupes = e.regresses.data;
    for (const g of groupes.slice(0, MAX_REGRESSIONS_NOMMEES)) {
      const nom = g.sample_message ?? g.error_type ?? `empreinte ${g.fingerprint.slice(0, 8)}`;
      constats.push({
        type: "regression",
        titre: `Erreur réapparue : ${nom} (${formater("count", g.occurrences)} occurrence(s) sur la période)`,
        regle: REGLE_REGRESSION,
        href: liens.erreur(g),
      });
    }
    const reste = groupes.length - MAX_REGRESSIONS_NOMMEES;
    if (reste > 0) {
      constats.push({
        type: "regression",
        titre: `et ${formater("count", reste)} autre(s) groupe(s) d'erreurs régressé(s)`,
        regle: REGLE_REGRESSION,
        href: liens.regresses,
      });
    }
  }

  return { constats, regles, echecs };
}
