// Classement de segments — TABLEAU CLASSÉ DENSE (charte § 3.5, refonte du 30/09/2026 ;
// F05, plan § 4.2, P3). IP-Label « top offenders », avec l'écart à l'ensemble. Rendu
// serveur, sans JS client.
//
// CE QUE LE CLASSEMENT DIT, ET CE QU'IL NE FAIT JAMAIS.
//   - Les lignes arrivent DÉJÀ classées (`classerParGravite`, lib/impact.ts) : le
//     composant n'ordonne rien, il dit l'ordre (bascule de tri, flèche ↓ sur l'en-tête
//     de la colonne qui classe, ou `ordreLibelle` quand l'ordre est celui de la source).
//   - La référence « Ensemble » est une LIGNE distincte, au-dessus des segments, jamais
//     une barre : elle ne se classe pas parmi eux, elle se lit à côté.
//   - Aucune ligne « Autres », aucun total : un p75 ne s'additionne pas (V5).
//   - Une valeur pilote inconnue n'a pas de barre (une barre nulle se lirait « le
//     meilleur ») ; un échantillon faible est ÉCRIT (« faible » dans la colonne de
//     l'effectif), pas seulement grisé.
//   - Un verdict (Bon / À améliorer / Mauvais) n'est posé que sur une mesure qui porte
//     `vital` — l'appelant ne le donne qu'à un p75 (R-V) — et seulement s'il tient sur
//     TOUT l'intervalle à 95 % (règle des tuiles, `lireVital`). Affirmé : une pastille
//     de forme ET de couleur (● ▲ ■, jamais la couleur seule), le mot en bulle et pour
//     l'écran vocal. Incertain ou non établi : AUCUNE couleur, un cercle vide, la raison
//     en bulle au survol (recette du 26/09/2026 : 304 ms « incertain » sur la tuile,
//     « À améliorer » ici).
//
// UNE LIGNE = 32 PX, PAS UNE PHRASE (recette du 30/09/2026 : « chaque ligne est une
// phrase »). Des colonnes alignées — segment (pictogramme : logo du navigateur ou du
// système, drapeau du pays, type d'appareil), barre, valeur classée, les autres
// mesures, l'effectif, l'écart à l'ensemble —, chiffres tabulaires à droite. Ce que la
// ligne disait en toutes lettres (verdict incertain, intervalle, « vs ensemble ») est
// dans la bulle de la cellule et dans le texte lu ; l'alternative textuelle, repliée
// sous la table, garde TOUTES les colonnes, doublon compris.
//
// BARRES COMPARABLES (recette du 26/09/2026). Toutes les lignes, l'en-tête et la
// référence partagent la MÊME grille, faite de longueurs et de fractions, jamais du
// contenu : une barre plus longue veut dire une valeur plus grande. La grille est
// choisie par la largeur de la TABLE (`@container`), pas par celle de la fenêtre (CI
// rouge du 27/09/2026 : à 1 024 px, la barre latérale ne laisse que ≈ 700 px) :
// étroite, segment, barre et valeur ; moyenne, plus l'effectif et l'écart ; large,
// toutes les mesures. Les plages sont DISJOINTES (min/max) : deux règles de grille ne
// se disputent jamais la même largeur.
//
// DIX LIGNES, PUIS « VOIR LES N AUTRES » (charte § 3.5) : un repli natif, sans JS ; les
// lignes repliées restent dans le document (liens, alternative, lecteurs d'écran).
//
// LA COLONNE QUI DOUBLE LA VALEUR CLASSÉE (« LCP p75 » quand on classe par le LCP) est
// retirée de la ligne : son en-tête nomme la valeur classée, son verdict passe sur elle.
//
// UN SEUL RANG DE COMMANDES : titre, dimensions, puis, à droite, le sélecteur propre à
// l'écran (`commandes`) et l'ordre. La provenance de la dimension (`notice`) et la règle
// de troncature passent dans « Méthode », sous la table.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { BasculeTri, LIBELLES_TRI, OngletsDecoupage, type OngletDecoupage } from "./Breakdown";
import { TableAlternative } from "./charts/Figure";
import { drapeau, PictoSegment } from "./Pictos";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { accord } from "@/lib/format";
import type { TriClassement } from "@/lib/impact";
import { FORME_RATING, RATING_BAR, type Rating } from "@/lib/rating";
import type { IntervalleP75 } from "@mip/stats/incertitude";
import { sommetRobuste } from "@/lib/series";
import { lireVital, texteVerdict, type VerdictVital } from "@/lib/vital-lecture";

export interface ImpactMesure {
  cle: string;
  valeur: number | null;
  affichage: string;
  /** Pose un verdict : réservé à un p75 de vital (R-V). */
  vital?: VitalName;
  n?: number | null;
  /**
   * Intervalle à 95 % de la p75 (P*.1). Fourni : le verdict n'est affirmé que s'il
   * vaut sur tout l'intervalle (règle des tuiles), sinon « incertain », sans couleur.
   */
  intervalle?: IntervalleP75;
  /**
   * Mesure TEXTUELLE (« navigateur », « +32 % ») : sans valeur numérique, elle ne
   * classe rien, mais son `affichage` s'écrit tel quel. Sans ce drapeau, une valeur
   * nulle s'écrit « — » (les colonnes « Côté » et « Tendance » de /map valaient
   * « — » sur toutes les lignes, contre-recette du 26/09/2026).
   */
  texte?: boolean;
}

export interface ImpactLigne {
  /** « Inconnu » a sa clé propre. */
  cle: string;
  libelle: string;
  /** Drill-down (§ 3.3) ; null = ligne non cliquable, raison dans l'alternative. */
  href: string | null;
  /** Libellé complet annoncé par le lien. */
  description: string;
  /** Valeur qui trie et dessine la barre. */
  pilote: number | null;
  /** Effectif de la ligne (mesures, sessions, appels…). */
  volume: number | null;
  /** Colonnes additionnelles, dans l'ordre de `colonnes`. */
  mesures: ImpactMesure[];
  /** « +1,2 s vs ensemble » : un écart de p75, jamais une contribution. */
  ecart?: { valeur: number | null; affichage: string };
  /** P*.1 : « 2,1 – 3,0 s ». */
  intervalle?: string | null;
  echantillonFaible: boolean;
}

export type TriImpact = TriClassement;

/** Lignes montrées avant « Voir les N autres » (charte § 3.5). */
export const LIGNES_VISIBLES = 10;

const FORMATS: readonly string[] = ["ms", "s-auto", "cls", "pct", "count", "bytes", "score", "ratio", "pour100"];

/** L'unité d'un format, telle qu'un en-tête l'écrit. */
const UNITE_LISIBLE: Record<string, string> = {
  ms: "durée",
  "s-auto": "durée",
  cls: "CLS",
  pct: "part",
  count: "nombre",
  bytes: "octets",
  score: "score",
  ratio: "rapport",
  pour100: "pour 100",
};

/** L'en-tête de la première colonne, selon la dimension découpée. */
const LIBELLE_DIMENSION: Record<string, string> = {
  route: "Route",
  browser: "Navigateur",
  os: "Système",
  country: "Pays",
  device: "Appareil",
  release: "Release",
};

/** Valeur pilote affichée : `unitePilote` est un `FormatId`, ou une unité libre (« appels »). */
function affichePilote(unitePilote: string, v: number | null): string {
  if (FORMATS.includes(unitePilote)) return formater(unitePilote as FormatId, v);
  return v == null || !Number.isFinite(v) ? "—" : `${v.toLocaleString("fr-FR")} ${unitePilote}`;
}

/**
 * Le verdict d'une mesure qui porte un vital : la règle des tuiles (`lireVital`),
 * avec l'intervalle quand l'appelant le fournit. `null` : aucun verdict à écrire.
 */
export function verdictMesure(m: Pick<ImpactMesure, "vital" | "valeur" | "n" | "intervalle">): VerdictVital | null {
  if (!m.vital || m.valeur == null || !Number.isFinite(m.valeur)) return null;
  return lireVital(m.vital, m.valeur, m.n ?? 0, m.intervalle).verdict;
}

/** La teinte d'un verdict : seulement s'il est affirmé sur tout l'intervalle. */
function teinte(v: VerdictVital | null): Rating | null {
  return v?.kind === "etabli" ? v.rating : null;
}

/**
 * Teinte de la pastille : le jeton de TEXTE du verdict (`-ink`, 4,5:1 sur le fond, qui
 * suit le mode sombre). La forme est un caractère : le vert de remplissage n'y tenait
 * que 3,8:1, sous le seuil d'un texte (axe, e2e `theme-contraste`).
 */
const TEINTE_PASTILLE: Record<Rating, string> = {
  good: "text-good-ink",
  "needs-improvement": "text-warn-ink",
  poor: "text-bad-ink",
};

/**
 * La pastille d'un verdict, devant la valeur : forme ET couleur pour un verdict
 * affirmé ; un cercle vide, sans couleur, quand il ne l'est pas (la raison en bulle).
 * Aucun verdict à poser (mesure sans vital) : rien.
 */
function Pastille({ verdict }: { verdict: VerdictVital | null }) {
  if (!verdict) return null;
  const couleur = teinte(verdict);
  return couleur ? (
    <i aria-hidden="true" className={`text-[9px] not-italic leading-none ${TEINTE_PASTILLE[couleur]}`}>
      {FORME_RATING[couleur]}
    </i>
  ) : (
    <i aria-hidden="true" className="cursor-help text-[10px] not-italic leading-none text-ink-faint">
      ○
    </i>
  );
}

/**
 * Rang de la colonne de `mesures` qui DOUBLE la valeur classée (« LCP p75 » quand
 * les lignes sont classées par le LCP), ou -1. Explicite (`cle`), ou reconnue : sur
 * chaque ligne où les deux sont connues, la mesure vaut exactement le pilote.
 */
export function colonneDoublon(lignes: readonly ImpactLigne[], cle?: string | null): number {
  const premiere = lignes[0]?.mesures ?? [];
  if (cle === null) return -1;
  if (cle !== undefined) return premiere.findIndex((m) => m.cle === cle);
  for (let i = 0; i < premiere.length; i++) {
    let comparees = 0;
    const egales = lignes.every((l) => {
      const m = l.mesures[i];
      if (l.pilote == null || m?.valeur == null) return true;
      comparees++;
      return m.valeur === l.pilote;
    });
    if (egales && comparees > 0) return i;
  }
  return -1;
}

/**
 * Couleur de barre : celle du verdict quand la valeur classée en porte un affirmé,
 * NEUTRE sinon. L'orange de marque, à côté de barres vertes « Bon », se lisait
 * « À améliorer » : /recherche à 443 ms paraissait lente (recette du 26/09/2026).
 */
function couleurBarre(verdict: Rating | null): string {
  return verdict ? `${RATING_BAR[verdict]} opacity-80` : "bg-ink-faint/50";
}

/** Texte d'une mesure pour l'alternative : valeur et verdict en toutes lettres. */
function texteMesure(m: ImpactMesure): string {
  if (m.texte) return m.affichage;
  if (m.valeur == null) return "—";
  const verdict = verdictMesure(m);
  return verdict ? `${m.affichage} (${texteVerdict(verdict)})` : m.affichage;
}

/**
 * Base 100 % des barres (01/10/2026 : sur /pages, /dashboards/:id à 311,9 s, vue trois
 * fois, réduisait toutes les autres routes à un point). Le sommet est ROBUSTE
 * (`sommetRobuste`, 90ᵉ centile × 1,25 quand le maximum le dépasse de moitié) : une
 * aberration isolée ne tasse plus la colonne. Il ne descend jamais sous la plus grande
 * ligne à effectif SUFFISANT : une mesure fiable n'est jamais plafonnée. Ce qui dépasse
 * est plafonné et marqué ▲ ; la valeur écrite reste exacte.
 *
 * Pas « l'échelle des seules lignes fiables » (essai du 01/10/2026) : cinq routes
 * fiables à 3 s plafonnaient d'un coup les vingt routes « faibles » au-dessus.
 */
export function baseBarres(lignes: readonly Pick<ImpactLigne, "pilote" | "echantillonFaible">[]): number {
  const finies = (ls: readonly Pick<ImpactLigne, "pilote" | "echantillonFaible">[]) =>
    ls.map((l) => l.pilote).filter((p): p is number => p != null && Number.isFinite(p) && p > 0);
  const toutes = finies(lignes);
  if (toutes.length === 0) return 1;
  const fiables = finies(lignes.filter((l) => !l.echantillonFaible));
  // Sous trois valeurs, un « centile » n'a pas de sens : le maximum.
  const sommet = toutes.length >= 3 ? sommetRobuste(toutes) : Math.max(...toutes);
  return Math.max(sommet, ...fiables) || 1;
}

/**
 * Une valeur de référence longue (« 12 sur 340 (une session comptée par route vue) ») :
 * la cellule n'en montre que la valeur, la précision entre parenthèses passe en bulle
 * et en texte lu. Rognée par la droite d'une colonne alignée à droite, elle s'écrivait
 * « …par route vue) » (recette du 01/10/2026).
 */
export function decouperReference(texte: string): { valeur: string; precision: string | null } {
  const i = texte.indexOf(" (");
  return i <= 0 ? { valeur: texte, precision: null } : { valeur: texte.slice(0, i), precision: texte.slice(i + 1) };
}

/** Préfixe « ≈ » d'une valeur approchée ; « — » reste « — ». */
function approche(texte: string, approchee: boolean): string {
  return approchee && texte !== "—" ? `≈${String.fromCharCode(0xa0)}${texte}` : texte;
}

/**
 * « +1,2 s vs ensemble » → « +1,2 s » dans la cellule, « vs ensemble » lu et en bulle :
 * l'en-tête de la colonne nomme déjà la référence.
 */
export function decouperEcart(affichage: string): { valeur: string; reference: string | null } {
  const i = affichage.indexOf(" vs ");
  return i < 0 ? { valeur: affichage, reference: null } : { valeur: affichage.slice(0, i), reference: affichage.slice(i + 1) };
}

// ─────────────────────────────── Pictogrammes ───────────────────────────────
// Réunis dans `components/Pictos.tsx` (01/10/2026), avec ceux des écrans Usages ;
// réexportés ici pour les appelants qui les prenaient dans ce module.
export { drapeau, PictoSegment };

/** Une route : ses paramètres (`:id`, `{id}`, `[id]`) grisés, le reste à l'encre. */
function LibelleRoute({ route }: { route: string }) {
  const morceaux = route.split(/(:[\w-]+|\{[^}]+\}|\[[^\]]+\])/);
  return (
    <>
      {morceaux.map((m, i) =>
        i % 2 === 1 ? (
          <span key={i} className="text-ink-faint">
            {m}
          </span>
        ) : (
          m
        ),
      )}
    </>
  );
}

// ─────────────────────────────── Grille ───────────────────────────────

/** Largeurs des colonnes chiffrées : fixes, pour des colonnes alignées d'une ligne à l'autre. */
const L_VALEUR = "5.75rem";
const L_NOMBRE = "4.75rem";
const L_ECART = "5.25rem";

/**
 * Les grilles « moyenne » et « large » selon la largeur de TABLE où tout tient. Classes
 * écrites en entier (le compilateur Tailwind ne voit que les littéraux) ; plages
 * disjointes : une seule règle de grille vaut à une largeur donnée.
 */
const PALIERS = [
  {
    rem: 36,
    moyenne: "[@container_(min-width:28rem)_and_(max-width:35.99rem)]:[grid-template-columns:var(--grille-moyenne)]",
    large: "[@container_(min-width:36rem)]:[grid-template-columns:var(--grille-large)]",
    cellule: "hidden [@container_(min-width:36rem)]:flex",
  },
  {
    rem: 44,
    moyenne: "[@container_(min-width:28rem)_and_(max-width:43.99rem)]:[grid-template-columns:var(--grille-moyenne)]",
    large: "[@container_(min-width:44rem)]:[grid-template-columns:var(--grille-large)]",
    cellule: "hidden [@container_(min-width:44rem)]:flex",
  },
  {
    rem: 52,
    moyenne: "[@container_(min-width:28rem)_and_(max-width:51.99rem)]:[grid-template-columns:var(--grille-moyenne)]",
    large: "[@container_(min-width:52rem)]:[grid-template-columns:var(--grille-large)]",
    cellule: "hidden [@container_(min-width:52rem)]:flex",
  },
  {
    rem: 60,
    moyenne: "[@container_(min-width:28rem)_and_(max-width:59.99rem)]:[grid-template-columns:var(--grille-moyenne)]",
    large: "[@container_(min-width:60rem)]:[grid-template-columns:var(--grille-large)]",
    cellule: "hidden [@container_(min-width:60rem)]:flex",
  },
  {
    rem: 68,
    moyenne: "[@container_(min-width:28rem)_and_(max-width:67.99rem)]:[grid-template-columns:var(--grille-moyenne)]",
    large: "[@container_(min-width:68rem)]:[grid-template-columns:var(--grille-large)]",
    cellule: "hidden [@container_(min-width:68rem)]:flex",
  },
] as const;
/** Colonnes de la grille moyenne (effectif, écart) : visibles à partir de 28 rem de table. */
const CELLULE_MOYENNE = "hidden [@container_(min-width:28rem)]:flex";
const GRILLE_ETROITE = "[grid-template-columns:var(--grille-etroite)]";

/** Le palier « large » : le plus petit où segment, barre et toutes les colonnes tiennent. */
function palierLarge(nMesures: number, avecEcart: boolean) {
  const besoin = 7 + 3.5 + 5.75 + nMesures * 4.75 + 4.75 + (avecEcart ? 5.25 : 0) + (nMesures + 4) * 0.5 + 1;
  return PALIERS.find((p) => p.rem >= besoin) ?? PALIERS[PALIERS.length - 1];
}

/**
 * Un en-tête de colonne chiffrée : aligné à droite, sur deux lignes au plus, coupé
 * entre les mots (jamais au milieu d'un mot qui tient). Le texte entier en bulle.
 */
function EnTete({ classe, titre, children }: { classe: string; titre: string; children: ReactNode }) {
  return (
    <span className={`${classe} min-w-0`} title={titre}>
      <span className="line-clamp-2 min-w-0 text-right [overflow-wrap:break-word]">{children}</span>
    </span>
  );
}

/** Une cellule de la ligne « Ensemble » : la valeur, sa précision en bulle et en texte lu. */
function CelluleReference({ classe, colonne, texte }: { classe: string; colonne: string; texte: string | undefined }) {
  const { valeur, precision } = decouperReference(texte || "—");
  return (
    <span className={`${classe} min-w-0 justify-end tabular-nums`} title={texte}>
      <span className="sr-only">{colonne} </span>
      <span className="min-w-0 truncate">{valeur}</span>
      {precision && <span className="sr-only"> {precision}</span>}
    </span>
  );
}

export function ImpactTable({
  titre,
  onglets,
  tri,
  triHref,
  ordreLibelle,
  reference,
  referenceRaison,
  lignes,
  colonnes,
  unitePilote,
  volumeLibelle,
  groupes,
  tronque,
  notice,
  compact = false,
  colonnePilote,
  approchee = false,
  commandes,
  dimension: dimensionDemandee,
  libelleGroupe,
  visibles = LIGNES_VISIBLES,
  hauteurMax,
}: {
  titre: string;
  /** Dimensions, mêmes règles que `Breakdown` (raison si indisponible). */
  onglets?: OngletDecoupage[];
  tri: TriImpact;
  /** null = ordre indisponible (raison en title et en texte lu) ; `fourni` : toujours null. */
  triHref: Record<TriImpact, string | null>;
  /** OBLIGATOIRE si tri === "fourni" : l'ordre, écrit sous le titre. */
  ordreLibelle?: string;
  /** Ligne « Ensemble », non classée ; `valeurs` indexées par `cle` de mesure, plus `pilote` et `volume`. */
  reference: { libelle: string; valeurs: Record<string, string> } | null;
  /** OBLIGATOIRE si reference === null : dit à la place de la ligne. */
  referenceRaison?: string;
  /** Déjà classées côté serveur (lib/impact.ts), sauf tri « fourni ». */
  lignes: ImpactLigne[];
  /** En-têtes des `mesures`, dans leur ordre. */
  colonnes: string[];
  /** Format de la valeur pilote (`FormatId`) ou unité libre. */
  unitePilote: string;
  /** « Mesures LCP », « Sessions », « Appels ». */
  volumeLibelle: string;
  /** Nombre réel de groupes. */
  groupes: number;
  tronque: boolean;
  /** Provenance de la dimension (BREAKDOWN_NOTICES) : dans « Méthode », sous la table. */
  notice?: string;
  /** Carte de tableau de bord : marges réduites. */
  compact?: boolean;
  /**
   * `cle` de la mesure qui double la valeur classée (retirée de la ligne, gardée
   * dans l'alternative) ; défaut : reconnue (`colonneDoublon`) ; `null` : aucune.
   */
  colonnePilote?: string | null;
  /**
   * Valeurs lues sur une distribution par tranches (`meta.approximate`) : la valeur
   * classée s'écrit « ≈ 93 ms ». Les `affichage` des mesures sont déjà du texte :
   * l'appelant les préfixe lui-même.
   */
  approchee?: boolean;
  /** Sélecteur propre à l'écran (le vital qui classe…), posé dans la rangée de l'ordre. */
  commandes?: ReactNode;
  /**
   * Dimension découpée (`route`, `browser`, `os`, `country`, `device`, `release`…) :
   * le pictogramme de chaque segment, et l'en-tête de la première colonne.
   */
  dimension?: string;
  /** En-tête de la première colonne, quand la dimension ne le donne pas. */
  libelleGroupe?: string;
  /** Lignes montrées avant « Voir les N autres » (défaut 10). */
  visibles?: number;
  /**
   * Hauteur maximale de la liste à partir de 640 px (« 20rem ») : les lignes défilent
   * dans la carte sous un en-tête collant, au lieu d'allonger la page (60 routes
   * faisaient un classement de 2 800 px). En dessous de 640 px, la page défile seule :
   * deux défilements imbriqués se disputent le doigt.
   */
  hauteurMax?: string;
}) {
  // Un classement de routes qui ne dit pas sa dimension (/pages, /ux) se reconnaît à
  // ses libellés : tous commencent par « / » (ou sont « Inconnu »).
  const dimension =
    dimensionDemandee ??
    (lignes.length > 0 && lignes.every((l) => l.libelle.startsWith("/") || l.libelle === "Inconnu") ? "route" : undefined);
  // Base 100 % : celle des lignes à effectif suffisant (`baseBarres`). Plus « au moins
  // 1 » : un CLS (0,1 ; 0,25) n'occupait qu'un quart de la piste.
  const max = baseBarres(lignes);
  const depasse = (l: ImpactLigne) => l.pilote != null && Number.isFinite(l.pilote) && l.pilote > max;
  const avecDepassement = lignes.some(depasse);
  const avecEcart = lignes.some((l) => l.ecart !== undefined);
  const avecIntervalle = lignes.some((l) => l.intervalle != null);
  const avecFaible = lignes.some((l) => l.echantillonFaible);
  const avecSansLien = lignes.some((l) => l.href === null);
  const nombre = (n: number | null) => (n == null ? "—" : n.toLocaleString("fr-FR"));
  const doublon = colonneDoublon(lignes, colonnePilote);
  // Le verdict de la valeur classée est celui de la colonne qu'elle double (même
  // vital, même effectif, même intervalle), porté par la valeur classée.
  const verdictPilote = (l: ImpactLigne): VerdictVital | null => {
    const m = doublon >= 0 ? l.mesures[doublon] : undefined;
    return m ? verdictMesure({ vital: m.vital, valeur: l.pilote, n: m.n, intervalle: m.intervalle }) : null;
  };
  const pilote = (v: number | null) => approche(affichePilote(unitePilote, v), approchee);
  // Un ordre que l'écran ne propose pas n'est pas montré (« Impact » était barré en
  // permanence) ; l'ordre courant l'est toujours.
  const ordres = (["gravite", "volume", "impact"] as const).filter((id) => id === tri || triHref[id] !== null);

  // ── La grille, commune à l'en-tête, à la référence et à chaque ligne ──
  const autres = colonnes.map((c, i) => ({ c, i })).filter(({ i }) => i !== doublon);
  const cleMesures = lignes[0]?.mesures.map((m) => m.cle) ?? [];
  const palier = palierLarge(autres.length, avecEcart);
  const style = {
    "--grille-etroite": `minmax(0,1fr) 3rem ${L_VALEUR}`,
    "--grille-moyenne": `minmax(0,1.4fr) minmax(3rem,1fr) ${L_VALEUR} ${L_NOMBRE}${avecEcart ? ` ${L_ECART}` : ""}`,
    "--grille-large": [
      "minmax(7rem,1.4fr)",
      "minmax(3.5rem,1fr)",
      L_VALEUR,
      ...autres.map(() => L_NOMBRE),
      L_NOMBRE,
      ...(avecEcart ? [L_ECART] : []),
    ].join(" "),
    ...(hauteurMax ? { "--impact-hauteur-max": hauteurMax } : {}),
  } as CSSProperties;
  // Sans `items-*` : la ligne centre ses cellules, l'en-tête les pose sur sa ligne de base
  // basse (un libellé sur deux lignes à côté d'un libellé sur une).
  const grilleNue = `grid gap-x-2 ${GRILLE_ETROITE} ${compact ? "" : `${palier.moyenne} ${palier.large}`}`;
  const grille = `${grilleNue} items-center`;
  const celluleLarge = compact ? "hidden" : palier.cellule;
  const celluleMoyenne = compact ? "hidden" : CELLULE_MOYENNE;
  // L'en-tête de la valeur classée : la colonne qu'elle double (« LCP p75 »), sinon son
  // unité en un mot (« Part », « Durée », « Appels »).
  const unite = UNITE_LISIBLE[unitePilote] ?? unitePilote;
  const libelleValeur = doublon >= 0 ? colonnes[doublon] : unite.charAt(0).toUpperCase() + unite.slice(1);
  const premiereColonne = libelleGroupe ?? (dimension ? LIBELLE_DIMENSION[dimension] : undefined) ?? "Segment";
  const fleche = (id: TriImpact) => (tri === id ? "↓ " : "");

  const enTetes = [
    "Groupe",
    // Un identifiant de format (« pct », « count ») n'est pas un mot : l'en-tête dit l'unité.
    `Valeur classée (${UNITE_LISIBLE[unitePilote] ?? unitePilote})`,
    volumeLibelle,
    ...colonnes,
    ...(avecEcart ? ["Écart à l'ensemble"] : []),
    ...(avecIntervalle ? ["Intervalle"] : []),
    ...(avecFaible ? ["Échantillon"] : []),
    ...(avecSansLien ? ["Lien"] : []),
  ];
  const ligneAlternative = (l: ImpactLigne): ReactNode[] => [
    l.libelle,
    pilote(l.pilote),
    nombre(l.volume),
    ...colonnes.map((_c, i) => (l.mesures[i] ? texteMesure(l.mesures[i]) : null)),
    ...(avecEcart ? [l.ecart?.affichage ?? null] : []),
    ...(avecIntervalle ? [l.intervalle ?? null] : []),
    ...(avecFaible ? [l.echantillonFaible ? "faible" : ""] : []),
    ...(avecSansLien ? [l.href ? "oui" : "non cliquable"] : []),
  ];
  const ligneReference: ReactNode[] | null = reference
    ? [
        reference.libelle,
        reference.valeurs.pilote ?? null,
        reference.valeurs.volume ?? null,
        ...colonnes.map((_c, i) => (cleMesures[i] ? (reference.valeurs[cleMesures[i]] ?? null) : null)),
        ...(avecEcart ? ["référence"] : []),
        ...(avecIntervalle ? [null] : []),
        ...(avecFaible ? [""] : []),
        ...(avecSansLien ? ["—"] : []),
      ]
    : null;

  /** Une ligne classée : segment, barre, valeur, mesures, effectif, écart. */
  const contenuLigne = (l: ImpactLigne) => {
    const verdict = verdictPilote(l);
    const couleur = teinte(verdict);
    const bulleValeur = [verdict ? texteVerdict(verdict) : null, l.intervalle ? `intervalle ${l.intervalle}` : null].filter(Boolean).join(" · ");
    const ecart = l.ecart ? decouperEcart(l.ecart.affichage) : null;
    return (
      <>
        {/* Le libellé est le PREMIER <span> de la ligne (les e2e le lisent) : le
            pictogramme est un <svg> ou un <i>, jamais un <span>. */}
        <div className="flex min-w-0 items-center gap-1.5">
          <PictoSegment dimension={dimension} libelle={l.libelle} />
          <span className={`min-w-0 truncate text-xs text-ink ${dimension === "route" || !dimension ? "font-mono" : ""}`} title={l.libelle}>
            {dimension === "route" ? <LibelleRoute route={l.libelle} /> : l.libelle}
          </span>
        </div>
        {/* Le repère ▲ a sa place réservée sur TOUTES les lignes dès qu'une dépasse : les
            pistes gardent la même longueur, les barres restent comparables. */}
        <span
          className={`min-w-0 items-center gap-0.5 ${avecDepassement ? "grid grid-cols-[minmax(0,1fr)_0.5rem]" : "block"}`}
          aria-hidden="true"
          title={depasse(l) ? `au-delà de l'échelle des barres (${pilote(max)})` : undefined}
        >
          <span className="relative block h-2 min-w-0 overflow-hidden rounded-full bg-panel2">
            {l.pilote != null && Number.isFinite(l.pilote) && (
              <span
                aria-hidden="true"
                className={`absolute inset-y-0 left-0 rounded-full ${couleurBarre(couleur)}`}
                data-barre=""
                data-depasse={depasse(l) ? "" : undefined}
                style={{ width: `${Math.max(2, Math.min(1, l.pilote / max) * 100)}%` }}
              />
            )}
          </span>
          {avecDepassement && (
            <i className="text-[8px] not-italic leading-none text-ink-soft" data-testid={depasse(l) ? "impact-depasse" : undefined}>
              {depasse(l) ? "▲" : ""}
            </i>
          )}
        </span>
        <span className="flex items-center justify-end gap-1 whitespace-nowrap text-xs font-semibold tabular-nums text-ink" title={bulleValeur || undefined}>
          <Pastille verdict={verdict} />
          {pilote(l.pilote)}
          {verdict && (
            <span className="sr-only" data-testid="impact-verdict" data-verdict={verdict.kind}>
              {" "}
              {texteVerdict(verdict)}
            </span>
          )}
          {l.intervalle && <span className="sr-only"> (intervalle {l.intervalle})</span>}
        </span>
        {autres.map(({ i }) => {
          const m = l.mesures[i];
          const v = m ? verdictMesure(m) : null;
          const texte = !m || (m.valeur == null && !m.texte) ? "—" : m.affichage;
          return (
            <span
              key={colonnes[i]}
              data-colonne={m?.cle ?? colonnes[i]}
              className={`${celluleLarge} min-w-0 items-center justify-end gap-1 whitespace-nowrap text-xs tabular-nums text-ink-soft`}
              title={v && v.kind !== "etabli" ? texteVerdict(v) : texte.length > 9 ? texte : undefined}
            >
              <Pastille verdict={v} />
              {/* Une mesure textuelle longue (« commentaires sans note ») se coupe dans sa
                  colonne ; le texte entier reste lu et en bulle. */}
              <span className="min-w-0 truncate">{texte}</span>
              {v && <span className="sr-only"> {texteVerdict(v)}</span>}
            </span>
          );
        })}
        <span
          className={`${celluleMoyenne} items-center justify-end gap-1 whitespace-nowrap text-xs tabular-nums ${l.echantillonFaible ? "text-ink-faint" : "text-ink-soft"}`}
          title={l.echantillonFaible ? "échantillon faible : rangé en fin, verdict à lire avec prudence" : undefined}
        >
          {nombre(l.volume)}
          {l.echantillonFaible && (
            <>
              <i aria-hidden="true" className="rounded border border-line px-0.5 text-[9px] font-medium not-italic leading-3 text-ink-soft">
                faible
              </i>
              <span className="sr-only"> échantillon faible</span>
            </>
          )}
        </span>
        {avecEcart && (
          <span
            className={`${celluleMoyenne} items-center justify-end whitespace-nowrap text-xs tabular-nums text-ink`}
            data-testid={l.ecart ? "impact-ecart" : undefined}
            title={l.ecart?.affichage}
          >
            {ecart ? ecart.valeur : "—"}
            {ecart?.reference && <span className="sr-only"> {ecart.reference}</span>}
          </span>
        )}
      </>
    );
  };

  const rangee = (l: ImpactLigne) => {
    const classe = `${grille} h-8 px-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf`;
    return (
      <li key={l.cle} data-testid="impact-ligne" data-faible={l.echantillonFaible ? "1" : undefined} className="border-b border-line/50 last:border-b-0">
        {l.href ? (
          <Link
            href={l.href}
            aria-label={`${l.description}${l.echantillonFaible ? ", échantillon faible" : ""} — ouvrir le détail`}
            className={`${classe} hover:bg-panel2/70`}
          >
            {contenuLigne(l)}
          </Link>
        ) : (
          <div className={classe}>{contenuLigne(l)}</div>
        )}
      </li>
    );
  };
  const tete = lignes.slice(0, visibles);
  const reste = lignes.slice(visibles);

  return (
    <section className={`card min-w-0 ${compact ? "p-3" : "p-3 sm:p-4"}`} data-testid="impact-table" data-tri={tri}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{titre}</h2>
        {onglets && (
          <OngletsDecoupage titre={titre} onglets={onglets} className="min-w-0" compacts />
        )}
        {(commandes || tri !== "fourni") && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 sm:ml-auto" data-testid="impact-commandes">
            {commandes}
            {tri !== "fourni" &&
              (ordres.length > 1 ? (
                <BasculeTri
                  courant={tri}
                  options={ordres.map((id) => ({ id, libelle: LIBELLES_TRI[id], href: triHref[id] }))}
                />
              ) : (
                // Un seul ordre possible : il est écrit, pas proposé comme un choix.
                <span className="text-xs text-ink-soft" data-testid="bascule-tri-seul">
                  Classés par {LIBELLES_TRI[tri].toLowerCase()}
                </span>
              ))}
          </div>
        )}
      </div>
      {tri === "fourni" && ordreLibelle && (
        <p className="mb-2 text-xs text-ink-soft" data-testid="impact-ordre">
          {ordreLibelle}
        </p>
      )}

      {/* Conteneur de requêtes : l'en-tête, la référence et les lignes prennent leurs
          colonnes de la largeur de la TABLE, et restent alignés entre eux. */}
      <div className="[container-type:inline-size]" style={style}>
        {/* Avec `hauteurMax`, la liste défile dans la carte (à partir de 640 px) ; l'en-tête
            et la référence restent collés en haut de la zone. */}
        <div
          className={hauteurMax ? "sm:max-h-[var(--impact-hauteur-max)] sm:overflow-y-auto sm:overscroll-contain" : undefined}
          data-testid={hauteurMax ? "impact-defilement" : undefined}
        >
        <div className={hauteurMax ? "sm:sticky sm:top-0 sm:z-10 sm:bg-panel" : undefined}>
        {/* En-têtes visuels ; l'alternative textuelle porte les en-têtes accessibles. Un
            libellé passe sur DEUX lignes plutôt que d'être rogné (recette du 01/10/2026 :
            « ANS RÉACTION », « NS TOUCHÉES ») ; le texte entier reste en bulle. */}
        <div
          aria-hidden="true"
          className={`${grilleNue} min-h-6 items-end border-b border-line px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase leading-tight tracking-normal text-ink-faint`}
        >
          <span className="min-w-0 truncate">{premiereColonne}</span>
          <span />
          <EnTete classe="flex justify-end" titre={libelleValeur}>
            {fleche("gravite")}
            {libelleValeur}
          </EnTete>
          {autres.map(({ c }) => (
            <EnTete key={c} classe={`${celluleLarge} justify-end`} titre={c}>
              {c}
            </EnTete>
          ))}
          <EnTete classe={`${celluleMoyenne} justify-end`} titre={volumeLibelle}>
            {fleche("volume")}
            {volumeLibelle}
          </EnTete>
          {avecEcart && (
            <EnTete classe={`${celluleMoyenne} justify-end`} titre="Écart à l'ensemble">
              Δ ensemble
            </EnTete>
          )}
        </div>

        {reference ? (
          <div
            className={`${grille} h-7 border-b border-dashed border-line bg-panel2/40 px-2 text-xs text-ink-soft`}
            data-testid="impact-reference"
            title="référence, non classée"
          >
            <span className="min-w-0 truncate font-medium text-ink" title={reference.libelle}>
              {reference.libelle}
              <span className="sr-only"> — référence, non classée</span>
            </span>
            {/* La référence n'a pas de barre : elle se lit à côté, elle ne se classe pas. */}
            <span aria-hidden="true" />
            {/* Chaque cellule dit sa colonne au lecteur d'écran (l'en-tête visuel est
                décoratif) : « Vues 4 », « LCP p75 2,5 s ». */}
            <span className="whitespace-nowrap text-right font-semibold tabular-nums text-ink">
              <span className="sr-only">{libelleValeur} </span>
              {reference.valeurs.pilote ?? "—"}
            </span>
            {autres.map(({ c, i }) => (
              <CelluleReference key={c} classe={celluleLarge} colonne={c} texte={cleMesures[i] ? reference.valeurs[cleMesures[i]] : undefined} />
            ))}
            <CelluleReference classe={celluleMoyenne} colonne={volumeLibelle} texte={reference.valeurs.volume} />
            {avecEcart && <span className={`${celluleMoyenne} justify-end text-[11px] text-ink-faint`}>réf.</span>}
          </div>
        ) : (
          <p className="border-b border-dashed border-line px-2 py-1 text-xs text-ink-soft" data-testid="impact-reference-absente">
            Pas de ligne « Ensemble » : {referenceRaison}
          </p>
        )}
        </div>

        {lignes.length === 0 ? (
          <p className="px-2 py-3 text-xs text-ink-soft">Aucun groupe à classer sur la fenêtre.</p>
        ) : (
          <>
            <ol className="flex flex-col">{tete.map(rangee)}</ol>
            {reste.length > 0 && (
              <details className="group border-t border-line/50" data-testid="impact-reste">
                <summary className="flex h-8 cursor-pointer select-none items-center px-2 text-xs font-medium text-perf-ink hover:underline dark:text-perf">
                  <span className="group-open:hidden">Voir les {reste.length.toLocaleString("fr-FR")} autres</span>
                  <span className="hidden group-open:inline">Replier les {reste.length.toLocaleString("fr-FR")} autres</span>
                </summary>
                <ol start={visibles + 1} className="flex flex-col">
                  {reste.map(rangee)}
                </ol>
              </details>
            )}
          </>
        )}
        </div>
      </div>

      {/* Le pied : l'effectif du classement, sa méthode, son alternative — une ligne
          fermée, un repli ouvert prend toute la largeur. */}
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11px] text-ink-soft [&>details[open]]:basis-full">
        <p data-testid="impact-couverture" className="tabular-nums">
          {groupes.toLocaleString("fr-FR")} {accord(groupes, "groupe")} · {lignes.length.toLocaleString("fr-FR")}{" "}
          {accord(lignes.length, "classé")}
          <span className="sr-only">
            {tronque ? " — les autres ne sont ni repliés dans « Autres », ni additionnés : un p75 ne s'additionne pas." : "."}
          </span>
        </p>
        {(notice?.trim() || tronque || avecFaible || avecDepassement) && (
          <details className="min-w-0" data-testid="impact-methode">
            <summary className="cursor-pointer select-none font-medium hover:text-ink">Méthode</summary>
            <div className="mt-1 space-y-1 leading-relaxed">
              {notice?.trim() && <p>{notice}</p>}
              {tronque && (
                <p>
                  {lignes.length.toLocaleString("fr-FR")} groupes classés sur {groupes.toLocaleString("fr-FR")} : les autres ne sont ni repliés
                  dans « Autres », ni additionnés — un p75 ne s&apos;additionne pas.
                </p>
              )}
              {avecFaible && <p>« faible » : échantillon sous le seuil de la dimension ; la ligne est rangée en fin et son verdict se lit avec prudence.</p>}
              {avecDepassement && (
                <p data-testid="impact-echelle">
                  Barres : 100 % = {pilote(max)}, échelle robuste (90ᵉ centile × 1,25, jamais sous une ligne à effectif suffisant) ; ▲ =
                  valeur au-delà, barre plafonnée (la valeur écrite reste exacte).
                </p>
              )}
            </div>
          </details>
        )}
        {lignes.length > 0 && (
          <TableAlternative
            alternative={{
              legende: `${titre} — ${lignes.length.toLocaleString("fr-FR")} ${accord(lignes.length, "groupe affiché", "groupes affichés")} sur ${groupes.toLocaleString("fr-FR")}${
                tri === "fourni" ? `, ${ordreLibelle ?? "ordre de la source"}` : `, classés par ${LIBELLES_TRI[tri].toLowerCase()}`
              }`,
              colonnes: enTetes,
              lignes: [...(ligneReference ? [ligneReference] : []), ...lignes.map(ligneAlternative)],
            }}
          />
        )}
      </div>
    </section>
  );
}
