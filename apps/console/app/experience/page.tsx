// Satisfaction `/experience` (F26, plan § 5.5) — « Les visiteurs se disent-ils
// satisfaits, et le ressenti suit-il la performance ? » ; question suivante : « sur
// quelle page, et que disent-ils ? » → verbatims → session.
//
// PAS DE SCORE COMPOSITE (§ 5.5.1). L'ancien « score d'expérience /100 » reposait sur
// des paliers de LCP sans source et une pondération au jugé ; il est retiré, avec
// son radar. Chaque chiffre a sa source : la part d'avis ≥ 4/5 (CSAT), le volume
// d'avis, la part de notes 1-2, les signaux de frustration par session ; et le lien au
// LCP se lit PAR PAGE, dans un nuage qui dit qu'il montre une corrélation, pas une
// cause.
//
// SANS AVIS, PAS DE SATISFACTION. Aucun avis noté : CSAT « — », jamais « 0 % » ni
// « 100 % » ; un seau sans avis est un trou dans la courbe ; une page qui n'a reçu
// que des commentaires n'a pas de CSAT (CP11). Aucune couleur de verdict hors du LCP
// au p75 (R-S) : un CSAT n'a pas de seuil publié.
//
// Pas de <Suspense> ni de `loading.tsx` au-dessus de l'écran (écart F02 validé) :
// chaque section lit par `lire()` et dit son propre échec.
import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS } from "@mip/console-contract";
import { ExperienceUnavailable } from "@/components/ExperienceUnavailable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { ImpactTable, type ImpactLigne } from "@/components/ImpactTable";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { RankBar } from "@/components/charts/RankBar";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { annotationsDeploiements } from "@/lib/annotations";
import { type CouverturePrecedente } from "@/lib/comparaison";
import {
  AVIS_FAIBLE_SOUS,
  AVIS_MIN_NUAGE,
  frustrationParSession,
  lignesSatisfactionParPage,
  nuageRessenti,
  partPositive,
  repartitionNotes,
} from "@/lib/experience";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { classerParGravite } from "@/lib/impact";
import { type SectionLue } from "@/lib/lecture";
import { chargerExperience } from "@/lib/chargeurs/experience";
import { chargerEcran } from "@/lib/ecran";
import { categorie } from "@/lib/palette";
import {
  type FeedbackRow,
  type FrustrationSessionsCommencees,
  type FeedbackStats,
  type FeedbackTrendContratPoint,
} from "@/lib/queries-experience";
import { hrefWithQuery, paramReader, previousRange, rangeLabel, type AnalyticsQuery } from "@/lib/query-contract";
import { THRESHOLDS } from "@/lib/rating";
import { libelleSeauComplet } from "@/lib/series";
import { ecartProportions, intervalleWilson } from "@/lib/stats/incertitude";
import { ecrirePanel, gabaritZoom, lireComparaison, lireTri } from "@/lib/view-state";
import { FUSEAU_AFFICHAGE } from "@/lib/fuseau-local";
import { fmtDate, pluriel } from "@/lib/format";
import { BasculeTri } from "@/components/Breakdown";
import { BandeauComparaison, MASQUE_SILENCE_REPETE } from "@/components/charts/RangeeKpi";

export const dynamic = "force-dynamic";

const TITRE = "Satisfaction";
const CHEMIN = "/experience";

/** « vs période précédente (du 20/09 14:00 au 21/09 14:00) », heure de Paris (§ 3.12). */
function referencePrecedente(query: AnalyticsQuery): string {
  return `vs période précédente (${rangeLabel({ ...previousRange(query.range), preset: null }, FUSEAU_AFFICHAGE)})`;
}

/** La couverture qui décide pour une rangée : la première incomplète, sinon la première. */
function pire(couvertures: readonly CouverturePrecedente[]): CouverturePrecedente {
  return (
    couvertures.find((c) => c.etat !== "complete") ??
    couvertures[0] ?? { etat: "inconnue", raison: "couverture de la période précédente non lue" }
  );
}

/** Lien vers ce même écran : l'URL telle quelle, avec des changements (`null` retire). */
function lienEcran(sp: SearchParams, changements: Record<string, string | null>): string {
  const p = new URLSearchParams();
  for (const [nom, valeur] of Object.entries(sp)) {
    if (typeof valeur === "string") p.set(nom, valeur);
    else if (Array.isArray(valeur)) for (const v of valeur) p.append(nom, v);
  }
  for (const [nom, valeur] of Object.entries(changements)) {
    if (valeur === null) p.delete(nom);
    else p.set(nom, valeur);
  }
  const qs = p.toString();
  return qs ? `${CHEMIN}?${qs}` : CHEMIN;
}

/** Écart de deux parts en POINTS de pourcentage : « +12 pts vs ensemble ». */
function ecartPoints(valeur: number | null, reference: number | null): { valeur: number | null; affichage: string } {
  if (valeur === null || reference === null) return { valeur: null, affichage: "—" };
  const d = valeur - reference;
  const pts = (d * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return { valeur: d, affichage: `${d > 0 ? "+" : ""}${pts} pts vs ensemble` };
}

export default async function Satisfaction({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  // Le chargeur (`lib/chargeurs/experience.ts`) lit filtres et sections.
  const ecran = await chargerEcran(ECRANS.experience, chargerExperience, sp);
  if (ecran.etat === "refus") return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  const q = ecran.query;
  const label = ecran.label;
  const lecteur = paramReader(sp);

  // Comparaison (§ 3.2) : la période précédente n'est lue qu'en `cmp=prev` (défaut
  // de cet écran Performance) ; ses écarts ne s'affichent que si elle est COMPLÈTE.
  const comparaison = lireComparaison(CHEMIN, lecteur).valeur;
  const prev = comparaison.mode === "prev";
  const triLu = lireTri(CHEMIN, lecteur);

  // CHAQUE LECTURE EST INDÉPENDANTE (§ 3.8 règle 1) : une lecture en échec ne dit que
  // son propre échec, les autres sections s'affichent.
  const { stats, statsPrev, contexte, frustration, tendance, recents, parPage, lcpPages, deploys, couvPart, couvCompte } = ecran;

  const s = stats.ok ? stats.data : null;
  const p = statsPrev?.ok ? statsPrev.data : null;
  const reference = p ? referencePrecedente(q) : undefined;

  // Annotations de déploiement (P9, § 3.7) : sur les deux panneaux du hero.
  const annotations = deploys.ok
    ? annotationsDeploiements(deploys.data, q.range, {
        lien: (relB, relA) => lienEcran(sp, { cmp: "release", rel_b: relB, rel_a: relA }),
      })
    : { annotations: [], liste: [], indisponible: "déploiements non lus (lecture en échec)" };
  const zoom = gabaritZoom(hrefWithQuery(CHEMIN, q, { period: null, from: "{from}", to: "{to}" }), sp);

  const lignes =
    parPage.ok ? lignesSatisfactionParPage(parPage.data, lcpPages.ok ? lcpPages.data.rows : []) : [];
  const nuage = nuageRessenti(lignes);
  const hrefPanneauRoute = (route: string) => hrefWithQuery("/pages", q, { panel: ecrirePanel({ type: "route", id: route }) });

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={TITRE}
        domain="perf"
        help="experience"
        // Espace insécable avant « ? » : la typographie française ne coupe pas la ligne là.
        sub={"Les visiteurs se disent-ils satisfaits, et le ressenti suit-il la performance\u00a0?"}
      />

      {/* Pourquoi les tuiles n'ont pas d'écart : dit en clair. */}
      {(comparaison.mode === "release" || (prev && statsPrev && !statsPrev.ok)) && (
        <div role="note" data-testid="note-comparaison" className="mb-4 text-xs text-ink-soft">
          {comparaison.mode === "release"
            ? "Comparaison de releases : les tuiles de cet écran n'ont pas d'écart par release."
            : "La période précédente n'a pas pu être lue : aucune variation n'est affichée."}
        </div>
      )}

      {/* La période précédente incomplète est dite UNE fois, au-dessus des tuiles. */}
      <BandeauComparaison couvertures={p ? [pire(couvPart), pire(couvCompte)] : []} />
      <section
        aria-label="Chiffres clés de la satisfaction"
        className={`mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4 ${MASQUE_SILENCE_REPETE}`}
        data-testid="satisfaction-kpi"
      >
        {!s ? (
          <>
            <EchecLecture compact titre="Satisfaction (CSAT)" />
            <EchecLecture compact titre="Avis reçus" />
            <EchecLecture compact titre="Part de détracteurs" />
          </>
        ) : (
          <TuilesAvis s={s} p={p} reference={reference} couvPart={pire(couvPart)} couvCompte={pire(couvCompte)} label={label} />
        )}
        {!frustration.ok ? (
          <EchecLecture compact titre="Signaux de frustration par session" />
        ) : (
          <TuileFrustration lu={frustration.data} label={label} href={hrefWithQuery("/ux", q)} />
        )}
      </section>

      {s && s.count === 0 && <CarteInstallation />}

      <SectionErreur titre="Satisfaction dans le temps">
        <HeroSatisfaction
          tendance={tendance}
          label={label}
          bucketLabel={ecran.bucketLabel}
          seauSecondes={q.range.bucketSeconds}
          annotations={annotations}
          zoom={zoom}
        />
      </SectionErreur>

      <div className="mt-6 grid min-w-0 gap-4 lg:grid-cols-2">
        <SectionErreur titre="Répartition des notes">
          <RepartitionNotes s={s} label={label} />
        </SectionErreur>
        <SectionErreur titre="Ressenti face au LCP, par page">
          <Figure
            titre="Ressenti face au LCP, par page"
            id="ressenti-face-au-lcp"
            meta={
              <>
                <span>
                  {pluriel(nuage.eligibles, "page éligible", "pages éligibles")} : au moins {AVIS_MIN_NUAGE} avis notés et
                  un LCP p75 mesuré
                </span>
                <span>{label}</span>
                <span>20 pages au plus, les plus commentées</span>
              </>
            }
            etat={
              !parPage.ok
                ? { kind: "erreur", titre: "Satisfaction par page" }
                : !lcpPages.ok
                  ? { kind: "erreur", titre: "LCP p75 par page" }
                  : undefined
            }
            lecture={
              nuage.suffisant
                ? `Corrélation observée sur ${pluriel(nuage.eligibles, "page")}, pas une cause : une page lente peut aussi être une page dont on se plaint pour autre chose. Horizontal : LCP p75 de la page ; vertical : CSAT ; taille : avis notés. La bande grise marque la zone « Bon » du LCP. Un point ouvre le panneau de la page.`
                : undefined
            }
            alternative={{
              legende: "CSAT et LCP p75 des pages éligibles",
              colonnes: ["Page", "LCP p75", "CSAT", "Avis notés"],
              lignes: nuage.points.map((pt) => [pt.route, formater("ms", pt.lcp), formater("pct", pt.csat), pt.avis]),
            }}
          >
            {/* Trop peu de pages : ce n'est pas une donnée PARTIELLE (le bandeau « Partiel »
                est réservé à une lecture incomplète), c'est un effectif trop faible pour un
                nuage. Le dire en clair, sans état d'alerte (recette du 26/09/2026). */}
            {!nuage.suffisant ? (
              <p className="py-6 text-center text-sm text-ink-soft" data-testid="nuage-insuffisant">
                Pas de nuage : il faut au moins trois pages ayant chacune {AVIS_MIN_NUAGE} avis notés et un LCP mesuré
                {nuage.eligibles === 0
                  ? " ; aucune ne l'est"
                  : nuage.eligibles === 1
                    ? " ; une seule l'est"
                    : ` ; seules ${nuage.eligibles} le sont`}{" "}
                sur {label}.
              </p>
            ) : (
              <ScatterPlot
                points={nuage.points.map((pt) => ({
                  x: Math.round(pt.lcp),
                  y: Math.round(pt.csat * 1000) / 10,
                  z: pt.avis,
                  label: pt.route,
                  href: hrefPanneauRoute(pt.route),
                }))}
                xLabel="LCP p75"
                yLabel="CSAT"
                xUnit=" ms"
                yUnit=" %"
                xFormat="int"
                yFormat="int"
                repereX={{ valeur: THRESHOLDS.LCP[0], libelle: `LCP Bon ≤ ${formater("ms", THRESHOLDS.LCP[0])}` }}
                height={260}
                ariaLabel={`CSAT et LCP p75 de ${pluriel(nuage.eligibles, "page")}, ${label}`}
              />
            )}
          </Figure>
        </SectionErreur>
      </div>

      <div className="mt-6">
        <SectionErreur titre="Satisfaction par page">
          {!parPage.ok ? (
            <div className="card p-4">
              <EchecLecture titre="Satisfaction par page" />
            </div>
          ) : (
            <>
              {triLu.ignore && (
                <p role="note" className="mb-2 text-xs text-ink-soft">
                  {triLu.ignore}
                </p>
              )}
              {/* La bascule est rendue ICI, sans « Impact » : ce classement (par mesures
                  « Mauvais ») n'a pas de sens pour des avis, et une option grisée se lisait
                  comme une fonction présente mais en panne (recette du 26/09/2026). La
                  table reçoit donc l'ordre déjà appliqué (« fourni »), comme sur /mobile. */}
              <div className="mb-2 flex justify-end">
                <BasculeTri
                  courant={triLu.tri === "volume" ? "volume" : "gravite"}
                  options={[
                    { id: "gravite", libelle: "Gravité", href: lienEcran(sp, { tri: null }) },
                    { id: "volume", libelle: "Volume", href: lienEcran(sp, { tri: "volume" }) },
                  ]}
                />
              </div>
              <ImpactTable
                titre="Satisfaction par page"
                tri="fourni"
                ordreLibelle={
                  triLu.tri === "volume"
                    ? "Ordre : par nombre d'avis notés, le plus grand en tête."
                    : `Ordre : de la page la moins satisfaisante à la plus satisfaisante ; sous ${AVIS_FAIBLE_SOUS} avis notés, en fin de liste.`
                }
                triHref={{ gravite: null, volume: null, impact: null, fourni: null }}
                reference={
                  s && s.count > 0
                    ? {
                        libelle: "Ensemble (toutes les pages)",
                        valeurs: {
                          pilote: formater("pct", partPositive(s.positives, s.count)),
                          volume: formater("count", s.count),
                          detracteurs: formater("pct", partPositive(s.detractors, s.count)),
                          lcp: contexte.ok ? formater("ms", contexte.data.lcp_p75) : "—",
                        },
                      }
                    : null
                }
                referenceRaison={s ? `aucun avis noté sur ${label}` : "avis non lus (lecture en échec)"}
                lignes={lignesImpact(lignes, s, (r) => hrefPanneauRoute(r), triLu.tri === "volume" ? "volume" : "gravite")}
                colonnes={["Notes 1-2", "LCP p75"]}
                unitePilote="pct"
                volumeLibelle="Avis notés"
                groupes={parPage.data[0]?.pages ?? 0}
                tronque={(parPage.data[0]?.pages ?? 0) > parPage.data.length}
                notice={`CSAT de chaque page (part des avis notés 4 ou 5 sur 5, comme la tuile) : une barre plus longue veut dire plus satisfaisante. Les 20 pages les plus commentées ; sous ${AVIS_FAIBLE_SOUS} avis notés, « échantillon faible ».${lcpPages.ok ? "" : " LCP p75 par page non lu (lecture en échec)."}`}
              />
            </>
          )}
        </SectionErreur>
      </div>

      <div className="mt-6">
        <SectionErreur titre="Derniers verbatims">
          <Verbatims recents={recents} q={q} label={label} />
        </SectionErreur>
      </div>
    </div>
  );
}

// ─────────────────────────────── Tuiles ───────────────────────────────

function TuilesAvis({
  s,
  p,
  reference,
  couvPart,
  couvCompte,
  label,
}: {
  s: FeedbackStats;
  p: FeedbackStats | null;
  reference: string | undefined;
  couvPart: CouverturePrecedente;
  couvCompte: CouverturePrecedente;
  label: string;
}) {
  const sansAvis = `aucun avis noté sur ${label}`;
  // L'effectif de la période précédente entre dans la règle d'échantillon faible (§ 3.2).
  const couvPrecedente = p ? { ...couvPart, n: p.count } : undefined;
  return (
    <>
      <KpiTile
        label="Satisfaction (CSAT)"
        valeur={partPositive(s.positives, s.count)}
        raisonNull={sansAvis}
        format="pct"
        sensMeilleur="haut"
        couverture={{ n: s.count, unite: "avis", faibleSous: AVIS_FAIBLE_SOUS }}
        intervalle={intervalleWilson(s.positives, s.count) ?? undefined}
        precedent={p ? partPositive(p.positives, p.count) : undefined}
        reference={reference}
        couverturePrecedente={couvPrecedente}
        ecart={p ? ecartProportions(s.positives, s.count, p.positives, p.count) : undefined}
        methode="Part des avis notés 4 ou 5 sur 5."
      />
      <KpiTile
        label="Avis reçus"
        valeur={s.count}
        format="count"
        sensMeilleur="neutre"
        precedent={p ? p.count : undefined}
        reference={reference}
        couverturePrecedente={p ? couvCompte : undefined}
        methode="Avis notés de 1 à 5 ; un commentaire sans note n'y entre pas, il est dans les verbatims."
        href="#verbatims"
      />
      <KpiTile
        label="Part de détracteurs"
        valeur={partPositive(s.detractors, s.count)}
        raisonNull={sansAvis}
        format="pct"
        sensMeilleur="bas"
        couverture={{ n: s.count, unite: "avis", faibleSous: AVIS_FAIBLE_SOUS }}
        intervalle={intervalleWilson(s.detractors, s.count) ?? undefined}
        precedent={p ? partPositive(p.detractors, p.count) : undefined}
        reference={reference}
        couverturePrecedente={couvPrecedente}
        ecart={p ? ecartProportions(s.detractors, s.count, p.detractors, p.count) : undefined}
        methode="Part des avis notés 1 ou 2 sur 5."
      />
    </>
  );
}

/**
 * « Signaux de frustration par session » : signaux et sessions de la MÊME population
 * (sessions commencées dont le capteur émet), et la garde de capteur R-F écrite
 * sous la tuile — `non_collecte` pour une population React Native, jamais « 0,00 ».
 */
function TuileFrustration({ lu, label, href }: { lu: FrustrationSessionsCommencees; label: string; href: string }) {
  const taux = frustrationParSession(lu, label);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="tuile-frustration">
      <KpiTile
        label="Signaux de frustration par session"
        valeur={taux.valeur}
        raisonNull={taux.raisonNull ?? undefined}
        format="ratio"
        couverture={taux.n > 0 ? { n: taux.n, unite: "sessions commencées", faibleSous: 30 } : undefined}
        // Les mots du détail de session : « clic de rage », « clic sans réaction »
        // (la recette relevait « clics morts » ici, « clic sans réaction » là-bas).
        methode="Clics de rage et clics sans réaction des sessions commencées sur la plage, divisés par le nombre de ces sessions. Les clics suivis d'une erreur n'y entrent pas."
        href={href}
      />
      {taux.etat && <EtatSurface compact etat={taux.etat} />}
    </div>
  );
}

/** État vide conservé (§ 5.5.2) : le geste d'installation et la règle de silence de 60 jours. */
function CarteInstallation() {
  return (
    <div className="card mb-6 p-6 text-sm text-ink-soft" data-testid="carte-installation">
      <p className="font-medium text-ink">Aucun avis sur la période.</p>
      <p className="mt-1">
        La satisfaction ne se calcule donc pas ; la frustration reste mesurée. Pour recueillir l&apos;avis des
        visiteurs, ajoutez le module d&apos;avis après le script MIP RUM :
      </p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-panel2 p-3 font-mono text-xs text-ink-soft">
        {`<script src="/mip-rum-feedback.js"></script>`}
      </pre>
      <p className="mt-2 text-xs text-ink-soft">
        Il envoie <code>MIPRum.track(&quot;feedback&quot;, …)</code> — aucune autre configuration. Après un avis envoyé,
        le module ne se remontre pas avant <strong>60 jours</strong> à ce visiteur sur cette application ; ajustez avec{" "}
        <code>window.MIPRumFeedback = {"{ cooldownDays: 30 }"}</code>.
      </p>
    </div>
  );
}

// ─────────────────────────────── Hero ───────────────────────────────

function HeroSatisfaction({
  tendance,
  label,
  bucketLabel,
  seauSecondes,
  annotations,
  zoom,
}: {
  tendance: SectionLue<FeedbackTrendContratPoint[]>;
  label: string;
  bucketLabel: string;
  seauSecondes: number;
  annotations: ReturnType<typeof annotationsDeploiements>;
  zoom: string;
}) {
  const points = tendance.ok ? tendance.data.map((pt) => ({ t: pt.bucket, csat: pt.csat, avis: pt.avis })) : [];
  const grille = points.map((pt) => pt.t);
  // Un compte d'avis (additif) : la somme des seaux est le total de la fenêtre.
  let avis = 0;
  for (const pt of points) avis += pt.avis;
  return (
    <Figure
      titre="Satisfaction dans le temps"
      id="satisfaction-dans-le-temps"
      aide="csat"
      etat={!tendance.ok ? { kind: "erreur", titre: "Satisfaction dans le temps" } : undefined}
      meta={
        <>
          <span>{formater("count", avis)} avis notés</span>
          <span>{label}</span>
          <span>tranches de {bucketLabel}</span>
          <span>point creux : moins de {AVIS_FAIBLE_SOUS} avis dans la tranche</span>
        </>
      }
      lecture="En haut, la part des avis notés 4 ou 5 sur 5 ; une tranche sans avis reste vide, jamais 0 %. En bas, le nombre d'avis notés. Un clic sur une tranche zoome sur sa plage."
      alternative={
        avis > 0
          ? {
              legende: `CSAT et avis notés par tranche de ${bucketLabel}`,
              colonnes: ["Période", "CSAT", "Avis notés"],
              lignes: points.map((pt) => [libelleSeauComplet(pt.t, seauSecondes, FUSEAU_AFFICHAGE), formater("pct", pt.csat), pt.avis]),
            }
          : undefined
      }
    >
      {avis === 0 ? (
        <ExperienceUnavailable />
      ) : (
        <div className="space-y-1">
          <ThresholdSeries
            grille={grille}
            points={points}
            series={[{ cle: "csat", libelle: "CSAT (avis ≥ 4/5)", role: "principale", effectifCle: "avis" }]}
            format="pct"
            faibleSous={AVIS_FAIBLE_SOUS}
            annotations={annotations.annotations}
            annotationsIndisponibles={annotations.indisponible ?? undefined}
            seauSecondes={seauSecondes}
            fuseau={FUSEAU_AFFICHAGE}
            zoomHref={zoom}
            hauteur={190}
            synchro="satisfaction"
            legendeAnnotations={false}
            ariaLabel={`CSAT par tranche de ${bucketLabel}, ${label}`}
          />
          <ThresholdSeries
            grille={grille}
            points={points}
            // Un volume : teinte neutre (ardoise), ni l'orange de la série principale ni un verdict.
            series={[{ cle: "avis", libelle: "Avis notés", role: "categorie", categorieIndex: 4, forme: "barres", additive: true }]}
            format="count"
            annotations={annotations.annotations}
            annotationsIndisponibles={annotations.indisponible ?? undefined}
            seauSecondes={seauSecondes}
            fuseau={FUSEAU_AFFICHAGE}
            zoomHref={zoom}
            hauteur={110}
            synchro="satisfaction"
            ariaLabel={`Avis notés par tranche de ${bucketLabel}, ${label}`}
          />
        </div>
      )}
    </Figure>
  );
}

// ─────────────────────────────── Répartition ───────────────────────────────

function RepartitionNotes({ s, label }: { s: FeedbackStats | null; label: string }) {
  const parts = s ? repartitionNotes(s) : [];
  return (
    <Figure
      titre="Répartition des notes"
      id="repartition-des-notes"
      meta={s ? <span>{formater("count", s.count)} avis notés · {label}</span> : undefined}
      etat={
        !s
          ? { kind: "erreur", titre: "Répartition des notes" }
          : s.count === 0
            ? { kind: "vide", population: "note d'avis", plage: label }
            : undefined
      }
      lecture="Les notes 4-5 forment le CSAT de la première tuile, les notes 1-2 la part de détracteurs."
      alternative={{
        legende: "Répartition des avis notés",
        colonnes: ["Notes", "Avis", "Part"],
        lignes: parts.map((r) => [r.libelle, r.n, formater("pct", r.part)]),
      }}
    >
      {s && (
        <>
          <RankBar
            data={[
              {
                label: "Avis notés",
                value: s.count,
                display: `${formater("count", s.count)} avis`,
                segments: parts.map((r, i) => ({ value: r.n, color: categorie(i), label: `${r.libelle} : ${formater("count", r.n)}` })),
              },
            ]}
            max={s.count}
            labelWidth="7rem"
            legende="Répartition des notes"
            alternative={false}
          />
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft" data-testid="legende-notes">
            {parts.map((r, i) => (
              <li key={r.cle} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: categorie(i) }} />
                <span className="text-ink">{r.libelle}</span>
                <span className="tabular-nums">
                  {formater("count", r.n)} · {formater("pct", r.part)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Figure>
  );
}

// ─────────────────────────────── Satisfaction par page ───────────────────────────────

function lignesImpact(
  lignes: ReturnType<typeof lignesSatisfactionParPage>,
  s: FeedbackStats | null,
  hrefRoute: (route: string) => string,
  tri: "gravite" | "volume",
): ImpactLigne[] {
  // Le CSAT, dans le MÊME SENS que la tuile (plus haut = mieux). La recette du
  // 26/09/2026 lisait « /partners 100,0 % » sous le titre « Satisfaction » : c'était
  // la part d'avis NON positifs. Le classement, lui, reste « la moins satisfaisante
  // d'abord » : il trie sur 1 − CSAT, qui n'est jamais affiché.
  const ensemble = s ? partPositive(s.positives, s.count) : null;
  const impact: ImpactLigne[] = lignes.map((l) => {
    const nom = l.route ?? "(toute l'app)";
    const sansNote = l.avis === 0;
    const libelle = sansNote ? `${nom} — commentaires sans note` : nom;
    const w = intervalleWilson(l.positifs, l.avis);
    return {
      cle: l.route ?? "__toute-l-app__",
      libelle,
      href: l.route === null ? null : hrefRoute(l.route),
      description: sansNote
        ? `${nom} : commentaires sans note, pas de CSAT`
        : `${nom} : CSAT ${formater("pct", l.csat)} sur ${formater("count", l.avis)} avis notés`,
      pilote: l.csat,
      volume: l.avis,
      mesures: [
        { cle: "detracteurs", valeur: l.partDetracteurs, affichage: formater("pct", l.partDetracteurs) },
        {
          cle: "lcp",
          valeur: l.lcp,
          affichage: formater("ms", l.lcp),
          vital: "LCP",
          n: l.lcpN,
          ...(l.lcpIntervalle ? { intervalle: l.lcpIntervalle } : {}),
        },
      ],
      ecart: ecartPoints(l.csat, ensemble),
      intervalle: w && !("indisponible" in w) ? `${formater("pct", w.bas)} – ${formater("pct", w.haut)}` : null,
      echantillonFaible: l.avis < AVIS_FAIBLE_SOUS,
    };
  });
  return classerParGravite(impact, {
    // « Gravité » = la moins satisfaisante d'abord : la clé décroissante est 1 − CSAT.
    pilote: (l) => (l.pilote === null ? null : 1 - l.pilote),
    effectif: (l) => l.volume,
    seuilFaible: AVIS_FAIBLE_SOUS,
    tri,
  }).lignes;
}

// ─────────────────────────────── Verbatims ───────────────────────────────

function Etoiles({ score }: { score: number | null }) {
  if (score == null) return <span className="text-xs text-ink-soft">sans note</span>;
  const n = Math.max(0, Math.min(5, score));
  return (
    <span className="tabular-nums">
      <span className="sr-only">note {score} sur 5</span>
      <span aria-hidden="true" className="text-ink">
        {"★".repeat(n)}
      </span>
      <span aria-hidden="true" className="text-ink-faint">
        {"★".repeat(5 - n)}
      </span>
    </span>
  );
}

function Verbatims({
  recents,
  q,
  label,
}: {
  recents: SectionLue<FeedbackRow[]>;
  q: AnalyticsQuery;
  label: string;
}): ReactNode {
  return (
    <Figure
      titre="Derniers verbatims"
      id="verbatims"
      meta={
        <>
          <span>30 derniers avis, notés ou non</span>
          <span>{label}</span>
          <span>données personnelles retirées des commentaires dès la réception</span>
        </>
      }
      etat={
        !recents.ok
          ? { kind: "erreur", titre: "Derniers verbatims" }
          : recents.data.length === 0
            ? { kind: "vide", population: "réponse au module d'avis", plage: label }
            : undefined
      }
    >
      {recents.ok && (
        <ul className="divide-y divide-line/60" data-testid="verbatims-liste">
          {recents.data.map((r) => {
            const ms = new Date(r.ts).getTime();
            return (
              <li key={r.id} className="flex min-w-0 flex-col gap-1 py-3 sm:flex-row sm:items-start sm:gap-4">
                <span className="shrink-0">
                  <Etoiles score={r.score} />
                </span>
                <span className="min-w-0 flex-1 break-words text-sm text-ink">
                  {r.comment ? r.comment : <span className="text-ink-soft">(sans commentaire)</span>}
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs sm:shrink-0">
                  <span className="chip-mono inline-block max-w-[14rem] truncate align-middle">{r.route ?? "(toute l'app)"}</span>
                  <time dateTime={Number.isFinite(ms) ? new Date(ms).toISOString() : undefined} className="text-ink-soft">
                    {fmtDate(ms)}
                  </time>
                  {r.session_id && (
                    <Link
                      href={hrefWithQuery(`/sessions/${encodeURIComponent(r.session_id)}`, q)}
                      className="font-medium text-perf hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      session →
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Figure>
  );
}
