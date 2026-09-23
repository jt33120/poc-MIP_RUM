// Robot et réel — /correlation (F58, plan § 5.7).
//
// LA QUESTION. « Le robot voit-il ce que vivent les visiteurs, et sur quelles
// routes, à quelles heures, ne le voit-il pas ? » L'écran y répond par des ÉTATS,
// jamais par un écart chiffré entre deux mesures qui ne mesurent pas la même chose
// (premier chargement d'un scénario robot contre LCP p75 des visiteurs, § 1.5 DF1) :
//   - le hero pose le LCP p75 réel sur ses bandes, et l'état du robot dans une frise
//     alignée au pixel en dessous — aucune courbe robot sur l'axe du LCP ;
//   - la matrice de concordance compte les heures × route où les deux s'accordent,
//     et celles où l'un voit ce que l'autre ne voit pas (angle mort, alerte non
//     ressentie) ;
//   - les tables listent ce qu'on ouvre ligne par ligne.
//
// P*.8 AJOUTE LA SEULE COMPARAISON QUI RESTE HONNÊTE : une corrélation de RANG
// (Spearman) entre les deux séries QUOTIDIENNES, avec son intervalle et son refus
// chiffré sous 10 jours communs. Elle répond à « le robot suit-il le réel dans le
// temps ? » sans jamais soustraire une latence de sonde à un LCP de visiteur.
//
// SI LE ROBOT S'EST ARRÊTÉ, « robot ok » ne veut plus rien dire : le bandeau de
// fraîcheur passe avant tout chiffre, et sans aucun passage les zones robot sont
// remplacées par « Non collecté ».
//
// CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8) : `lire()` ne lève pas, une lecture
// en échec ne fait tomber que sa section. PAS de `<Suspense>` ni de `loading.tsx`
// au-dessus de l'écran : ils bloquaient les navigations qui ne changent que la query.
import { Figure } from "@/components/charts/Figure";
import { FriseEtats } from "@/components/charts/FriseEtats";
import { KpiTile } from "@/components/charts/KpiTile";
import { MatriceConcordance } from "@/components/charts/MatriceConcordance";
import { RankBar } from "@/components/charts/RankBar";
import { ScatterPlot } from "@/components/charts/ScatterPlot";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { SelecteurSerie } from "@/components/correlation/SelecteurSerie";
import { TableAnglesMorts, type LigneAngleMort } from "@/components/correlation/TableAnglesMorts";
import { TableRoutes, type LigneRoute } from "@/components/correlation/TableRoutes";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { PageHeader } from "@/components/PageHeader";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import Link from "next/link";
import { annotationsDeploiements } from "@/lib/annotations";
import { annotationsAlertes, fusionnerAnnotations, raisonsAnnotations } from "@/lib/annotations";
import { getUser } from "@/lib/auth";
import { couverturePrecedente } from "@/lib/comparaison";
import {
  aucunPassageSurLaGrille,
  casesFriseRobot,
  dernierPassage,
  ETATS_FRISE_ROBOT,
  grilleHoraire,
  heuresAngleMort,
  LIBELLE_ETAT_ROBOT,
  lignesRetard,
  partCouverte,
  pucesAnglesMorts,
  regleAlerteAngleMort,
  regleAngleMort,
  trierRoutes,
  trierSansRobot,
} from "@/lib/correlation";
// P*.8 — concordance robot ↔ réel, mesurée sur les jours communs.
import { concordanceAbsente, concordanceParCouple, type ResultatConcordance } from "@/lib/correlation";
import { LIBELLE_ISSUE, MENTION_RHO, phraseConcordance, regleConcordance, texteConcordanceCourt } from "@/lib/stats/concordance";
import { ecrireSerie, libelleSerie, lireSerie, serieParDefaut } from "@/lib/correlation-serie";
import { explorerHref } from "@/lib/explorer-page-params";
import type { SearchParams } from "@/lib/filters";
import { formater } from "@/lib/fmt-ids";
import { fmtLatency } from "@/lib/format";
import { lire, type Lecture } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import { RATING_HEX } from "@/lib/palette";
import { hrefWithQuery, paramReader, previousRange, queryToSearchParams, rangeLabel } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { sessionsDeLaRoute } from "@/lib/breakdowns";
import { listDeploys } from "@/lib/queries-deploys";
import {
  alertEvents,
  blindSpots,
  correlationCards,
  correlationConcordance,
  correlationQuotidienne,
  correlationRoutes,
  correlationSeries,
  EFFECTIF_MIN_HEURE,
  syntheticFreshness,
  type CorrSeriesRow,
} from "@/lib/queries-v2";
import { RATING_LABEL, THRESHOLDS } from "@/lib/rating";
import { alignerSeaux, libelleSeauComplet, type PointSerie, type SerieDef } from "@/lib/series";
import { ecrirePanel, gabaritZoom, lireComparaison, VIEW_CONTEXT_PARAMS } from "@/lib/view-state";

export const dynamic = "force-dynamic";

const TITRE = "Corrélation synthétique ↔ RUM";
const H = 3_600_000;
/** Couples listés au plus dans « Routes à trafic réel sans scénario robot » (P14). */
const TOP_SANS_ROBOT = 10;

/** Lecture non lancée : une valeur sûre, jamais affichée comme mesure. */
const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

export default async function Correlation({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const ecran = await pageFilters(sp, "/correlation");
  if (!ecran.ok) return <FilterProblemNotice title={TITRE} problem={ecran.problem} />;
  const f = ecran.filters;
  const query = ecran.query;
  const lecteur = paramReader(sp);
  const toMs = Date.parse(query.range.to);
  // Colonnes présentes : ce que `/sessions` sait appliquer (lien « Sessions de cette heure »).
  const schema = await dimensionSchema();

  // Comparaison (§ 3.2) : `none` par défaut sur cet écran. En `prev`, seules la tuile
  // « Heures en angle mort » et la série réelle ont une référence. `release` n'a pas
  // de sens ici (le robot ne porte pas de release) : c'est dit, pas ignoré (V10).
  const comparaison = lireComparaison("/correlation", lecteur).valeur;
  const prev = comparaison.mode === "prev";
  const rangePrec = previousRange(query.range);
  const fPrec = { ...f, query: { ...query, range: rangePrec } };
  const reference = `vs période précédente (${rangeLabel({ ...rangePrec, preset: null }, "UTC")} UTC)`;

  // Liens qui restent sur l'écran : contrat canonique + réglages de vue de l'URL
  // (comparaison, releases), jamais le panneau ni le curseur.
  const lienEcran = (extra: Record<string, string | null>) => gabaritZoom(hrefWithQuery("/correlation", query, extra), sp);
  const lienHeure = (serie: string, debut: string) =>
    lienEcran({ serie, period: null, from: debut, to: new Date(Date.parse(debut) + H).toISOString() });
  const lienPages = (app: string, route: string, extra: Record<string, string | null> = {}) =>
    hrefWithQuery("/pages", query, { app, route, panel: ecrirePanel({ type: "route", id: route }), ...extra });

  const [utilisateur, cartes, couples, concordance, concordancePrec, couverturePrec, spots, fraicheurs, deploys, alertes, quotidien] =
    await Promise.all([
      getUser(),
      lire(() => correlationCards(f)),
      lire(() => correlationRoutes(f)),
      lire(() => correlationConcordance(f)),
      prev ? lire(() => correlationConcordance(fPrec)) : sansLecture(null),
      prev
        ? couverturePrecedente(query, { table: "rum_metric", colonneTemps: "ts", additive: false })
        : Promise.resolve(undefined),
      lire(() => blindSpots(f)),
      lire(() => syntheticFreshness(f)),
      lire(() => listDeploys(f, 20)),
      // Annotations d'alerte (F67) : les 100 derniers déclenchements du périmètre ;
      // la fenêtre et le couple app × route sont appliqués par `annotationsAlertes`.
      lire(() => alertEvents(f)),
      // P*.8 : une seule lecture quotidienne pour TOUS les couples (≤ 30 jours par
      // couple, plage bornée par le contrat) ; le ρ de chaque route s'en déduit.
      lire(() => correlationQuotidienne(null, null, f)),
    ]);

  // ── Concordance robot ↔ réel (P*.8) ───────────────────────────────────────────
  // Corrélation de RANG entre le premier chargement du robot et le LCP p75 réel,
  // jour par jour : elle dit si les deux montent et descendent ensemble, jamais si
  // leurs valeurs sont égales. Sous 10 jours communs, refus chiffré ; lecture en
  // échec, la raison — jamais une case vide ni un « 0 ».
  const concordances = quotidien.ok ? concordanceParCouple(quotidien.data) : null;
  const rhoDuCouple = (cle: string | null): ResultatConcordance | null =>
    concordances === null ? null : cle === null ? concordanceAbsente() : (concordances.get(cle) ?? concordanceAbsente());
  const celluleRho = (cle: string) => {
    const res = rhoDuCouple(cle);
    if (res === null) return { texte: "Concordance non lue : lecture quotidienne en échec", issue: null, jours: null };
    return res.ok
      ? { texte: texteConcordanceCourt(res), issue: LIBELLE_ISSUE[res.issue], jours: res.n }
      : { texte: texteConcordanceCourt(res), issue: null, jours: null };
  };

  // ── Robot présent ? ───────────────────────────────────────────────────────────
  // Sans AUCUN passage sur le périmètre, les zones robot deviennent « Non collecté »
  // (CR1). Une lecture de fraîcheur en échec ne conclut rien : les zones restent.
  const plusRecent = fraicheurs.ok ? dernierPassage(fraicheurs.data) : null;
  const robotAbsent = fraicheurs.ok && plusRecent === null;
  const retards = fraicheurs.ok ? lignesRetard(fraicheurs.data, toMs) : [];
  const appsSansPassage = fraicheurs.ok && !robotAbsent ? fraicheurs.data.filter((r) => r.dernier === null).map((r) => r.app_id) : [];
  const admin = utilisateur?.role === "admin";

  // ── Couple du hero (CR7-a) ────────────────────────────────────────────────────
  const options = couples.ok ? couples.data : [];
  const anglesMortsParRoute = concordance.ok ? concordance.data.anglesMortsParRoute : [];
  const serieDemandee = lecteur.get("serie");
  const choisi =
    lireSerie(serieDemandee, options) ??
    serieParDefaut(options, { route: query.filters.route ?? null, anglesMorts: anglesMortsParRoute });
  const serieChoisie = choisi ? ecrireSerie(choisi.app_id, choisi.route) : null;
  const libelleChoisi = choisi ? libelleSerie(choisi, options) : null;
  // La phrase du hero (P*.8) : « Sur 12 jours communs, le robot et le réel évoluent
  // ensemble (ρ de Spearman = 0,71, entre 0,21 et 0,92). ρ mesure si les deux montent
  // et descendent ensemble, pas si leurs valeurs sont égales. »
  const rhoHero = rhoDuCouple(serieChoisie);
  const phraseConcordanceHero =
    rhoHero === null ? "Concordance non lue : lecture quotidienne en échec." : phraseConcordance(rhoHero);

  const { starts, grille, tronque } = grilleHoraire(query.range);
  const grillePrec = prev ? grilleHoraire(rangePrec) : null;
  const [serie, seriePrec] = await Promise.all([
    choisi && !robotAbsent ? lire(() => correlationSeries(choisi.app_id, choisi.route, f)) : sansLecture<CorrSeriesRow[]>([]),
    choisi && !robotAbsent && prev ? lire(() => correlationSeries(choisi.app_id, choisi.route, fPrec)) : sansLecture<CorrSeriesRow[]>([]),
  ]);

  // Alignement OBLIGATOIRE avant tout tracé (§ 3.10) : une heure sans mesure est
  // absente de la lecture ; `null` à son indice = trou dans la série ET case
  // « aucun passage » dans la frise.
  const lignes = serie.ok ? alignerSeaux(serie.data, starts, false) : [];
  // Période précédente : alignée sur SA grille, posée par RANG de seau (§ 3.2).
  const lignesPrec = seriePrec.ok && grillePrec ? alignerSeaux(seriePrec.data, grillePrec.starts, false) : [];
  const points: PointSerie[] = grille.map((t, i) => {
    const l = lignes[i] ?? null;
    const p: PointSerie = {
      t,
      reel: l?.rum_lcp_p75 != null ? Number(l.rum_lcp_p75) : null,
      n: l?.rum_lcp_n != null ? Number(l.rum_lcp_n) : null,
    };
    if (prev) {
      const lp = lignesPrec[i] ?? null;
      p.prec = lp?.rum_lcp_p75 != null ? Number(lp.rum_lcp_p75) : null;
    }
    return p;
  });
  const series: SerieDef[] = [
    { cle: "reel", libelle: "Réel · LCP p75", role: "principale", effectifCle: "n" },
    ...(prev ? [{ cle: "prec", libelle: "Réel, période précédente", role: "reference" as const }] : []),
  ];
  const cases = casesFriseRobot(lignes, grille);
  const zoomHref = serieChoisie
    ? lienEcran({ serie: serieChoisie, period: null, from: "{from}", to: "{to}" })
    : undefined;
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], query.range, {
    lien: (relB, relA) => lienEcran({ cmp: "release", rel_b: relB, rel_a: relA }),
  });
  // Déclenchements d'alerte du couple app × route du hero (F67, § 3.7) : chaque
  // trait mène à SON événement sur `/alerts` (`evt`, § 3.1), jamais à `fired=`.
  const lienAlertes = hrefWithQuery("/alerts", query);
  const alertesHero = annotationsAlertes(alertes.ok ? alertes.data : [], query.range, {
    lien: (id) => `${hrefWithQuery("/alerts", query, { evt: String(id) })}#evt-${id}`,
    lienListe: lienAlertes,
    app: choisi?.app_id ?? null,
    route: choisi?.route ?? null,
  });
  const familles = [
    { ...annotations, lienListe: undefined },
    { ...alertesHero, lienListe: lienAlertes },
  ];
  const annotationsHero = fusionnerAnnotations(familles);
  const raisonFamilles = raisonsAnnotations(familles);
  // Une lecture en échec n'est pas « aucune annotation » : la figure la nomme.
  const annotationsAbsentes =
    [
      ...(deploys.ok ? [] : ["lecture des déploiements en échec"]),
      ...(alertes.ok ? [] : ["lecture des alertes en échec"]),
      ...(raisonFamilles ? [raisonFamilles] : []),
    ].join(" ; ") || undefined;

  // ── KPI ───────────────────────────────────────────────────────────────────────
  const heuresAM = concordance.ok ? heuresAngleMort(concordance.data.cellules) : null;
  const heuresAMPrec = prev ? (concordancePrec.ok && concordancePrec.data ? heuresAngleMort(concordancePrec.data.cellules) : null) : undefined;
  const routesRobot = cartes.ok ? cartes.data.filter((c) => c.syn_latency_avg != null).length : null;
  const part = cartes.ok ? partCouverte(cartes.data) : null;
  const ageDernier = plusRecent ? Math.max(0, toMs - plusRecent.getTime()) : null;
  const sousAppAll = query.scope.requestedApp === null;

  // ── Tables ────────────────────────────────────────────────────────────────────
  const plusieursApps = (lignesApp: readonly { app_id: string }[]) => new Set(lignesApp.map((l) => l.app_id)).size > 1;
  const lignesAngles: LigneAngleMort[] = spots.ok
    ? spots.data.map((s, i) => {
        const heure = new Date(s.bucket).toISOString();
        const route = s.route ?? "";
        const serieLigne = ecrireSerie(s.app_id, route);
        const fin = new Date(Date.parse(heure) + H).toISOString();
        return {
          cle: `${s.app_id}|${route}|${heure}|${i}`,
          app_id: s.app_id,
          route: s.route,
          heure,
          etatRobot: s.syn_state,
          latenceRobot: s.syn_latency_avg != null ? Number(s.syn_latency_avg) : null,
          scenarios: s.syn_measures,
          lcpReel: Number(s.rum_lcp_p75),
          mesures: Number(s.rum_lcp_n),
          ecartMs: Number(s.gap_ms),
          liens: {
            heure: lienHeure(serieLigne, heure),
            // La recherche exacte par route de `/sessions` sur cette heure : `route=`, que
            // l'écran des sessions refuse (une session ne porte pas de route), menait à
            // son écran de refus.
            sessions: sessionsDeLaRoute(query, route, schema, { app: s.app_id, period: null, from: heure, to: fin }),
            pages: lienPages(s.app_id, route, { period: null, from: heure, to: fin }),
          },
        };
      })
    : [];
  const estOption = (app: string, route: string | null) => route !== null && options.some((o) => o.app_id === app && o.route === route);
  const lignesRoutes: LigneRoute[] = cartes.ok
    ? trierRoutes(cartes.data).map((c) => ({
        cle: `${c.app_id}|${c.route ?? ""}`,
        app_id: c.app_id,
        route: c.route,
        latenceRobot: c.syn_latency_avg != null ? Number(c.syn_latency_avg) : null,
        etatRobot: c.syn_state,
        scoreRobot: c.syn_score_avg != null ? Number(c.syn_score_avg) : null,
        scenarios: c.syn_measures,
        // Même définition que la tuile « Routes suivies par le robot » (CR2) et que
        // `partCouverte` / `trierSansRobot` : un premier chargement robot mesuré.
        robot: c.syn_latency_avg != null,
        lcpReel: c.rum_lcp_p75 != null ? Number(c.rum_lcp_p75) : null,
        inpReel: c.rum_inp_p75 != null ? Number(c.rum_inp_p75) : null,
        mesuresLcp: c.rum_lcp_n != null ? Number(c.rum_lcp_n) : null,
        sessions: c.rum_sessions != null ? Number(c.rum_sessions) : null,
        reel: c.rum_lcp_n != null || c.rum_sessions != null,
        hrefHero: estOption(c.app_id, c.route) ? `${lienEcran({ serie: ecrireSerie(c.app_id, c.route!) })}#hero` : null,
        hrefPages: c.route !== null ? lienPages(c.app_id, c.route) : null,
        concordance:
          c.route !== null
            ? celluleRho(ecrireSerie(c.app_id, c.route))
            : { texte: "Concordance non calculée : route inconnue", issue: null, jours: null },
      }))
    : [];
  const sansRobot = cartes.ok ? trierSansRobot(cartes.data, EFFECTIF_MIN_HEURE) : [];
  const nuage = cartes.ok
    ? cartes.data.filter((c) => c.route !== null && c.syn_latency_avg != null && c.rum_lcp_p75 != null)
    : [];

  const plage = ecran.label;
  const elargir =
    Date.parse(query.range.to) - Date.parse(query.range.from) < 7 * 24 * H
      ? { libelle: "Élargir à 7 jours", href: lienEcran({ period: "7d", from: null, to: null, serie: null }) }
      : undefined;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={TITRE}
        domain="robot"
        help="robotVsReal"
        sub="Le robot voit-il ce que vivent les visiteurs, et sur quelles routes, à quelles heures, ne le voit-il pas ?"
      />

      {/* ── Zone 2 : fraîcheur du robot, AVANT tout chiffre (CR1). ── */}
      {!fraicheurs.ok ? (
        <div className="mb-4">
          <EchecLecture titre="Fraîcheur du robot" compact />
        </div>
      ) : (
        (retards.length > 0 || appsSansPassage.length > 0) && (
          <div className="mb-4 flex min-w-0 flex-col gap-2" data-testid="fraicheur-robot">
            {retards.map((texte) => (
              <EtatSurface key={texte} etat={{ kind: "partiel", raison: texte }} compact />
            ))}
            {appsSansPassage.map((app) => (
              <EtatSurface key={app} etat={{ kind: "partiel", raison: `${app} — aucun passage du robot sur la plage` }} compact />
            ))}
            {admin && (
              <Link href="/admin/health" className="text-xs font-medium text-brand hover:underline">
                Voir la santé interne
              </Link>
            )}
          </div>
        )
      )}

      {/* ── Zone 3 : KPI (CR2 à CR6). ── */}
      <SectionErreur titre="Chiffres clés robot et réel">
        <div className="mb-6 grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="kpi-correlation">
          <KpiTile
            label="Routes suivies par le robot"
            valeur={routesRobot}
            format="count"
            raisonNull="lecture en échec"
            lecture="sans référence : configuration du robot"
            href="#routes"
          />
          <KpiTile
            label="Routes vues des deux côtés"
            valeur={couples.ok ? couples.data.length : null}
            format="count"
            raisonNull="lecture en échec"
            lecture={sousAppAll ? "une route présente dans deux apps compte deux fois" : "au moins une heure avec robot et réel"}
            href="#hero"
          />
          <KpiTile
            label="Heures en angle mort"
            valeur={heuresAM}
            format="count"
            raisonNull="lecture de la concordance en échec"
            sensMeilleur="bas"
            precedent={heuresAMPrec}
            reference={prev ? reference : undefined}
            couverturePrecedente={couverturePrec}
            alerte={{ si: ">", valeur: 0, regle: regleAlerteAngleMort() }}
            href="#angles-morts"
          />
          <KpiTile
            label="Part du LCP réel sur des routes suivies par le robot"
            valeur={part}
            format="pct"
            raisonNull={cartes.ok ? "aucune mesure LCP réelle sur la plage" : "lecture en échec"}
            href="#sans-robot"
          />
          <KpiTile
            label="Dernier passage du robot"
            valeur={ageDernier}
            format="s-auto"
            raisonNull={fraicheurs.ok ? "Aucun passage du robot sur la plage" : "lecture en échec"}
            lecture={plusRecent ? `le ${plusRecent.toISOString().replace(/\.\d{3}Z$/, "Z")} (UTC), compté à la fin de la plage` : undefined}
          />
        </div>
      </SectionErreur>

      {robotAbsent ? (
        <div className="mb-6">
          <Figure
            titre="Robot face au réel"
            id="hero"
            etat={{
              kind: "non_collecte",
              manque: sousAppAll
                ? "aucun passage du robot sur les apps du périmètre, sur cette plage"
                : "aucun passage du robot sur cette app, sur cette plage",
            }}
          />
        </div>
      ) : (
        <>
          {/* ── Zone 4 : hero (2/3) + concordance (1/3). ── */}
          <div className="mb-6 grid min-w-0 gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <SectionErreur titre="Robot face au réel">
                <Figure
                  titre={`Robot face au réel${libelleChoisi ? ` — ${libelleChoisi}` : ""}`}
                  id="hero"
                  aide="robotVsReal"
                  meta={
                    <>
                      <span>seau d&apos;une heure, UTC</span>
                      <span>{plage}</span>
                    </>
                  }
                  lecture={
                    <span data-testid="concordance-hero">
                      {phraseConcordanceHero}{" "}
                      <span className="text-ink-soft">{regleConcordance()}</span>
                    </span>
                  }
                  etat={
                    !couples.ok
                      ? { kind: "erreur", titre: "Robot face au réel" }
                      : !choisi
                        ? { kind: "vide", population: "heure vue à la fois par le robot et par le réel", plage, geste: elargir }
                        : !serie.ok
                          ? { kind: "erreur", titre: "Robot face au réel" }
                          : undefined
                  }
                  alternative={{
                    legende: `Réel · LCP p75 par heure — ${libelleChoisi ?? ""}, un seau par ligne (UTC)`,
                    colonnes: ["Heure (UTC)", "Réel · LCP p75", "Mesures LCP"],
                    lignes: points.map((p) => [
                      libelleSeauComplet(p.t, 3600, "UTC"),
                      typeof p.reel === "number" ? fmtLatency(p.reel) : null,
                      typeof p.n === "number" ? p.n : null,
                    ]),
                  }}
                  explorer={
                    choisi
                      ? explorerHref(
                          query,
                          {
                            version: 1,
                            dataset: "vitals",
                            measure: { field: "value", aggregation: "p75" },
                            variant: "LCP",
                            groupBy: [],
                            visualization: "timeseries",
                            limit: 10,
                            cursor: null,
                          },
                          { app: choisi.app_id, route: choisi.route },
                        )
                      : undefined
                  }
                >
                  {choisi && serieChoisie && (
                    <SelecteurSerie
                      action="/correlation"
                      conserves={[
                        ...queryToSearchParams(query).entries(),
                        ...VIEW_CONTEXT_PARAMS.flatMap((nom) => lecteur.getAll(nom).map((v): [string, string] => [nom, v])),
                      ]}
                      options={options.map((o) => ({ valeur: ecrireSerie(o.app_id, o.route), libelle: libelleSerie(o, options) }))}
                      choisie={serieChoisie}
                      puces={pucesAnglesMorts(anglesMortsParRoute, options).map((a) => ({
                        href: lienEcran({ serie: a.serie }),
                        libelle: libelleSerie(a, options),
                        heures: a.heures,
                        active: a.serie === serieChoisie,
                      }))}
                    />
                  )}
                  {tronque && (
                    <div className="mb-2">
                      <EtatSurface
                        etat={{
                          kind: "partiel",
                          raison:
                            "Seaux horaires : les 300 dernières heures de la plage sont affichées (plafond de points du contrat). La matrice et les angles morts portent sur toute la plage.",
                        }}
                        compact
                      />
                    </div>
                  )}
                  {comparaison.mode === "release" && (
                    <p className="mb-2 text-xs text-ink-soft" role="note">
                      Comparaison de releases non appliquée ici : le robot ne porte pas de release. La série et la
                      matrice couvrent toute la plage.
                    </p>
                  )}
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                    Réel · LCP p75 par heure{libelleChoisi ? ` — ${libelleChoisi}` : ""}
                  </p>
                  <ThresholdSeries
                    grille={grille}
                    points={points}
                    series={series}
                    format="ms"
                    vital="LCP"
                    faibleSous={EFFECTIF_MIN_HEURE}
                    seauSecondes={3600}
                    fuseau="UTC"
                    annotations={annotationsHero}
                    annotationsIndisponibles={annotationsAbsentes}
                    zoomHref={zoomHref}
                    hauteur={180}
                    ariaLabel={`LCP p75 réel par heure, ${libelleChoisi ?? ""}, ${plage}, 3 zones de seuil`}
                  />
                  <p className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">
                    Robot · état par heure
                  </p>
                  {aucunPassageSurLaGrille(lignes) ? (
                    <p className="py-2 text-xs text-ink-soft" data-testid="frise-sans-passage">
                      Aucun passage du robot sur cette route et cette plage.
                    </p>
                  ) : (
                    <FriseEtats
                      grille={grille}
                      seauSecondes={3600}
                      cases={cases}
                      etats={ETATS_FRISE_ROBOT}
                      zoomHref={zoomHref}
                      ariaLabel={`Robot · état par heure, ${libelleChoisi ?? ""}, ${plage}`}
                    />
                  )}
                  <p className="mt-1 text-[11px] text-ink-soft">
                    État du robot (pire état de l&apos;heure), pas une note du LCP : aucune bande de seuil ne
                    s&apos;applique au robot.
                  </p>
                </Figure>
              </SectionErreur>
            </div>

            <div className="min-w-0">
              <SectionErreur titre="Concordance des états">
                <Figure
                  titre="Concordance des états, par heure et par route"
                  id="concordance"
                  meta={
                    <>
                      <span>heures × route d&apos;au moins {EFFECTIF_MIN_HEURE} mesures LCP</span>
                      <span>toute la plage : {plage}</span>
                    </>
                  }
                  etat={
                    !concordance.ok
                      ? { kind: "erreur", titre: "Concordance des états" }
                      : concordance.data.cellules.every((c) => c.heures === 0) &&
                          concordance.data.reelInsuffisant === 0 &&
                          concordance.data.robotInconnu === 0
                        ? { kind: "vide", population: "heure vue à la fois par le robot et par le réel", plage, geste: elargir }
                        : undefined
                  }
                  lecture={
                    <>
                      Sur la diagonale, robot et réel s&apos;accordent ; hors diagonale, l&apos;un voit ce que l&apos;autre
                      ne voit pas. Verdict réel : LCP p75 de l&apos;heure, bon ≤{" "}
                      {formater("ms", THRESHOLDS.LCP[0])}, mauvais au-delà de {formater("ms", THRESHOLDS.LCP[1])}.
                    </>
                  }
                >
                  {concordance.ok && (
                    <MatriceConcordance
                      lignes={["ok", "warn", "incident"].map((cle) => ({ cle, libelle: LIBELLE_ETAT_ROBOT[cle] }))}
                      colonnes={(["good", "needs-improvement", "poor"] as const).map((cle) => ({ cle, libelle: RATING_LABEL[cle] }))}
                      cellules={Object.fromEntries(
                        ["ok", "warn", "incident"].map((robot) => [
                          robot,
                          Object.fromEntries(
                            concordance.data.cellules.filter((c) => c.robot === robot).map((c) => [c.reel, c.heures]),
                          ),
                        ]),
                      )}
                      nommees={[
                        { ligne: "ok", colonne: "needs-improvement", nom: "angle mort", href: "#angles-morts", ton: "bad" },
                        { ligne: "ok", colonne: "poor", nom: "angle mort", href: "#angles-morts", ton: "bad" },
                        { ligne: "incident", colonne: "good", nom: "alerte robot non ressentie", ton: "warn" },
                      ]}
                      horsMatrice={[
                        { libelle: "heures robot seul", n: concordance.data.robotSeul },
                        { libelle: "heures réel seul", n: concordance.data.reelSeul },
                        {
                          libelle: `heures au réel insuffisant (moins de ${EFFECTIF_MIN_HEURE} mesures)`,
                          n: concordance.data.reelInsuffisant,
                        },
                        { libelle: "état robot inconnu", n: concordance.data.robotInconnu },
                      ]}
                      unite="heures × route"
                    />
                  )}
                </Figure>
              </SectionErreur>
            </div>
          </div>

          {/* ── Zone 5 : angles morts (CR9). ── */}
          <div className="mb-6">
            <SectionErreur titre="Angles morts">
              <Figure
                titre="Angles morts — heures où le robot dit ok alors que les visiteurs attendent"
                id="angles-morts"
                meta={
                  spots.ok && heuresAM !== null && heuresAM > lignesAngles.length ? (
                    <span>
                      {lignesAngles.length} premières sur {heuresAM.toLocaleString("fr-FR")}, écart décroissant
                    </span>
                  ) : (
                    <span>écart décroissant · {plage}</span>
                  )
                }
                etat={!spots.ok ? { kind: "erreur", titre: "Angles morts" } : undefined}
              >
                <p className="mb-3 text-xs leading-relaxed text-ink-soft" data-testid="regle-angle-mort">
                  {regleAngleMort(EFFECTIF_MIN_HEURE)}
                </p>
                {heuresAM !== null && heuresAM > lignesAngles.length && (
                  <div className="mb-3">
                    <EtatSurface
                      etat={{ kind: "partiel", raison: `${lignesAngles.length} affichées sur ${heuresAM.toLocaleString("fr-FR")}` }}
                      compact
                    />
                  </div>
                )}
                {lignesAngles.length > 0 ? (
                  <TableAnglesMorts lignes={lignesAngles} avecApp={plusieursApps(lignesAngles)} />
                ) : (
                  <p className="py-4 text-center text-sm text-ink-soft" data-testid="aucun-angle-mort">
                    Aucun angle mort sur la plage (règle : {regleAngleMort(EFFECTIF_MIN_HEURE)})
                  </p>
                )}
              </Figure>
            </SectionErreur>
          </div>
        </>
      )}

      {/* ── Zone 6 : nuage des routes (CR10) + routes sans robot (CR11). ── */}
      <div className="mb-6 grid min-w-0 gap-4 lg:grid-cols-2">
        {!robotAbsent && (
          <div className="min-w-0">
            <SectionErreur titre="Nuage des routes">
              <Figure
                titre="Nuage des routes : premier chargement robot × LCP p75 réel"
                id="nuage"
                meta={<span>un point par route vue des deux côtés · taille = mesures LCP · {plage}</span>}
                etat={
                  !cartes.ok
                    ? { kind: "erreur", titre: "Nuage des routes" }
                    : nuage.length === 0
                      ? { kind: "vide", population: "route vue à la fois par le robot et par le réel", plage, geste: elargir }
                      : nuage.length < 2
                        ? { kind: "partiel", raison: "au moins deux routes vues des deux côtés sont nécessaires pour les situer l'une par rapport à l'autre" }
                        : undefined
                }
                lecture="Deux axes séparés : le premier chargement du scénario robot en abscisse, le LCP p75 réel en ordonnée. Les bandes Bon / À améliorer / Mauvais ne portent que sur l'axe réel ; aucun écart n'est calculé entre les deux."
                alternative={{
                  legende: "Nuage des routes — une ligne par couple app et route",
                  colonnes: ["Route", "App", "Premier chargement robot (moyenne)", "LCP p75 réel", "Mesures LCP"],
                  lignes: nuage.map((c) => [
                    c.route,
                    c.app_id,
                    fmtLatency(Number(c.syn_latency_avg)),
                    fmtLatency(Number(c.rum_lcp_p75)),
                    c.rum_lcp_n,
                  ]),
                }}
              >
                <ScatterPlot
                  points={nuage.map((c) => ({
                    x: Number(c.syn_latency_avg),
                    y: Number(c.rum_lcp_p75),
                    z: c.rum_lcp_n ?? undefined,
                    label: libelleSerie({ app_id: c.app_id, route: c.route! }, nuage.map((n) => ({ app_id: n.app_id, route: n.route! }))),
                    href: lienPages(c.app_id, c.route!),
                  }))}
                  xLabel="Premier chargement robot (moyenne)"
                  yLabel="LCP p75 réel"
                  xUnit=" ms"
                  yUnit=" ms"
                  xFormat="int"
                  yFormat="int"
                  etiquettes={3}
                  bandesY={{ vital: "LCP" }}
                  height={260}
                  ariaLabel={`Nuage des routes : premier chargement robot et LCP p75 réel, ${nuage.length} routes, ${plage}`}
                />
              </Figure>
            </SectionErreur>
          </div>
        )}
        <div className={`min-w-0 ${robotAbsent ? "lg:col-span-2" : ""}`}>
          <SectionErreur titre="Routes à trafic réel sans scénario robot">
            <Figure
              titre="Routes à trafic réel sans scénario robot"
              id="sans-robot"
              meta={
                <>
                  <span>barre = mesures LCP réelles · tri : verdict Mauvais d&apos;abord, puis volume</span>
                  {sansRobot.length > TOP_SANS_ROBOT && (
                    <span>
                      {TOP_SANS_ROBOT} premières sur {sansRobot.length}
                    </span>
                  )}
                </>
              }
              etat={!cartes.ok ? { kind: "erreur", titre: "Routes à trafic réel sans scénario robot" } : undefined}
              lecture={`Où écrire le prochain scénario robot. Sous ${EFFECTIF_MIN_HEURE} mesures, « échantillon faible » : classé en fin, quel que soit son verdict.`}
            >
              <RankBar
                data={sansRobot.slice(0, TOP_SANS_ROBOT).map((c) => {
                  const lcp = c.rum_lcp_p75 != null ? Number(c.rum_lcp_p75) : null;
                  return {
                    label: c.route === null ? `${c.app_id} · (sans route)` : libelleSerie({ app_id: c.app_id, route: c.route }, sansRobot.map((s) => ({ app_id: s.app_id, route: s.route ?? "" }))),
                    value: c.rum_lcp_n,
                    display: `${formater("count", c.rum_lcp_n)} mesures`,
                    color: c.verdict ? RATING_HEX[c.verdict] : undefined,
                    sub: `LCP p75 ${fmtLatency(lcp)}${c.verdict ? ` · ${RATING_LABEL[c.verdict]}` : ""}${c.faible ? " · échantillon faible" : ""}`,
                    href: c.route !== null ? lienPages(c.app_id, c.route) : undefined,
                  };
                })}
                emptyLabel="Toutes les routes à trafic réel ont un scénario robot sur la plage."
                legende="Routes à trafic réel sans scénario robot"
              />
            </Figure>
          </SectionErreur>
        </div>
      </div>

      {/* ── Zone 7 : routes, robot et réel côte à côte (CR12). ── */}
      {!robotAbsent && (
        <SectionErreur titre="Routes : robot et réel côte à côte">
          <Figure
            titre="Routes : robot et réel côte à côte"
            id="routes"
            meta={<span>{plage}</span>}
            etat={
              !cartes.ok
                ? { kind: "erreur", titre: "Routes : robot et réel côte à côte" }
                : lignesRoutes.length === 0
                  ? { kind: "vide", population: "route mesurée par le robot ou le réel", plage, geste: elargir }
                  : undefined
            }
            lecture={`L'état robot est le PIRE état de la plage, le score une MOYENNE : un score de 92 peut côtoyer un état incident. Les deux mesures sont posées côte à côte, jamais divisées l'une par l'autre. ${regleConcordance()} ${MENTION_RHO}`}
          >
            <TableRoutes lignes={lignesRoutes} avecApp={plusieursApps(lignesRoutes)} />
          </Figure>
        </SectionErreur>
      )}
    </div>
  );
}
