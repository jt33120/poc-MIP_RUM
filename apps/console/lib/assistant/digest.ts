// LE CONDENSÉ DU TABLEAU DE BORD — ce que l'assistant a le droit de dire (30/09/2026).
//
// L'assistant de la Vue d'ensemble répond à partir de FAITS, pas de la base : chaque
// fait est un chiffre que l'écran a déjà lu et déjà affiché (santé, cases, constats,
// segments classés, release, historique…), avec son libellé, sa valeur écrite comme
// l'écran l'écrit (unité comprise) et l'endroit de la page qui le montre. Un fait porte
// un identifiant (« F1 »…) : une réponse cite ses sources par ces identifiants, et un
// clic sur une source fait défiler la page jusqu'à cet endroit et le surligne.
//
// AUCUNE REQUÊTE DE PLUS. `construireDigestVueEnsemble` ne reçoit que des valeurs déjà
// lues par la page (`app/page.tsx`) : l'assistant ne coûte aucune lecture, et ne peut
// pas dire autre chose que ce que l'écran montre.
//
// AUCUNE DONNÉE PERSONNELLE. Des agrégats et des routes normalisées par le capteur ;
// jamais un identifiant de visiteur ni une adresse IP. Les deux textes venus d'ailleurs
// (message d'une erreur réapparue, nom d'une alerte) passent par `masque.ts`.
//
// DES CIBLES QUI EXISTENT DÉJÀ. Chaque fait vise un repère que la page porte déjà
// (`#sante`, `[data-testid="tuile-LCP"]`, `#constats`…) ; un fait dont l'élément peut
// manquer (vignette d'un onglet fermé, ligne d'une liste repliée) porte un `repli`.
import type { ImpactLigne } from "@/components/ImpactTable";
import type { Constat, TypeConstat } from "@/components/InsightStrip";
import type { ReleaseStats } from "@/components/ReleaseCompare";
import type { EtatAngleMort } from "@/components/vue-ensemble/AngleMort";
import type { EtatConstatsDetectes } from "@/components/vue-ensemble/ConstatsDetectes";
import type { CouverturePrecedente } from "@/lib/comparaison";
import type { Heatmap } from "@/lib/heatmap-latence";
import type { Ecart, IntervalleP75 } from "@mip/stats/incertitude";
import { BREAKDOWN_LABELS, type BreakdownDimension } from "@/lib/breakdowns";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { entreGuillemets, fmtBorne, fmtInstant, pluriel } from "@/lib/format";
import { MESURES_MIN_COLONNE } from "@/lib/heatmap-latence";
import { RATING_LABEL, THRESHOLDS, rating2026, type Rating } from "@/lib/rating";
import { lireVital, texteVerdict, type VerdictVital } from "@/lib/vital-lecture";
import { borner, texteSur } from "./masque";

// ───────────────────────────────── Le condensé ─────────────────────────────────

/** Le ton d'un fait qui porte un verdict : il ordonne la réponse, il ne colore rien. */
export type TonFait = "bon" | "moyen" | "mauvais" | "neutre";

export interface FaitDigest {
  /** « F1 », « F2 »… : ce qu'une réponse cite. */
  id: string;
  /** Le domaine du fait : « Santé », « Trafic », « Web Vitals », « Constats »… */
  categorie: string;
  libelle: string;
  /** La valeur, écrite comme l'écran l'écrit : nombre ET unité (« 2,7 s », « 1 240 sessions »). */
  valeur: string;
  /** Verdict, intervalle, effectif, variation, règle : ce que la fenêtre de la case dit en plus. */
  detail?: string;
  /** Sélecteur CSS de l'élément de la page qui montre ce fait. */
  cible: string;
  /** Sélecteur de repli, quand l'élément visé peut manquer (onglet fermé, liste repliée). */
  repli?: string;
  /** Clé stable (« sante », « tuile:LCP », « segment:route:1 ») : la réponse par règles choisit ses faits par elle. */
  cle: string;
  ton?: TonFait;
  /** Le verdict en mots, tel que la case le porte (« Mauvais », « À améliorer ou Mauvais, incertain »). */
  verdict?: string;
  /** La variation telle que l'écran l'écrit (« +12 % vs 24 h précédentes », « +1,2 s vs ensemble »). */
  variation?: string;
  /** Variation affichée par la case, en % signé contre sa référence. */
  ecartPct?: number;
  /** La variation va dans le mauvais sens (au-delà de ±2 %, écart établi). Absent : sans objet. */
  degradation?: boolean;
  /** Ordre d'importance dans sa catégorie (points perdus par une composante de la santé…). */
  poids?: number;
}

export interface Digest {
  version: 1;
  ecran: string;
  /** L'application lue ; `null` : toutes celles du périmètre. */
  app: string | null;
  /** « 24 dernières heures », « 7 derniers jours »… */
  periode: string;
  /** Instant de la lecture, ISO. */
  genereLe: string;
  faits: FaitDigest[];
}

/** Au-delà, le condensé enverrait plus qu'il n'en faut (et la route le refuserait). */
export const MAX_FAITS = 120;
/** Poids maximal du condensé sérialisé : la route accepte 32 Kio, question comprise. */
export const MAX_OCTETS_DIGEST = 24 * 1024;

const BORNES = { libelle: 110, valeur: 140, detail: 240 } as const;

// ─────────────────────────── Ce que la page a déjà lu ───────────────────────────

/** Les propriétés d'une case que le condensé lit : un sous-ensemble de celles de `KpiTile`. */
export interface ProprietesCase {
  label: string;
  valeur: number | null;
  format: FormatId;
  raisonNull?: string;
  vital?: VitalName;
  precedent?: number | null;
  reference?: string;
  couverturePrecedente?: CouverturePrecedente;
  sensMeilleur?: "bas" | "haut" | "neutre";
  couverture?: { n: number | null; unite: string; faibleSous?: number };
  intervalle?: IntervalleP75;
  ecart?: Ecart | null;
  lecture?: string;
}

/** Une case de la grille, ou l'échec de sa lecture (forme de `Tuile` dans `app/page.tsx`). */
export type CaseLue = { cle: string; titre: string } & ({ props: ProprietesCase } | { echec: true });

export interface SanteLue {
  score: number | null;
  label: string | null;
  factors: readonly { key: string; label: string; detail: string; earned: number | null; max: number; raisonNull?: string }[];
}

type Lu<T> = { readonly ok: true; readonly data: T } | { readonly ok: false };

export interface EntreesDigest {
  app: string | null;
  periode: string;
  /** Instant de la lecture (ms) ; défaut : maintenant. */
  maintenant?: number;
  /** Présente si la case de santé est affichée ; `"echec"` : sa lecture a échoué. */
  sante?: SanteLue | "echec" | null;
  /** Les cases trafic, erreurs et Web Vitals, dans l'ordre de la grille. */
  cases?: readonly CaseLue[];
  /** Les petits multiples du graphique principal (LCP, INP, CLS), s'il est affiché. */
  series?: readonly { vital: VitalName; lu: Lu<readonly { bucket: string; p75: number | null; n: number }[]> }[] | null;
  /**
   * La datation d'une rupture du LCP sur 14 jours, écrite sous le graphique principal.
   * `datable: false` : pas assez de jours mesurés pour tenter la datation (sa phrase le dit).
   */
  datation?: { phrase: string; datable: boolean; rupture: { jour: string; sens: "hausse" | "baisse" } | null } | null;
  constats?: {
    liste: readonly Constat[];
    echecs: readonly string[];
    detectes: EtatConstatsDetectes;
    /** La colonne `#constats` est-elle rendue ? (elle se tait quand il n'y a rien.) */
    affiches: boolean;
  } | null;
  anomalies?: {
    lignes: readonly { route: string | null; bucket: Date | string; p75: number; mean_7d: number; z_score: number }[];
    filtrees: boolean;
  } | null;
  segments?: {
    dimension: BreakdownDimension;
    vital: "LCP" | "INP" | "CLS";
    lignes: readonly ImpactLigne[];
    /** p75 du vital sur toute la population filtrée. */
    ensemble: number | null;
    groupes: number;
  } | null;
  release?: { a: ReleaseStats; b: ReleaseStats; regle: string } | null;
  historique?: readonly { day: string; hour: number; good_w: number; total_w: number }[] | null;
  angleMort?: EtatAngleMort | null;
  latence?: Heatmap | null;
  charge?: {
    vues: readonly { bucket: string; chargements: number; spa: number; inconnu: number }[] | null;
    erreurs: readonly { bucket: string; navigateur: number }[] | null;
  } | null;
  sansVisite?: { titre: string; detail: string } | null;
  /** Le dernier déploiement, écrit dans le bandeau « En bref » ; `"echec"` : non lu. */
  deploiement?: { version: string | null; ts: Date | string } | "echec" | null;
}

// ─────────────────────────────── Outils d'écriture ───────────────────────────────

const NBSP = String.fromCharCode(0xa0);
const TON_DU_RATING: Record<Rating, TonFait> = { good: "bon", "needs-improvement": "moyen", poor: "mauvais" };
/** Sous ±2 %, une variation est « stable » : la règle de `KpiTile`. */
const SEUIL_STABLE_PCT = 2;
const FAIBLE_SOUS_DEFAUT = 100;

/** La valeur d'une case telle que la case l'écrit : « pour 100 » devient « % » (recette du 30/09/2026). */
export function valeurDeCase(format: FormatId, valeur: number | null, unite = ""): string {
  if (valeur == null || !Number.isFinite(valeur)) return "—";
  const brute = formater(format, valeur);
  if (format === "pour100") return brute.replace(/[\s  ]pour[\s  ]100$/, `${NBSP}%`);
  return unite ? `${brute}${NBSP}${unite}` : brute;
}

/** Unité d'une case de compte : sans elle, « 1 240 » ne dit pas ce qu'il compte. */
const UNITE_CASE: Record<string, string> = { sessions: "sessions", "pages-vues": "pages vues" };

function categorieDeCase(cle: string): string {
  if (cle === "sessions" || cle === "pages-vues") return "Trafic";
  if (cle === "erreurs") return "Erreurs";
  return "Web Vitals";
}

/**
 * Le ton d'un verdict de Web Vital. Un verdict INCERTAIN dont la borne basse n'est
 * déjà pas « Bon » (« entre À améliorer et Mauvais ») est hors du vert à coup sûr :
 * il compte comme « À améliorer ». Taire le LCP parce que son intervalle chevauche
 * deux mauvais verdicts ferait passer la pire mesure pour une bonne.
 */
function tonDuVerdict(v: VerdictVital | null): TonFait | undefined {
  if (v?.kind === "etabli") return TON_DU_RATING[v.rating];
  if (v?.kind === "incertain" && v.de !== "good") return "moyen";
  return undefined;
}

/** Le verdict en mots, court : « Mauvais », « À améliorer ou Mauvais, incertain », « non établi ». */
function motVerdict(v: VerdictVital | null): string | undefined {
  if (!v) return undefined;
  if (v.kind === "etabli") return RATING_LABEL[v.rating];
  if (v.kind === "incertain") return `${RATING_LABEL[v.de]} ou ${RATING_LABEL[v.a]}, incertain`;
  return "verdict non établi";
}

/** « 26/09/2026 » d'une clé de jour « AAAA-MM-JJ » (étiquette, lue sans fuseau). */
function jourLong(jour: string): string {
  const [a, m, j] = jour.split("-");
  return a && m && j ? `${j}/${m}/${a}` : jour;
}

/** La référence d'une variation, sans le « vs » : « 24 h précédentes (…) ». */
const sansVs = (reference: string) => reference.trim().replace(/^vs\s+/i, "");

/**
 * Ce que la case dit de sa comparaison — la règle de `comparaisonDeTuile` (KpiTile),
 * reprise en texte : un écart chiffré, ou pourquoi il n'y en a pas.
 */
function comparaison(p: ProprietesCase): { texte: string | null; pct?: number; variation?: string } {
  const connue = p.valeur != null && Number.isFinite(p.valeur);
  if (p.precedent === undefined || !p.reference || !connue) return { texte: null };
  if (p.couverturePrecedente && p.couverturePrecedente.etat !== "complete") {
    return { texte: `variation non affichée : période précédente incomplète (${p.couverturePrecedente.raison ?? "raison non lue"})` };
  }
  if (p.precedent === null || !Number.isFinite(p.precedent)) return { texte: `variation non affichée : pas de mesure sur ${sansVs(p.reference)}` };
  if (p.precedent === 0) return { texte: `variation non affichée : la valeur de référence est nulle sur ${sansVs(p.reference)}` };
  const faibleSous = p.couverture?.faibleSous ?? FAIBLE_SOUS_DEFAUT;
  const faible = (n: number | null | undefined) => n != null && n < faibleSous;
  if (faible(p.couverture?.n) || faible(p.couverturePrecedente?.n)) {
    return { texte: "variation non affichée : échantillon faible sur l'une des deux périodes" };
  }
  const pct = ((p.valeur! - p.precedent) / Math.abs(p.precedent)) * 100;
  const arrondi = Math.round(pct);
  const signe = arrondi > 0 ? "+" : arrondi < 0 ? "−" : "";
  const nonEtabli = p.ecart != null && !p.ecart.etabli;
  const variation = `${Math.abs(arrondi) < SEUIL_STABLE_PCT ? "stable, " : ""}${signe}${Math.abs(arrondi)}${NBSP}% vs ${sansVs(p.reference)}`;
  return {
    texte: `${variation}${nonEtabli ? " (écart non établi : intervalles qui se chevauchent)" : ""}`,
    pct,
    variation: `${variation}${nonEtabli ? ", écart non établi" : ""}`,
  };
}

// ─────────────────────────────── La construction ───────────────────────────────

type Brouillon = Omit<FaitDigest, "id">;

/**
 * Le condensé de la Vue d'ensemble, à partir de ce que la page a déjà lu. Chaque
 * section absente de l'écran (bloc éteint, lecture en échec) est absente du condensé,
 * ou dite en échec : l'assistant ne cite jamais un endroit que la page n'affiche pas.
 */
export function construireDigestVueEnsemble(e: EntreesDigest): Digest {
  const maintenant = e.maintenant ?? Date.now();
  const brouillons: Brouillon[] = [];
  const ajouter = (b: Brouillon | null | undefined) => {
    if (b) brouillons.push(b);
  };

  if (e.sansVisite) {
    ajouter({
      cle: "sans-visite",
      categorie: "Trafic",
      libelle: "Aucune visite sur la période",
      valeur: `0${NBSP}session`,
      detail: `${e.sansVisite.titre} ${e.sansVisite.detail}`,
      cible: '[data-testid="onboarding-nudge"]',
      ton: "neutre",
    });
  }

  faitsSante(e.sante, ajouter);
  for (const c of e.cases ?? []) ajouter(faitCase(c));
  faitsConstats(e, ajouter);
  if (e.deploiement) ajouter(faitDeploiement(e.deploiement));
  for (const s of e.series ?? []) ajouter(faitSerie(s.vital, s.lu));
  if (e.datation) ajouter(faitDatation(e.datation));
  if (e.latence) ajouter(faitLatence(e.latence));
  if (e.charge) faitsCharge(e.charge, ajouter);
  if (e.angleMort) ajouter(faitAngleMort(e.angleMort));
  if (e.segments) faitsSegments(e.segments, ajouter);
  if (e.release) ajouter(faitRelease(e.release));
  if (e.historique) ajouter(faitHistorique(e.historique));
  if (e.anomalies) faitsAnomalies(e.anomalies, ajouter);

  const faits = brouillons.slice(0, MAX_FAITS).map((b, i): FaitDigest => {
    const f: FaitDigest = {
      id: `F${i + 1}`,
      categorie: b.categorie,
      libelle: texteSur(b.libelle, BORNES.libelle),
      valeur: texteSur(b.valeur, BORNES.valeur),
      cible: b.cible,
      cle: b.cle,
    };
    if (b.detail) f.detail = texteSur(b.detail, BORNES.detail);
    if (b.repli) f.repli = b.repli;
    if (b.ton) f.ton = b.ton;
    if (b.verdict) f.verdict = texteSur(b.verdict, BORNES.valeur);
    if (b.variation) f.variation = texteSur(b.variation, BORNES.valeur);
    if (b.ecartPct !== undefined && Number.isFinite(b.ecartPct)) f.ecartPct = Math.round(b.ecartPct * 10) / 10;
    if (b.degradation !== undefined) f.degradation = b.degradation;
    if (b.poids !== undefined && Number.isFinite(b.poids)) f.poids = b.poids;
    return f;
  });

  return allege({
    version: 1,
    ecran: "Vue d'ensemble",
    app: e.app ? borner(e.app, 80) : null,
    periode: borner(e.periode, 80),
    genereLe: new Date(maintenant).toISOString(),
    faits,
  });
}

/** Poids du condensé sérialisé, en octets UTF-8. */
export function octetsDigest(d: Digest): number {
  return new TextEncoder().encode(JSON.stringify(d)).length;
}

/**
 * Au-delà de `MAX_OCTETS_DIGEST`, le détail des derniers faits tombe, puis les
 * derniers faits eux-mêmes : les premiers (santé, cases, constats) restent entiers.
 */
function allege(d: Digest): Digest {
  const faits = d.faits.map((f) => ({ ...f }));
  const leger = { ...d, faits };
  for (let i = faits.length - 1; i >= 0 && octetsDigest(leger) > MAX_OCTETS_DIGEST; i--) delete faits[i].detail;
  while (faits.length > 1 && octetsDigest(leger) > MAX_OCTETS_DIGEST) faits.pop();
  return leger;
}

// ─────────────────────────────────── La santé ───────────────────────────────────

const TON_SANTE: Record<string, TonFait> = { Excellent: "bon", Bon: "bon", Dégradé: "moyen", Critique: "mauvais" };

function faitsSante(sante: EntreesDigest["sante"], ajouter: (b: Brouillon) => void) {
  if (!sante) return;
  if (sante === "echec") {
    ajouter({ cle: "sante", categorie: "Santé", libelle: "Santé de la période", valeur: "—", detail: "lecture en échec", cible: "#sante" });
    return;
  }
  ajouter({
    cle: "sante",
    categorie: "Santé",
    libelle: "Santé de la période",
    valeur: sante.score == null ? "—" : `${sante.score}${NBSP}/${NBSP}100`,
    detail: sante.score == null || !sante.label ? "score non calculable : données insuffisantes" : `${sante.label} · score sur 100, quatre composantes`,
    cible: "#sante",
    ton: sante.label ? TON_SANTE[sante.label] : undefined,
  });
  for (const f of sante.factors) {
    const points = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
    ajouter({
      cle: `sante:${f.key}`,
      categorie: "Santé",
      libelle: `Santé · ${f.label}`,
      valeur: f.earned == null ? "—" : `${points(f.earned)}${NBSP}/${NBSP}${f.max}${NBSP}points`,
      detail: f.earned == null ? (f.raisonNull ?? "composante exclue : pas de donnée") : f.detail,
      cible: "#sante",
      poids: f.earned == null ? 0 : Math.max(0, f.max - f.earned),
    });
  }
}

// ─────────────────────────────────── Les cases ───────────────────────────────────

function faitCase(c: CaseLue): Brouillon {
  const cible = `[data-testid="tuile-${c.cle}"]`;
  const categorie = categorieDeCase(c.cle);
  if (!("props" in c)) {
    return { cle: `tuile:${c.cle}`, categorie, libelle: c.titre, valeur: "—", detail: "lecture en échec : valeur non lue", cible };
  }
  const p = c.props;
  const connue = p.valeur != null && Number.isFinite(p.valeur);
  const valeur = valeurDeCase(p.format, connue ? p.valeur : null, UNITE_CASE[c.cle]);
  if (!connue) return { cle: `tuile:${c.cle}`, categorie, libelle: p.label, valeur, detail: p.raisonNull ?? "valeur inconnue", cible };

  const n = p.couverture?.n ?? null;
  const verdict = p.vital ? lireVital(p.vital, p.valeur, n ?? 0, p.intervalle).verdict : null;
  const intervalle =
    p.intervalle && !("indisponible" in p.intervalle)
      ? `entre ${formater(p.format, p.intervalle.bas)} et ${formater(p.format, p.intervalle.haut)} (95 %)`
      : null;
  const faibleSous = p.couverture?.faibleSous ?? FAIBLE_SOUS_DEFAUT;
  const effectif = p.couverture
    ? `${n == null ? "effectif inconnu" : `${formater("count", n)} ${p.couverture.unite}`}${n != null && n < faibleSous ? " (échantillon faible)" : ""}`
    : null;
  const comp = comparaison(p);
  const sens = p.sensMeilleur ?? (p.vital ? "bas" : "neutre");
  const etabli = p.ecart == null || p.ecart.etabli;
  const degradation =
    comp.pct === undefined || sens === "neutre" || !etabli || Math.abs(Math.round(comp.pct)) < SEUIL_STABLE_PCT
      ? undefined
      : sens === "bas"
        ? comp.pct > 0
        : comp.pct < 0;
  return {
    cle: `tuile:${c.cle}`,
    categorie,
    libelle: p.label,
    valeur,
    detail: [verdict ? texteVerdict(verdict) : null, intervalle, effectif, comp.texte, p.lecture ?? null].filter(Boolean).join(" · "),
    cible,
    ton: tonDuVerdict(verdict),
    verdict: motVerdict(verdict),
    variation: comp.variation,
    ecartPct: comp.pct,
    degradation,
  };
}

// ────────────────────────────────── Les constats ──────────────────────────────────

const LIBELLE_CONSTAT: Record<TypeConstat, string> = {
  anomalie: "Anomalie",
  regression: "Régression",
  alerte: "Alerte",
  erreur_nouvelle: "Erreur nouvelle",
  surrepresentation: "Surreprésentation",
  rupture: "Rupture",
};
const TON_CONSTAT: Record<TypeConstat, TonFait> = {
  anomalie: "moyen",
  regression: "mauvais",
  alerte: "mauvais",
  erreur_nouvelle: "mauvais",
  surrepresentation: "moyen",
  rupture: "moyen",
};
const TON_PRIORITE: Record<string, TonFait> = { haute: "mauvais", moyenne: "moyen", basse: "neutre" };

/** Au plus 8 constats et 5 écarts détectés nommés : la colonne n'en montre pas davantage d'un coup d'œil. */
const MAX_CONSTATS = 8;
const MAX_DETECTES = 5;

function faitsConstats(e: EntreesDigest, ajouter: (b: Brouillon) => void) {
  const c = e.constats;
  if (!c) return;
  const cartes = c.detectes.kind === "ok" ? c.detectes.cartes : [];
  const total = c.liste.length + cartes.length;
  const parType = new Map<string, number>();
  for (const x of c.liste) parType.set(LIBELLE_CONSTAT[x.type], (parType.get(LIBELLE_CONSTAT[x.type]) ?? 0) + 1);
  if (cartes.length) parType.set("Écart détecté", cartes.length);
  const repartition = [...parType].map(([nom, n]) => `${nom.toLowerCase()} : ${n}`).join(", ");
  const partielles = [...c.echecs, ...(c.detectes.kind === "echec" ? ["écarts détectés par calcul"] : [])];
  // Sans constat, la colonne se tait : le fait vise alors le compte du bandeau « En
  // bref » (« 0 constat »), et, si le bandeau se tait aussi (ni constat ni
  // déploiement), le tableau des anomalies — la première source des constats.
  const cibleVide = '[data-testid="r0-constats"]';
  const repliVide = e.anomalies ? "#anomalies" : "#sante";
  ajouter({
    cle: "constats",
    categorie: "Constats",
    libelle: "Constats automatiques en cours",
    valeur: pluriel(total, "constat"),
    detail: [
      total === 0 ? "rien à signaler : anomalies LCP, dernier déploiement, alertes non acquittées, erreurs réapparues" : repartition,
      partielles.length ? `lecture partielle : ${partielles.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
    cible: c.affiches ? "#constats" : cibleVide,
    repli: c.affiches ? undefined : repliVide,
    ton: total === 0 ? "bon" : c.liste.some((x) => TON_CONSTAT[x.type] === "mauvais") ? "mauvais" : "moyen",
  });
  c.liste.slice(0, MAX_CONSTATS).forEach((x, i) =>
    ajouter({
      cle: `constat:${x.type}:${i + 1}`,
      categorie: "Constats",
      libelle: LIBELLE_CONSTAT[x.type],
      valeur: x.titre,
      detail: `règle : ${x.regle}`,
      cible: c.affiches ? `#constats [data-testid="constat"]:nth-child(${i + 1})` : cibleVide,
      repli: c.affiches ? "#constats" : repliVide,
      ton: TON_CONSTAT[x.type],
    }),
  );
  for (const carte of cartes.slice(0, MAX_DETECTES)) {
    ajouter({
      cle: `detecte:${carte.id}`,
      categorie: "Constats",
      libelle: `Écart détecté par calcul · priorité ${carte.niveauPriorite}`,
      valeur: carte.titre,
      detail: [carte.preuve, carte.effectif].filter(Boolean).join(" · ") || undefined,
      cible: `#constat-detecte-${carte.id}`,
      repli: "#constats",
      ton: TON_PRIORITE[carte.niveauPriorite],
    });
  }
}

function faitDeploiement(d: NonNullable<EntreesDigest["deploiement"]>): Brouillon {
  const cible = '[data-testid="r0-deploiement"]';
  if (d === "echec") return { cle: "deploiement", categorie: "Release", libelle: "Dernier déploiement", valeur: "—", detail: "déploiements non lus", cible };
  return {
    cle: "deploiement",
    categorie: "Release",
    libelle: "Dernier déploiement",
    valeur: d.version ?? "sans version",
    detail: `le ${fmtInstant(d.ts, { annee: true })}`,
    cible,
    repli: '[data-testid="release-compare"]',
  };
}

// ───────────────────────────── Le graphique principal ─────────────────────────────

function faitSerie(vital: VitalName, lu: Lu<readonly { bucket: string; p75: number | null; n: number }[]>): Brouillon | null {
  if (!lu.ok) return null;
  const mesures = lu.data.filter((p): p is { bucket: string; p75: number; n: number } => p.p75 != null && Number.isFinite(p.p75));
  if (mesures.length < 2) return null;
  const pic = mesures.reduce((a, b) => (b.p75 > a.p75 ? b : a));
  const format: FormatId = vital === "CLS" ? "cls" : "ms";
  return {
    cle: `serie:${vital}`,
    categorie: "Tendance",
    libelle: `${vital} p75 par tranche : pic de la période`,
    valeur: formater(format, pic.p75),
    detail: `le ${fmtInstant(pic.bucket)} · ${pluriel(pic.n, "mesure")} dans la tranche · ${mesures.length} tranches mesurées sur ${lu.data.length}`,
    cible: `[data-testid="vignette-${vital}"]`,
    repli: `[data-testid="tuile-${vital}"]`,
    ton: (() => {
      const r = rating2026(vital, pic.p75);
      return r ? TON_DU_RATING[r] : undefined;
    })(),
  };
}

function faitDatation(d: NonNullable<EntreesDigest["datation"]>): Brouillon {
  return {
    cle: "datation",
    categorie: "Tendance",
    libelle: "Rupture du LCP p75 sur 14 jours",
    valeur: !d.datable ? "non datable" : d.rupture ? `${d.rupture.sens} le ${jourLong(d.rupture.jour)}` : "aucune rupture",
    detail: d.phrase,
    cible: '[data-testid="vignette-LCP"]',
    repli: '[data-testid="tuile-LCP"]',
    ton: d.rupture ? (d.rupture.sens === "hausse" ? "mauvais" : "bon") : undefined,
  };
}

function faitLatence(h: Heatmap): Brouillon | null {
  const colonnes = h.colonnes.filter((c): c is typeof c & { p75: number } => c.p75 != null && Number.isFinite(c.p75) && c.n >= MESURES_MIN_COLONNE);
  if (colonnes.length === 0) return null;
  const pire = colonnes.reduce((a, b) => (b.p75 > a.p75 ? b : a));
  const borne = THRESHOLDS[h.vital]?.[1];
  const auDela = borne == null ? null : colonnes.filter((c) => c.p75 > borne).length;
  const format: FormatId = h.vital === "CLS" ? "cls" : "ms";
  const r = rating2026(h.vital, pire.p75);
  return {
    cle: "latence",
    categorie: "Latence",
    libelle: `${h.vital} p75 horaire le plus haut`,
    valeur: formater(format, pire.p75),
    detail: [
      `le ${fmtInstant(pire.t)} · ${pluriel(pire.n, "mesure")}`,
      auDela == null || borne == null
        ? null
        : `${pluriel(auDela, "heure")} sur ${colonnes.length} au-delà du seuil Mauvais (${fmtBorne(h.vital, borne)})`,
    ]
      .filter(Boolean)
      .join(" · "),
    cible: "#heatmap-latence",
    ton: r ? TON_DU_RATING[r] : undefined,
  };
}

function faitsCharge(c: NonNullable<EntreesDigest["charge"]>, ajouter: (b: Brouillon) => void) {
  const pic = <T,>(lignes: readonly T[], valeur: (l: T) => number) =>
    lignes.reduce<{ l: T; v: number } | null>((m, l) => (m === null || valeur(l) > m.v ? { l, v: valeur(l) } : m), null);
  if (c.vues && c.vues.length) {
    const vues = (l: { chargements: number; spa: number; inconnu: number }) => l.chargements + l.spa + l.inconnu;
    const total = c.vues.reduce((s, l) => s + vues(l), 0);
    const p = pic(c.vues, vues);
    if (p && total > 0) {
      ajouter({
        cle: "charge:vues",
        categorie: "Charge",
        libelle: "Pages vues par tranche : pic de charge",
        valeur: pluriel(p.v, "page vue", "pages vues"),
        detail: `le ${fmtInstant(p.l.bucket)} · ${pluriel(total, "page vue", "pages vues")} sur ${c.vues.length} tranches`,
        cible: "#charge-erreurs-lcp",
      });
    }
  }
  if (c.erreurs && c.erreurs.length) {
    const total = c.erreurs.reduce((s, l) => s + l.navigateur, 0);
    const p = pic(c.erreurs, (l) => l.navigateur);
    if (p && total > 0) {
      ajouter({
        cle: "charge:erreurs",
        categorie: "Erreurs",
        libelle: "Erreurs navigateur par tranche : pic",
        valeur: pluriel(p.v, "occurrence"),
        detail: `le ${fmtInstant(p.l.bucket)} · ${pluriel(total, "occurrence")} sur la période`,
        cible: "#charge-erreurs-lcp",
      });
    }
  }
}

function faitAngleMort(a: EtatAngleMort): Brouillon | null {
  if (a.kind !== "ok") return null;
  return {
    cle: "angle-mort",
    categorie: "Angle mort",
    libelle: "Heures en angle mort (robot à l'état ok, visiteurs lents)",
    valeur: pluriel(a.heures, "heure"),
    detail: a.pire ? `pire route : ${a.pire.route} (${pluriel(a.pire.heures, "heure")})` : undefined,
    cible: '[data-testid="angle-mort"]',
    ton: a.heures > 0 ? "moyen" : "bon",
  };
}

// ───────────────────────────────── Les segments ─────────────────────────────────

/** Les cinq pires segments assez mesurés, et les deux pires sur trop peu de mesures : le classement complet reste à l'écran. */
const MAX_SEGMENTS = 5;
const MAX_SEGMENTS_FAIBLES = 2;

function faitsSegments(s: NonNullable<EntreesDigest["segments"]>, ajouter: (b: Brouillon) => void) {
  const dimension = BREAKDOWN_LABELS[s.dimension] ?? s.dimension;
  const format: FormatId = s.vital === "CLS" ? "cls" : "ms";
  const cible = '[data-testid="impact-table"]';
  ajouter({
    cle: `segments:${s.dimension}:${s.vital}`,
    categorie: "Segments",
    libelle: `Segments classés par ${dimension.toLowerCase()} (${s.vital} p75)`,
    valeur: pluriel(s.lignes.length, "segment"),
    detail: [`ensemble : ${s.vital} p75 ${formater(format, s.ensemble)}`, s.groupes > s.lignes.length ? `${s.groupes} groupes sur la fenêtre` : null]
      .filter(Boolean)
      .join(" · "),
    cible,
  });
  // Les PIRES d'abord, quel que soit l'ordre choisi à l'écran (gravité ou volume). Un
  // échantillon faible est à part (« segment-faible: ») : « la page la plus lente » ne
  // se dit pas d'une page vue une fois, mais la taire cacherait un chiffre de l'écran.
  const classes = s.lignes
    .map((l, rang) => ({ l, rang }))
    .filter(({ l }) => l.pilote != null && Number.isFinite(l.pilote))
    .sort((x, y) => y.l.pilote! - x.l.pilote!);
  const nommer = (faibles: boolean, max: number) =>
    classes
      .filter(({ l }) => l.echantillonFaible === faibles)
      .slice(0, max)
      .forEach(({ l, rang }, i) => {
        const pilote = l.mesures.find((m) => m.vital === s.vital);
        const verdict =
          pilote?.vital && pilote.valeur != null ? lireVital(pilote.vital, pilote.valeur, pilote.n ?? 0, pilote.intervalle).verdict : null;
        const autres = l.mesures
          .filter((m) => m.vital && m.vital !== s.vital && m.valeur != null)
          .map((m) => `${m.vital} p75 ${m.affichage}`)
          .join(" · ");
        const ecart = l.ecart?.valeur ?? null;
        ajouter({
          cle: `${faibles ? "segment-faible" : "segment"}:${s.dimension}:${i + 1}`,
          categorie: "Segments",
          libelle: `${dimension} ${entreGuillemets(l.libelle)} · ${s.vital} p75`,
          valeur: formater(format, l.pilote),
          detail: [
            l.volume == null ? null : `${formater("count", l.volume)} mesures ${s.vital}`,
            faibles ? "échantillon faible" : null,
            verdict ? texteVerdict(verdict) : null,
            autres || null,
          ]
            .filter(Boolean)
            .join(" · "),
          cible: `${cible} [data-testid="impact-ligne"]:nth-child(${rang + 1})`,
          repli: cible,
          ton: tonDuVerdict(verdict),
          verdict: motVerdict(verdict),
          variation: ecart != null ? l.ecart!.affichage : undefined,
          ecartPct: ecart != null && s.ensemble != null && s.ensemble > 0 ? (ecart / s.ensemble) * 100 : undefined,
          // Plus lent que l'ensemble : c'est ce que « dégradé » veut dire pour un segment.
          degradation: ecart != null ? ecart > 0 : undefined,
          poids: l.pilote ?? undefined,
        });
      });
  nommer(false, MAX_SEGMENTS);
  nommer(true, MAX_SEGMENTS_FAIBLES);
}

// ────────────────────────────────── La release ──────────────────────────────────

function faitRelease(r: NonNullable<EntreesDigest["release"]>): Brouillon {
  const { a, b } = r;
  const ms = (v: number | null | undefined) => formater("ms", v ?? null);
  const taux = (s: ReleaseStats) =>
    s.sessions != null && s.sessions > 0 && s.sessionsEnErreur != null ? formater("pct", s.sessionsEnErreur / s.sessions) : "—";
  const ecart = a.lcp_p75 != null && b.lcp_p75 != null && a.lcp_p75 > 0 ? ((b.lcp_p75 - a.lcp_p75) / a.lcp_p75) * 100 : undefined;
  const arrondi = ecart === undefined ? 0 : Math.round(ecart);
  return {
    cle: "release",
    categorie: "Release",
    libelle: `Release ${b.release} face à ${a.release}`,
    valeur: `LCP p75 ${ms(b.lcp_p75)} contre ${ms(a.lcp_p75)}`,
    detail: [
      `sessions : ${formater("count", b.sessions)} contre ${formater("count", a.sessions)}`,
      `INP p75 ${ms(b.inp_p75)} contre ${ms(a.inp_p75)}`,
      `sessions en erreur : ${taux(b)} contre ${taux(a)}`,
      "même fenêtre, sans normalisation de trafic",
      r.regle,
    ].join(" · "),
    cible: '[data-testid="release-compare"]',
    // L'écart des deux p75, sans verdict : la comparaison de l'écran dit, elle, s'il est établi.
    variation:
      ecart === undefined ? undefined : `LCP p75 ${arrondi > 0 ? "+" : arrondi < 0 ? "−" : ""}${Math.abs(arrondi)}${NBSP}% vs ${a.release}`,
    ecartPct: ecart,
  };
}

// ───────────────────────────────── L'historique ─────────────────────────────────

function faitHistorique(cellules: NonNullable<EntreesDigest["historique"]>): Brouillon | null {
  const total = cellules.reduce((s, c) => s + c.total_w, 0);
  if (!(total > 0)) return null;
  const bon = cellules.reduce((s, c) => s + c.good_w, 0);
  const jours = new Set(cellules.filter((c) => c.total_w > 0).map((c) => c.day)).size;
  // Le pire créneau parmi ceux qui ont de quoi être lus : le seuil de la heatmap de latence.
  const lisibles = cellules.filter((c) => c.total_w >= MESURES_MIN_COLONNE);
  const pire = lisibles.length ? lisibles.reduce((x, y) => (y.good_w / y.total_w < x.good_w / x.total_w ? y : x)) : null;
  return {
    cle: "historique",
    categorie: "Historique",
    libelle: "Historique 14 jours : part de mesures Bon",
    valeur: formater("pct", bon / total),
    detail: [
      "pondérée, LCP compté double",
      pire ? `pire créneau : ${jourLong(pire.day)} à ${String(pire.hour).padStart(2, "0")} h (${formater("pct", pire.good_w / pire.total_w)})` : null,
      `${pluriel(jours, "jour")} mesurés sur 14`,
    ]
      .filter(Boolean)
      .join(" · "),
    cible: "#historique",
  };
}

// ────────────────────────────────── Les anomalies ──────────────────────────────────

const MAX_ANOMALIES = 5;

function faitsAnomalies(a: NonNullable<EntreesDigest["anomalies"]>, ajouter: (b: Brouillon) => void) {
  ajouter({
    cle: "anomalies",
    categorie: "Anomalies",
    libelle: "Anomalies LCP sur 24 h",
    valeur: a.filtrees ? "—" : pluriel(a.lignes.length, "anomalie"),
    detail: a.filtrees
      ? "non cherchées sous un filtre de population"
      : "règle : z-score au-delà de 3 sur la moyenne horaire des 7 derniers jours",
    cible: "#anomalies",
    ton: a.filtrees ? undefined : a.lignes.length > 0 ? "moyen" : "bon",
  });
  if (a.filtrees) return;
  a.lignes.slice(0, MAX_ANOMALIES).forEach((l, i) =>
    ajouter({
      cle: `anomalie:${i + 1}`,
      categorie: "Anomalies",
      libelle: `Anomalie LCP · ${l.route ?? "toutes routes"}`,
      valeur: formater("ms", l.p75),
      detail: `le ${fmtInstant(l.bucket)} · moyenne 7 j : ${formater("ms", l.mean_7d)} · z-score ${l.z_score.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}`,
      cible: "#anomalies",
      ton: "moyen",
      poids: l.z_score,
    }),
  );
}

/** Le libellé d'un verdict de Web Vital (« Bon »…), pour la réponse par règles. */
export function libelleTon(ton: TonFait | undefined): string | null {
  if (ton === "bon") return RATING_LABEL.good;
  if (ton === "moyen") return RATING_LABEL["needs-improvement"];
  if (ton === "mauvais") return RATING_LABEL.poor;
  return null;
}
