// Écran « Tendances » (§ 5.20, F65) : « Si la tendance des 14 derniers jours
// continue, quand franchit-on le seuil, et cette tendance se distingue-t-elle du
// bruit ? » (libellé « Tendances », jamais « Prévisions » : ce n'est pas une prévision).
//
// CE QUI CHANGE, ET POURQUOI (DF4).
//   - La fenêtre : 14 jours COMPLETS dans le fuseau de l'app, aujourd'hui exclu.
//     L'ancienne lecture mêlait deux demi-journées (la première et aujourd'hui) aux
//     douze jours complets, et « LCP actuel » prenait la journée entamée.
//   - La droite n'est plus une échéance d'office : elle est tracée sur les jours
//     d'au moins 30 mesures, avec la dispersion des points autour d'elle ; une
//     échéance ne s'écrit que si la pente dépasse ce bruit (`penteSignificative`).
//   - Le ratio d'erreurs n'a pas de seuil (aucun n'est publié, R-S) : ni verdict,
//     ni « franchira ». Le trafic n'a pas de droite : 14 jours lisent un cycle
//     hebdomadaire comme une tendance ; il se lit contre le même jour J−7.
//   - Un seul composant de série, `ThresholdSeries` (bandes de `lib/rating.ts`) ;
//     `ForecastChart`, `MetricCard` et `ForecastSpark` disparaissent.
//
// PORTES OUVERTES. P*.3 (anomalies quotidiennes) posera ses annotations sur ces
// séries (`annotations` de `ThresholdSeries`) ; P*.4 (test de pente, bande de
// prédiction) remplacera `tendance()` sans toucher à la mise en page.
//
// P*.7 — « DEPUIS QUAND ? ». La tendance dit si la série DÉRIVE ; elle ne dit pas
// si elle a changé de NIVEAU à une date. Le test de Pettitt (`lib/stats/rupture.ts`)
// le date sur les mêmes jours valides, pose son annotation de type « rupture » sur
// le hero et écrit sa phrase sous la figure — ou refuse en chiffres. Un déploiement
// à ± 1 jour est cité comme une coïncidence de date ; la réserve est écrite ici.
//
// Chaque section lit par `lire()` : une lecture en échec ne fait tomber qu'elle.
import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface, type Etat } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import {
  HORIZON_JOURS,
  JOURS_VALIDES_REQUIS,
  K_BRUIT,
  MESURES_MIN_JOUR,
  buildForecastNarrative,
  cleJour,
  echeanceLcp,
  pointsTendance,
  projectAt,
  tendance,
  type Tendance,
} from "@/lib/forecast";
import { liensDesJours } from "@/lib/forecast-liens";
import { bornesJourLocal } from "@/lib/fuseau-local";
import { instantDe, jourDans } from "@/lib/series";
import {
  JOURS_VALIDES_REQUIS_RUPTURE,
  MESURES_MIN_JOUR_RUPTURE,
  SEUIL_P_RUPTURE,
  REGLE_RUPTURE,
  annotationRupture,
  daterRupture,
  deploiementCoincident,
  phraseRupture,
  phraseSansRupture,
} from "@/lib/stats/rupture";
// Le seuil publié dans « Méthode » est FORMATÉ par la même fonction que les p des
// phrases : deux écritures du même nombre finiraient par diverger.
import { formaterP } from "@/lib/stats/surrepresentation";
import { chargerForecast } from "@/lib/chargeurs/forecast";
import { chargerEcran } from "@/lib/ecran";
import { ratioPour100 } from "@/lib/perf-domain";
import { GRID_DAYS } from "@/lib/queries-grid";
import { hrefWithQuery } from "@/lib/query-contract";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

// Borne « Bon » du LCP, lue dans lib/rating.ts : l'échéance se calcule contre elle.
const LCP_BON = THRESHOLDS.LCP[0];
const LCP_BON_TEXTE = formater("ms", LCP_BON);

/** « 10/09 » d'une clé de jour « AAAA-MM-JJ » (une étiquette, lue sans fuseau). */
function jjmm(jour: string | undefined): string {
  if (!jour) return "—";
  const [, m, j] = jour.split("-");
  return `${j}/${m}`;
}

/** L'état d'une tendance, en une ligne de méta. */
function texteTendance(t: Tendance, unite: string): string {
  if (t.etat === "insuffisante") return `tendance non calculée : ${JOURS_VALIDES_REQUIS} jours mesurés requis, ${t.joursValides} disponibles`;
  const pente = t.fit ? `${t.fit.slope >= 0 ? "+" : "−"}${formater(unite === "ms" ? "ms" : "pour100", Math.abs(t.fit.slope))} par jour` : "";
  return t.etat === "bruit" ? `tendance non distinguable du bruit (${pente})` : `tendance établie (${pente})`;
}

const TON_SYNTHESE = {
  risk: "border-bad/40 bg-bad/5",
  watch: "border-warn/50 bg-warn/10",
  ok: "border-line bg-panel2/60",
} as const;

function Methode() {
  return (
    <details className="card mt-6 p-4 text-sm sm:p-5" data-testid="methode">
      <summary className="cursor-pointer select-none text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
        Méthode
      </summary>
      <p className="mt-2 leading-relaxed text-ink-soft">
        Droite des moindres carrés sur les jours d&apos;au moins {MESURES_MIN_JOUR} mesures ; bande = ± 1 écart type des
        résidus ; échéance écrite seulement si la pente sur {GRID_DAYS} jours dépasse {K_BRUIT} écarts types ; aucune
        saisonnalité ; ce n&apos;est pas une prévision. Au moins {JOURS_VALIDES_REQUIS} jours valides sont requis pour
        tracer une droite. Les journées sont découpées dans le fuseau de l&apos;application ; la journée en cours est
        exclue. Aucun seuil publié n&apos;existe pour le ratio d&apos;erreurs ni pour le trafic : ils se lisent sans verdict.
      </p>
      <p className="mt-2 leading-relaxed text-ink-soft">
        Datation d&apos;une rupture (P*.7) : test de Pettitt, non paramétrique, une seule rupture —{" "}
        <code>U</code> cumulé des signes, <code>K = max |U|</code>, <code>p ≈ 2·exp(−6K²/(n³+n²))</code>, retenue sous{" "}
        {formaterP(SEUIL_P_RUPTURE)}. Un jour n&apos;entre dans ce test qu&apos;au-dessus de {MESURES_MIN_JOUR_RUPTURE} mesures (minimum
        d&apos;une p75), et il en faut {JOURS_VALIDES_REQUIS_RUPTURE} ; à {JOURS_VALIDES_REQUIS_RUPTURE} jours, même une marche
        parfaite reste au-dessus de {formaterP(SEUIL_P_RUPTURE)}, donc « aucune rupture datée » y veut surtout dire « pas assez de jours ». Les deux niveaux
        comparés sont des médianes de p75 quotidiennes, jamais une p75 de période. Un déploiement à un jour au plus est
        cité comme une coïncidence de date.
      </p>
    </details>
  );
}

export default async function Tendances({ searchParams }: { searchParams: Promise<SearchParams> }) {
  // Le chargeur (`lib/chargeurs/forecast.ts`) lit les quatorze jours, les marqueurs
  // et la couverture du jour de référence ; un jour y voyage en clé « AAAA-MM-JJ ».
  const ecran = await chargerEcran(ECRANS.forecast, chargerForecast, await searchParams);
  if (ecran.etat === "refus") return <FilterProblemNotice title="Tendances" problem={ecran.problem} />;
  const { query, fuseau, jours, traficLu, lcpLu, deploysLu, couvLcp, couvRatio, couvVues, peutEcrire } = ecran;

  const dernier = jours.length - 1;
  const semainePrecedente = dernier - 7;

  const lcpParJour = new Map((lcpLu.ok ? lcpLu.data : []).map((r) => [r.jour, r]));
  const traficParJour = new Map((traficLu.ok ? traficLu.data : []).map((t) => [cleJour(t.day), t]));
  const lcp = jours.map((j) => lcpParJour.get(j)?.p75 ?? null);
  const mesures = jours.map((j) => lcpParJour.get(j)?.n ?? 0);
  const vues = jours.map((j) => Number(traficParJour.get(j)?.pageviews ?? 0));
  const occurrences = jours.map((j) => Number(traficParJour.get(j)?.errors ?? 0));
  const ratios = jours.map((_j, i) => ratioPour100(occurrences[i], vues[i]));

  // ─────────────── Tendances ───────────────
  const tLcp = tendance(lcp, mesures);
  const tRatio = tendance(ratios, vues);
  const hero = pointsTendance(jours, lcp, mesures, tLcp);

  // Échéance (TE1) : contre la dernière valeur RETENUE (≥ 30 mesures) ; un seuil
  // déjà dépassé se dit même sans pente — c'est une mesure, pas une projection.
  // « Dépassé » au sens de lib/rating.ts : 2 500 ms est encore « Bon » (`echeanceLcp`).
  const courant = [...tLcp.retenues].reverse().find((v) => v !== null) ?? null;
  const eta = echeanceLcp(tLcp.fit, courant);
  const synthese = buildForecastNarrative([{ label: "LCP p75", thresholdLabel: LCP_BON_TEXTE, eta, tendance: tLcp }]);

  // ─────────────── Liens (bornes UTC du jour local, § 3.3) ───────────────
  const gabarit = (chemin: string) => hrefWithQuery(chemin, query, { period: null, from: "{from}", to: "{to}" });
  const liensVue = liensDesJours(gabarit("/"), jours, fuseau);
  const liensErreurs = liensDesJours(gabarit("/errors"), jours, fuseau);

  // ─────────────── Datation d'une rupture (P*.7) ───────────────
  // Même série, mêmes jours, mais une autre question : la tendance dit si le LCP
  // DÉRIVE, Pettitt dit s'il a changé de NIVEAU à une date. Un jour n'entre dans le
  // test qu'au-dessus de MESURES_MIN_JOUR_RUPTURE (13, minimum d'une p75, P*.1) :
  // c'est un seuil PLUS BAS que celui de la droite (30), et les deux sont écrits.
  const datation = daterRupture(jours.map((jour, i) => ({ jour, valeur: lcp[i], effectif: mesures[i] })));
  // `deploy_marker` est horodaté en instant ; la rupture est un JOUR de l'app :
  // on ramène chaque marqueur au jour du fuseau de l'app avant de comparer.
  const joursDeploys = deploysLu.ok
    ? deploysLu.data.map((d) => ({ jour: jourDans(instantDe(d.ts), fuseau), version: d.version }))
    : [];
  const ruptureDeploiement =
    datation.ok && datation.rupture ? deploiementCoincident(datation.rupture.jour, joursDeploys) : null;
  const phraseDatation = !datation.ok
    ? datation.raison
    : datation.rupture
      ? phraseRupture(datation.rupture, "Le LCP p75", (v) => formater("ms", v), ruptureDeploiement)
      : phraseSansRupture(datation, tLcp.etat === "significative");
  const annotationsRupture =
    datation.ok && datation.rupture
      ? [
          annotationRupture(
            datation.rupture,
            bornesJourLocal(datation.rupture.jour, fuseau).from,
            liensVue[datation.rupture.jour]?.href,
          ),
        ]
      : [];
  const lienAlerte = (() => {
    const p = new URLSearchParams();
    if (query.scope.requestedApp) p.set("app", query.scope.requestedApp);
    p.set("regle_metrique", "LCP");
    p.set("regle_seuil", String(LCP_BON));
    return `/alerts?${p}#nouvelle-regle`;
  })();

  const referenceJ7 = `vs même jour, semaine précédente (${jjmm(jours[semainePrecedente])})`;
  const dateDernier = jjmm(jours[dernier]);
  const aucuneMesureLcp = lcpLu.ok && mesures.every((n) => n === 0);
  const aucuneVue = traficLu.ok && vues.every((v) => v === 0);

  const etatHero: Etat | undefined = !lcpLu.ok
    ? { kind: "erreur", titre: "LCP p75 quotidien" }
    : aucuneMesureLcp
      ? { kind: "vide", population: "mesure LCP", plage: `${GRID_DAYS} jours complets` }
      : undefined;
  const etatRatio: Etat | undefined = !traficLu.ok
    ? { kind: "erreur", titre: "Occurrences d'erreurs pour 100 pages vues" }
    : aucuneVue
      ? { kind: "vide", population: "page vue", plage: `${GRID_DAYS} jours complets` }
      : undefined;
  const etatVues: Etat | undefined = !traficLu.ok
    ? { kind: "erreur", titre: "Pages vues par jour" }
    : aucuneVue
      ? { kind: "vide", population: "page vue", plage: `${GRID_DAYS} jours complets` }
      : undefined;

  const seriesHero = [
    { cle: "observe", libelle: "LCP p75 du jour", role: "principale" as const, effectifCle: "n" },
    ...(tLcp.fit
      ? [{ cle: "ajuste", libelle: tLcp.etat === "bruit" ? "Droite ajustée (dans le bruit)" : "Droite ajustée", role: "reference" as const }]
      : []),
    ...(tLcp.etat === "significative" ? [{ cle: "projection", libelle: `Projection sur ${HORIZON_JOURS} jours`, role: "projection" as const }] : []),
  ];
  const pointsRatio = jours.map((t, i) => ({
    t,
    ratio: ratios[i],
    vues: vues[i],
    ajuste: tRatio.etat === "significative" && tRatio.fit ? projectAt(tRatio.fit, i) : null,
  }));
  const pointsVues = jours.map((t, i) => ({ t, vues: vues[i], vues_j7: i >= 7 ? vues[i - 7] : null }));

  const kpi = (contenu: ReactNode) => <div className="min-w-0">{contenu}</div>;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tendances"
        domain="fiabilite"
        help="forecast"
        sub="Si la tendance des 14 derniers jours continue, quand franchit-on le seuil, et cette tendance se distingue-t-elle du bruit ?"
      />

      {/* 1 — Bandeau de fenêtre fixe : la plage du haut ne s'applique pas, et on le dit avec les dates. */}
      <p role="note" data-testid="fenetre-fixe" className="-mt-2 mb-5 rounded-lg border border-line bg-panel2/60 px-4 py-2 text-xs text-ink-soft">
        {GRID_DAYS} jours complets, du {jjmm(jours[0])} au {dateDernier}, fuseau de l&apos;app ({fuseau}) ; la plage
        choisie en haut ne s&apos;applique pas ; la journée en cours est exclue.
      </p>

      {/* 2 — Synthèse (TE1) : une échéance seulement si la pente dépasse le bruit. */}
      <section role="note" aria-label="Synthèse" data-testid="synthese" className={`mb-6 rounded-xl border px-4 py-3 ${TON_SYNTHESE[synthese.status]}`}>
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Synthèse</h2>
        {!lcpLu.ok ? (
          <p className="mt-1 text-sm text-ink">LCP non lu (lecture en échec) : aucune synthèse n&apos;est calculée.</p>
        ) : (
          <ul className="mt-1.5 space-y-0.5 text-sm text-ink">
            {synthese.lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}
        {peutEcrire && lcpLu.ok && (
          <Link href={lienAlerte} className="mt-2 inline-block text-xs font-medium text-perf underline-offset-2 hover:underline">
            Créer une alerte sur ce seuil ({LCP_BON_TEXTE})
          </Link>
        )}
      </section>

      {/* 3 — Chiffres du dernier jour complet, contre le même jour de la semaine précédente. */}
      <section aria-label="Dernier jour complet" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {kpi(
          !lcpLu.ok ? (
            <EchecLecture titre="LCP p75, dernier jour complet" compact />
          ) : (
            <KpiTile
              label={`LCP p75, dernier jour complet (${dateDernier})`}
              valeur={lcp[dernier] ?? null}
              format="ms"
              vital="LCP"
              raisonNull="aucune mesure LCP ce jour-là"
              serie={lcp}
              couverture={{ n: mesures[dernier] ?? 0, unite: "mesures LCP" }}
              precedent={semainePrecedente >= 0 ? (lcp[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvLcp ?? undefined}
              href={hrefWithQuery("/pages", query, { vital: "LCP" })}
            />
          ),
        )}
        {kpi(
          !traficLu.ok ? (
            <EchecLecture titre="Occurrences d'erreurs pour 100 pages vues" compact />
          ) : (
            <KpiTile
              label={`Occurrences d'erreurs pour 100 pages vues, dernier jour complet (${dateDernier})`}
              valeur={ratios[dernier] ?? null}
              format="pour100"
              sensMeilleur="bas"
              raisonNull="aucune page vue ce jour-là"
              lecture="Inclut les erreurs sans page vue (backend) : le ratio peut dépasser 100."
              couverture={{ n: vues[dernier] ?? 0, unite: "pages vues", faibleSous: MESURES_MIN_JOUR }}
              precedent={semainePrecedente >= 0 ? (ratios[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvRatio ?? undefined}
              href={hrefWithQuery("/errors", query)}
            />
          ),
        )}
        {kpi(
          !traficLu.ok ? (
            <EchecLecture titre="Pages vues, dernier jour complet" compact />
          ) : (
            <KpiTile
              label={`Pages vues, dernier jour complet (${dateDernier})`}
              valeur={vues[dernier] ?? 0}
              format="count"
              sensMeilleur="neutre"
              precedent={semainePrecedente >= 0 ? (vues[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvVues ?? undefined}
            />
          ),
        )}
      </section>

      {/* 4 — Hero (TE5) : 14 jours observés, droite ajustée, projection si la pente dépasse le bruit. */}
      <SectionErreur titre="LCP p75 quotidien et sa tendance">
        <Figure
          titre="LCP p75 quotidien et sa tendance"
          id="tendance-lcp"
          aide="LCP"
          etat={etatHero}
          meta={
            etatHero ? undefined : (
              <>
                <span>
                  {GRID_DAYS} jours complets ({fuseau})
                </span>
                <span>
                  {tLcp.joursValides} jour{tLcp.joursValides > 1 ? "s" : ""} d&apos;au moins {MESURES_MIN_JOUR} mesures
                </span>
                <span>{texteTendance(tLcp, "ms")}</span>
                {tLcp.etat === "significative" && tLcp.dispersion !== null && (
                  <span>bande ± {formater("ms", tLcp.dispersion)}</span>
                )}
                <span>
                  {datation.ok
                    ? datation.rupture
                      ? "rupture datée (Pettitt)"
                      : "aucune rupture datée (Pettitt)"
                    : "datation non tentée"}
                </span>
              </>
            )
          }
          lecture={
            <>
              Points creux : moins de {MESURES_MIN_JOUR} mesures, exclus de l&apos;ajustement. Droite grise : moindres
              carrés sur les jours valides, tracée sur les {GRID_DAYS} jours pour voir si elle colle aux points.
              {tLcp.etat === "significative"
                ? ` Pointillé : projection sur ${HORIZON_JOURS} jours dans une bande de ± 1 écart type des résidus.`
                : tLcp.etat === "bruit"
                  ? " La pente ne dépasse pas le bruit : aucune projection, aucune échéance."
                  : ""}{" "}
              {datation.ok && datation.rupture
                ? "Le trait vertical « Rupture » marque le premier jour du nouveau niveau ; il ouvre la Vue d'ensemble sur ce jour."
                : ""}{" "}
              Un point ouvre la Vue d&apos;ensemble sur ce jour (bornes converties en UTC).
            </>
          }
          alternative={
            etatHero
              ? undefined
              : {
                  legende: "LCP p75 par jour, droite ajustée et projection",
                  colonnes: ["Jour", "LCP p75", "Mesures", "Droite ajustée", "Projection", "Bande basse", "Bande haute"],
                  lignes: hero.points.map((p) => [
                    jjmm(p.t),
                    formater("ms", p.observe),
                    p.n,
                    formater("ms", p.ajuste),
                    formater("ms", p.projection),
                    formater("ms", p.bas),
                    formater("ms", p.haut),
                  ]),
                }
          }
        >
          <div className="flex flex-col gap-3">
            {tLcp.etat === "insuffisante" && (
              <EtatSurface
                etat={{
                  kind: "partiel",
                  raison: `tendance non calculée : ${JOURS_VALIDES_REQUIS} jours mesurés requis, ${tLcp.joursValides} disponibles`,
                }}
                compact
              />
            )}
            {tLcp.etat === "bruit" && (
              <p className="text-xs text-ink-soft" data-testid="tendance-bruit">
                Tendance non distinguable du bruit : la pente sur {GRID_DAYS} jours ne dépasse pas {K_BRUIT} écarts types
                des résidus.
              </p>
            )}
            {/* P*.7 — « depuis quand ? » : la datation, ou son refus chiffré. La réserve
                d'interprétation est écrite ICI, jamais par le module (RM5). */}
            <p className="min-w-0 text-xs text-ink-soft" data-testid="datation-rupture">
              {phraseDatation}
              {ruptureDeploiement && " Coïncidence de date, pas une cause établie."}
              {datation.ok &&
                datation.rupture &&
                tLcp.etat === "significative" &&
                " La tendance est par ailleurs établie sur la même fenêtre : une dérive régulière sépare la série aussi nettement qu'une marche, la date est donc un point de bascule et non la preuve d'un saut."}{" "}
              {/* La règle reste en `ink-soft` : sous 18 px, `ink-faint` ne passe pas le contraste (§ 3.9). */}
              <span>Règle : {REGLE_RUPTURE}.</span>
            </p>
            <ThresholdSeries
              grille={hero.grille}
              points={hero.points}
              series={seriesHero}
              annotations={annotationsRupture}
              format="ms"
              vital="LCP"
              faibleSous={MESURES_MIN_JOUR}
              bande={tLcp.etat === "significative" ? { basseCle: "bas", hauteCle: "haut", libelle: "± 1 écart type des résidus" } : undefined}
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensVue}
              ariaLabel={`LCP p75 quotidien sur ${GRID_DAYS} jours complets, droite ajustée${tLcp.etat === "significative" ? ` et projection à ${HORIZON_JOURS} jours` : ""}, 3 zones de seuil`}
            />
          </div>
        </Figure>
      </SectionErreur>

      {/* 5 — Deux petits multiples, sans seuil ni échéance. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionErreur titre="Occurrences d'erreurs pour 100 pages vues">
          <Figure
            titre="Occurrences d'erreurs pour 100 pages vues"
            id="tendance-erreurs"
            etat={etatRatio}
            meta={
              etatRatio ? undefined : (
                <>
                  <span>par jour, {fuseau}</span>
                  <span>{texteTendance(tRatio, "pour100")}</span>
                </>
              )
            }
            lecture="Aucun seuil n'est publié pour ce ratio : ni verdict, ni échéance. Droite tracée seulement si la pente dépasse le bruit. Points creux : moins de 30 pages vues. Un point ouvre les erreurs de ce jour."
            alternative={
              etatRatio
                ? undefined
                : {
                    legende: "Occurrences d'erreurs pour 100 pages vues, par jour",
                    colonnes: ["Jour", "Pour 100 pages vues", "Occurrences", "Pages vues"],
                    lignes: jours.map((j, i) => [jjmm(j), formater("pour100", ratios[i]), occurrences[i], vues[i]]),
                  }
            }
          >
            <ThresholdSeries
              grille={jours}
              points={pointsRatio}
              series={[
                { cle: "ratio", libelle: "Pour 100 pages vues", role: "principale", effectifCle: "vues" },
                ...(tRatio.etat === "significative" ? [{ cle: "ajuste", libelle: "Droite ajustée", role: "reference" as const }] : []),
              ]}
              format="pour100"
              faibleSous={MESURES_MIN_JOUR}
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensErreurs}
              hauteur={140}
              ariaLabel={`Occurrences d'erreurs pour 100 pages vues, par jour, ${GRID_DAYS} jours complets`}
            />
          </Figure>
        </SectionErreur>

        <SectionErreur titre="Pages vues par jour">
          <Figure
            titre="Pages vues par jour"
            id="pages-vues-jour"
            etat={etatVues}
            meta={
              etatVues ? undefined : (
                <>
                  <span>par jour, {fuseau}</span>
                  <span>repère J−7 sur les 7 derniers jours</span>
                </>
              )
            }
            lecture="Pas de droite : sur 14 jours, une droite lirait le cycle de la semaine comme une tendance. Chaque jour se compare au même jour de la semaine précédente. Une barre ouvre la Vue d'ensemble sur ce jour."
            alternative={
              etatVues
                ? undefined
                : {
                    legende: "Pages vues par jour et même jour de la semaine précédente",
                    colonnes: ["Jour", "Pages vues", "Même jour, semaine précédente"],
                    lignes: pointsVues.map((p) => [jjmm(p.t), p.vues, p.vues_j7]),
                  }
            }
          >
            <ThresholdSeries
              grille={jours}
              points={pointsVues}
              series={[
                { cle: "vues", libelle: "Pages vues", role: "principale", forme: "barres", additive: true },
                { cle: "vues_j7", libelle: "Même jour, semaine précédente", role: "reference" },
              ]}
              format="count"
              seauSecondes={86_400}
              fuseau={fuseau}
              liensSeaux={liensVue}
              hauteur={140}
              ariaLabel={`Pages vues par jour sur ${GRID_DAYS} jours complets, repère du même jour de la semaine précédente`}
            />
          </Figure>
        </SectionErreur>
      </div>

      {/* 6 — Méthode (TE8). */}
      <Methode />
    </div>
  );
}
