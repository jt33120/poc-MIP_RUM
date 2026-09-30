// Classement de segments « les plus dégradés » (F05, plan § 4.2, P3) — IP-Label
// « top offenders », avec l'écart à l'ensemble. Rendu serveur, sans JS client.
//
// CE QUE LE CLASSEMENT DIT, ET CE QU'IL NE FAIT JAMAIS.
//   - Les lignes arrivent DÉJÀ classées (`classerParGravite`, lib/impact.ts) : le
//     composant n'ordonne rien, il dit l'ordre (bascule de tri, ou `ordreLibelle`
//     quand l'ordre est celui de la source).
//   - La référence « Ensemble » est une LIGNE DE TABLE distincte, jamais une barre :
//     elle ne se classe pas parmi les segments, elle se lit à côté.
//   - Aucune ligne « Autres », aucun total : un p75 ne s'additionne pas (V5).
//   - Une valeur pilote inconnue n'a pas de barre (une barre nulle se lirait « le
//     meilleur ») ; un échantillon faible est écrit, pas seulement grisé.
//   - Un verdict (Bon / À améliorer / Mauvais) n'est posé que sur une mesure qui
//     porte `vital` — l'appelant ne le donne qu'à un p75 (R-V) — et toujours en
//     texte à côté de la teinte (§ 3.9).
//
// Accessibilité : la grammaire de `Breakdown` — la ligne EST le lien (un arrêt de
// tabulation), les rectangles sont décoratifs, le tableau replié donne tout.
//
// BARRES COMPARABLES (recette du 26/09/2026). La piste était en `flex-1` : sa largeur
// dépendait du texte à droite, et /contact (92 ms) avait une barre plus longue que
// /partners (108 ms). Chaque ligne est désormais une grille aux colonnes FIXES
// (libellé, piste, valeur, détails) : même piste pour toutes, une barre plus longue
// veut dire une valeur plus grande. La valeur classée n'est plus répétée dans les
// colonnes voisines (« LCP p75 92 ms … LCP p75 92 ms ») : la colonne qui la double
// est retirée de la ligne, son verdict passe sur la valeur.
//
// UN VERDICT QUI TIENT SUR SON INTERVALLE (recette du 26/09/2026). La tuile « INP
// p75 304 ms » disait « verdict incertain » ; la même valeur portait « À améliorer »
// ici. Une mesure qui fournit son intervalle (`ImpactMesure.intervalle`) suit la
// règle des tuiles (`lireVital`) : verdict affirmé seulement s'il vaut sur tout
// l'intervalle, sinon « incertain » (ou « non établi » sous 13 mesures), sans
// couleur. Le découpage des Web Vitals lit cet intervalle par groupe
// (`vitalsBreakdown`) : la Vue d'ensemble et /pages suivent la même règle que leurs
// tuiles. Sans intervalle fourni, le verdict est celui de la valeur.
//
// UN SEUL RANG DE COMMANDES. Un ordre non proposé (« Impact », barré en permanence)
// n'est plus affiché ; un sélecteur propre à l'écran (le vital qui classe) se pose
// dans la même rangée que l'ordre (`commandes`), au lieu d'un second « Classé par ».
import Link from "next/link";
import type { ReactNode } from "react";
import { BasculeTri, LIBELLES_TRI, MarqueFaible, OngletsDecoupage, type OngletDecoupage } from "./Breakdown";
import { TableAlternative } from "./charts/Figure";
import { formater, type FormatId, type VitalName } from "@/lib/fmt-ids";
import { accord } from "@/lib/format";
import type { TriClassement } from "@/lib/impact";
import { RATING_BAR, RATING_CLASS, RATING_LABEL, type Rating } from "@/lib/rating";
import type { IntervalleP75 } from "@mip/stats/incertitude";
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

/** Le verdict en mots, tel que la ligne l'écrit à côté de la valeur. */
function motVerdict(v: VerdictVital): string {
  return v.kind === "etabli" ? RATING_LABEL[v.rating] : v.kind === "incertain" ? "verdict incertain" : "verdict non établi";
}

/** Une mesure, avec son verdict écrit quand elle en porte un. */
function Mesure({ m, libelle }: { m: ImpactMesure; libelle: string }) {
  const verdict = verdictMesure(m);
  const couleur = teinte(verdict);
  return (
    // `flex-wrap` : dans une colonne de détails étroite, le verdict passe sous la valeur
    // au lieu de pousser la ligne hors de la carte (la largeur minimale devient celle
    // du plus long des trois morceaux, pas leur somme).
    <span className="inline-flex flex-wrap items-center gap-x-1">
      <span className="text-ink-soft">{libelle}</span>
      {couleur ? (
        <span className={`rounded border px-1 py-px font-medium tabular-nums ${RATING_CLASS[couleur]}`}>{m.affichage}</span>
      ) : (
        <span className="tabular-nums text-ink">{m.valeur == null && !m.texte ? "—" : m.affichage}</span>
      )}
      {verdict && (
        <span className="text-[10px] text-ink-soft" title={verdict.kind === "etabli" ? undefined : texteVerdict(verdict)}>
          {motVerdict(verdict)}
        </span>
      )}
    </span>
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
 * Grille d'une ligne : libellé, piste, valeur, détails. Colonnes BORNÉES par des
 * longueurs, jamais par le contenu : toutes les lignes d'une table gardent la même
 * piste, les barres restent comparables ; à pleine largeur, les colonnes prennent
 * leur maximum.
 *
 * Choisies par la largeur de la TABLE (`@container`), pas par celle de la fenêtre
 * (CI de master rouge du 27/09/2026). Les colonnes FIXES suivaient `sm:` / `lg:` : à
 * 1 024 px, la barre latérale et les marges ne laissent que ≈ 700 px, mais `lg:`
 * posait déjà 12 + 16 + 6 rem, et les détails débordaient de la ligne d'environ
 * 50 px (hors de la carte, sous macOS comme sous Linux). Avec les polices plus larges
 * d'Ubuntu, ils sortaient de la fenêtre : page à 1 026 px, deux E2E rouges. Même
 * correction que `Breakdown` et `ContrastBars` (d013fdac) : les détails gardent au
 * moins 7 rem, et une table étroite repasse sur deux rangées.
 */
const GRILLE_LARGE =
  "[@container_(min-width:32rem)_and_(max-width:47.99rem)]:grid-cols-[minmax(6rem,10rem)_minmax(6rem,12rem)_6rem_minmax(7rem,1fr)] [@container_(min-width:48rem)]:grid-cols-[minmax(7rem,12rem)_minmax(7rem,16rem)_6rem_minmax(7rem,1fr)]";
/** Table de moins de 32 rem (ou carte de tableau de bord) : libellé, puis piste et valeur, puis détails. */
const GRILLE_ETROITE = "grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-x-3 gap-y-1";

/** Place de chaque cellule : deux rangées sous 32 rem de table, une seule au-delà (sauf en carte compacte). */
const CELLULES = {
  etroite: { libelle: "col-span-2", piste: "col-start-1", valeur: "col-start-2", details: "col-span-2", vide: "hidden" },
  large: {
    libelle: "col-span-2 [@container_(min-width:32rem)]:col-span-1",
    piste: "col-start-1 [@container_(min-width:32rem)]:col-start-2",
    valeur: "col-start-2 [@container_(min-width:32rem)]:col-start-3",
    details: "col-span-2 [@container_(min-width:32rem)]:col-span-1 [@container_(min-width:32rem)]:col-start-4",
    vide: "hidden [@container_(min-width:32rem)]:block",
  },
} as const;

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

/** Préfixe « ≈ » d'une valeur approchée ; « — » reste « — ». */
function approche(texte: string, approchee: boolean): string {
  return approchee && texte !== "—" ? `≈${String.fromCharCode(0xa0)}${texte}` : texte;
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
  /** Provenance de la dimension (BREAKDOWN_NOTICES) ; vide ou absente : aucun paragraphe. */
  notice?: string;
  /** Carte de tableau de bord. */
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
}) {
  const pilotes = lignes.map((l) => l.pilote).filter((p): p is number => p != null && Number.isFinite(p));
  // Base 100 % : la plus grande valeur. Plus « au moins 1 » : un CLS (0,1 ; 0,25)
  // n'occupait qu'un quart de la piste.
  const max = Math.max(0, ...pilotes) || 1;
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
  const grille = `${GRILLE_ETROITE} ${compact ? "" : GRILLE_LARGE}`;
  const place = compact ? CELLULES.etroite : CELLULES.large;

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
  const cleMesures = lignes[0]?.mesures.map((m) => m.cle) ?? [];
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

  return (
    <section className={`card min-w-0 ${compact ? "p-3" : "mb-6 p-4"}`} data-testid="impact-table" data-tri={tri}>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">{titre}</h2>
        {(commandes || tri !== "fourni") && (
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:ml-auto" data-testid="impact-commandes">
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
        <p className="-mt-2 mb-3 text-xs text-ink-soft" data-testid="impact-ordre">
          {ordreLibelle}
        </p>
      )}

      {onglets && <OngletsDecoupage titre={titre} onglets={onglets} />}
      {/* Une notice vide ne laisse pas de paragraphe vide (et sa marge) sous le titre. */}
      {notice?.trim() && <p className={`mb-3 leading-relaxed text-ink-soft ${compact ? "text-[11px]" : "text-xs"}`}>{notice}</p>}

      {/* Conteneur de requêtes : la référence et les lignes prennent leurs colonnes de
          la largeur de la table (voir GRILLE_LARGE), et restent alignées entre elles. */}
      <div className="[container-type:inline-size]">
        {reference ? (
          <div
            className={`mb-2 rounded-lg border border-dashed border-line px-2 py-1.5 text-xs ${grille}`}
            data-testid="impact-reference"
          >
            {/* Passe à la ligne plutôt que d'être coupé : « Ensemble (toute la population filtrée) ». */}
            <span className={`${place.libelle} min-w-0 break-words font-semibold text-ink`}>{reference.libelle}</span>
            {/* La référence n'a pas de barre : elle se lit à côté, elle ne se classe pas. */}
            <span className={place.vide} aria-hidden="true" />
            <span className={`${place.valeur} text-right font-semibold tabular-nums text-ink`}>
              {reference.valeurs.pilote ?? "—"}
            </span>
            <span className={`${place.details} flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5`}>
              {reference.valeurs.volume && (
                <span className="tabular-nums text-ink-soft">
                  {volumeLibelle} {reference.valeurs.volume}
                </span>
              )}
              {cleMesures.map((cle, i) =>
                i !== doublon && reference.valeurs[cle] ? (
                  <span key={cle} className="tabular-nums text-ink-soft">
                    {colonnes[i]} {reference.valeurs[cle]}
                  </span>
                ) : null,
              )}
              <span className="text-[11px] text-ink-soft">référence, non classée</span>
            </span>
          </div>
        ) : (
          <p className="mb-2 text-xs text-ink-soft" data-testid="impact-reference-absente">
            Pas de ligne « Ensemble » : {referenceRaison}
          </p>
        )}

        {lignes.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">Aucun groupe à classer sur la fenêtre.</p>
        ) : (
          <ol className="flex flex-col gap-1">
            {lignes.map((l) => {
              const verdict = verdictPilote(l);
              const couleur = teinte(verdict);
              const contenu = (
                <>
                  <span className={`${place.libelle} min-w-0 truncate font-mono text-xs text-ink`} title={l.libelle}>
                    {l.libelle}
                  </span>
                  <span className={`${place.piste} relative h-5 min-w-0 overflow-hidden rounded bg-panel2`}>
                    {l.pilote != null && Number.isFinite(l.pilote) && (
                      <span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 rounded ${couleurBarre(couleur)}`}
                        data-barre=""
                        style={{ width: `${Math.max(2, (l.pilote / max) * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className={`${place.valeur} text-right`}>
                    <span
                      className={`text-xs font-semibold tabular-nums ${
                        couleur ? `rounded border px-1 py-px ${RATING_CLASS[couleur]}` : "text-ink"
                      }`}
                    >
                      {pilote(l.pilote)}
                    </span>
                  </span>
                  <span className={`${place.details} flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs`}>
                    {verdict && (
                      <span className="text-[10px] text-ink-soft" data-testid="impact-verdict" data-verdict={verdict.kind}>
                        {verdict.kind === "etabli" ? motVerdict(verdict) : texteVerdict(verdict)}
                      </span>
                    )}
                    <span className="tabular-nums text-ink-soft">
                      {volumeLibelle} <span className="text-ink">{nombre(l.volume)}</span>
                    </span>
                    {l.mesures.map((m, i) => (i === doublon ? null : <Mesure key={m.cle} m={m} libelle={colonnes[i] ?? m.cle} />))}
                    {l.ecart && (
                      <span className="tabular-nums text-ink" data-testid="impact-ecart">
                        {l.ecart.affichage}
                      </span>
                    )}
                    {l.intervalle && <span className="tabular-nums text-ink-soft">{l.intervalle}</span>}
                    {l.echantillonFaible && <MarqueFaible />}
                  </span>
                </>
              );
              const classe = `${grille} rounded-lg px-2 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf`;
              return (
                <li key={l.cle} data-testid="impact-ligne" data-faible={l.echantillonFaible ? "1" : undefined}>
                  {l.href ? (
                    <Link
                      href={l.href}
                      aria-label={`${l.description}${l.echantillonFaible ? ", échantillon faible" : ""} — ouvrir le détail`}
                      className={`${classe} hover:bg-panel2/70`}
                    >
                      {contenu}
                    </Link>
                  ) : (
                    <div className={classe}>{contenu}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

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

      <p className="mt-2 text-xs text-ink-soft" data-testid="impact-couverture">
        {groupes.toLocaleString("fr-FR")} {accord(groupes, "groupe")} sur la fenêtre, {lignes.length.toLocaleString("fr-FR")}{" "}
        {accord(lignes.length, "affiché")}
        {tronque
          ? " — les autres ne sont ni repliés dans « Autres », ni additionnés : un p75 ne s'additionne pas."
          : "."}
      </p>
    </section>
  );
}
