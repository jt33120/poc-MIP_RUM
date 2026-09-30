// Séries de la Vue d'ensemble (F12, plan § 5.1, zones 5 et 6) — rendu serveur.
// Les graphiques eux-mêmes sont des composants client (`ThresholdSeries`,
// `StackedBars`) ; ici, le cadre (`Figure`), les séries, les états et
// l'alternative textuelle, calculés côté serveur à partir des lectures.
//
// ZONE 5 — « Core Web Vitals dans le temps » : TROIS PETITS MULTIPLES (LCP, INP,
// CLS), un par vital, chacun sur ses bandes Bon / À améliorer / Mauvais : trois
// unités, trois échelles, jamais superposées (Datadog, en mieux : l'INP, et une
// échelle par vital).
//
// ZONE 6 — « Charge, erreurs et LCP » : TROIS PANNEAUX EMPILÉS qui partagent
// l'axe x (même grille, même seau, mêmes marges `SERIE_MARGES`, survol
// synchronisé), JAMAIS un axe secondaire (P5) : la dégradation coïncide-t-elle
// avec la charge ou avec des erreurs ? Chaque grandeur garde SON axe.
import type { ReactNode } from "react";
import { Figure, type AlternativeTexte } from "@/components/charts/Figure";
import { StackedBars } from "@/components/charts/StackedBars";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface, type Etat } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import { formater, formatDuVital, type VitalName } from "@/lib/fmt-ids";
import type { SectionLue } from "@/lib/lecture";
import { bucketLabel } from "@/lib/query-contract";
import { libelleSeauComplet, type Annotation, type PointSerie, type SerieDef } from "@/lib/series";
import { pointsCharge, pointsRelease, pointsVital, serieVide, sommeLue, type SeauVital } from "@/lib/vue-ensemble";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { LIBELLE_PLAGE, phrasePlagesHero, type PlageHero } from "@/lib/detections-ecran";
import { pluriel } from "@/lib/format";

/** Ce que les séries comparent : rien, la période précédente, ou deux releases (§ 3.2). */
export type ModeSeries =
  | { kind: "simple" }
  | { kind: "prev" }
  | { kind: "release"; relA: string; relB: string };

export interface AnnotationsFigure {
  annotations: Annotation[];
  /** Raison d'absence (B1, lecture en échec) : dite sous le graphique. */
  indisponible: string | null;
}

interface Commun {
  grille: string[];
  seauSecondes: number;
  /** Gabarit `{from}` `{to}` du zoom au clic (même écran, seule la plage change). */
  zoomHref: string;
  annotations: AnnotationsFigure;
  plage: string;
  /**
   * Début de la plage (`query.range.from`) : le premier seau de la grille commence
   * avant lui et n'en couvre qu'une partie ; les graphiques le marquent.
   */
  debutPlage?: string;
}

const somme = (valeurs: number[]) => valeurs.reduce((a, b) => a + b, 0);
const ligneSeau = (t: string, seau: number) => libelleSeauComplet(t, seau, FUSEAU_AFFICHAGE);

// ─────────────────────────────── Zone 5 — hero ───────────────────────────────

export interface LectureVital {
  vital: VitalName;
  /** `vitalSeriesN(f, vital)` : toute la population filtrée. */
  courant: SectionLue<SeauVital[]>;
  /** `vitalSeriesN(f, vital, true)` en `cmp=prev`, si la période précédente est complète. */
  precedent?: SectionLue<SeauVital[]> | null;
  /** `cmp=release` : la release B et la référence A, même fenêtre. */
  releaseB?: SectionLue<SeauVital[]> | null;
  releaseA?: SectionLue<SeauVital[]> | null;
  explorer: string;
}

/** Clés de la plage habituelle dans les points du graphique. */
const PLAGE_BAS = "plage_bas";
const PLAGE_HAUT = "plage_haut";

/** Un petit multiple : ses points, ses séries, son état et son alternative. */
function petitMultiple(l: LectureVital, mode: ModeSeries, c: Commun, plage?: PlageHero) {
  const format = formatDuVital(l.vital);
  const nom = `${l.vital} p75`;
  const seau = bucketLabel(c.seauSecondes);

  if (mode.kind === "release") {
    if (!l.releaseB?.ok || !l.releaseA?.ok) return { ok: false as const, etat: { kind: "erreur" as const, titre: nom } };
    const points = pointsRelease(c.grille, l.releaseB.data, l.releaseA.data);
    const series: SerieDef[] = [
      { cle: "b", libelle: `Release ${mode.relB}`, role: "principale", effectifCle: "nb" },
      { cle: "a", libelle: `Release ${mode.relA}`, role: "reference", effectifCle: "na" },
    ];
    const etat: Etat | undefined = serieVide(points, ["a", "b"])
      ? { kind: "vide", population: `mesure ${l.vital} sur ces deux releases`, plage: c.plage }
      : undefined;
    const alternative: AlternativeTexte = {
      legende: `${nom} par tranche de ${seau}, release ${mode.relB} face à ${mode.relA}`,
      colonnes: ["Période", `${mode.relB} p75`, `${mode.relB} mesures`, `${mode.relA} p75`, `${mode.relA} mesures`],
      lignes: points.map((p) => [ligneSeau(p.t, c.seauSecondes), formater(format, p.b), p.nb, formater(format, p.a), p.na]),
    };
    const n = somme(points.map((p) => p.nb));
    return { ok: true as const, plage: null, points: points as PointSerie[], series, etat, alternative, n, meta: `release ${mode.relB} : ${formater("count", n)} mesures ; ${mode.relA} : ${formater("count", somme(points.map((p) => p.na)))}` };
  }

  if (!l.courant.ok) return { ok: false as const, etat: { kind: "erreur" as const, titre: nom } };
  const precedent = mode.kind === "prev" && l.precedent?.ok ? l.precedent.data : null;
  // La plage habituelle, heure par heure : une heure sans plage calculée reste SANS
  // bande (`null`), jamais comblée (A2 § 8.6).
  const tracee = plage?.etat === "tracee" ? plage : null;
  const points = pointsVital(c.grille, l.courant.data, precedent).map((p) => {
    const h = tracee?.parInstant[p.t];
    return tracee ? { ...p, [PLAGE_BAS]: h?.bas ?? null, [PLAGE_HAUT]: h?.haut ?? null } : p;
  });
  const series: SerieDef[] = [{ cle: "p75", libelle: nom, role: "principale", effectifCle: "n" }];
  if (precedent) series.push({ cle: "precedent", libelle: "Période précédente", role: "reference" });
  const etat: Etat | undefined = serieVide(points, ["p75"])
    ? { kind: "vide", population: `mesure ${l.vital}`, plage: c.plage }
    : undefined;
  const alternative: AlternativeTexte = {
    legende: `${nom} par tranche de ${seau}`,
    colonnes: [
      "Période",
      "p75",
      "Mesures",
      ...(precedent ? ["Période précédente (même rang)"] : []),
      ...(tracee ? ["Plage habituelle, bas", "Plage habituelle, haut", "Écarts robustes"] : []),
    ],
    lignes: points.map((p) => {
      const h = tracee?.parInstant[p.t];
      return [
        ligneSeau(p.t, c.seauSecondes),
        formater(format, p.p75),
        p.n,
        ...(precedent ? [formater(format, p.precedent ?? null)] : []),
        ...(tracee ? [formater(format, h?.bas ?? null), formater(format, h?.haut ?? null), h?.z == null ? "—" : h.z.toLocaleString("fr-FR", { maximumFractionDigits: 1 })] : []),
      ];
    }),
  };
  const n = somme(points.map((p) => p.n));
  // Période précédente demandée mais illisible : la série grise manque, et la méta le dit.
  const precedentNonLu = mode.kind === "prev" && l.precedent != null && !l.precedent.ok;
  return {
    ok: true as const,
    points: points as PointSerie[],
    series,
    etat,
    alternative,
    n,
    meta: `${formater("count", n)} mesures${precedentNonLu ? " · période précédente : non lue" : ""}`,
    plage: tracee,
  };
}

export function HeroCwv({
  vitaux,
  mode,
  lecture,
  plages,
  ...commun
}: Commun & {
  vitaux: LectureVital[];
  mode: ModeSeries;
  lecture: ReactNode;
  /** La plage habituelle de chaque vital (A2 § 6.1), ou la raison de son absence. */
  plages?: Partial<Record<string, PlageHero>>;
}) {
  const phrasePlage = plages ? phrasePlagesHero(vitaux.map((l) => plages[l.vital])) : null;
  const seau = bucketLabel(commun.seauSecondes);
  return (
    <section className="mb-6 min-w-0" aria-labelledby="hero-cwv-titre" data-testid="hero-cwv">
      <h2 id="hero-cwv-titre" className="mb-1 text-sm font-semibold text-ink">
        Core Web Vitals dans le temps
      </h2>
      {/* Un bloc, pas un paragraphe : la lecture peut porter un repli « Méthode ». */}
      <div className="mb-3 space-y-1 text-xs text-ink-soft">
        {lecture}
        {phrasePlage && (
          <p className="min-w-0 [overflow-wrap:anywhere]" data-testid="plage-habituelle-etat" data-etat={phrasePlage.etat}>
            {phrasePlage.texte}
          </p>
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        {vitaux.map((l, i) => {
          const m = petitMultiple(l, mode, commun, mode.kind === "release" ? undefined : plages?.[l.vital]);
          return (
            <Figure
              key={l.vital}
              titre={`${l.vital} p75`}
              aide={l.vital}
              id={`hero-${l.vital}`}
              explorer={l.explorer}
              etat={m.etat}
              meta={
                <>
                  <span>p75 par tranche de {seau}</span>
                  <span>{commun.grille.length} tranches</span>
                  {m.ok && <span>{m.meta}</span>}
                  <span>{commun.plage}</span>
                </>
              }
              alternative={m.ok ? m.alternative : undefined}
            >
              {m.ok && (
                <ThresholdSeries
                  grille={commun.grille}
                  points={m.points}
                  series={m.series}
                  format={formatDuVital(l.vital)}
                  vital={l.vital}
                  bande={m.plage ? { basseCle: PLAGE_BAS, hauteCle: PLAGE_HAUT, libelle: LIBELLE_PLAGE } : undefined}
                  episodes={m.plage?.episodes}
                  seauSecondes={commun.seauSecondes}
                  fuseau={FUSEAU_AFFICHAGE}
                  zoomHref={commun.zoomHref}
                  debutPlage={commun.debutPlage}
                  annotations={commun.annotations.annotations}
                  annotationsIndisponibles={commun.annotations.indisponible ?? undefined}
                  // Les déploiements sont les mêmes sur les trois : listés en liens sous le
                  // premier seulement (un arrêt de tabulation chacun, pas trois).
                  legendeAnnotations={i === 0}
                  // « Premières données à HH:MM » : dite une fois, au-dessus du premier
                  // petit multiple, pas trois fois de suite.
                  noteCollecte={i === 0}
                  hauteur={200}
                  ariaLabel={`${l.vital} p75 par tranche de ${seau}, ${commun.grille.length} tranches, 3 zones de seuil (Bon, À améliorer, Mauvais)${
                    m.series.length > 1 ? `, comparé à ${m.series[1].libelle.toLowerCase()}` : ""
                  }`}
                />
              )}
            </Figure>
          );
        })}
      </div>
    </section>
  );
}

// ─────────────────────────────── Zone 6 — « Charge, erreurs et LCP » ───────────────────────────────

export interface LecturesCharge {
  vues: SectionLue<{ bucket: string; chargements: number; spa: number; inconnu: number }[]>;
  erreurs: SectionLue<{ restreint: boolean; points: { bucket: string; navigateur: number; sansSource: number }[] }>;
  lcp: SectionLue<SeauVital[]>;
  /** Période précédente du LCP (`cmp=prev`, complète) : série grise sur le panneau (3) seulement. */
  lcpPrecedent?: SectionLue<SeauVital[]> | null;
}

/** Un panneau de la figure : son titre (la population comptée), puis le graphique ou son état. */
function Panneau({ titre, id, children }: { titre: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0" data-testid={`panneau-${id}`}>
      <p className="mb-1 text-[11px] font-medium text-ink-soft">{titre}</p>
      {children}
    </div>
  );
}

export function ChargeErreursLcp({
  lectures,
  mode,
  ...commun
}: Commun & { lectures: LecturesCharge; mode: ModeSeries }) {
  const seau = bucketLabel(commun.seauSecondes);
  const synchro = "vue-ensemble-charge";
  // Une lecture en échec reste `null` jusque dans l'alternative et la méta (V3) :
  // jamais « 0 occurrence » sur une fenêtre qu'on n'a pas pu lire.
  const vues = lectures.vues.ok ? lectures.vues.data : null;
  const erreurs = lectures.erreurs.ok ? lectures.erreurs.data.points : null;
  const lcp = lectures.lcp.ok ? lectures.lcp.data : null;
  const precedent = mode.kind === "prev" && lectures.lcpPrecedent?.ok ? lectures.lcpPrecedent.data : null;
  const precedentNonLu = mode.kind === "prev" && lectures.lcpPrecedent != null && !lectures.lcpPrecedent.ok;
  const points = pointsCharge(commun.grille, vues, erreurs, lcp);
  const pointsLcp = pointsVital(commun.grille, lcp ?? [], precedent);
  const lignes: PointSerie[] = points.map((p, i) => ({ ...p, precedent: pointsLcp[i].precedent ?? null }));

  const totalVues = vues ? sommeLue(points.map((p) => (p.chargements ?? 0) + (p.spa ?? 0) + (p.inconnu ?? 0))) : null;
  const totalErreurs = erreurs ? sommeLue(points.map((p) => p.erreurs)) : null;
  const totalSansSource = erreurs ? sommeLue(points.map((p) => p.sansSource)) : null;
  const totalLcp = lcp ? sommeLue(points.map((p) => p.n)) : null;
  const avecInconnu = points.some((p) => (p.inconnu ?? 0) > 0);
  // CP14 : les occurrences sans source déclarée ne sont pas au panneau (2), et c'est dit.
  const noteSansSource =
    lectures.erreurs.ok && lectures.erreurs.data.restreint && (totalSansSource ?? 0) > 0
      ? `${pluriel(totalSansSource ?? 0, "occurrence sans source déclarée, non comptée", "occurrences sans source déclarée, non comptées")}`
      : null;
  const compte = (n: number | null, unite: string) => (n === null ? `${unite} : non lu` : `${formater("count", n)} ${unite}`);
  // Sans la colonne de source (v69), le numérateur porte toutes les sources : le titre le dit.
  const titreErreurs =
    lectures.erreurs.ok && !lectures.erreurs.data.restreint
      ? "Occurrences d'erreurs, toutes sources (colonne de source absente)"
      : "Occurrences d'erreurs navigateur";

  const toutEnEchec = !lectures.vues.ok && !lectures.erreurs.ok && !lectures.lcp.ok;
  const annotationsDe = (liste: boolean) => ({
    annotations: commun.annotations.annotations,
    annotationsIndisponibles: commun.annotations.indisponible ?? undefined,
    legendeAnnotations: liste,
  });
  const partage = {
    grille: commun.grille,
    seauSecondes: commun.seauSecondes,
    fuseau: FUSEAU_AFFICHAGE,
    zoomHref: commun.zoomHref,
    debutPlage: commun.debutPlage,
    synchro,
    hauteur: 110,
  };

  return (
    <Figure
      titre="Charge, erreurs et LCP"
      id="charge-erreurs-lcp"
      etat={toutEnEchec ? { kind: "erreur", titre: "Charge, erreurs et LCP" } : undefined}
      meta={
        <>
          <span>
            {commun.grille.length} tranches de {seau}
          </span>
          <span>{compte(totalVues, "pages vues")}</span>
          <span>{compte(totalErreurs, "occurrences navigateur")}</span>
          <span>{compte(totalLcp, "mesures LCP")}</span>
          {precedentNonLu && <span>période précédente : non lue</span>}
          <span>{commun.plage}</span>
        </>
      }
      lecture={
        <>
          Le LCP n&apos;est mesuré qu&apos;au chargement ; les changements de route SPA comptent des vues sans LCP.
          Trois panneaux, un axe chacun, la même heure alignée sur les trois : aucune grandeur n&apos;est lue sur
          l&apos;échelle d&apos;une autre.{" "}
          {precedent
            ? "La série grise pointillée du LCP est la période précédente, alignée tranche à tranche ; les comptes se comparent dans les tuiles."
            : mode.kind === "release"
              ? "La comparaison de releases se lit dans « Core Web Vitals dans le temps » ; ici, toute la population."
              : null}
        </>
      }
      alternative={{
        legende: `Pages vues, occurrences d'erreurs et LCP p75 par tranche de ${seau}`,
        colonnes: [
          "Période",
          "Chargements",
          "Changements de route SPA",
          ...(avecInconnu ? ["Type inconnu"] : []),
          titreErreurs,
          "LCP p75",
          "Mesures LCP",
        ],
        lignes: points.map((p) => [
          ligneSeau(p.t, commun.seauSecondes),
          p.chargements,
          p.spa,
          ...(avecInconnu ? [p.inconnu] : []),
          p.erreurs,
          // LCP illisible : « — » (null), comme un seau sans mesure ; l'effectif « — » dit lequel.
          lcp ? formater("ms", p.p75) : null,
          p.n,
        ]),
      }}
    >
      <div className="flex min-w-0 flex-col gap-3" data-testid="charge-panneaux">
        <Panneau titre="Pages vues : chargements et changements de route SPA" id="vues">
          {!lectures.vues.ok ? (
            <EchecLecture compact titre="Pages vues par tranche" />
          ) : totalVues === 0 ? (
            <EtatSurface compact etat={{ kind: "vide", population: "page vue", plage: commun.plage }} />
          ) : (
            <StackedBars
              {...partage}
              {...annotationsDe(false)}
              points={lignes}
              series={[
                { cle: "chargements", libelle: "Chargements", categorieIndex: 0 },
                { cle: "spa", libelle: "Changements de route SPA", categorieIndex: 1 },
                // Vues sans type déclaré : ni rangées parmi les chargements, ni perdues.
                ...(avecInconnu ? [{ cle: "inconnu", libelle: "Type de navigation inconnu", categorieIndex: 2 }] : []),
              ]}
              format="count"
              ariaLabel={`Pages vues par tranche de ${seau}, chargements et changements de route SPA empilés, ${commun.grille.length} tranches`}
            />
          )}
        </Panneau>
        <Panneau titre={titreErreurs} id="erreurs">
          {!lectures.erreurs.ok ? (
            <EchecLecture compact titre="Occurrences d'erreurs par tranche" />
          ) : totalErreurs === 0 ? (
            <EtatSurface
              compact
              etat={{
                kind: "vide",
                population: "occurrence d'erreur navigateur",
                plage: commun.plage,
                ...(noteSansSource ? { borne: `${noteSansSource}.` } : {}),
              }}
            />
          ) : (
            <ThresholdSeries
              {...partage}
              {...annotationsDe(false)}
              // Les trois panneaux partagent l'axe : la note de collecte récente est dite
              // une fois, au-dessus du premier.
              noteCollecte={false}
              points={lignes}
              series={[{ cle: "erreurs", libelle: titreErreurs, role: "categorie", categorieIndex: 3, forme: "barres", additive: true }]}
              format="count"
              ariaLabel={`${titreErreurs} par tranche de ${seau}, ${commun.grille.length} tranches`}
            />
          )}
          {noteSansSource && totalErreurs !== 0 && (
            <p role="note" className="mt-1 text-xs text-ink-soft" data-testid="charge-sans-source">
              {noteSansSource}.
            </p>
          )}
        </Panneau>
        <Panneau titre="LCP p75" id="lcp">
          {!lectures.lcp.ok ? (
            <EchecLecture compact titre="LCP p75 par tranche" />
          ) : totalLcp === 0 ? (
            <EtatSurface compact etat={{ kind: "vide", population: "mesure LCP", plage: commun.plage }} />
          ) : (
            <ThresholdSeries
              {...partage}
              {...annotationsDe(true)}
              points={lignes}
              noteCollecte={false}
              series={[
                { cle: "p75", libelle: "LCP p75", role: "principale", effectifCle: "n" },
                ...(precedent ? [{ cle: "precedent", libelle: "Période précédente", role: "reference" as const }] : []),
              ]}
              format="ms"
              vital="LCP"
              ariaLabel={`LCP p75 par tranche de ${seau}, ${commun.grille.length} tranches, 3 zones de seuil (Bon, À améliorer, Mauvais)`}
            />
          )}
        </Panneau>
      </div>
    </Figure>
  );
}
