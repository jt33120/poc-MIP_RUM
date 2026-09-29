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
import { accord } from "./format";
import { nomFuseau } from "./fuseau-local";
import { graduationsAxe, type Graduations } from "./graduations";
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
  /** Texte entier quand `libelle` est abrégé (message d'erreur) : infobulle de la légende. */
  libelleComplet?: string;
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
 * Décalage (ms) d'un fuseau à un instant : heure murale moins UTC (+2 h à Paris
 * l'été, +1 h l'hiver). Lu par `Intl`, donc juste aux changements d'heure.
 */
export function decalageFuseau(ms: number, fuseau: string): number {
  const parts = formateur("en-GB", fuseau, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(ms);
  const v = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const mural = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return mural - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant UTC du minuit d'un jour « AAAA-MM-JJ » dans un fuseau. Le décalage est
 * relu À minuit local : le 25/10/2026, minuit à Paris est encore en heure d'été
 * (22:00 UTC la veille), alors que midi du même jour est en heure d'hiver.
 */
export function minuitDans(jour: string, fuseau: string): number {
  const [a, m, j] = jour.split("-").map(Number);
  const naif = Date.UTC(a, m - 1, j);
  const essai = naif - decalageFuseau(naif, fuseau);
  return naif - decalageFuseau(essai, fuseau);
}

// ─────────────────────────────── Fenêtres hors collecte ───────────────────────────────
//
// POURQUOI. Un seau sans ligne vaut 0 pour un compte : « aucune page vue ». C'est vrai
// quand la collecte tournait, FAUX quand elle était coupée (base suspendue du 24 au
// 27/09/2026 : « 0 page vue » trois jours durant). Le registre `collecte_fenetre`
// (lu par `chargeurs/collecte.ts`) date les périodes non nominales ; un seau que
// couvre entièrement une fenêtre `interrompue` n'est plus un zéro mesuré mais un
// « non mesuré » — `null`, hachuré par la figure. Aucune date de panne n'est écrite
// dans le code : elles viennent toutes de la base.

/** Une période où la chaîne de mesure n'était pas nominale (registre `collecte_fenetre`). */
export interface FenetreCollecte {
  /** Instant ISO UTC. */
  debut: string;
  /** Instant ISO UTC ; `null` = en cours. */
  fin: string | null;
  etat: "degradee" | "interrompue";
}

/** Ce que la collecte a été pendant un seau : `interrompue` (entièrement), `partielle`, ou `null` (nominale). */
export type CollecteSeau = "interrompue" | "partielle" | null;

/** Bornes [début, fin) d'un seau de la grille (un jour « AAAA-MM-JJ » est lu dans le fuseau). */
export function bornesSeau(t: string, seauSecondes: number, fuseau: string): [number, number] | null {
  if (estJour(t)) {
    const suivant = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10)) + 1))
      .toISOString()
      .slice(0, 10);
    return [minuitDans(t, fuseau), minuitDans(suivant, fuseau)];
  }
  const debut = Date.parse(t);
  if (!Number.isFinite(debut)) return null;
  return [debut, debut + seauSecondes * 1000];
}

interface Intervalle {
  a: number;
  b: number;
  etat: FenetreCollecte["etat"];
}

function intervallesDe(fenetres: readonly FenetreCollecte[]): Intervalle[] {
  return fenetres
    .map((f) => ({ a: Date.parse(f.debut), b: f.fin === null ? Number.POSITIVE_INFINITY : Date.parse(f.fin), etat: f.etat }))
    .filter((i) => Number.isFinite(i.a) && !Number.isNaN(i.b) && i.b > i.a);
}

/** Union d'intervalles triés : deux fenêtres qui se chevauchent (plateforme et app) ne comptent pas double. */
function fusionner(intervalles: Intervalle[]): Intervalle[] {
  const tries = [...intervalles].sort((x, y) => x.a - y.a);
  const union: Intervalle[] = [];
  for (const i of tries) {
    const dernier = union[union.length - 1];
    if (dernier && i.a <= dernier.b) dernier.b = Math.max(dernier.b, i.b);
    else union.push({ ...i });
  }
  return union;
}

/**
 * État de la collecte de chaque seau de la grille. Un seau est `interrompue` quand
 * des fenêtres `interrompue` couvrent TOUTE sa part écoulée (le seau en cours
 * s'arrête à `maintenant`) ; `partielle` quand une fenêtre le recoupe sans le
 * couvrir, ou qu'une fenêtre `degradee` le touche ; `null` sinon.
 */
export function collecteDesSeaux(
  grille: string[],
  seauSecondes: number,
  fenetres: readonly FenetreCollecte[],
  { fuseau = "UTC", maintenant = Date.now() }: { fuseau?: string; maintenant?: number } = {},
): CollecteSeau[] {
  if (fenetres.length === 0) return grille.map(() => null);
  const toutes = intervallesDe(fenetres);
  const interrompues = fusionner(toutes.filter((i) => i.etat === "interrompue"));
  return grille.map((t) => {
    const bornes = bornesSeau(t, seauSecondes, fuseau);
    if (!bornes) return null;
    const a = bornes[0];
    const b = Math.min(bornes[1], maintenant);
    if (b <= a) return null;
    let couvert = 0;
    for (const i of interrompues) couvert += Math.max(0, Math.min(b, i.b) - Math.max(a, i.a));
    if (couvert >= b - a) return "interrompue";
    if (couvert > 0 || toutes.some((i) => i.a < b && i.b > a)) return "partielle";
    return null;
  });
}

/** Les fenêtres qui recoupent la grille, dans l'ordre : celles que la légende nomme. */
export function fenetresDeLaGrille(
  fenetres: readonly FenetreCollecte[],
  grille: string[],
  seauSecondes: number,
  fuseau: string,
): FenetreCollecte[] {
  if (grille.length === 0) return [];
  const premier = bornesSeau(grille[0], seauSecondes, fuseau);
  const dernier = bornesSeau(grille[grille.length - 1], seauSecondes, fuseau);
  if (!premier || !dernier) return [];
  return fenetres
    .filter((f) => {
      const a = Date.parse(f.debut);
      const b = f.fin === null ? Number.POSITIVE_INFINITY : Date.parse(f.fin);
      return a < dernier[1] && b > premier[0];
    })
    .sort((x, y) => Date.parse(x.debut) - Date.parse(y.debut));
}

/**
 * La fenêtre, dite : « Collecte interrompue du 24/09 05:28 au 27/09 21:44 (heure de
 * Paris) », « Collecte dégradée depuis le 29/09 14:30 (heure de Paris) ».
 */
export function texteFenetreCollecte(f: FenetreCollecte, fuseau: string): string {
  const quand = formateur("fr-FR", fuseau, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const nom = nomFuseau(fuseau);
  const suffixe = nom === "UTC" ? nom : `(${nom})`;
  const etat = f.etat === "interrompue" ? "Collecte interrompue" : "Collecte dégradée";
  const debut = quand.format(Date.parse(f.debut));
  if (f.fin === null) return `${etat} depuis le ${debut} ${suffixe}`;
  return `${etat} du ${debut} au ${quand.format(Date.parse(f.fin))} ${suffixe}`;
}

/** Suites continues d'indices dans un état donné : `[premier, dernier]`, pour une zone hachurée par suite. */
export function suitesDeSeaux(collecte: readonly CollecteSeau[], etat: Exclude<CollecteSeau, null>): [number, number][] {
  const suites: [number, number][] = [];
  let debut = -1;
  collecte.forEach((c, i) => {
    if (c === etat) {
      if (debut < 0) debut = i;
    } else if (debut >= 0) {
      suites.push([debut, i - 1]);
      debut = -1;
    }
  });
  if (debut >= 0) suites.push([debut, collecte.length - 1]);
  return suites;
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
 *
 * `collecte` (aligné sur `starts`, `collecteDesSeaux`) : un seau `interrompue` sans
 * ligne reste `null` même en `additif` — la collecte était coupée, ce n'est pas 0.
 */
export function alignerSeauxDetail<T extends { bucket: string | Date }>(
  rows: T[],
  starts: number[],
  additif: boolean,
  collecte?: readonly CollecteSeau[],
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
      if (s !== null || collecte?.[i] === "interrompue") return;
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
  /** Indices des seaux « non mesurés » : collecte interrompue sur tout le seau (hachurés). */
  horsCollecte: number[];
  /** Indices des seaux à collecte partielle ou dégradée (valeur gardée, point creux). */
  collectePartielle: number[];
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
 *   la grille encore en cours (`seauEnCours`), ou seau à collecte partielle.
 * - `collecte` (aligné sur la grille, `collecteDesSeaux`) : dans un seau
 *   `interrompue`, un 0 ou une absence devient `null` — « non mesuré », même pour
 *   un compte. Une valeur non nulle reçue est gardée (des lignes sont arrivées :
 *   la collecte n'était pas coupée pour elles), en point creux.
 */
export function preparerPoints(
  grille: string[],
  points: PointSerie[],
  series: SerieDef[],
  options: { faibleSous?: number; seauEnCours?: boolean; collecte?: readonly CollecteSeau[] } = {},
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

  const collecte = options.collecte ?? [];
  const horsCollecte: number[] = [];
  const collectePartielle: number[] = [];
  const lignes: LignePreparee[] = grille.map((t, i) => {
    const p = parInstant.get(instantDe(t));
    const ligne: LignePreparee = { t };
    if (p) for (const [k, v] of Object.entries(p)) if (k !== "t") ligne[k] = nombreOuNull(v);
    for (const c of effectifs) if (!p) ligne[c] = 0;
    for (const s of series) {
      if (!p || p[s.cle] === undefined) ligne[s.cle] = s.additive ? 0 : null;
    }
    if (collecte[i] === "interrompue") {
      let garde = false;
      for (const s of series) {
        if (ligne[s.cle] === 0) ligne[s.cle] = null;
        if (ligne[s.cle] !== null) garde = true;
      }
      if (garde) collectePartielle.push(i);
      else horsCollecte.push(i);
    } else if (collecte[i] === "partielle") collectePartielle.push(i);
    return ligne;
  });
  const partielle = new Set(collectePartielle);

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
      if (faible || (options.seauEnCours && i === dernier) || partielle.has(i)) creux[s.cle].push(i);
    });
  }
  return { lignes, segments, creux, faibleEffectif, ignores, horsCollecte, collectePartielle };
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

/**
 * Échelle y d'une figure temporelle, en graduations RONDES (recette du 26/09/2026) :
 * le haut de l'axe est le maximum des données arrondi vers le haut à un pas rond
 * (`graduationsAxe`), l'axe part de 0. La marge × 1,2 de `domaineY` n'est plus
 * nécessaire : l'arrondi au pas rond en donne une.
 *
 * UN VITAL SE CALE AUSSI SUR SES DONNÉES (recette du 26/09/2026). L'axe montait
 * jusqu'à `seuilBon × 1,1` pour garder « À améliorer » visible : un LCP à 92 ms
 * s'écrasait sur l'axe, sous une échelle de 0 à 2,8 s. La bande de seuil reste
 * dessinée là où elle tombe (toute la hauteur quand tout est « Bon »), et la borne
 * hors échelle est écrite sous la figure (`bandesSeuils`). Sans aucune donnée,
 * l'axe garde la bande « Bon » entière.
 */
export function echelleY(
  lignes: LignePreparee[],
  series: SerieDef[],
  format: FormatId,
  { vital, bande, empile = false }: { vital?: VitalName; bande?: { basseCle: string; hauteCle: string }; empile?: boolean } = {},
): Graduations {
  let maxDonnees = 0;
  for (const l of lignes) {
    if (empile) {
      // Des barres empilées montent jusqu'à la SOMME des segments du seau.
      maxDonnees = Math.max(maxDonnees, series.reduce((a, s) => a + Math.max(nombreOuNull(l[s.cle]) ?? 0, 0), 0));
      continue;
    }
    for (const c of [...series.map((s) => s.cle), ...(bande ? [bande.hauteCle] : [])]) {
      maxDonnees = Math.max(maxDonnees, nombreOuNull(l[c]) ?? 0);
    }
  }
  const bon = vital ? THRESHOLDS[vital][0] : null;
  return graduationsAxe(maxDonnees > 0 ? maxDonnees : bon !== null ? bon * 1.1 : 0, format);
}

export interface BandesSeuils {
  bon: { y1: number; y2: number };
  ameliorer: { y1: number; y2: number } | null;
  mauvais: { y1: number; y2: number } | null;
  /**
   * « seuil Mauvais à 4,0 s, hors échelle » quand la borne haute sort du domaine ;
   * « seuil À améliorer à 2,5 s et seuil Mauvais à 4,0 s, hors échelle » quand
   * tout le domaine est « Bon » (échelle calée sur des données toutes bonnes).
   */
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
    horsEchelle:
      bon >= haut
        ? `seuil À améliorer à ${formater(formatDuVital(vital), bon)} et seuil Mauvais à ${formater(formatDuVital(vital), mauvais)}, hors échelle`
        : mauvais > haut
          ? `seuil Mauvais à ${formater(formatDuVital(vital), mauvais)}, hors échelle`
          : null,
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

/**
 * Libellé complet d'un seau (infobulle, alternative) : « 22/09 14:00 → 15:00
 * (heure de Paris) », « 10/09 ». Le fuseau est NOMMÉ (`nomFuseau`), pas écrit en
 * identifiant IANA.
 */
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
  const nom = nomFuseau(fuseau);
  return `${complet.format(debut)} → ${finTexte} ${nom === "UTC" ? nom : `(${nom})`}`;
}

/** Pas candidats d'une graduation temporelle, en secondes : des heures rondes. */
const PAS_TEMPS = [300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, 86_400] as const;

/** Secondes écoulées depuis minuit, dans le fuseau d'affichage. */
function secondesDuJour(ms: number, fuseau: string): number {
  const [h, mi] = formateur("en-GB", fuseau, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(ms)
    .split(":")
    .map(Number);
  return h * 3600 + mi * 60;
}

/**
 * Graduations de l'axe du temps : des éléments de la grille à intervalle RÉGULIER
 * et sur des heures RONDES (« 00:00, 03:00, 06:00… ») — jamais « 03:00 → 12:00 →
 * 17:00 », que donnait le choix de recharts (garder le premier et le dernier seau,
 * boucher entre les deux). Au plus `cible` graduations ; le composant les passe à
 * recharts avec `interval="equidistantPreserveStart"`, qui en saute un nombre
 * CONSTANT quand la largeur manque (390 px) : le pas reste régulier.
 *
 *   - seaux infra-journaliers : le plus petit pas rond (5 min … 24 h), multiple du
 *     seau, qui donne au plus `cible` graduations ; une graduation tombe sur un
 *     multiple de ce pas depuis minuit, dans le fuseau d'affichage ;
 *   - jours : un jour sur 1, 2 ou 7 (les lundis), 14 au-delà.
 */
export function graduationsTemps(grille: string[], seauSecondes: number, fuseau: string, cible = 8): string[] {
  if (grille.length <= 2) return [...grille];
  if (estJour(grille[0]) || seauSecondes >= 86_400) {
    const pas = [1, 2, 7, 14, 28].find((p) => Math.ceil(grille.length / p) <= cible) ?? Math.ceil(grille.length / cible);
    if (pas === 7 && estJour(grille[0])) {
      const lundis = grille.filter((t) => new Date(`${t}T00:00:00Z`).getUTCDay() === 1);
      if (lundis.length >= 2) return lundis;
    }
    // Le dernier jour (aujourd'hui) est une graduation : on compte à rebours depuis lui.
    const depart = (grille.length - 1) % pas;
    return grille.filter((_t, i) => i >= depart && (i - depart) % pas === 0);
  }
  // Durée couverte par les débuts de seau (24 h pour une grille glissante de 25 heures).
  const duree = (grille.length - 1) * seauSecondes;
  const pas = PAS_TEMPS.find((p) => p >= seauSecondes && p % seauSecondes === 0 && duree / p <= cible);
  if (pas !== undefined) {
    const alignees = grille.filter((t) => {
      const ms = Date.parse(t);
      return Number.isFinite(ms) && secondesDuJour(ms, fuseau) % pas === 0;
    });
    if (alignees.length >= 2) return alignees;
  }
  // Grille non alignée sur des heures rondes : un seau sur k, depuis le premier.
  const k = Math.max(1, Math.ceil(grille.length / cible));
  return grille.filter((_t, i) => i % k === 0);
}

/**
 * Le seau en cours, dit en français : « heure en cours (incomplète) », « jour en
 * cours (incomplet) »… Le mot « seau » (traduction de *bucket*) ne s'affiche plus :
 * la recette l'a trouvé obscur partout où il apparaissait.
 */
export function libellePeriodeEnCours(seauSecondes: number, jours = false): string {
  if (jours || seauSecondes === 86_400) return "jour en cours (incomplet)";
  if (seauSecondes === 3600) return "heure en cours (incomplète)";
  if (seauSecondes === 604_800) return "semaine en cours (incomplète)";
  if (seauSecondes === 60) return "minute en cours (incomplète)";
  return "période en cours (incomplète)";
}

/**
 * Indice du premier seau porteur de données quand SEULS les deux derniers seaux en
 * ont (une collecte qui vient de commencer), `null` sinon. Une valeur additive à 0
 * n'est pas une donnée (aucun événement) ; une mesure `null` non plus. Sous six
 * seaux, la figure n'est pas « vide en pratique » : `null`.
 *
 * POURQUOI. Avec 20 minutes de collecte, les six graphiques 24 h de la vue
 * d'ensemble n'avaient qu'une barre pâle collée à droite de 23 heures vides : ils
 * étaient vides en pratique, et ressemblaient à un espace réservé.
 */
export function premiereDonneeTardive(lignes: LignePreparee[], cles: string[]): number | null {
  if (lignes.length < 6) return null;
  const premier = lignes.findIndex((l) =>
    cles.some((c) => {
      const v = nombreOuNull(l[c]);
      return v !== null && v !== 0;
    }),
  );
  if (premier < 0) return null;
  return premier >= lignes.length - 2 ? premier : null;
}

/** Nombre de tranches de la grille où au moins une des séries `cles` porte une valeur. */
export function tranchesMesurees(lignes: LignePreparee[], cles: string[]): number {
  if (cles.length === 0) return 0;
  return lignes.filter((l) => cles.some((c) => nombreOuNull(l[c]) !== null)).length;
}

/** Le nom d'une tranche et son genre : « heure » (f.), « jour » (m.)… */
function nomDeTranche(seauSecondes: number, jours: boolean): { nom: string; masculin: boolean } {
  if (jours || seauSecondes === 86_400) return { nom: "jour", masculin: true };
  if (seauSecondes === 3600) return { nom: "heure", masculin: false };
  if (seauSecondes === 604_800) return { nom: "semaine", masculin: false };
  if (seauSecondes === 60) return { nom: "minute", masculin: false };
  return { nom: "tranche", masculin: false };
}

/** « Une seule heure mesurée », « Deux jours mesurés » : ce que dit une figure presque vide. */
export function phrasePeuDePoints(n: number, seauSecondes: number, jours = false): string {
  const { nom, masculin } = nomDeTranche(seauSecondes, jours);
  const mesure = masculin ? "mesuré" : "mesurée";
  if (n <= 1) return `${masculin ? "Un seul" : "Une seule"} ${nom} ${mesure} sur la période`;
  return `${n === 2 ? "Deux" : n.toLocaleString("fr-FR")} ${nom}s ${mesure}s sur la période`;
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

/** Des annotations assez proches sur l'axe pour partager UNE étiquette. */
export interface GroupeAnnotations {
  /** Abscisse (px) de l'étiquette : celle de la première annotation du groupe. */
  x: number;
  /** Abscisses (px) de chaque annotation : chaque trait reste à son instant. */
  xs: number[];
  annotations: Annotation[];
  /** « v1.4.2 » seule ; « 3 alertes à 14:14 » pour un groupe. */
  libelle: string;
  /** Le lien de l'annotation seule, ou celui que partage tout le groupe. */
  href?: string;
}

const NOMS_TYPE: Record<Annotation["type"], [string, string]> = {
  deploiement: ["déploiement", "déploiements"],
  alerte: ["alerte", "alertes"],
  anomalie: ["anomalie", "anomalies"],
  rupture: ["rupture", "ruptures"],
};

/**
 * Regroupe les annotations qui tomberaient à moins de `ecart` px l'une de l'autre
 * (distance à la PREMIÈRE du groupe : un groupe ne s'étire pas de proche en proche).
 * Un groupe a une seule étiquette — « 3 alertes à 14:14 », « 2 alertes (14:14–14:40) »,
 * « 3 événements » s'ils sont de types différents — et le détail reste dans
 * l'infobulle et la légende. Avant, trois alertes simultanées écrivaient leurs trois
 * libellés au même endroit : « Alerte eAlerte log_errors… ».
 */
export function regrouperAnnotations(
  positions: { annotation: Annotation; x: number }[],
  { ecart, fuseau }: { ecart: number; fuseau: string },
): GroupeAnnotations[] {
  const tries = positions.filter((p) => Number.isFinite(p.x)).sort((a, b) => a.x - b.x);
  const groupes: { annotation: Annotation; x: number }[][] = [];
  for (const p of tries) {
    const dernier = groupes[groupes.length - 1];
    if (dernier && p.x - dernier[0].x <= ecart) dernier.push(p);
    else groupes.push([p]);
  }
  const heure = (ms: number) => formateur("fr-FR", fuseau, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  return groupes.map((g) => {
    const annotations = g.map((p) => p.annotation);
    const xs = g.map((p) => p.x);
    if (g.length === 1) return { x: g[0].x, xs, annotations, libelle: annotations[0].libelle, href: annotations[0].href };
    const types = new Set(annotations.map((a) => a.type));
    const [sing, plur] = types.size === 1 ? NOMS_TYPE[annotations[0].type] : ["événement", "événements"];
    const instants = annotations.map((a) => Date.parse(a.t)).filter(Number.isFinite).sort((a, b) => a - b);
    let quand = "";
    if (instants.length > 0) {
      const debut = instants[0];
      const fin = instants[instants.length - 1];
      if (jourDans(debut, fuseau) !== jourDans(fin, fuseau)) {
        quand = ` (${jjmm(jourDans(debut, fuseau))}–${jjmm(jourDans(fin, fuseau))})`;
      } else {
        const [hd, hf] = [heure(debut), heure(fin)];
        quand = hd === hf ? ` à ${hd}` : ` (${hd}–${hf})`;
      }
    }
    const hrefs = new Set(annotations.map((a) => a.href));
    const href = hrefs.size === 1 ? annotations[0].href : undefined;
    return { x: g[0].x, xs, annotations, libelle: `${g.length} ${accord(g.length, sing, plur)}${quand}`, href };
  });
}
