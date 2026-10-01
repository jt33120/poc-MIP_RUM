// Distribution d'un Web Vital sur ses seuils (F05, plan § 4.2, P2 et P7) — rendu
// serveur, SVG déterministe.
//
// POURQUOI UNE DISTRIBUTION. Un p75 dit où passe le quart le plus lent, pas à quoi
// ressemble la population : deux pages au même p75 peuvent avoir l'une une bosse
// nette, l'autre une longue traîne. Ici, la forme se voit, avec ses repères p50 /
// p75 / p95 — calculés par la base, jamais moyennés ici (V5).
//
// LA COULEUR EST CELLE DE LA MESURE, PAS DU BAC. Une barre est colorée par la zone
// de seuil de chaque valeur qu'elle couvre (Bon / À améliorer / Mauvais, seuils de
// lib/rating.ts) ; une barre à cheval sur un seuil est COUPÉE au seuil. Ce n'est pas
// un verdict sur la population — seul le p75 en porte un (R-V) — et la légende le dit.
//
// LA DERNIÈRE BARRE EST « ≥ PLAFOND ». Les valeurs au-delà du plafond d'affichage
// sont regroupées à part, et dites comme telles : les étaler sur l'axe écraserait
// la forme, les taire la mentirait.
//
// Les bacs ne sont pas cliquables : le contrat ne filtre pas sur une valeur de
// mesure (§ 3.3). L'alternative textuelle le rappelle.
//
// ÉTIQUETTES SANS CHEVAUCHEMENT (recette du 26/09/2026). Les repères avaient chacun
// leur ligne, mais le trait d'un repère traversait l'étiquette du suivant (« p50
// 56 ms » sous « p75 92 ms ») et l'axe CLS écrivait « 0,000,100 » (deux graduations
// au même endroit). Les étiquettes des repères sont désormais rangées AU-DESSUS du
// tracé, sur le moins de rangées possible (`rangerEtiquettes`), et les traits
// partent du haut du tracé : aucun ne traverse un texte. Les graduations de l'axe
// partagent une unité et une précision, et celle qui n'a pas la place est omise.
import { MethodeRepliee, TableAlternative, type AlternativeTexte } from "./Figure";
import { EtatSurface } from "../states/EtatSurface";
import { etendueCentree, etiquettesAxeLisibles, largeurTexte, rangerEtiquettes } from "@/lib/etiquettes";
import { formatDuVital, formater, type VitalName } from "@/lib/fmt-ids";
import { pluriel } from "@/lib/format";
import { etiquettesGraduations } from "@/lib/graduations";
import { RATING_JETON, SERIE } from "@/lib/palette";
import { RATING_LABEL, THRESHOLDS, rating2026, texteSeuils, type Rating } from "@/lib/rating";

export interface Bac {
  debut: number;
  /** Borne haute exclue ; `Infinity` pour le bac « ≥ plafond ». */
  fin: number;
  n: number;
}

export interface Percentiles {
  p50: number | null;
  p75: number | null;
  p95: number | null;
}

export interface DistributionSeuilsProps {
  vital: VitalName;
  /** `vitalHistogram` : bacs linéaires jusqu'au plafond, puis le bac « ≥ plafond » (`bacsDeHistogramme`). */
  bacs: Bac[];
  /** Plafond d'affichage ; les bacs qui commencent au plafond forment la dernière barre, « ≥ plafond ». */
  plafond: number;
  /** « plafond d'affichage : p99 arrondi (320 ms) » quand il n'est pas `VITAL_CAP`. */
  plafondLibelle?: string;
  percentiles: Percentiles | null;
  n: number;
  /** « cette vue : 3,1 s », « p75 toutes routes ». */
  valeurMarquee?: { valeur: number; libelle: string };
  /** P*.1 : bande grisée autour du repère p75. */
  intervalleP75?: { bas: number; haut: number } | null;
  /** false : l'alternative est portée par la `Figure` englobante (`alternativeDistribution`). */
  alternative?: boolean;
  /**
   * Où va la légende chiffrée (`distribution-legende`) : `methode` (défaut), repliée sous
   * le dessin ; `lue`, en `sr-only` quand la `Figure` englobante porte déjà la lecture
   * dans SA « Méthode » (une seule « Méthode » par figure) ; `visible`, en clair.
   */
  legende?: "methode" | "lue" | "visible";
}

/**
 * Sortie de `width_bucket(v, 0, plafond, nbacs)` → `nbacs` bacs linéaires + le bac
 * « ≥ plafond » (bucket nbacs + 1). Une valeur négative (théorique) rejoint le
 * premier bac ; un bac absent de la lecture vaut 0 (c'est un compte).
 */
export function bacsDeHistogramme(
  rows: { bucket: number | string; count: number | string }[],
  plafond: number,
  nbacs = 20,
): Bac[] {
  const largeur = plafond / nbacs;
  const comptes = new Array<number>(nbacs + 1).fill(0);
  for (const r of rows) {
    const b = Number(r.bucket);
    const c = Number(r.count) || 0;
    if (!Number.isFinite(b)) continue;
    if (b <= 1) comptes[0] += c;
    else if (b >= nbacs + 1) comptes[nbacs] += c;
    else comptes[b - 1] += c;
  }
  return comptes.map((n, i) =>
    i === nbacs ? { debut: plafond, fin: Number.POSITIVE_INFINITY, n } : { debut: i * largeur, fin: (i + 1) * largeur, n },
  );
}

const W = 320;
const H = 132;
const BAS = 16; // libellés d'axe
const DEBORD = 22; // largeur de la barre « ≥ plafond »
const ECART = 6; // espace avant elle
const LIGNE = 9; // hauteur d'une ligne d'étiquettes de repère
const JOINT = 0.5; // espace entre deux barres voisines
const POLICE = 8; // corps des étiquettes (unités du viewBox)

/** Zones de seuil sur [0, +∞) : [debut, fin, verdict]. */
function zones(vital: VitalName): [number, number, Rating][] {
  const [bon, mauvais] = THRESHOLDS[vital];
  return [
    [0, bon, "good"],
    [bon, mauvais, "needs-improvement"],
    [mauvais, Number.POSITIVE_INFINITY, "poor"],
  ];
}

/** Texte d'une borne de bac. */
function borne(vital: VitalName, v: number): string {
  return formater(formatDuVital(vital), v);
}

/** L'alternative textuelle : un bac par ligne, ses bornes, son effectif. */
export function alternativeDistribution(p: Pick<DistributionSeuilsProps, "vital" | "bacs" | "plafond" | "percentiles" | "n">): AlternativeTexte {
  const pc = p.percentiles;
  const reperes = pc
    ? `p50 ${formater(formatDuVital(p.vital), pc.p50)}, p75 ${formater(formatDuVital(p.vital), pc.p75)}, p95 ${formater(formatDuVital(p.vital), pc.p95)}`
    : "percentiles non calculables";
  return {
    legende: `Distribution ${p.vital} : ${p.n.toLocaleString("fr-FR")} mesures ; ${reperes}. Bacs non cliquables : le contrat ne filtre pas sur une valeur de mesure.`,
    colonnes: ["Bac", "De", "À", "Mesures", "Zone"],
    lignes: p.bacs.map((b, i) => [
      Number.isFinite(b.fin) ? `${i + 1}` : `≥ plafond`,
      borne(p.vital, b.debut),
      Number.isFinite(b.fin) ? borne(p.vital, b.fin) : "et au-delà",
      b.n,
      zonesDuBac(p.vital, b)
        .map((z) => RATING_LABEL[z])
        .join(" / "),
    ]),
  };
}

/** Les verdicts des valeurs couvertes par un bac (plusieurs s'il est à cheval). */
function zonesDuBac(vital: VitalName, b: Bac): Rating[] {
  return zones(vital)
    .filter(([de, a]) => b.debut < a && b.fin > de)
    .map(([, , r]) => r);
}

export function DistributionSeuils({
  vital,
  bacs,
  plafond,
  plafondLibelle,
  percentiles,
  n,
  valeurMarquee,
  intervalleP75,
  alternative = true,
  legende = "methode",
}: DistributionSeuilsProps) {
  if (n === 0) {
    return <EtatSurface etat={{ kind: "vide", population: `mesure ${vital}`, plage: "la fenêtre" }} />;
  }
  const lineaires = bacs.filter((b) => b.debut < plafond);
  const debords = bacs.filter((b) => b.debut >= plafond);
  const nDebord = debords.reduce((s, b) => s + b.n, 0);
  const max = Math.max(1, ...bacs.map((b) => b.n));
  const fmt = (v: number | null) => formater(formatDuVital(vital), v);

  const largeurAxe = W - DEBORD - ECART;
  const x = (v: number) => (Math.min(Math.max(v, 0), plafond) / plafond) * largeurAxe;
  const xDebord = largeurAxe + ECART;
  const yBas = H - BAS;

  // Zone de la barre « ≥ plafond » : une seule si toutes ses valeurs y tombent.
  const zoneDebord = zones(vital).find(([de, a]) => plafond >= de && a === Number.POSITIVE_INFINITY)?.[2] ?? null;
  const pc = percentiles && [percentiles.p50, percentiles.p75, percentiles.p95].some((v) => v != null) ? percentiles : null;

  // Un repère : sa position, ou la barre « ≥ plafond » quand il la dépasse.
  const position = (v: number) => (v >= plafond ? xDebord + DEBORD / 2 : x(v));
  const reperes: { cle: string; valeur: number; libelle: string; dash?: string; epaisseur: number; couleur?: string }[] = [];
  if (valeurMarquee) {
    const libelle = `${valeurMarquee.libelle} ${fmt(valeurMarquee.valeur)}`;
    reperes.push({ cle: "marque", valeur: valeurMarquee.valeur, libelle, epaisseur: 2, couleur: SERIE.principale });
  }
  if (pc?.p95 != null) reperes.push({ cle: "p95", valeur: pc.p95, libelle: `p95 ${fmt(pc.p95)}`, dash: "4 2", epaisseur: 1 });
  if (pc?.p75 != null) reperes.push({ cle: "p75", valeur: pc.p75, libelle: `p75 ${fmt(pc.p75)}`, epaisseur: 1.5 });
  if (pc?.p50 != null) reperes.push({ cle: "p50", valeur: pc.p50, libelle: `p50 ${fmt(pc.p50)}`, dash: "1 2", epaisseur: 1 });

  // Étiquettes des repères, centrées sur leur trait et gardées dans le cadre, rangées
  // sur le moins de rangées possible : la hauteur réservée suit le nombre de rangées.
  const textes = reperes.map((r) => (r.valeur >= plafond ? `${r.libelle} (≥ plafond)` : r.libelle));
  const etendues = reperes.map((r, i) => etendueCentree(position(r.valeur), largeurTexte(textes[i], POLICE), 0, W));
  const rangees = rangerEtiquettes(etendues, Math.max(reperes.length, 1), 3);
  const nbRangees = Math.max(1, ...rangees.map((r) => r + 1));
  const HAUT = nbRangees * LIGNE + 4;
  const hauteurUtile = H - BAS - HAUT;
  const hauteur = (c: number) => (c / max) * hauteurUtile;

  // Graduations de l'axe : 0, les seuils sous le plafond, le plafond — une seule unité,
  // une seule précision, et celles qui se chevaucheraient sont omises.
  const valeursAxe = [0, ...THRESHOLDS[vital].filter((t) => t > 0 && t < plafond), plafond];
  const textesAxe = etiquettesGraduations(valeursAxe, formatDuVital(vital)).map((t, i) =>
    i === valeursAxe.length - 1 ? `≥ ${t}` : t,
  );
  const etenduesAxe = valeursAxe.map((v, i) => {
    const l = largeurTexte(textesAxe[i], POLICE);
    const px = i === valeursAxe.length - 1 ? W : x(v);
    if (i === 0) return { debut: 0, fin: l };
    if (i === valeursAxe.length - 1) return { debut: W - l, fin: W };
    return { debut: px - l / 2, fin: px + l / 2 };
  });
  const axeLisible = new Set(etiquettesAxeLisibles(etenduesAxe, 3));

  // La légende complète, chiffrée. Repliée dans « Méthode » par défaut (recette du
  // 30/09/2026 : trois paragraphes de trois lignes, un sous chaque histogramme) ; lue
  // seulement (`sr-only`) quand la figure englobante porte déjà sa « Méthode ».
  const texteLegende = (
    <p
      className={legende === "lue" ? "sr-only" : `${legende === "visible" ? "mt-2" : ""} text-[11px] leading-relaxed text-ink-soft`}
      data-testid="distribution-legende"
    >
      Couleur = zone de seuil de chaque mesure ({texteSeuils(vital)}) ; une barre à cheval sur un seuil est coupée au
      seuil. Ce n&apos;est pas un verdict : seul le p75 en porte un. Dernière barre : {pluriel(nDebord, "mesure")} ≥{" "}
      {fmt(plafond)}
      {plafondLibelle ? ` (${plafondLibelle})` : " (plafond d'affichage)"}. Repères :{" "}
      {pc
        ? [
            pc.p50 != null ? `p50 ${fmt(pc.p50)} (pointillé)` : null,
            pc.p75 != null ? `p75 ${fmt(pc.p75)} (trait plein)` : null,
            pc.p95 != null ? `p95 ${fmt(pc.p95)} (tirets)` : null,
          ]
            .filter(Boolean)
            .join(", ")
        : "p50 pointillé, p75 plein, p95 tirets"}
      {valeurMarquee ? `, ${valeurMarquee.libelle} en orange` : ""}.
      {!pc && legende === "visible" && <strong className="font-medium text-ink"> Percentiles non calculables.</strong>}
    </p>
  );

  const aria = `Distribution ${vital} : ${n.toLocaleString("fr-FR")} mesures${
    pc ? `, p50 ${fmt(pc.p50)}, p75 ${fmt(pc.p75)}, p95 ${fmt(pc.p95)}` : ", percentiles non calculables"
  }${nDebord > 0 ? `, ${nDebord.toLocaleString("fr-FR")} au-delà de ${fmt(plafond)}` : ""}`;

  return (
    <div className="min-w-0" data-testid="distribution-seuils">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={aria}>
        {/* Zones pleines en fond (P2) : la zone se lit même là où il n'y a pas de barre. */}
        {zones(vital).map(([de, a, r]) =>
          de < plafond ? (
            // `zone-seuil` : opacité relevée en thème sombre (app/globals.css), où 7 %
            // rendait « À améliorer » et « Mauvais » presque invisibles.
            <rect
              key={r}
              x={x(de)}
              y={HAUT}
              width={x(Math.min(a, plafond)) - x(de)}
              height={hauteurUtile}
              fill={RATING_JETON[r]}
              opacity={0.07}
              className="zone-seuil"
            />
          ) : null,
        )}

        {/* Barres, coupées aux seuils : chaque morceau prend la zone de ses valeurs. */}
        {lineaires.map((b, i) => {
          const h = hauteur(b.n);
          if (h <= 0) return null;
          return zones(vital)
            .filter(([de, a]) => b.debut < a && Math.min(b.fin, plafond) > de)
            .map(([de, a, r]) => {
              const x0 = x(Math.max(b.debut, de));
              const x1 = x(Math.min(b.fin, a, plafond));
              return (
                <rect key={`${i}-${r}`} x={x0 + JOINT / 2} y={yBas - h} width={Math.max(x1 - x0 - JOINT, JOINT)} height={h} fill={RATING_JETON[r]} opacity={0.85}>
                  <title>{`${borne(vital, b.debut)} – ${borne(vital, b.fin)} : ${pluriel(b.n, "mesure")}`}</title>
                </rect>
              );
            });
        })}

        {/* Barre « ≥ plafond » : à part, grise si elle mêle plusieurs zones. */}
        <rect
          x={xDebord}
          y={yBas - hauteur(nDebord)}
          width={DEBORD}
          height={hauteur(nDebord)}
          fill={zoneDebord ? RATING_JETON[zoneDebord] : "currentColor"}
          opacity={zoneDebord ? 0.85 : 0.35}
          className={zoneDebord ? undefined : "text-ink-soft"}
        >
          <title>{`≥ ${fmt(plafond)} : ${pluriel(nDebord, "mesure")}`}</title>
        </rect>
        <line x1={0} x2={W} y1={yBas + 0.5} y2={yBas + 0.5} stroke="currentColor" strokeWidth={0.5} className="text-line" />

        {/* Bande d'incertitude du p75 (P*.1). */}
        {intervalleP75 && (
          <rect
            x={position(intervalleP75.bas)}
            y={HAUT}
            width={Math.max(position(intervalleP75.haut) - position(intervalleP75.bas), 1)}
            height={hauteurUtile}
            fill="currentColor"
            opacity={0.15}
            className="text-ink-soft"
          >
            <title>{`intervalle du p75 : ${fmt(intervalleP75.bas)} – ${fmt(intervalleP75.haut)}`}</title>
          </rect>
        )}

        {/* Repères : le trait dans le tracé, l'étiquette au-dessus, centrée sur lui, sur
            sa rangée. Un trait ne traverse plus l'étiquette d'un autre repère. */}
        {reperes.map((r, i) => {
          const px = position(r.valeur);
          const rangee = rangees[i];
          return (
            <g key={r.cle} className="text-ink" data-repere={r.cle}>
              <line
                x1={px}
                x2={px}
                y1={HAUT - 2}
                y2={yBas}
                stroke={r.couleur ?? "currentColor"}
                strokeWidth={r.epaisseur}
                strokeDasharray={r.dash}
              />
              {rangee >= 0 && (
                <text x={etendues[i].centre} y={(rangee + 1) * LIGNE - 1} fontSize={POLICE} fill="currentColor" textAnchor="middle">
                  {textes[i]}
                </text>
              )}
            </g>
          );
        })}

        {/* Axe : 0, les seuils, le plafond — ceux qui ont la place. */}
        {valeursAxe.map((t, i) =>
          axeLisible.has(i) ? (
            <text
              key={`${t}-${i}`}
              x={i === valeursAxe.length - 1 ? W : x(t)}
              y={H - 4}
              fontSize={POLICE}
              fill="currentColor"
              textAnchor={i === 0 ? "start" : i === valeursAxe.length - 1 ? "end" : "middle"}
              className="text-ink-soft"
            >
              {textesAxe[i]}
            </text>
          ) : null,
        )}
      </svg>

      {/* L'absence de repères se voit sur le dessin : elle est DITE, sur une ligne. */}
      {!pc && legende !== "visible" && (
        <p className="mt-1 text-[11px] font-medium text-ink" data-testid="distribution-sans-percentiles">
          Percentiles non calculables
        </p>
      )}
      {legende === "methode" ? (
        <MethodeRepliee testId="distribution-methode">{texteLegende}</MethodeRepliee>
      ) : (
        texteLegende
      )}

      {alternative && <TableAlternative alternative={alternativeDistribution({ vital, bacs, plafond, percentiles, n })} />}
    </div>
  );
}
