import Link from "next/link";
import { HealthHeatmap, type HeatCell, dayKey, lastNDayKeys } from "@/components/charts/HealthHeatmap";
import { TrafficTimeseries } from "@/components/charts/TrafficTimeseries";
import { VitalsTimeseries } from "@/components/charts/VitalsTimeseries";
import { GlossaryTip } from "@/components/GlossaryTip";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { cookies } from "next/headers";
import { catalogueDe, lireChoix } from "@/lib/dashboard-blocs";
import { TousEteints } from "@/components/TousEteints";
import { VitalCard } from "@/components/VitalCard";
import { HealthBanner } from "@/components/health/HealthBanner";
import { AnomalyTable } from "@/components/health/AnomalyTable";
import { VersionsTable } from "@/components/VersionsTable";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { Breakdown } from "@/components/Breakdown";
import { VITALS_BREAKDOWN_COLUMNS, vitalsBreakdownItems } from "@/components/breakdown-view";
import { type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  BREAKDOWN_NOTICES,
  BREAKDOWN_PARAM,
  availableBreakdowns,
  breakdownTabs,
  datasetAvailability,
  parseBreakdown,
} from "@/lib/breakdowns";
import { healthScore } from "@/lib/health";
import { lire, type Lecture } from "@/lib/lecture";
import { paramReader } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import { overviewStats, vitalSeries, vitalsP75, type OverviewStats } from "@/lib/queries";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown } from "@/lib/queries-breakdowns";
import { dailyLcpSeries, dailyTraffic, GRID_DAYS, healthGrid } from "@/lib/queries-grid";
import { comparaisonVersions, type ComparaisonVersions } from "@/lib/queries-deploys";
import { fmtBorne } from "@/lib/format";
import { THRESHOLDS } from "@/lib/rating";
import {
  couverturePrecedente,
  deltasDeLaRangee,
  type CouverturePrecedente,
  type SourceComparaison,
} from "@/lib/comparaison";
import { lireComparaison } from "@/lib/view-state";

// Sources des deux rangées de tuiles comparées à la période précédente (§ 3.2).
// Un taux (erreurs / pages vues) n'est pas un compte : le retard d'ingestion
// touche son numérateur et son dénominateur, il n'est pas traité comme additif.
const SOURCE_VITAUX: SourceComparaison = { table: "rum_metric", colonneTemps: "ts", additive: false };
const SOURCES_HERO: SourceComparaison[] = [
  { table: "rum_session", colonneTemps: "last_seen_at", additive: true },
  { table: "rum_pageview", colonneTemps: "started_at", additive: true },
  { table: "rum_error", colonneTemps: "ts", additive: false },
];

export const dynamic = "force-dynamic";

/** Lecture non lancée (bloc éteint) : une valeur sûre, jamais affichée comme mesure. */
const sansLecture = <T,>(data: T): Promise<Lecture<T>> => Promise.resolve({ ok: true, data });

// PAS DE `<Suspense>` AUTOUR DE L'ÉCRAN, ni de `loading.tsx` (F02, correctif). Une
// frontière de chargement posée au-dessus de TOUTE la page bloquait les
// navigations qui ne changent que la query (période, comparaison, segment) : la
// transition de `router.replace` ne se validait plus, l'URL restait l'ancienne
// (e2e `etat-de-vue`, `navigation-filtres`). Les frontières restent PAR SECTION
// (`SectionErreur`), où elles ne gênent pas la navigation.
export default async function Overview({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/");
  if (!ecran.ok) return <FilterProblemNotice title="Vue d'ensemble" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = { label: ecran.label, bucketLabel: ecran.bucketLabel };

  // toggle « heures ouvrées » de la heatmap, porté par l'URL (?hours=business),
  // en préservant les autres filtres (app/période/device)
  const businessHours = sp.hours === "business";
  const baseParams = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") baseParams.set(k, v);
  const hrefWith = (val: string | null) => {
    const p = new URLSearchParams(baseParams);
    if (val) p.set("hours", val);
    else p.delete("hours");
    const qs = p.toString();
    return qs ? `/?${qs}` : "/";
  };

  // Le choix des blocs est lu ICI, AVANT les requêtes : un bloc éteint ne coûte
  // rien. Masquer en CSS aurait laissé tout le travail serveur en place, ce qui
  // vide la fonctionnalité de son intérêt sur un écran qui porte neuf requêtes.
  //
  // `overviewStats(f)` reste inconditionnel : le bandeau « pas encore de
  // données » en dépend, et il doit s'afficher même sur un tableau de bord
  // réduit au minimum — c'est justement là qu'on a besoin de savoir pourquoi
  // l'écran est vide.
  const cat = catalogueDe("/")!;
  const blocs = lireChoix(cat, (await cookies()).get(cat.cookie)?.value);

  // Découpage (P6.3) : l'onglet est jugé sur les mesures RÉELLEMENT groupées —
  // les Web Vitals — et non sur ce que l'écran sait filtrer. L'accueil compte
  // aussi des sessions, qui ne portent pas de route : c'est pourquoi le clic sur
  // un groupe de routes ouvre `/pages`, la surface qui sait appliquer ce filtre.
  const schema = await dimensionSchema();
  const dispoDecoupage = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const decoupage = blocs.decoupage
    ? parseBreakdown(paramReader(sp).get(BREAKDOWN_PARAM), availableBreakdowns(dispoDecoupage))
    : null;

  // Comparaison (F06) : la période précédente n'est lue qu'en `cmp=prev` (défaut de
  // cet écran), et ses écarts ne s'affichent que si elle est COMPLÈTE — une plage
  // de 30 jours, dont la précédente est purgée, n'en montre donc aucun.
  const comparaison = lireComparaison("/", paramReader(sp)).valeur;
  const prev = comparaison.mode === "prev";

  // CHAQUE LECTURE EST INDÉPENDANTE (F02, § 3.8 règle 1). `lire()` ne lève pas :
  // une lecture en échec devient `{ ok: false }`, et seule SA section le dit. Le
  // `Promise.all` d'avant rejetait au premier échec et emportait tout l'écran —
  // quand il ne recevait pas, des lectures « fail-soft », des vides et des zéros
  // qu'on lisait comme une période calme. `couverturePrecedente` ne lève pas : une
  // lecture en échec y devient déjà une couverture « inconnue », avec sa raison.
  const [
    vitals,
    vitalsPrev,
    stats,
    statsPrev,
    series,
    health,
    grid,
    traffic,
    dailyLcp,
    versions,
    decoupe,
    couvVitaux,
    couvHero,
  ] = await Promise.all([
    blocs.vitals || blocs.reseau ? lire(() => vitalsP75(f)) : sansLecture([]),
    blocs.vitals && prev ? lire(() => vitalsP75(f, true)) : sansLecture([]),
    lire(() => overviewStats(f)),
    blocs.hero && prev ? lire(() => overviewStats(f, true)) : sansLecture(null),
    blocs.hero ? lire(() => vitalSeries(f, "LCP")) : sansLecture([]),
    blocs.sante || blocs.anomalies ? lire(() => healthScore(f)) : sansLecture(null),
    blocs.historique ? lire(() => healthGrid(f)) : sansLecture([]),
    blocs.historique ? lire(() => dailyTraffic(f)) : sansLecture([]),
    blocs.historique ? lire(() => dailyLcpSeries(f)) : sansLecture([]),
    blocs.versions
      ? lire(() => comparaisonVersions(f))
      : sansLecture<ComparaisonVersions>({ rows: [], source: "occurrence" }),
    decoupage ? lire(() => vitalsBreakdown(f, decoupage)) : sansLecture(null),
    blocs.vitals && prev
      ? couverturePrecedente(ecran.query, SOURCE_VITAUX).then((c) => [c])
      : Promise.resolve<CouverturePrecedente[]>([]),
    blocs.hero && prev
      ? Promise.all(SOURCES_HERO.map((s) => couverturePrecedente(ecran.query, s)))
      : Promise.resolve<CouverturePrecedente[]>([]),
  ]);
  const deltasVitaux = deltasDeLaRangee(comparaison.mode, couvVitaux);
  const deltasHero = deltasDeLaRangee(comparaison.mode, couvHero);
  // Une ligne par raison distincte : la rétention, qui touche toutes les sources, n'est dite qu'une fois.
  const notesComparaison = [
    ...new Set(
      [blocs.vitals ? deltasVitaux.note : null, blocs.hero ? deltasHero.note : null].filter((n): n is string => n !== null),
    ),
  ];

  const byName = Object.fromEntries((vitals.ok ? vitals.data : []).map((v) => [v.name, v]));
  const prevByName = Object.fromEntries((vitalsPrev.ok ? vitalsPrev.data : []).map((v) => [v.name, v]));
  // La référence s'écrit à côté de l'écart (DeltaBadge, F03, P4) ; son libellé daté
  // (plage précédente résolue) arrive avec la rangée de KpiTile de F11.
  const pctOf = (cur: number, ref: number | null | undefined) =>
    deltasHero.deltas && ref != null && ref !== 0
      ? { pct: ((cur - ref) / ref) * 100, reference: "période précédente" }
      : null;

  return (
    <div className="animate-fade-up">
      <PageHeader title="Vue d'ensemble" help="rum" />

      {f.app && stats.ok && stats.data.sessions === 0 && (
        <div
          data-testid="onboarding-nudge"
          className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3 text-sm"
        >
          <span className="text-ink">
            <strong>Cette application n&apos;a pas encore reçu de données.</strong> Posez le capteur RUM
            sur votre site, puis simulez un parcours — les mesures apparaîtront ici.
          </span>
          <Link href={`/select/new?app=${encodeURIComponent(f.app)}`} className="btn-accent ml-auto shrink-0 px-3 py-1.5">
            Guide d&apos;intégration →
          </Link>
        </div>
      )}

      {blocs.sante && (
        <SectionErreur titre="Score de santé">
          {!health.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Score de santé" />
            </div>
          ) : (
            health.data && <HealthBanner health={health.data} periodLabel={period.label} />
          )}
        </SectionErreur>
      )}

      {/* Pourquoi les tuiles n'ont pas d'écart : dit en clair, jamais un delta
          calculé sur une période à moitié mesurée (§ 3.2). */}
      {(blocs.vitals || blocs.hero) && (notesComparaison.length > 0 || comparaison.mode === "release") && (
        <div role="note" data-testid="note-comparaison" className="mb-4 space-y-1 text-xs text-ink-soft">
          {notesComparaison.map((note) => (
            <p key={note}>Aucun écart affiché — {note}.</p>
          ))}
          {comparaison.mode === "release" && (
            <p>
              Comparaison de releases : ces tuiles n&apos;ont pas d&apos;écart par release
              {blocs.versions
                ? " ; le tableau des versions compare les releases sur la même fenêtre, sans normalisation de trafic."
                : "."}
            </p>
          )}
        </div>
      )}

      {blocs.vitals && (
        <SectionErreur titre="Web Vitals">
          {!vitals.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Web Vitals" />
            </div>
          ) : (
            <>
              {/* Période précédente illisible : les cartes s'affichent SANS variation,
                  et le disent — une absence de flèche ne doit pas se lire « stable ». */}
              {!vitalsPrev.ok && (
                <div className="mb-3">
                  <EtatSurface
                    compact
                    etat={{ kind: "partiel", raison: "la période précédente n'a pas pu être lue : aucune variation n'est affichée." }}
                  />
                </div>
              )}
              <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-5">
                {["LCP", "INP", "CLS", "FCP", "TTFB"].map((name) => (
                  <VitalCard
                    key={name}
                    name={name}
                    p75={byName[name]?.p75 ?? null}
                    median={byName[name]?.p50 ?? null}
                    n={byName[name]?.n ?? 0}
                    intervalle={byName[name]?.intervalle}
                    prev={deltasVitaux.deltas ? (prevByName[name]?.p75 ?? null) : null}
                    periodLabel={period.label}
                  />
                ))}
              </div>
            </>
          )}
        </SectionErreur>
      )}

      {blocs.reseau && (
        <SectionErreur titre="Décomposition réseau du TTFB">
          {vitals.ok ? (
            <PhasesReseau vitals={byName} periodLabel={period.label} />
          ) : (
            <div className="mb-6">
              <EchecLecture titre="Décomposition réseau du TTFB" />
            </div>
          )}
        </SectionErreur>
      )}

      {blocs.hero && (
        <SectionErreur titre="LCP p75 dans le temps">
          <SupervisionHero
            chartTitle={`LCP p75 dans le temps (buckets ${period.bucketLabel})`}
            state={
              !series.ok
                ? { kind: "erreur", titre: "LCP p75 dans le temps" }
                : series.data.length === 0
                  ? { kind: "vide", population: "mesure LCP", plage: period.label }
                  : undefined
            }
            chart={
              series.ok && (
                <VitalsTimeseries
                  data={series.data.map((s) => ({ ...s, bucket: String(s.bucket), p75: Number(s.p75) }))}
                  thresholds={THRESHOLDS.LCP}
                />
              )
            }
          >
            {!stats.ok ? (
              // Aucun chiffre du volume n'est lisible : ni tuile à 0, ni « — » (qui dirait
              // « pas de mesure » sur une fenêtre qu'on n'a simplement pas pu lire).
              <EchecLecture compact titre="Sessions, pages vues et taux d'erreur" />
            ) : (
              <HeroVolume stats={stats.data} statsPrev={statsPrev} periodLabel={period.label} pctOf={pctOf} />
            )}
            <HeroReading>
              Courbe = LCP p75 dans le temps ; pointillé vert = borne «&nbsp;Bon&nbsp;» ({fmtBorne("LCP", THRESHOLDS.LCP[0])}),
              pointillé rouge = borne «&nbsp;Mauvais&nbsp;» ({fmtBorne("LCP", THRESHOLDS.LCP[1])}), seuils web.dev au
              75ᵉ&nbsp;centile.{" "}
              {deltasHero.deltas && "Les tuiles comparent le volume et la fiabilité à la période précédente. "}
              Détail vital par vital ci-dessous, historique 14&nbsp;jours plus bas.
            </HeroReading>
          </SupervisionHero>
        </SectionErreur>
      )}

      {/* Découpage (P6.3) : les mêmes Web Vitals, répartis par dimension. Chaque
          groupe ouvre la surface de détail avec la MÊME plage et le filtre du
          groupe en plus — jamais à la place des filtres déjà posés. */}
      {decoupage && (
        <SectionErreur titre="Web Vitals par dimension">
          {!decoupe.ok ? (
            <div className="mb-6">
              <EchecLecture titre="Web Vitals par dimension" />
            </div>
          ) : (
            decoupe.data && (
              <Breakdown
                title="Web Vitals par dimension"
                tabs={breakdownTabs("/", ecran.query, decoupage, dispoDecoupage, {
                  hours: businessHours ? "business" : null,
                })}
                notice={BREAKDOWN_NOTICES[decoupage]}
                items={vitalsBreakdownItems(
                  { pathname: "/", query: ecran.query, schema, dimension: decoupage },
                  decoupe.data.rows,
                )}
                columns={VITALS_BREAKDOWN_COLUMNS}
                groups={decoupe.data.groups}
                truncated={decoupe.data.truncated}
                measureLabel="Mesures"
                emptyLabel={`Aucune mesure LCP, INP ou CLS sur ${period.label}.`}
              />
            )
          )}
        </SectionErreur>
      )}

      {/* Historique de santé 14 j (fenêtre fixe, comme les anomalies) :
          heatmap jour × heure + courbes de volume et de p75 LCP associées.
          Rendu SEULEMENT si le bloc est allumé : éteint, ses lectures ne sont pas
          lancées, et l'ancien « Pas assez de données sur 14 jours » affiché à sa
          place décrivait une lecture qui n'avait pas eu lieu. */}
      {blocs.historique && (
      <section className="card mt-6 p-4">
        <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          {/* La bulle d'aide OUVRE le titre au lieu de le clore : posée après un
              intitulé long, sa bulle de 288 px centrée sortait de l'écran par la
              droite et portait la page à 493 px sur une fenêtre de 390. En tête
              de titre, elle s'ouvre toujours vers l'intérieur de la page. */}
          <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            <GlossaryTip id="healthGrid" />
            Historique de santé — {GRID_DAYS} derniers jours
          </h2>
          {/* filtre heures ouvrées (Lun–Ven, 8h–19h) — ne montre que les créneaux à trafic attendu */}
          <div className="ml-auto flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
            <Link
              href={hrefWith(null)}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                !businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              24 h/24
            </Link>
            <Link
              href={hrefWith("business")}
              scroll={false}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                businessHours ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
              }`}
            >
              Heures ouvrées
            </Link>
          </div>
        </div>
        <p className="mb-4 text-xs text-ink-faint">
          Fenêtre fixe (indépendante du filtre période) · une case = une heure, sa couleur = la part de
          mesures « good ».{" "}
          {businessHours
            ? "Vue Lun–Ven, 8h–19h."
            : "Une case vide = aucune page vue ce créneau (le RUM n'enregistre que le trafic réel) — les nuits/week-ends creux sont normaux."}
        </p>
        <SectionErreur titre="Heatmap de santé">
          {!grid.ok ? (
            <EchecLecture titre="Heatmap de santé" />
          ) : grid.data.length > 0 ? (
            <HealthHeatmap
              dayKeys={lastNDayKeys(GRID_DAYS)}
              byKey={
                new Map<string, HeatCell>(
                  grid.data.map((c) => [`${dayKey(c.day)}|${c.hour}`, { good_w: c.good_w, total_w: c.total_w }]),
                )
              }
              businessOnly={businessHours}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-faint">
              Pas assez de données sur 14 jours — la heatmap se remplit au fil des mesures.
            </p>
          )}
        </SectionErreur>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Volume & fiabilité par jour
            </h3>
            <SectionErreur titre="Volume & fiabilité par jour">
              {!traffic.ok ? (
                <EchecLecture titre="Volume & fiabilité par jour" />
              ) : traffic.data.length ? (
                <TrafficTimeseries data={traffic.data.map((t) => ({ ...t, day: String(t.day) }))} />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
              )}
            </SectionErreur>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              p75 LCP par jour
            </h3>
            <SectionErreur titre="p75 LCP par jour">
              {!dailyLcp.ok ? (
                <EchecLecture titre="p75 LCP par jour" />
              ) : dailyLcp.data.length ? (
                <VitalsTimeseries
                  data={dailyLcp.data.map((s) => ({ bucket: String(s.bucket), p75: Number(s.p75) }))}
                  thresholds={THRESHOLDS.LCP}
                  xAxis="day"
                />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Pas de données.</p>
              )}
            </SectionErreur>
          </div>
        </div>
      </section>
      )}

      {/* Le bloc décide LUI-MÊME de s'afficher : sous deux versions, une
          « comparaison » d'une ligne n'apprend rien (cf. VersionsTable). */}
      {blocs.versions && (
        <SectionErreur titre="Comparaison des versions">
          {versions.ok ? (
            <VersionsTable comparaison={versions.data} periodLabel={period.label} />
          ) : (
            <div className="mt-6">
              <EchecLecture titre="Comparaison des versions" />
            </div>
          )}
        </SectionErreur>
      )}

      {blocs.anomalies && (
        <SectionErreur titre="Anomalies">
          {health.ok ? (
            health.data && <AnomalyTable health={health.data} />
          ) : (
            <div className="mt-6">
              <EchecLecture titre="Anomalies" />
            </div>
          )}
        </SectionErreur>
      )}
      {!Object.values(blocs).some(Boolean) && <TousEteints />}
    </div>
  );
}

/**
 * Les trois tuiles de volume du hero. La période précédente est une lecture à
 * part : illisible, les tuiles restent justes mais perdent leur variation — et un
 * bandeau « Partiel » le dit, sinon l'absence de flèche se lirait « stable ».
 */
function HeroVolume({
  stats,
  statsPrev,
  periodLabel,
  pctOf,
}: {
  stats: OverviewStats;
  statsPrev: Lecture<OverviewStats | null>;
  periodLabel: string;
  pctOf: (cur: number, prev: number | null | undefined) => { pct: number; reference: string } | null;
}) {
  const prev = statsPrev.ok ? statsPrev.data : null;
  // Sans page vue, le taux n'a pas de dénominateur : « — », jamais « 0 % » — qui se
  // lirait « aucune erreur » sur une fenêtre où l'on n'a simplement rien mesuré.
  const errorRate = stats.pageviews ? (stats.errors / stats.pageviews) * 100 : null;
  const prevErrorRate = prev?.pageviews ? (prev.errors / prev.pageviews) * 100 : null;
  return (
    <>
      {!statsPrev.ok && (
        <EtatSurface
          compact
          etat={{ kind: "partiel", raison: "la période précédente n'a pas pu être lue : aucune variation n'est affichée." }}
        />
      )}
      <HeroStat
        label={`Sessions · ${periodLabel}`}
        value={stats.sessions.toLocaleString("fr-FR")}
        delta={pctOf(stats.sessions, prev?.sessions)}
      />
      <HeroStat
        label="Pages vues"
        value={stats.pageviews.toLocaleString("fr-FR")}
        delta={pctOf(stats.pageviews, prev?.pageviews)}
      />
      <HeroStat
        label="Taux d'erreur JS / page vue"
        value={errorRate == null ? "—" : `${errorRate.toFixed(1)} %`}
        delta={errorRate == null ? null : (() => {
          // Même règle que les autres tuiles : sans base (période précédente vide ou
          // à 0), pas de variation — l'ancien `prev || 1` inventait un pourcentage.
          const d = pctOf(errorRate, prevErrorRate);
          return d && { ...d, lowerIsBetter: true };
        })()}
        tone={errorRate == null ? "neutral" : errorRate > 2 ? "poor" : errorRate > 1 ? "warn" : "good"}
        hint={errorRate == null ? "aucune page vue sur la période" : undefined}
      />
    </>
  );
}

/** Les phases réseau qui composent le TTFB, dans l'ordre chronologique. Libellés
 *  français à l'affichage, noms bruts pour la lecture des données. */
const PHASES: { cle: string; label: string }[] = [
  { cle: "REDIRECT", label: "Redirection" },
  { cle: "DNS", label: "DNS" },
  { cle: "TCP", label: "Connexion" },
  { cle: "TLS", label: "TLS" },
  { cle: "REQUEST", label: "Requête" },
  { cle: "RESPONSE", label: "Réponse" },
];

/**
 * Décomposition du TTFB. Sans elle, la vue d'ensemble donnait le SYMPTÔME — « la
 * première donnée arrive en 900 ms » — sans jamais la cause : un DNS lent, une
 * poignée de main TLS coûteuse et un serveur lent produisent le même TTFB et
 * appellent trois corrections opposées.
 *
 * Aucune requête supplémentaire : `vitalsP75` groupe sur `m.name` sans filtrer,
 * ces lignes étaient déjà dans le résultat, simplement jamais lues.
 *
 * Rendu seulement si au moins une phase a des mesures — un parc qui tourne encore
 * sur une version antérieure du capteur n'en émet pas, et six cartes vides
 * feraient croire à une panne.
 */
function PhasesReseau({
  vitals,
  periodLabel,
}: {
  vitals: Record<string, { p75: number | null; p50: number | null; n: number } | undefined>;
  periodLabel: string;
}) {
  // La redirection vaut 0 sur l'immense majorité des navigations : lui donner une
  // carte permanente gâcherait une place pour n'afficher que des zéros.
  const visibles = PHASES.filter(
    (p) => (vitals[p.cle]?.n ?? 0) > 0 && (p.cle !== "REDIRECT" || (vitals[p.cle]?.p75 ?? 0) > 0),
  );
  if (visibles.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        D&apos;où vient le TTFB — décomposition réseau
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {visibles.map((p) => (
          <VitalCard
            key={p.cle}
            name={p.label}
            p75={vitals[p.cle]?.p75 ?? null}
            median={vitals[p.cle]?.p50 ?? null}
            n={vitals[p.cle]?.n ?? 0}
            periodLabel={periodLabel}
          />
        ))}
      </div>
    </section>
  );
}
