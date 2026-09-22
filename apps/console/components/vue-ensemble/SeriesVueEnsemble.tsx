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
import type { Lecture } from "@/lib/lecture";
import { bucketLabel } from "@/lib/query-contract";
import { libelleSeauComplet, type Annotation, type PointSerie, type SerieDef } from "@/lib/series";
import { pointsCharge, pointsRelease, pointsVital, serieVide, type SeauVital } from "@/lib/vue-ensemble";

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
}

const somme = (valeurs: number[]) => valeurs.reduce((a, b) => a + b, 0);
const ligneSeau = (t: string, seau: number) => libelleSeauComplet(t, seau, "UTC");

// ─────────────────────────────── Zone 5 — hero ───────────────────────────────

export interface LectureVital {
  vital: VitalName;
  /** `vitalSeriesN(f, vital)` : toute la population filtrée. */
  courant: Lecture<SeauVital[]>;
  /** `vitalSeriesN(f, vital, true)` en `cmp=prev`, si la période précédente est complète. */
  precedent?: Lecture<SeauVital[]> | null;
  /** `cmp=release` : la release B et la référence A, même fenêtre. */
  releaseB?: Lecture<SeauVital[]> | null;
  releaseA?: Lecture<SeauVital[]> | null;
  explorer: string;
}

/** Un petit multiple : ses points, ses séries, son état et son alternative. */
function petitMultiple(l: LectureVital, mode: ModeSeries, c: Commun) {
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
      legende: `${nom} par seau de ${seau}, release ${mode.relB} face à ${mode.relA} (UTC)`,
      colonnes: ["Seau (UTC)", `${mode.relB} p75`, `${mode.relB} mesures`, `${mode.relA} p75`, `${mode.relA} mesures`],
      lignes: points.map((p) => [ligneSeau(p.t, c.seauSecondes), formater(format, p.b), p.nb, formater(format, p.a), p.na]),
    };
    const n = somme(points.map((p) => p.nb));
    return { ok: true as const, points: points as PointSerie[], series, etat, alternative, n, meta: `release ${mode.relB} : ${formater("count", n)} mesures ; ${mode.relA} : ${formater("count", somme(points.map((p) => p.na)))}` };
  }

  if (!l.courant.ok) return { ok: false as const, etat: { kind: "erreur" as const, titre: nom } };
  const precedent = mode.kind === "prev" && l.precedent?.ok ? l.precedent.data : null;
  const points = pointsVital(c.grille, l.courant.data, precedent);
  const series: SerieDef[] = [{ cle: "p75", libelle: nom, role: "principale", effectifCle: "n" }];
  if (precedent) series.push({ cle: "precedent", libelle: "Période précédente", role: "reference" });
  const etat: Etat | undefined = serieVide(points, ["p75"])
    ? { kind: "vide", population: `mesure ${l.vital}`, plage: c.plage }
    : undefined;
  const alternative: AlternativeTexte = {
    legende: `${nom} par seau de ${seau} (UTC)`,
    colonnes: ["Seau (UTC)", "p75", "Mesures", ...(precedent ? ["Période précédente (même rang)"] : [])],
    lignes: points.map((p) => [
      ligneSeau(p.t, c.seauSecondes),
      formater(format, p.p75),
      p.n,
      ...(precedent ? [formater(format, p.precedent ?? null)] : []),
    ]),
  };
  const n = somme(points.map((p) => p.n));
  return { ok: true as const, points: points as PointSerie[], series, etat, alternative, n, meta: `${formater("count", n)} mesures` };
}

export function HeroCwv({
  vitaux,
  mode,
  lecture,
  ...commun
}: Commun & { vitaux: LectureVital[]; mode: ModeSeries; lecture: ReactNode }) {
  const seau = bucketLabel(commun.seauSecondes);
  return (
    <section className="mb-6 min-w-0" aria-labelledby="hero-cwv-titre" data-testid="hero-cwv">
      <h2 id="hero-cwv-titre" className="mb-1 text-sm font-semibold text-ink">
        Core Web Vitals dans le temps
      </h2>
      <p className="mb-3 text-xs text-ink-soft">{lecture}</p>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
        {vitaux.map((l, i) => {
          const m = petitMultiple(l, mode, commun);
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
                  <span>p75 par seau de {seau}</span>
                  <span>{commun.grille.length} seaux</span>
                  {m.ok && <span>{m.meta}</span>}
                  <span>{commun.plage}, UTC</span>
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
                  seauSecondes={commun.seauSecondes}
                  fuseau="UTC"
                  zoomHref={commun.zoomHref}
                  annotations={commun.annotations.annotations}
                  annotationsIndisponibles={commun.annotations.indisponible ?? undefined}
                  // Les déploiements sont les mêmes sur les trois : listés en liens sous le
                  // premier seulement (un arrêt de tabulation chacun, pas trois).
                  legendeAnnotations={i === 0}
                  hauteur={200}
                  ariaLabel={`${l.vital} p75 par seau de ${seau}, ${commun.grille.length} seaux, 3 zones de seuil (Bon, À améliorer, Mauvais)${
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
  vues: Lecture<{ bucket: string; chargements: number; spa: number; inconnu: number }[]>;
  erreurs: Lecture<{ restreint: boolean; points: { bucket: string; navigateur: number }[] }>;
  lcp: Lecture<SeauVital[]>;
  /** Période précédente du LCP (`cmp=prev`, complète) : série grise sur le panneau (3) seulement. */
  lcpPrecedent?: Lecture<SeauVital[]> | null;
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
  const vues = lectures.vues.ok ? lectures.vues.data : [];
  const erreurs = lectures.erreurs.ok ? lectures.erreurs.data.points : [];
  const lcp = lectures.lcp.ok ? lectures.lcp.data : [];
  const precedent = mode.kind === "prev" && lectures.lcpPrecedent?.ok ? lectures.lcpPrecedent.data : null;
  const points = pointsCharge(commun.grille, vues, erreurs, lcp);
  const pointsLcp = pointsVital(commun.grille, lcp, precedent);
  const lignes: PointSerie[] = points.map((p, i) => ({ ...p, precedent: pointsLcp[i].precedent ?? null }));

  const totalVues = somme(points.map((p) => p.chargements + p.spa + p.inconnu));
  const totalErreurs = somme(points.map((p) => p.erreurs));
  const totalLcp = somme(points.map((p) => p.n));
  const avecInconnu = points.some((p) => p.inconnu > 0);
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
  const partage = { grille: commun.grille, seauSecondes: commun.seauSecondes, fuseau: "UTC", zoomHref: commun.zoomHref, synchro, hauteur: 110 };

  return (
    <Figure
      titre="Charge, erreurs et LCP"
      id="charge-erreurs-lcp"
      etat={toutEnEchec ? { kind: "erreur", titre: "Charge, erreurs et LCP" } : undefined}
      meta={
        <>
          <span>seau de {seau}</span>
          <span>{commun.grille.length} seaux</span>
          <span>{formater("count", totalVues)} pages vues</span>
          <span>{formater("count", totalErreurs)} occurrences</span>
          <span>{formater("count", totalLcp)} mesures LCP</span>
          <span>{commun.plage}, UTC</span>
        </>
      }
      lecture={
        <>
          Le LCP n&apos;est mesuré qu&apos;au chargement ; les changements de route SPA comptent des vues sans LCP.
          Trois panneaux, un axe chacun, la même heure alignée sur les trois : aucune grandeur n&apos;est lue sur
          l&apos;échelle d&apos;une autre.{" "}
          {precedent
            ? "La série grise pointillée du LCP est la période précédente, alignée par rang de seau ; les comptes se comparent dans les tuiles."
            : mode.kind === "release"
              ? "La comparaison de releases se lit dans « Core Web Vitals dans le temps » ; ici, toute la population."
              : null}
        </>
      }
      alternative={{
        legende: `Pages vues, occurrences d'erreurs et LCP p75 par seau de ${seau} (UTC)`,
        colonnes: [
          "Seau (UTC)",
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
          formater("ms", p.p75),
          p.n,
        ]),
      }}
    >
      <div className="flex min-w-0 flex-col gap-3" data-testid="charge-panneaux">
        <Panneau titre="Pages vues : chargements et changements de route SPA" id="vues">
          {!lectures.vues.ok ? (
            <EchecLecture compact titre="Pages vues par seau" />
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
              ariaLabel={`Pages vues par seau de ${seau}, chargements et changements de route SPA empilés, ${commun.grille.length} seaux`}
            />
          )}
        </Panneau>
        <Panneau titre={titreErreurs} id="erreurs">
          {!lectures.erreurs.ok ? (
            <EchecLecture compact titre="Occurrences d'erreurs par seau" />
          ) : totalErreurs === 0 ? (
            <EtatSurface compact etat={{ kind: "vide", population: "occurrence d'erreur navigateur", plage: commun.plage }} />
          ) : (
            <ThresholdSeries
              {...partage}
              {...annotationsDe(false)}
              points={lignes}
              series={[{ cle: "erreurs", libelle: titreErreurs, role: "categorie", categorieIndex: 3, forme: "barres", additive: true }]}
              format="count"
              ariaLabel={`${titreErreurs} par seau de ${seau}, ${commun.grille.length} seaux`}
            />
          )}
        </Panneau>
        <Panneau titre="LCP p75" id="lcp">
          {!lectures.lcp.ok ? (
            <EchecLecture compact titre="LCP p75 par seau" />
          ) : totalLcp === 0 ? (
            <EtatSurface compact etat={{ kind: "vide", population: "mesure LCP", plage: commun.plage }} />
          ) : (
            <ThresholdSeries
              {...partage}
              {...annotationsDe(true)}
              points={lignes}
              series={[
                { cle: "p75", libelle: "LCP p75", role: "principale", effectifCle: "n" },
                ...(precedent ? [{ cle: "precedent", libelle: "Période précédente", role: "reference" as const }] : []),
              ]}
              format="ms"
              vital="LCP"
              ariaLabel={`LCP p75 par seau de ${seau}, ${commun.grille.length} seaux, 3 zones de seuil (Bon, À améliorer, Mauvais)`}
            />
          )}
        </Panneau>
      </div>
    </Figure>
  );
}
