// ResultatAnalyse — la traduction UNIQUE « résultat Explorer → figure » (F32, plan
// § 4.3, W-E3 à W-E6, W-E8). Rendu serveur ; seules les séries (recharts) sont des
// îlots client, et elles ne reçoivent que des données sérialisables.
//
// POURQUOI UN SEUL COMPOSANT. L'Explorer et les cartes de tableau de bord (F36)
// affichent le même objet — un plan, sa méta, ses données. Deux traductions
// finiraient par dire deux choses différentes du même chiffre : ici, une seule
// décide de la forme, du verdict et de ce que la figure déclare.
//
// LA FORME SUIT L'ADDITIVITÉ (`estAdditive`). Un compte ou une somme se découpe en
// parts d'un total, s'empile, se lit en barres ; un percentile, une moyenne, un
// dénombrement de distincts ne s'additionnent pas : classement à écart à
// l'« Ensemble » (`ImpactTable`), séries en lignes sur un axe partagé, jamais
// empilées, jamais de ligne « Autres ».
//
// LE VERDICT SUIT R-V. `vitalDeVerdict(plan)` est la seule porte : badge de la
// tuile, bandes de la série et verdict d'un classement n'existent que pour le p75
// d'un Web Vital. Une moyenne ou un p95 de LCP n'a ni badge, ni teinte, ni bande —
// et la figure le DIT (`phraseSansVerdict`). `rating2026` n'est jamais appelé ici
// sur `plan.variant` : il ne l'est que par les composants, sur ce que R-V leur passe.
//
// L'INCONNU RESTE INCONNU. Un seau sans mesure est un trou, pas une barre à zéro
// (CE5) ; un groupe sans valeur est « — », rangé en dernier, sans barre (CE2) ;
// un total `null` est « — » avec sa raison (V3).
import Link from "next/link";
import type { ReactNode } from "react";
import { Figure, type AlternativeTexte } from "@/components/charts/Figure";
import { ImpactTable, type ImpactLigne, type TriImpact } from "@/components/ImpactTable";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar, type RankDatum } from "@/components/charts/RankBar";
import { StackedBars, type SerieEmpilee } from "@/components/charts/StackedBars";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { datasetDefinition, estAdditive, type ExplorerPlan } from "@/lib/analytics-schema";
import type { CouverturePrecedente } from "@/lib/comparaison";
import {
  formatDeMesure,
  libelleCle,
  libelleMesure,
  phraseSansVerdict,
  titreResultat,
  vitalDeVerdict,
} from "@/lib/explorer-page-params";
import { formater, type FormatId } from "@/lib/fmt-ids";
import { fmtDate } from "@/lib/format";
import { classerParGravite, ecartALaReference, estFaible, SEUIL_ECHANTILLON_FAIBLE } from "@/lib/impact";
import type { ExplorerData, ExplorerMeta, ExplorerPoint } from "@/lib/queries-explorer";
import {
  bucketLabel,
  bucketStarts,
  previousRange,
  rangeLabel,
  type ResolvedRange,
} from "@/lib/query-contract";
import { grilleIso, libelleSeauComplet, type Annotation, type PointSerie, type SerieDef } from "@/lib/series";

/** La période de référence d'une comparaison `cmp=prev`, déjà lue par l'appelant. */
export interface PrecedentResultat {
  /** Total de la période précédente (tuile « Valeur »). */
  total: number | null;
  /** Série de la période précédente, même plan (série sans groupe). */
  series?: ExplorerPoint[];
  /** Référence écrite en clair : « vs 24 h précédentes (…) ». */
  plage: string;
  couverture: CouverturePrecedente;
}

/**
 * Liens calculés CÔTÉ SERVEUR : les fonctions ne franchissent jamais la frontière
 * client (§ 0.3) — les îlots recharts ne reçoivent que des chaînes.
 */
export interface HrefsResultat {
  /** Drill-down d'un groupe (§ 3.3) : l'Explorer filtré sur ses valeurs. */
  groupe: (key: (string | null)[]) => string;
  /** Gabarit `{from}` / `{to}` du zoom sur un seau (W-E5). */
  zoom?: string;
  /** Destination d'une session du journal (W-E6). */
  session?: (id: string) => string;
  /** Bascule d'ordre du classement non additif (P3) ; absente : gravité seule. */
  tri?: Record<TriImpact, string | null>;
  /** « Lignes suivantes » du journal. */
  suivant?: string | null;
}

/** Sous ce nombre de mesures, un vital est un échantillon faible (§ 3.12). */
const FAIBLE_VITAL = 100;

/** Effectif d'une ligne de résultat : des LIGNES de la population, pas des occurrences. */
const UNITE_EFFECTIF = "lignes de population";

/**
 * Seuil d'échantillon faible d'une valeur : 100 pour un vital (§ 3.12), 30 pour une
 * autre estimation (P3), aucun pour un compte — une somme n'est pas une estimation.
 */
function faibleSousDe(plan: ExplorerPlan): number {
  if (estAdditive(plan.measure.aggregation)) return 0;
  return plan.dataset === "vitals" ? FAIBLE_VITAL : SEUIL_ECHANTILLON_FAIBLE;
}

const nombre = (n: number) => n.toLocaleString("fr-FR");

/**
 * L'unité à écrire après une valeur formatée : seulement quand le format n'en porte
 * pas (« 6 occurrences »). « 2,4 s », « 18 Ko », un CLS : l'unité est déjà dite.
 */
function uniteApres(format: FormatId, unite: string): string {
  return format === "count" || format === "ratio" ? ` ${unite}` : "";
}

/** La plage lue, en toutes lettres : « 24 h » ou « du 17/09 10:00 au 17/09 12:00 (UTC) ». */
function plageLue(meta: ExplorerMeta): string {
  const range: ResolvedRange = {
    from: meta.range.from,
    to: meta.range.to,
    preset: meta.range.preset as ResolvedRange["preset"],
    bucketSeconds: meta.range.bucket_seconds,
  };
  return range.preset ? rangeLabel(range, "UTC") : `${rangeLabel(range, "UTC")} (UTC)`;
}

/**
 * W-E8 — ce que la figure déclare (P11) : population comptée, effectif, fenêtre
 * réellement lue, seau, additivité, caractère approché, source, raison pour laquelle
 * l'agrégat n'a pas servi, apps effectives, couverture, troncature. Jamais vide dès
 * qu'une ligne a été lue. Exporté pour les tests.
 */
export function metaResultat(plan: ExplorerPlan, meta: ExplorerMeta, data: ExplorerData): string[] {
  const morceaux = [
    `Compte : ${meta.counting}`,
    `${nombre(data.samples)} ${UNITE_EFFECTIF}`,
    `fenêtre ${plageLue(meta)}`,
  ];
  if (plan.visualization === "timeseries") morceaux.push(`seaux de ${bucketLabel(meta.range.bucket_seconds)} (UTC)`);
  morceaux.push(meta.additive ? "agrégation additive" : "agrégation non additive");
  if (meta.approximate) morceaux.push("valeur approchée");
  morceaux.push(`source : ${meta.source === "rollup+raw" ? "agrégat + lignes" : "lignes brutes"}`);
  if (meta.rollup.reason) morceaux.push(`agrégat non utilisé : ${meta.rollup.reason}`);
  morceaux.push(
    meta.effective_apps === null ? "toutes les apps autorisées" : `apps : ${meta.effective_apps.join(", ")}`,
  );
  morceaux.push(meta.coverage.status === "complete" ? "couverture complète" : `couverture partielle : ${meta.coverage.reason ?? "raison non lue"}`);
  if (meta.truncated_groups && (plan.visualization === "toplist" || plan.visualization === "timeseries")) {
    morceaux.push(`${nombre(data.groups.length)} groupes affichés ; le total porte sur toute la population`);
  }
  if (plan.visualization === "table") {
    morceaux.push("aucun tri par mesure : le journal est ordonné par date");
  }
  return morceaux;
}

/** Le total de toute la population, écrit dans la méta hors représentation « Valeur ». */
function Total({ data, format, unite }: { data: ExplorerData; format: FormatId; unite: string }) {
  return (
    <span>
      Total sur toute la population :{" "}
      <strong className="font-semibold tabular-nums text-ink" data-testid="explorer-total">
        {formater(format, data.total)}
      </strong>
      {uniteApres(format, unite)}
    </span>
  );
}

function Meta({ plan, meta, data, format }: { plan: ExplorerPlan; meta: ExplorerMeta; data: ExplorerData; format: FormatId }) {
  const morceaux = metaResultat(plan, meta, data);
  const source = morceaux.findIndex((m) => m.startsWith("source : "));
  return (
    <>
      {plan.visualization !== "value" && <Total data={data} format={format} unite={meta.unit} />}
      {morceaux.map((m, i) =>
        i === source ? (
          <span key={m}>
            source :{" "}
            <span data-testid="explorer-source">{meta.source === "rollup+raw" ? "agrégat + lignes" : "lignes brutes"}</span>
          </span>
        ) : (
          <span key={m}>{m}</span>
        ),
      )}
    </>
  );
}

// ─────────────────────────────── Séries (W-E5) ───────────────────────────────

interface GroupeSerie {
  cle: string;
  effectif: string;
  key: (string | null)[];
}

/**
 * Points d'une série posés sur la grille du contrat (§ 3.10). Un groupe par clé,
 * dans l'ordre des groupes du résultat (les plus hauts d'abord) ; un seau absent
 * n'est pas écrit — c'est `ThresholdSeries` qui en fait un trou (mesure) ou un 0
 * (compte). La période précédente est alignée PAR RANG DE SEAU (§ 3.2) : son i-ème
 * seau se lit sous le i-ème seau courant. Exporté pour les tests.
 */
export function pointsDeSerie(
  meta: ExplorerMeta,
  data: ExplorerData,
  precedent?: ExplorerPoint[],
): { grille: string[]; points: PointSerie[]; groupes: GroupeSerie[] } {
  const range: ResolvedRange = {
    from: meta.range.from,
    to: meta.range.to,
    preset: meta.range.preset as ResolvedRange["preset"],
    bucketSeconds: meta.range.bucket_seconds,
  };
  const starts = bucketStarts(range);
  const grille = grilleIso(starts);
  const indexDe = new Map(starts.map((s, i) => [s, i]));

  const ordre = new Map<string, (string | null)[]>();
  for (const g of data.groups) ordre.set(JSON.stringify(g.key), g.key);
  for (const p of data.series) if (!ordre.has(JSON.stringify(p.key))) ordre.set(JSON.stringify(p.key), p.key);
  const groupes: GroupeSerie[] = [...ordre.values()].map((key, i) => ({ cle: `s${i}`, effectif: `n${i}`, key }));
  const parCle = new Map(groupes.map((g) => [JSON.stringify(g.key), g]));

  const points: PointSerie[] = grille.map((t) => ({ t }));
  const horsGrille: PointSerie[] = [];
  for (const p of data.series) {
    const g = parCle.get(JSON.stringify(p.key));
    if (!g) continue;
    const i = indexDe.get(Date.parse(p.start));
    // Un point hors grille n'est pas rangé de force : `ThresholdSeries` le compte et le dit.
    if (i === undefined) {
      horsGrille.push({ t: p.start, [g.cle]: p.value, [g.effectif]: p.samples });
      continue;
    }
    points[i][g.cle] = p.value;
    points[i][g.effectif] = p.samples;
  }
  if (precedent) {
    const startsPrecedents = bucketStarts(previousRange(range));
    const rangDe = new Map(startsPrecedents.map((s, i) => [s, i]));
    for (const p of precedent) {
      const i = rangDe.get(Date.parse(p.start));
      if (i === undefined || i >= points.length) continue;
      points[i].ref = p.value;
      points[i].nref = p.samples;
    }
  }
  // Seuls les seaux qui portent au moins une valeur sont transmis : la grille dit le reste.
  const portes = points.filter((p) => Object.keys(p).length > 1);
  return { grille, points: [...portes, ...horsGrille], groupes };
}

function serieDuResultat({
  plan,
  meta,
  data,
  precedent,
  hrefs,
  annotations,
  annotationsIndisponibles,
  taille,
  format,
}: {
  plan: ExplorerPlan;
  meta: ExplorerMeta;
  data: ExplorerData;
  precedent?: PrecedentResultat | null;
  hrefs: HrefsResultat;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  taille: "page" | "carte";
  format: FormatId;
}): { dessin: ReactNode; alternative: AlternativeTexte } {
  const additive = estAdditive(plan.measure.aggregation);
  const avecGroupes = plan.groupBy.length > 0;
  const reference = !avecGroupes && precedent?.series ? precedent.series : undefined;
  const { grille, points, groupes } = pointsDeSerie(meta, data, reference);
  const seauSecondes = meta.range.bucket_seconds;
  const hauteur = taille === "page" ? 260 : 160;
  const titre = titreResultat(plan);
  const ariaLabel = `${titre}, ${grille.length} seaux de ${bucketLabel(seauSecondes)} (UTC)`;
  const libelleGroupe = (key: (string | null)[]) => (key.length ? libelleCle(key) : libelleMesure(plan));

  let dessin: ReactNode;
  if (additive && avecGroupes) {
    // Empiler, c'est additionner : permis pour un compte seulement (§ 3.10).
    const series: SerieEmpilee[] = groupes.map((g, i) => ({ cle: g.cle, libelle: libelleGroupe(g.key), categorieIndex: i }));
    dessin = (
      <StackedBars
        grille={grille}
        points={points}
        series={series}
        format={format}
        annotations={annotations}
        annotationsIndisponibles={annotationsIndisponibles}
        seauSecondes={seauSecondes}
        fuseau="UTC"
        zoomHref={hrefs.zoom}
        hauteur={hauteur}
        ariaLabel={ariaLabel}
      />
    );
  } else {
    const series: SerieDef[] = avecGroupes
      ? groupes.map((g, i) => ({
          cle: g.cle,
          libelle: libelleGroupe(g.key),
          role: "categorie",
          categorieIndex: i,
          additive,
          effectifCle: additive ? undefined : g.effectif,
        }))
      : [
          {
            cle: groupes[0]?.cle ?? "s0",
            libelle: libelleMesure(plan),
            role: "principale",
            forme: additive ? "barres" : "ligne",
            additive,
            effectifCle: additive ? undefined : (groupes[0]?.effectif ?? "n0"),
          },
          ...(reference
            ? [
                {
                  cle: "ref",
                  libelle: "Période précédente",
                  role: "reference" as const,
                  additive,
                  effectifCle: additive ? undefined : "nref",
                },
              ]
            : []),
        ];
    const vital = vitalDeVerdict(plan);
    dessin = (
      <ThresholdSeries
        grille={grille}
        points={points}
        series={series}
        format={format}
        vital={vital ?? undefined}
        annotations={annotations}
        annotationsIndisponibles={annotationsIndisponibles}
        seauSecondes={seauSecondes}
        fuseau="UTC"
        zoomHref={hrefs.zoom}
        hauteur={hauteur}
        ariaLabel={ariaLabel}
      />
    );
  }

  // Alternative : une ligne par seau de la grille, mêmes valeurs que le dessin,
  // effectif compris pour une mesure non additive (P10).
  const parT = new Map(points.map((p) => [Date.parse(p.t), p]));
  const colonnesSeries = groupes.flatMap((g) => (additive ? [libelleGroupe(g.key)] : [libelleGroupe(g.key), `n (${libelleGroupe(g.key)})`]));
  const colonnesRef = reference ? (additive ? ["Période précédente"] : ["Période précédente", "n (précédente)"]) : [];
  const valeur = (p: PointSerie | undefined, cle: string) => {
    const v = p?.[cle];
    if (typeof v === "number") return formater(format, v);
    return additive && p?.[cle] === undefined ? formater(format, 0) : "—";
  };
  const effectif = (p: PointSerie | undefined, cle: string) => {
    const v = p?.[cle];
    return typeof v === "number" ? v : 0;
  };
  const alternative: AlternativeTexte = {
    legende: `${titre} — ${grille.length} seaux de ${bucketLabel(seauSecondes)}, heures UTC`,
    colonnes: ["Seau (UTC)", ...colonnesSeries, ...colonnesRef],
    lignes: grille.map((t) => {
      const p = parT.get(Date.parse(t));
      return [
        libelleSeauComplet(t, seauSecondes, "UTC"),
        ...groupes.flatMap((g) => (additive ? [valeur(p, g.cle)] : [valeur(p, g.cle), effectif(p, g.effectif)])),
        ...(reference ? (additive ? [valeur(p, "ref")] : [valeur(p, "ref"), effectif(p, "nref")]) : []),
      ];
    }),
  };
  return { dessin, alternative };
}

// ─────────────────────────────── Classement (W-E4) ───────────────────────────────

/** Classement d'une mesure ADDITIVE : barre = valeur, sous-texte = part du total. */
function donneesRankBar(plan: ExplorerPlan, data: ExplorerData, hrefs: HrefsResultat, format: FormatId): RankDatum[] {
  const connu = (v: number | null): v is number => v !== null && Number.isFinite(v);
  // Une valeur inconnue ferme la liste, sans barre (CE2) ; l'ordre reçu est gardé sinon.
  const tries = data.groups
    .map((g, i) => ({ g, i }))
    .sort((a, b) => (connu(a.g.value) === connu(b.g.value) ? a.i - b.i : connu(a.g.value) ? -1 : 1))
    .map((x) => x.g);
  const total = data.total;
  return tries.map((g) => {
    const part = connu(g.value) && connu(total) && total > 0 ? g.value / total : null;
    const lignes = `${nombre(g.samples)} lignes`;
    return {
      label: libelleCle(g.key),
      // Le libellé complet reste lisible au survol quand la colonne le tronque (P14).
      title: libelleCle(g.key),
      value: g.value,
      display: formater(format, g.value),
      sub: part === null ? lignes : `${formater("pct", part)} du total · ${lignes}`,
      href: hrefs.groupe(g.key),
    };
  });
}

/** Classement d'une mesure NON additive : écart à l'« Ensemble », tri gravité, échantillon faible. */
function lignesImpact(
  plan: ExplorerPlan,
  data: ExplorerData,
  hrefs: HrefsResultat,
  format: FormatId,
  tri: "gravite" | "volume",
): ImpactLigne[] {
  const verdict = vitalDeVerdict(plan);
  const { lignes } = classerParGravite(data.groups, {
    pilote: (g) => g.value,
    effectif: (g) => g.samples,
    tri,
    volume: (g) => g.samples,
  });
  const ecartLibelle = `écart de ${plan.measure.aggregation === "avg" ? "moyenne" : plan.measure.aggregation}`;
  return lignes.map((g) => {
    const libelle = libelleCle(g.key);
    const ecart = ecartALaReference(g.value, data.total);
    const affichageEcart =
      ecart === null ? "—" : `${ecart > 0 ? "+" : ecart < 0 ? "−" : "±"}${formater(format, Math.abs(ecart))} vs ensemble`;
    return {
      cle: JSON.stringify(g.key),
      libelle,
      href: hrefs.groupe(g.key),
      description: `${libelle} : ${formater(format, g.value)}, ${nombre(g.samples)} lignes, ${ecartLibelle} ${affichageEcart}`,
      pilote: g.value,
      volume: g.samples,
      // R-V : le verdict n'est posé que sur le p75 d'un vital.
      mesures: verdict ? [{ cle: "verdict", valeur: g.value, affichage: formater(format, g.value), vital: verdict, n: g.samples }] : [],
      ecart: { valeur: ecart, affichage: affichageEcart },
      echantillonFaible: estFaible(g.samples),
    };
  });
}

// ─────────────────────────────── Journal (W-E6) ───────────────────────────────

/** Une cellule de journal : jamais un objet brut, jamais une valeur inventée. */
function cellule(valeur: unknown): string {
  if (valeur === null || valeur === undefined) return "—";
  if (valeur instanceof Date) return fmtDate(valeur);
  if (typeof valeur === "number") return valeur.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return String(valeur);
}

function Journal({ plan, data, hrefs }: { plan: ExplorerPlan; data: ExplorerData; hrefs: HrefsResultat }) {
  const colonnes = datasetDefinition(plan.dataset).rows;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-table text-sm">
          <caption className="sr-only">Journal des lignes correspondant à la requête, ordonnées par date</caption>
          <thead className="bg-panel2">
            <tr>
              {colonnes.map((colonne) => (
                <th key={colonne.id} scope="col" className="th">
                  {colonne.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((ligne, index) => (
              <tr key={index} className="border-t border-line/60 align-top hover:bg-panel2/60">
                {colonnes.map((colonne) => {
                  const v = ligne[colonne.id];
                  const lien = colonne.id === "session" && typeof v === "string" && v && hrefs.session ? hrefs.session(v) : null;
                  return (
                    <td key={colonne.id} className="px-4 py-2 text-xs text-ink-soft">
                      {lien ? (
                        <Link href={lien} className="font-mono text-brand hover:underline" data-testid="journal-session">
                          {cellule(v)}
                        </Link>
                      ) : (
                        cellule(v)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hrefs.suivant && (
        <nav className="mt-3 flex justify-end text-sm" aria-label="Pagination du journal">
          <Link
            className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            href={hrefs.suivant}
          >
            Lignes suivantes
          </Link>
        </nav>
      )}
    </>
  );
}

// ─────────────────────────────── Composant ───────────────────────────────

export function ResultatAnalyse({
  plan,
  meta,
  data,
  precedent,
  hrefs,
  annotations,
  annotationsIndisponibles,
  taille,
  tri = "gravite",
  id,
}: {
  plan: ExplorerPlan;
  meta: ExplorerMeta;
  data: ExplorerData;
  /**
   * `undefined` : aucune comparaison demandée. `null` : demandée, mais pas calculée
   * pour cette forme (classement, série à groupes) — la figure dit pourquoi.
   */
  precedent?: PrecedentResultat | null;
  hrefs: HrefsResultat;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  taille: "page" | "carte";
  /** Ordre du classement non additif (P3, `TRIS_PAR_ECRAN["/explorer"]`). */
  tri?: "gravite" | "volume";
  /** Ancre de la figure. */
  id?: string;
}) {
  const format = formatDeMesure(plan);
  const vital = vitalDeVerdict(plan);
  const additive = estAdditive(plan.measure.aggregation);
  const titre = titreResultat(plan);
  const plage = plageLue(meta);
  const sansVerdict = phraseSansVerdict(plan);
  const vide = data.samples === 0;

  const lectures: string[] = [];
  if (sansVerdict) lectures.push(sansVerdict);
  if (precedent === null) {
    lectures.push(
      plan.visualization === "toplist"
        ? "Comparaison à la période précédente non affichée pour un classement : deux classements côte à côte trompent sur l'ordre."
        : "Comparaison à la période précédente non calculée pour une série à plusieurs groupes : elle doublerait les courbes.",
    );
  }
  if (plan.visualization === "toplist" && !vide) {
    lectures.push(
      additive
        ? "Chaque part est rapportée au total de toute la population, groupes non affichés compris."
        : "L'écart est la différence entre la valeur du groupe et celle de l'ensemble de la population : ce n'est pas une contribution.",
    );
  }
  // Une valeur à zéro se lit « rien ne s'est passé » : la tuile le confirme en toutes
  // lettres. Les autres formes rendent l'état « vide » à la place du dessin.
  const lectureVide = vide && plan.visualization === "value" ? (
    <span data-testid="explorer-vide">
      Aucune ligne ne correspond à cette requête sur la fenêtre demandée : la population est réellement vide, ce n&apos;est pas
      une erreur.
    </span>
  ) : null;
  const lecture =
    lectures.length || lectureVide ? (
      <>
        {lectureVide}
        {lectureVide && lectures.length > 0 && " "}
        {lectures.join(" ")}
      </>
    ) : undefined;
  const meta_ = <Meta plan={plan} meta={meta} data={data} format={format} />;
  const idFigure = id ?? "explorer-resultat";

  // ───── Classement non additif : l'ImpactTable EST la figure (titre, ordre, référence,
  // alternative, couverture) ; la méta W-E8 y est portée par sa notice.
  if (plan.visualization === "toplist" && !additive && !vide && data.groups.length > 0) {
    const lignes = lignesImpact(plan, data, hrefs, format, tri);
    const notice = [
      `Total sur toute la population : ${formater(format, data.total)}${uniteApres(format, meta.unit)}`,
      ...metaResultat(plan, meta, data),
      ...(meta.truncated_groups
        ? [`au moins ${nombre(data.groups.length + 1)} groupes existent : seuls les ${nombre(data.groups.length)} de valeur la plus haute sont lus et classés ici`]
        : []),
    ].join(" · ");
    return (
      <div id={idFigure} data-testid="resultat-analyse" data-forme="impact" data-vital={vital ?? undefined}>
        <ImpactTable
          titre={titre}
          tri={tri}
          triHref={hrefs.tri ?? { gravite: null, volume: null, impact: null, fourni: null }}
          reference={{
            libelle: "Ensemble de la population",
            valeurs: { pilote: formater(format, data.total), volume: nombre(data.samples), ...(vital ? { verdict: formater(format, data.total) } : {}) },
          }}
          lignes={lignes}
          colonnes={vital ? [`Verdict ${vital} p75`] : []}
          unitePilote={format}
          volumeLibelle="Lignes"
          groupes={data.groups.length}
          tronque={meta.truncated_groups}
          notice={notice}
          compact={taille === "carte"}
        />
        {lectures.length > 0 && <p className="-mt-3 mb-6 text-xs leading-relaxed text-ink-soft">{lectures.join(" ")}</p>}
      </div>
    );
  }

  let corps: ReactNode;
  let alternative: AlternativeTexte | undefined;
  let titreFigure = titre;
  let etat: { kind: "vide"; population: string; plage: string } | undefined;

  switch (plan.visualization) {
    case "value": {
      // La figure dit la forme ; la tuile dit la mesure (« LCP — p75 ») — pas deux fois le même titre.
      titreFigure = "Valeur unique";
      const raisonNull = data.samples === 0 ? "aucune ligne mesurée sur la fenêtre" : "valeur non calculable sur ces lignes";
      corps = (
        <div className="max-w-sm">
          <KpiTile
            label={libelleMesure(plan)}
            valeur={data.total}
            format={format}
            raisonNull={data.total === null ? raisonNull : undefined}
            vital={vital ?? undefined}
            sensMeilleur={vital ? "bas" : "neutre"}
            precedent={precedent ? precedent.total : undefined}
            reference={precedent ? precedent.plage : undefined}
            couverturePrecedente={precedent ? precedent.couverture : undefined}
            couverture={{ n: data.samples, unite: UNITE_EFFECTIF, faibleSous: faibleSousDe(plan) }}
          />
        </div>
      );
      alternative = {
        legende: `${libelleMesure(plan)} sur ${plage}`,
        colonnes: ["Période", libelleMesure(plan), "Lignes de population"],
        lignes: [
          [plage, formater(format, data.total), data.samples],
          ...(precedent ? [[precedent.plage.replace(/^vs\s+/, ""), formater(format, precedent.total), precedent.couverture.n ?? null]] : []),
        ],
      };
      break;
    }
    case "toplist": {
      if (vide || data.groups.length === 0) {
        etat = { kind: "vide", population: "ligne correspondant à la requête", plage };
        break;
      }
      // Mesure additive : `RankBar` porte sa propre alternative (mêmes lignes que les barres).
      corps = <RankBar data={donneesRankBar(plan, data, hrefs, format)} legende={titre} emptyLabel="Aucun groupe sur la fenêtre." />;
      break;
    }
    case "timeseries": {
      if (vide) {
        etat = { kind: "vide", population: "ligne correspondant à la requête", plage };
        break;
      }
      const serie = serieDuResultat({ plan, meta, data, precedent, hrefs, annotations, annotationsIndisponibles, taille, format });
      corps = serie.dessin;
      alternative = serie.alternative;
      break;
    }
    case "table": {
      if (data.rows.length === 0) {
        etat = { kind: "vide", population: "ligne correspondant à la requête", plage };
        break;
      }
      corps = <Journal plan={plan} data={data} hrefs={hrefs} />;
      break;
    }
  }

  return (
    <div data-testid="resultat-analyse" data-forme={plan.visualization} data-vital={vital ?? undefined} className={taille === "page" ? "mb-6" : undefined}>
      <Figure id={idFigure} titre={titreFigure} meta={meta_} etat={etat} alternative={alternative} lecture={lecture}>
        {corps}
      </Figure>
    </div>
  );
}
