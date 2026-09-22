// Séries temporelles : la GRILLE, les trous, le domaine, les bandes (F04, plan § 3.10, § 4.2).
// Logique pure, sans React ni base : importable des deux côtés de la frontière client.
//
// POURQUOI UNE GRILLE. `vitalSeries`, `dailyLcpSeries`, `correlationSeries` ne
// renvoient que les seaux NON VIDES. Passées telles quelles à recharts, deux mesures
// séparées par trois heures sans trafic deviennent deux points voisins, reliés par un
// segment : une évolution qui n'a jamais été mesurée. Toute série est donc posée sur
// la liste des débuts de seau ATTENDUS (`bucketStarts(range)`), et un seau absent y
// reste visible — un TROU pour une mesure (un p75 absent n'est pas un p75 nul), un
// ZÉRO seulement pour un compte (aucune page vue dans le seau, c'est 0 page vue).
//
// POURQUOI ICI ET PAS DANS LE COMPOSANT. `ThresholdSeries` et `StackedBars` sont des
// composants client : une constante exportée d'un module « use client » arrive côté
// serveur comme une RÉFÉRENCE client, pas comme sa valeur. `SERIE_MARGES` sert aussi à
// des SVG rendus serveur (FriseEtats, F56), qui doivent l'importer d'ici.
import { formater, formatDuVital, type FormatId, type VitalName } from "./fmt-ids";
import type { RoleSerie } from "./palette";
import { THRESHOLDS } from "./rating";

/** Au plus cinq séries par graphique (P14) : au-delà, l'appelant passe à un classement. */
export const MAX_SERIES = 5;

/** Effectif sous lequel un seau est un point creux (« moins de 30 mesures »). */
export const FAIBLE_SOUS_DEFAUT = 30;

/**
 * Marges horizontales (px) de la zone de tracé, partagées par `ThresholdSeries`,
 * `StackedBars` et les frises SVG (F56). `gauche` = largeur de l'axe y (la zone de
 * tracé commence exactement là), `droite` = marge droite. Deux panneaux empilés qui
 * les partagent ont le même axe x au pixel près (P5 : panneaux empilés plutôt que
 * double axe).
 */
export const SERIE_MARGES: Readonly<{ gauche: number; droite: number }> = { gauche: 56, droite: 16 };

/** Une série d'une figure temporelle (§ 4.2). Le RÔLE choisit couleur et trait (P15). */
export interface SerieDef {
  /** Clé dans chaque point. */
  cle: string;
  /** « LCP p75 », « Release 1.4.2 », « Période précédente ». */
  libelle: string;
  role: RoleSerie;
  /** Couleur dans CATEGORIELLE si role = "categorie". */
  categorieIndex?: number;
  /** Défaut "ligne" ; "barres" réservé aux comptes (additifs). */
  forme?: "ligne" | "barres";
  /** Défaut false : seau absent de la grille = trou ; true : seau absent = 0. */
  additive?: boolean;
  /** Clé de l'effectif du seau dans chaque point (point creux sous `faibleSous`). */
  effectifCle?: string;
}

/** Un événement posé sur l'axe du temps (§ 3.7) : trait vertical, étiquette, lien. */
export interface Annotation {
  /** Instant ISO UTC. */
  t: string;
  /** « v1.4.2 », « Alerte LCP /checkout ». */
  libelle: string;
  type: "deploiement" | "alerte" | "anomalie" | "rupture";
  /** Déploiement → cmp=release… ; alerte → /alerts?evt=<id>. */
  href?: string;
}

/**
 * Un point d'une série : `t` (un élément de la grille) et une valeur par clé.
 * Le plan écrit `{ t: string } & Record<string, number | null>`, que TypeScript
 * refuse (la clé `t` y serait à la fois texte et nombre) : les valeurs sont donc
 * typées `number | null` ou texte, et lues par `nombreOuNull`.
 */
export type PointSerie = { t: string } & { [cle: string]: string | number | null | undefined };

// ─────────────────────────────── Instants et jours ───────────────────────────────

const JOUR = /^\d{4}-\d{2}-\d{2}$/;

/** Vrai pour une clé de jour « AAAA-MM-JJ » (grille quotidienne découpée dans un fuseau). */
export function estJour(t: string): boolean {
  return JOUR.test(t);
}

/**
 * Instant (ms) d'un début de seau. Une clé de jour vaut son minuit UTC : c'est une
 * ÉTIQUETTE de jour calendaire, comparée à d'autres étiquettes du même fuseau, pas
 * un instant (voir `libelleSeau`). node-postgres rend un `timestamptz` en `Date`,
 * que les lignes typées `bucket: string` transportent en réalité.
 */
export function instantDe(v: string | Date): number {
  return v instanceof Date ? v.getTime() : Date.parse(v);
}

/** Instant ISO UTC sans millisecondes (« 2026-09-22T14:00:00Z »), accepté par le contrat. */
export function isoSansMs(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** La grille d'une plage du contrat, en ISO UTC : `bucketStarts(range).map(grilleIso)`. */
export function grilleIso(starts: number[]): string[] {
  return starts.map(isoSansMs);
}

/** Clé « AAAA-MM-JJ » du jour calendaire d'un instant dans un fuseau. */
export function jourDans(ms: number, fuseau: string): string {
  const parts = formateur("en-CA", fuseau, { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(ms);
  const v = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

/**
 * Les `n` jours calendaires qui finissent aujourd'hui dans `fuseau`, du plus ancien
 * au plus récent — la grille d'une série quotidienne (`dailyTraffic`,
 * `dailyLcpSeries`), qui découpe ses journées dans le fuseau de l'application.
 */
export function joursLocaux(n: number, fuseau: string, maintenant: number): string[] {
  const [a, m, j] = jourDans(maintenant, fuseau).split("-").map(Number);
  return Array.from({ length: n }, (_v, i) => new Date(Date.UTC(a, m - 1, j - (n - 1 - i))).toISOString().slice(0, 10));
}

// ─────────────────────────────────── Alignement ───────────────────────────────────

/**
 * Pose des lignes de seaux sur la grille attendue (§ 4.2, `alignerSeaux`).
 *
 * Rapprochement par instant : `bucket` (ISO ou `Date`) === `starts[i]`. Un seau de
 * la grille sans ligne vaut :
 *   - `null` si `additif` est faux (mesure : un trou, jamais une valeur inventée) ;
 *   - une ligne à ZÉRO si `additif` est vrai : chaque champ numérique connu (lu sur
 *     les lignes reçues) vaut 0, `bucket` porte le début du seau. À réserver aux
 *     lignes dont TOUS les champs sont des comptes ; une ligne qui mêle un compte et
 *     un p75 s'aligne avec `additif: false`, et l'appelant remplace `null` par 0
 *     pour ses seuls champs de compte. Sans aucune ligne reçue, aucun champ n'est
 *     connu : le seau reste `null` (la figure est alors vide, pas nulle).
 * Une ligne hors grille (ou en double) est ignorée et COMPTÉE dans `ignorees`.
 */
export function alignerSeauxDetail<T extends { bucket: string | Date }>(
  rows: T[],
  starts: number[],
  additif: boolean,
): { seaux: (T | null)[]; ignorees: number } {
  const index = new Map<number, number>();
  starts.forEach((s, i) => index.set(s, i));
  const seaux: (T | null)[] = starts.map(() => null);
  let ignorees = 0;
  for (const row of rows) {
    const i = index.get(instantDe(row.bucket));
    if (i === undefined || seaux[i] !== null) {
      ignorees++;
      continue;
    }
    seaux[i] = row;
  }
  if (additif && rows.length > 0) {
    const comptes = Object.keys(rows[0]).filter((k) => k !== "bucket" && typeof rows[0][k as keyof T] === "number");
    seaux.forEach((s, i) => {
      if (s !== null) return;
      const zero: Record<string, unknown> = { bucket: isoSansMs(starts[i]) };
      for (const k of comptes) zero[k] = 0;
      seaux[i] = zero as T;
    });
  }
  return { seaux, ignorees };
}

/** Signature du plan (§ 4.2) : les seaux seuls. `alignerSeauxDetail` donne aussi le compte des lignes ignorées. */
export function alignerSeaux<T extends { bucket: string | Date }>(rows: T[], starts: number[], additif: boolean): (T | null)[] {
  return alignerSeauxDetail(rows, starts, additif).seaux;
}

// ─────────────────────────────── Préparation des points ───────────────────────────────

/** Une valeur lue dans un point : un nombre fini, ou `null` (jamais `NaN`, jamais 0 par défaut). */
export function nombreOuNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Une ligne prête pour recharts : un seau de la grille, une valeur (ou `null`) par clé. */
export type LignePreparee = { t: string } & { [cle: string]: string | number | null };

export interface PointsPrepares {
  /** Une ligne par élément de la grille, dans l'ordre. */
  lignes: LignePreparee[];
  /** Par série : suites continues de valeurs mesurées, `[premier, dernier]` (indices). */
  segments: Record<string, [number, number][]>;
  /** Par série : indices des points CREUX (effectif faible, seau en cours). */
  creux: Record<string, number[]>;
  /** Au moins un point creux pour effectif faible (légende « moins de N mesures »). */
  faibleEffectif: boolean;
  /** Points dont `t` n'est pas dans la grille : ignorés, et comptés (rien ne disparaît en silence). */
  ignores: number;
}

/**
 * Prépare les points d'une `ThresholdSeries` sur sa grille (§ 3.10, § 4.2).
 *
 * - Un seau de la grille sans point : `null` (trou) pour une série non additive,
 *   `0` pour une série `additive` ; un effectif absent vaut 0 (aucune mesure).
 * - Une valeur `null` REÇUE reste `null`, même additive : c'est un inconnu déclaré.
 * - `segments` découpe chaque série en suites continues : `[h0, h2]` sur la grille
 *   `[h0, h1, h2]` donne deux segments `[0,0]` et `[2,2]`, jamais une droite.
 * - Point creux : effectif du seau connu et sous `faibleSous`, ou dernier seau de
 *   la grille encore en cours (`seauEnCours`).
 */
export function preparerPoints(
  grille: string[],
  points: PointSerie[],
  series: SerieDef[],
  options: { faibleSous?: number; seauEnCours?: boolean } = {},
): PointsPrepares {
  const faibleSous = options.faibleSous ?? FAIBLE_SOUS_DEFAUT;
  const parInstant = new Map<number, PointSerie>();
  const instants = new Set(grille.map(instantDe));
  let ignores = 0;
  for (const p of points) {
    const k = instantDe(p.t);
    if (!instants.has(k) || parInstant.has(k)) {
      ignores++;
      continue;
    }
    parInstant.set(k, p);
  }
  const effectifs = new Set(series.map((s) => s.effectifCle).filter((c): c is string => !!c));

  const lignes: LignePreparee[] = grille.map((t) => {
    const p = parInstant.get(instantDe(t));
    const ligne: LignePreparee = { t };
    if (p) for (const [k, v] of Object.entries(p)) if (k !== "t") ligne[k] = nombreOuNull(v);
    for (const c of effectifs) if (!p) ligne[c] = 0;
    for (const s of series) {
      if (!p || p[s.cle] === undefined) ligne[s.cle] = s.additive ? 0 : null;
    }
    return ligne;
  });

  const segments: Record<string, [number, number][]> = {};
  const creux: Record<string, number[]> = {};
  let faibleEffectif = false;
  const dernier = grille.length - 1;
  for (const s of series) {
    const runs: [number, number][] = [];
    let debut = -1;
    lignes.forEach((l, i) => {
      if (l[s.cle] === null) {
        if (debut >= 0) runs.push([debut, i - 1]);
        debut = -1;
      } else if (debut < 0) debut = i;
    });
    if (debut >= 0) runs.push([debut, dernier]);
    segments[s.cle] = runs;

    creux[s.cle] = [];
    lignes.forEach((l, i) => {
      if (l[s.cle] === null) return;
      const n = s.effectifCle ? nombreOuNull(l[s.effectifCle]) : null;
      const faible = n !== null && n < faibleSous;
      if (faible) faibleEffectif = true;
      if (faible || (options.seauEnCours && i === dernier)) creux[s.cle].push(i);
    });
  }
  return { lignes, segments, creux, faibleEffectif, ignores };
}

// ─────────────────────────────── Domaine et bandes ───────────────────────────────

/**
 * Domaine y (§ 4.2) : de 0 à `max(maxDonnées × 1,2, seuilBon × 1,1)` pour un vital
 * (la bande « Bon » reste toujours visible, même quand tout est bon), à
 * `maxDonnées × 1,2` sinon. Une figure sans valeur garde un axe `[0, 1]`.
 * La bande d'incertitude compte dans le maximum : elle ne sort pas du cadre.
 */
export function domaineY(
  lignes: LignePreparee[],
  series: SerieDef[],
  { vital, bande }: { vital?: VitalName; bande?: { basseCle: string; hauteCle: string } } = {},
): [number, number] {
  const cles = [...series.map((s) => s.cle), ...(bande ? [bande.hauteCle] : [])];
  let maxDonnees = 0;
  for (const l of lignes) for (const c of cles) maxDonnees = Math.max(maxDonnees, nombreOuNull(l[c]) ?? 0);
  const bon = vital ? THRESHOLDS[vital][0] : null;
  const haut = Math.max(maxDonnees * 1.2, bon !== null ? bon * 1.1 : 0);
  return [0, haut > 0 ? haut : 1];
}

export interface BandesSeuils {
  bon: { y1: number; y2: number };
  ameliorer: { y1: number; y2: number } | null;
  mauvais: { y1: number; y2: number } | null;
  /** « seuil Mauvais à 4,0 s, hors échelle » quand la borne haute sort du domaine. */
  horsEchelle: string | null;
  /** Bornes lues dans `lib/rating.ts` (P2 : un seul fichier de seuils). */
  seuils: [number, number];
}

/**
 * Les trois zones pleines d'un vital (P2), coupées au haut du domaine. Une borne
 * « Mauvais » au-dessus du domaine n'étire pas l'axe (les données deviendraient
 * illisibles) : elle est DITE, « seuil Mauvais à 4,0 s, hors échelle ».
 */
export function bandesSeuils(vital: VitalName, haut: number): BandesSeuils {
  const seuils = THRESHOLDS[vital];
  const [bon, mauvais] = seuils;
  return {
    bon: { y1: 0, y2: Math.min(bon, haut) },
    ameliorer: bon < haut ? { y1: bon, y2: Math.min(mauvais, haut) } : null,
    mauvais: mauvais < haut ? { y1: mauvais, y2: haut } : null,
    horsEchelle: mauvais > haut ? `seuil Mauvais à ${formater(formatDuVital(vital), mauvais)}, hors échelle` : null,
    seuils,
  };
}

// ─────────────────────────────────── Libellés ───────────────────────────────────

const FORMATEURS = new Map<string, Intl.DateTimeFormat>();

/** Un formateur de dates mis en cache ; un fuseau inconnu retombe sur UTC plutôt que de planter la figure. */
function formateur(locale: string, fuseau: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cle = `${locale}|${fuseau}|${JSON.stringify(opts)}`;
  let f = FORMATEURS.get(cle);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: fuseau });
    } catch {
      f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" });
    }
    FORMATEURS.set(cle, f);
  }
  return f;
}

function jjmm(t: string): string {
  const [, m, j] = t.split("-");
  return `${j}/${m}`;
}

/**
 * Étiquette d'axe d'un seau, dans le fuseau d'affichage : « 14:00 » (seau infra-
 * journalier), « 22/09 12:00 » (seau de 6 h), « 22/09 » (jour). Une clé de jour est
 * écrite telle quelle : c'est déjà un jour du fuseau de l'application.
 */
export function libelleSeau(t: string, seauSecondes: number, fuseau: string): string {
  if (estJour(t)) return jjmm(t);
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) return t;
  const date = { day: "2-digit", month: "2-digit" } as const;
  const heure = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  if (seauSecondes >= 86_400) return formateur("fr-FR", fuseau, date).format(ms);
  if (seauSecondes >= 21_600) return formateur("fr-FR", fuseau, { ...date, ...heure }).format(ms);
  return formateur("fr-FR", fuseau, heure).format(ms);
}

/** Libellé complet d'un seau (infobulle, alternative) : « 22/09 14:00 → 15:00 UTC », « 10/09 ». */
export function libelleSeauComplet(t: string, seauSecondes: number, fuseau: string): string {
  if (estJour(t)) return jjmm(t);
  const debut = Date.parse(t);
  if (!Number.isFinite(debut)) return t;
  const fin = debut + seauSecondes * 1000;
  const complet = formateur("fr-FR", fuseau, {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const finTexte =
    jourDans(debut, fuseau) === jourDans(fin, fuseau)
      ? formateur("fr-FR", fuseau, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(fin)
      : complet.format(fin);
  return `${complet.format(debut)} → ${finTexte} ${fuseau}`;
}

/**
 * Graduation courte de l'axe y : la valeur sans son suffixe long (« 150 » plutôt
 * que « 150 pour 100 », dont l'unité est dans le titre), un compte en milliers au-delà
 * de 10 000, pour tenir dans `SERIE_MARGES.gauche`.
 */
export function formaterAxe(format: FormatId, v: number): string {
  if (format === "pour100" || format === "ratio") return v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (format === "count" && Math.abs(v) >= 10_000) {
    return `${(v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}${String.fromCharCode(0xa0)}k`;
  }
  return formater(format, v);
}

// ───────────────────────────────── Zoom et annotations ─────────────────────────────────

/**
 * Lien de zoom sur un seau (§ 3.3) : `{from}` et `{to}` (brutes ou encodées par
 * `URLSearchParams`) remplacées par les bornes du seau. Le seau en cours s'arrête à
 * la minute passée : le contrat refuse un `to` dans le futur. Une grille de JOURS
 * n'a pas de zoom ici : ses bornes UTC dépendent du fuseau et se calculent côté
 * serveur (`bornesJourLocal`, F05).
 */
export function hrefZoom(gabarit: string, t: string, seauSecondes: number, maintenant?: number): string | null {
  if (estJour(t)) return null;
  const debut = Date.parse(t);
  if (!Number.isFinite(debut)) return null;
  let fin = debut + seauSecondes * 1000;
  if (maintenant !== undefined && fin > maintenant) fin = Math.floor(maintenant / 60_000) * 60_000;
  if (fin <= debut) return null;
  return gabarit
    .replace(/\{from\}|%7Bfrom%7D/gi, encodeURIComponent(isoSansMs(debut)))
    .replace(/\{to\}|%7Bto%7D/gi, encodeURIComponent(isoSansMs(fin)));
}

export interface AnnotationPlacee {
  annotation: Annotation;
  /** Seau de la grille qui contient l'instant. */
  index: number;
  /** Position dans le seau, de 0 (début) à 1 (fin). */
  fraction: number;
}

/**
 * Place chaque annotation dans le seau qui la contient. Hors de la grille, elle est
 * écartée (la lecture des déploiements n'a pas de borne de temps, § 3.7). Sur une
 * grille de jours, l'instant est converti en jour et heure du fuseau d'affichage.
 */
export function placerAnnotations(
  annotations: Annotation[],
  grille: string[],
  seauSecondes: number,
  fuseau: string,
): AnnotationPlacee[] {
  const placees: AnnotationPlacee[] = [];
  const jours = grille.length > 0 && estJour(grille[0]);
  for (const annotation of annotations) {
    const ms = Date.parse(annotation.t);
    if (!Number.isFinite(ms)) continue;
    if (jours) {
      const index = grille.indexOf(jourDans(ms, fuseau));
      if (index < 0) continue;
      const parts = formateur("en-GB", fuseau, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
      const [h, mi] = parts.split(":").map(Number);
      placees.push({ annotation, index, fraction: (h * 60 + mi) / 1440 });
      continue;
    }
    const largeur = seauSecondes * 1000;
    const index = grille.findIndex((t) => {
      const debut = Date.parse(t);
      return ms >= debut && ms < debut + largeur;
    });
    if (index < 0) continue;
    placees.push({ annotation, index, fraction: (ms - Date.parse(grille[index])) / largeur });
  }
  return placees;
}
