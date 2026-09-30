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
// si elle a changé de NIVEAU à une date. Le test de Pettitt (`@mip/stats/rupture`)
// le date sur les mêmes jours valides, pose son annotation de type « rupture » sur
// le hero et écrit sa phrase sous la figure — ou refuse en chiffres. Un déploiement
// à ± 1 jour est cité comme une coïncidence de date ; la réserve est écrite ici.
//
// UN SEUL CALCUL. Tendance, échéance, datation et déploiement coïncident viennent
// d'`analyserSerieQuotidienne` (`@mip/stats`), la fonction que `GET /api/v1/trends`
// applique aux cinq vitals : l'écran et l'API ne peuvent pas dire deux choses de
// la même série.
//
// Chaque section lit par `lire()` : une lecture en échec ne fait tomber qu'elle.
import Link from "next/link";
import type { ReactNode } from "react";
import { ECRANS } from "@mip/console-contract";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { Figure } from "@/components/charts/Figure";
import { KpiTile } from "@/components/charts/KpiTile";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { ICON_PATHS, Icon } from "@/components/icons";
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
  pointsTendance,
  premiereTendancePossible,
  projectAt,
  tendance,
  type Tendance,
} from "@mip/stats/tendance";
import { analyserSerieQuotidienne } from "@mip/stats/serie-quotidienne";
import { annotationRupture } from "@/lib/annotations";
// Les réserves d'interprétation, écrites ici ET par `GET /api/v1/trends` : une seule source.
import { RESERVE_COINCIDENCE, RESERVE_TENDANCE_ETABLIE } from "@/lib/api/tendances";
import { cleJour } from "@/lib/forecast";
import { liensDesJours } from "@/lib/forecast-liens";
import { bornesJourLocal, nomFuseau } from "@/lib/fuseau-local";
import { fenetresLues, instantDe, jourDans } from "@/lib/series";
import {
  JOURS_VALIDES_REQUIS_RUPTURE,
  MESURES_MIN_JOUR_RUPTURE,
  SEUIL_P_RUPTURE,
  REGLE_RUPTURE,
  phraseRupture,
  phraseSansRupture,
} from "@mip/stats/rupture";
// Le seuil publié dans « Méthode » est FORMATÉ par la même fonction que les p des
// phrases : deux écritures du même nombre finiraient par diverger.
import { formaterP } from "@mip/stats/surrepresentation";
import { chargerForecast } from "@/lib/chargeurs/forecast";
import { chargerEcran } from "@/lib/ecran";
import { ratioPour100 } from "@/lib/perf-domain";
import { GRID_DAYS } from "@/lib/queries-grid";
import { hrefWithQuery } from "@/lib/query-contract";
import { THRESHOLDS } from "@/lib/rating";
import { BandeauComparaison, MASQUE_SILENCE_REPETE } from "@/components/charts/RangeeKpi";
import { Methode as MethodeRepliee } from "@/components/perf/Methode";

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

/**
 * Le voyant de la case « Synthèse » (recette du 30/09/2026) : rouge quand le LCP p75
 * dépasse déjà la borne « Bon » de web.dev, ambre quand la projection la franchit dans
 * l'horizon — les deux seuls constats que la synthèse sait sourcer. Sinon, aucun voyant.
 */
const POINT_SYNTHESE = {
  risk: "bg-bad",
  watch: "bg-warn",
  ok: null,
} as const;

/** Sources écrites dans la fenêtre de chaque case (capteur, API, référence des seuils). */
const SOURCE_LCP =
  "Navigateur, bibliothèque web-vitals 5.3 (Largest Contentful Paint, W3C) ; p75 du jour. Seuils : web.dev (Google).";
const SOURCE_TRAFIC_JOUR = "SDK MIP RUM dans la page : une page vue par chargement ou changement de route, comptée par jour.";
const SOURCE_ERREURS_JOUR =
  "SDK MIP RUM : événements error et unhandledrejection, échecs réseau et violations CSP, rapportés aux pages vues du jour.";

function Methode() {
  // Replié sur une ligne, sans cadre (recette du 30/09/2026) : la méthode se lit à la
  // demande, elle n'occupe plus une carte en bas d'écran.
  return (
    <details className="mt-4 text-xs text-ink-soft" data-testid="methode">
      <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">Méthode</summary>
      <p className="mt-2 leading-relaxed text-ink-soft">
        Droite des moindres carrés sur les jours d&apos;au moins {MESURES_MIN_JOUR} mesures (un jour en dessous est un
        point creux, exclu de l&apos;ajustement), tracée sur les {GRID_DAYS} jours pour voir si elle colle aux points ;
        bande = ± 1 écart type des résidus ; échéance écrite seulement si la pente sur {GRID_DAYS} jours dépasse{" "}
        {K_BRUIT} écarts types ; aucune saisonnalité ; ce n&apos;est pas une prévision. Au moins {JOURS_VALIDES_REQUIS}{" "}
        jours valides sont requis pour tracer une droite. Les journées sont découpées dans le fuseau de
        l&apos;application ; la journée en cours est exclue. Aucun seuil publié n&apos;existe pour le ratio
        d&apos;erreurs ni pour le trafic : ils se lisent sans verdict ; le trafic n&apos;a pas de droite, une droite
        sur {GRID_DAYS} jours lirait le cycle de la semaine comme une tendance.
      </p>
      <p className="mt-2 leading-relaxed text-ink-soft">
        Datation d&apos;une rupture : test de Pettitt, non paramétrique, une seule rupture —{" "}
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
  // Hachures « non mesuré » : un jour entièrement hors collecte n'est ni un zéro de vues ni un trou muet.
  const fenetres = fenetresLues(ecran.fenetresCollecte);

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
  // `deploy_marker` est horodaté en instant ; la rupture est un JOUR de l'app :
  // on ramène chaque marqueur au jour du fuseau de l'app avant de comparer.
  const joursDeploys = deploysLu.ok
    ? deploysLu.data.map((d) => ({ jour: jourDans(instantDe(d.ts), fuseau), version: d.version }))
    : [];
  // Échéance (TE1) : contre la dernière valeur RETENUE (≥ 30 mesures) ; un seuil
  // déjà dépassé se dit même sans pente — c'est une mesure, pas une projection.
  // « Dépassé » au sens de lib/rating.ts : 2 500 ms est encore « Bon ».
  // P*.7 : même série, mêmes jours, mais une autre question — la tendance dit si le
  // LCP DÉRIVE, Pettitt dit s'il a changé de NIVEAU à une date. Un jour n'entre dans
  // le test qu'au-dessus de MESURES_MIN_JOUR_RUPTURE (13, minimum d'une p75, P*.1) :
  // c'est un seuil PLUS BAS que celui de la droite (30), et les deux sont écrits.
  const analyseLcp = analyserSerieQuotidienne(
    jours.map((jour, i) => ({ jour, valeur: lcp[i], effectif: mesures[i] })),
    { borne: LCP_BON, deploiements: joursDeploys },
  );
  const tLcp = analyseLcp.tendance;
  const tRatio = tendance(ratios, vues);
  const hero = pointsTendance(jours, lcp, mesures, tLcp);
  const synthese = buildForecastNarrative([
    { label: "LCP p75", thresholdLabel: LCP_BON_TEXTE, eta: analyseLcp.eta, tendance: tLcp },
  ]);

  // ─────────────── Liens (bornes UTC du jour local, § 3.3) ───────────────
  const gabarit = (chemin: string) => hrefWithQuery(chemin, query, { period: null, from: "{from}", to: "{to}" });
  const liensVue = liensDesJours(gabarit("/"), jours, fuseau);
  const liensErreurs = liensDesJours(gabarit("/errors"), jours, fuseau);

  // ─────────────── Datation d'une rupture (P*.7) ───────────────
  const { datation, deploiement: ruptureDeploiement } = analyseLcp;
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
  // Rien sur les quatorze jours (collecte commencée aujourd'hui, ou app muette) : UN
  // état vide pour l'écran, avec la date où il servira, au lieu de trois panneaux vides
  // qui répétaient chacun leur message et la méthode d'un graphique absent.
  const toutVide = aucuneMesureLcp && aucuneVue;
  const premiereTendance = premiereTendancePossible(jours[dernier], tLcp.joursValides);
  const phrasePremiereTendance = premiereTendance
    ? `Premières tendances au plus tôt le ${jjmm(premiereTendance)} : il faut ${JOURS_VALIDES_REQUIS} journées complètes d'au moins ${MESURES_MIN_JOUR} mesures LCP.`
    : null;

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
  // Début de chaque journée dans le fuseau de l'app : l'axe du temps de la fenêtre d'une case.
  const debutsJours = jours.map((j) => bornesJourLocal(j, fuseau).from);

  // ─────────────── Synthèse, en une case (recette du 30/09/2026) ───────────────
  // Une valeur courte, la plus importante d'abord : ce qui est déjà franchi, puis ce qui
  // le sera dans l'horizon, puis l'état de la tendance. Les phrases de la synthèse (et la
  // date des premières tendances) sont dans la fenêtre de la case.
  const etaEcrite = analyseLcp.eta;
  const valeurSynthese = !lcpLu.ok
    ? "—"
    : etaEcrite === 0
      ? `> ${LCP_BON_TEXTE}`
      : etaEcrite != null && etaEcrite > 0 && etaEcrite <= HORIZON_JOURS
        ? `J+${Math.ceil(etaEcrite)}`
        : tLcp.etat === "significative"
          ? "Établie"
          : tLcp.etat === "bruit"
            ? "Dans le bruit"
            : "Non calculée";
  const pointSynthese = lcpLu.ok ? POINT_SYNTHESE[synthese.status] : null;
  const phraseFenetre = `${GRID_DAYS} jours complets, du ${jjmm(jours[0])} au ${dateDernier}, fuseau de l'app (${nomFuseau(fuseau)}) ; la plage choisie en haut ne s'applique pas ; la journée en cours est exclue.`;

  // ─────────────── Datation, en une ligne ───────────────
  // Le constat se lit en un coup d'œil (« Rupture autour du 07/09 : 1,9 s → 2,7 s ») ;
  // la phrase entière, ses chiffres et ses réserves restent dans la page, lus par un
  // lecteur d'écran et repris par la méthode.
  const ligneDatation =
    datation.ok && datation.rupture
      ? `Rupture autour du ${jjmm(datation.rupture.jour)} : ${formater("ms", datation.rupture.medianeAvant)} → ${formater("ms", datation.rupture.medianeApres)} (Pettitt, p = ${formaterP(datation.rupture.p)})`
      : null;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Tendances" domain="fiabilite" help="forecast">
        {/* 1 — La fenêtre fixe, en pastille à droite du titre : la plage du haut ne
            s'applique pas, et la pastille le dit avec les dates (le détail au survol). */}
        <p
          role="note"
          data-testid="fenetre-fixe"
          title={phraseFenetre}
          className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[11px] text-ink-soft"
        >
          <Icon paths={ICON_PATHS.timer} className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
          <span className="min-w-0">
            {GRID_DAYS} jours complets, du {jjmm(jours[0])} au {dateDernier}, fuseau de l&apos;app ({nomFuseau(fuseau)})
          </span>
          <span className="sr-only"> ; la plage choisie en haut ne s&apos;applique pas ; la journée en cours est exclue.</span>
        </p>
      </PageHeader>

      {/* 2 — Quatre cases de même gabarit : le dernier jour complet contre le même jour de
          la semaine précédente, et la synthèse de la tendance. La référence incomplète est
          dite UNE fois, au-dessus des cases. */}
      <BandeauComparaison couvertures={semainePrecedente >= 0 && !toutVide ? [couvLcp, couvRatio, couvVues] : []} />
      <div
        role="group"
        aria-label="Dernier jour complet"
        className={`mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4 ${MASQUE_SILENCE_REPETE}`}
      >
        {kpi(
          !lcpLu.ok ? (
            <EchecLecture titre="LCP p75, dernier jour complet" compact />
          ) : (
            <KpiTile
              label={`LCP p75, dernier jour complet (${dateDernier})`}
              libelleCase={`LCP p75 · ${dateDernier}`}
              valeur={lcp[dernier] ?? null}
              format="ms"
              vital="LCP"
              raisonNull="aucune mesure LCP ce jour-là"
              serie={lcp}
              grapheDebuts={debutsJours}
              titreAxeY="LCP p75 du jour"
              couverture={{ n: mesures[dernier] ?? 0, unite: "mesures LCP" }}
              precedent={semainePrecedente >= 0 ? (lcp[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvLcp ?? undefined}
              source={SOURCE_LCP}
              categorie="Navigateur · Core Web Vitals"
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
              libelleCase={`Erreurs / 100 vues · ${dateDernier}`}
              valeur={ratios[dernier] ?? null}
              format="pour100"
              sensMeilleur="bas"
              raisonNull="aucune page vue ce jour-là"
              methode="Inclut les erreurs sans page vue (backend) : le ratio peut dépasser 100."
              serie={ratios}
              grapheDebuts={debutsJours}
              titreAxeY="erreurs pour 100 pages vues"
              couverture={{ n: vues[dernier] ?? 0, unite: "pages vues", faibleSous: MESURES_MIN_JOUR }}
              precedent={semainePrecedente >= 0 ? (ratios[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvRatio ?? undefined}
              source={SOURCE_ERREURS_JOUR}
              categorie="Navigateur · erreurs"
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
              libelleCase={`Pages vues · ${dateDernier}`}
              // Aucune page vue sur 14 jours : « — » et sa raison, comme les deux autres
              // tuiles, jamais un « 0 » qui se lirait comme une journée mesurée.
              valeur={aucuneVue ? null : (vues[dernier] ?? 0)}
              raisonNull={`aucune page vue sur les ${GRID_DAYS} derniers jours complets`}
              format="count"
              sensMeilleur="neutre"
              serie={aucuneVue ? undefined : vues}
              grapheDebuts={debutsJours}
              titreAxeY="pages vues par jour"
              // Un même jour de référence presque vide (une poignée de vues) donnait
              // « +35 200 % » : sous 30 pages vues d'un côté ou de l'autre, l'écart se tait
              // et dit pourquoi (recette du 30/09/2026).
              couverture={{ n: aucuneVue ? null : (vues[dernier] ?? 0), unite: "pages vues", faibleSous: MESURES_MIN_JOUR }}
              precedent={semainePrecedente >= 0 ? (vues[semainePrecedente] ?? null) : undefined}
              reference={referenceJ7}
              couverturePrecedente={couvVues ?? undefined}
              source={SOURCE_TRAFIC_JOUR}
              categorie="Navigateur · trafic"
            />
          ),
        )}
        {/* Synthèse (TE1) : une case — la valeur courte ; les phrases, la date des
            premières tendances et « Créer une alerte » dans sa fenêtre. */}
        <div className="min-w-0" data-testid="synthese" role="note" aria-label="Synthèse">
          <FicheMesure
            titre="Synthèse de la tendance du LCP p75"
            ariaLabel={`Synthèse de la tendance du LCP p75 : ${
              !lcpLu.ok ? "LCP non lu (lecture en échec) : aucune synthèse n'est calculée." : synthese.lines.join(" ")
            }`}
            testId="synthese-case"
            case={
              <>
                <span className="flex min-w-0 items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-[11px] font-medium text-ink-soft">Tendance · LCP p75</span>
                  {pointSynthese && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${pointSynthese}`} />}
                </span>
                <span className="whitespace-nowrap text-[22px] font-semibold leading-8 tracking-tight text-ink" data-testid="synthese-valeur">
                  {valeurSynthese}
                </span>
                <span className="truncate text-[10px] text-ink-faint">
                  {etaEcrite != null && etaEcrite > 0 && etaEcrite <= HORIZON_JOURS
                    ? `franchit ${LCP_BON_TEXTE} · horizon ${HORIZON_JOURS} j`
                    : `seuil ${LCP_BON_TEXTE} · horizon ${HORIZON_JOURS} j`}
                </span>
              </>
            }
          >
            {!lcpLu.ok ? (
              <p className="mt-3 text-sm text-ink">LCP non lu (lecture en échec) : aucune synthèse n&apos;est calculée.</p>
            ) : (
              <ul className="mt-3 space-y-1 text-sm text-ink">
                {synthese.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {lcpLu.ok && tLcp.etat === "insuffisante" && phrasePremiereTendance && (
              <p className="mt-2 text-sm text-ink-soft" data-testid="premiere-tendance">
                {phrasePremiereTendance}
              </p>
            )}
            <dl className="mt-4 grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 border-t border-line pt-3 text-xs leading-snug">
              <dt className="text-ink-faint">Tendance</dt>
              <dd className="min-w-0 text-ink-soft">{texteTendance(tLcp, "ms")}</dd>
              <dt className="text-ink-faint">Seuil</dt>
              <dd className="min-w-0 text-ink-soft">borne « Bon » du LCP, {LCP_BON_TEXTE} (web.dev)</dd>
              <dt className="text-ink-faint">Horizon</dt>
              <dd className="min-w-0 text-ink-soft">{HORIZON_JOURS} jours, si la pente dépasse le bruit</dd>
              <dt className="text-ink-faint">Source</dt>
              <dd className="min-w-0 text-ink-soft">{SOURCE_LCP}</dd>
            </dl>
            {/* Proposée seulement quand une tendance est calculée : sans elle, la synthèse
                dit qu'elle ne sait rien, et l'alerte arrivait comme une conclusion. */}
            {peutEcrire && lcpLu.ok && tLcp.etat !== "insuffisante" && (
              <Link href={lienAlerte} className="mt-4 inline-flex text-sm font-medium text-perf underline-offset-2 hover:underline">
                Créer une alerte LCP &gt; {LCP_BON_TEXTE}
              </Link>
            )}
          </FicheMesure>
        </div>
      </div>

      {toutVide && (
        <div className="mb-4" data-testid="tendances-vides">
          <EtatSurface
            etat={{
              kind: "vide",
              population: "mesure",
              plage: `les ${GRID_DAYS} derniers jours complets`,
              borne: phrasePremiereTendance ?? undefined,
            }}
          />
        </div>
      )}

      {/* 3 — Hero (TE5) : 14 jours observés, droite ajustée, projection si la pente dépasse le bruit. */}
      {!toutVide && (
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
                  {GRID_DAYS} jours complets ({nomFuseau(fuseau)})
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
                <span>source : web-vitals (navigateur), seuils web.dev</span>
              </>
            )
          }
          lecture={
            etatHero ? undefined : (
            <>
              Points creux : moins de {MESURES_MIN_JOUR} mesures.
              {tLcp.fit ? " Droite grise : la droite ajustée (voir « Méthode »)." : ""}
              {tLcp.etat === "significative"
                ? ` Pointillé : projection sur ${HORIZON_JOURS} jours dans une bande de ± 1 écart type des résidus.`
                : tLcp.etat === "bruit"
                  ? " La pente ne dépasse pas le bruit : aucune projection, aucune échéance."
                  : ""}{" "}
              {datation.ok && datation.rupture
                ? "Le trait vertical « Rupture » marque le premier jour du nouveau niveau ; il ouvre la Vue d'ensemble sur ce jour."
                : ""}{" "}
              Un point ouvre la Vue d&apos;ensemble sur ce jour.
            </>
            )
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
          <div className="flex flex-col gap-2">
            {/* Les raisons d'une tendance absente sont dans la méta, au-dessus du dessin :
                ces phrases entières restent lues par un lecteur d'écran. */}
            {tLcp.etat === "insuffisante" && (
              <p className="sr-only" data-testid="tendance-insuffisante">
                Tendance non calculée : {JOURS_VALIDES_REQUIS} jours mesurés requis, {tLcp.joursValides} disponibles.
                {phrasePremiereTendance ? ` ${phrasePremiereTendance}` : ""}
              </p>
            )}
            {tLcp.etat === "bruit" && (
              <p className="sr-only" data-testid="tendance-bruit">
                Tendance non distinguable du bruit : la pente sur {GRID_DAYS} jours ne dépasse pas {K_BRUIT} écarts types
                des résidus.
              </p>
            )}
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
              fenetresCollecte={fenetres}
              liensSeaux={liensVue}
              ariaLabel={`LCP p75 quotidien sur ${GRID_DAYS} jours complets, droite ajustée${tLcp.etat === "significative" ? ` et projection à ${HORIZON_JOURS} jours` : ""}, 3 zones de seuil`}
            />
            {/* P*.7 — « depuis quand ? » : la datation, ou son refus chiffré, en une ligne
                sous le dessin. La réserve d'interprétation est écrite ICI, jamais par le
                module (RM5) ; la règle reste à côté du résultat (RM4), repliée. */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] text-ink-soft" data-testid="datation-rupture">
              {ligneDatation ? (
                <>
                  <span className="font-medium text-ink" aria-hidden>
                    {ligneDatation}
                  </span>
                  <span className="sr-only">
                    {phraseDatation}
                    {ruptureDeploiement && ` ${RESERVE_COINCIDENCE}`}
                    {datation.ok && datation.rupture && tLcp.etat === "significative" && ` ${RESERVE_TENDANCE_ETABLIE}`}
                  </span>
                  {ruptureDeploiement && (
                    <span aria-hidden className="rounded-full bg-panel2 px-2 py-0.5">
                      déploiement {ruptureDeploiement.version ?? "sans version"} le {jjmm(ruptureDeploiement.jour)} : coïncidence de date
                    </span>
                  )}
                </>
              ) : (
                <span>{phraseDatation}</span>
              )}
              <MethodeRepliee titre="Règle de la datation">{REGLE_RUPTURE}.</MethodeRepliee>
            </div>
          </div>
        </Figure>
      </SectionErreur>
      )}

      {/* 4 — Deux petits multiples, sans seuil ni échéance, de même gabarit. */}
      {!toutVide && (
      <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-2">
        <SectionErreur titre="Occurrences d'erreurs pour 100 pages vues">
          <Figure
            titre="Occurrences d'erreurs pour 100 pages vues"
            id="tendance-erreurs"
            etat={etatRatio}
            meta={
              etatRatio ? undefined : (
                <>
                  <span>par jour, {nomFuseau(fuseau)}</span>
                  <span>{texteTendance(tRatio, "pour100")}</span>
                  <span>source : SDK MIP RUM</span>
                </>
              )
            }
            lecture={
              etatRatio
                ? undefined
                : "Aucun seuil n'est publié pour ce ratio : ni verdict, ni échéance. Droite tracée seulement si la pente dépasse le bruit. Points creux : moins de 30 pages vues. Un point ouvre les erreurs de ce jour."
            }
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
              fenetresCollecte={fenetres}
              liensSeaux={liensErreurs}
              hauteur={160}
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
                  <span>par jour, {nomFuseau(fuseau)}</span>
                  <span>repère J−7 sur les 7 derniers jours</span>
                  <span>source : SDK MIP RUM</span>
                </>
              )
            }
            lecture={
              etatVues
                ? undefined
                : "Pas de droite (voir « Méthode »). Chaque jour se compare au même jour de la semaine précédente. Une barre ouvre la Vue d'ensemble sur ce jour."
            }
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
              fenetresCollecte={fenetres}
              liensSeaux={liensVue}
              hauteur={160}
              ariaLabel={`Pages vues par jour sur ${GRID_DAYS} jours complets, repère du même jour de la semaine précédente`}
            />
          </Figure>
        </SectionErreur>
      </div>
      )}

      {/* 5 — Méthode (TE8), repliée sur une ligne. */}
      <Methode />
    </div>
  );
}
