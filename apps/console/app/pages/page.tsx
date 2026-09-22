import Link from "next/link";
import { Histogram, PercentileTable } from "@/components/Distribution";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { Breakdown } from "@/components/Breakdown";
import { VITALS_BREAKDOWN_COLUMNS, vitalsBreakdownItems } from "@/components/breakdown-view";
import { LongtasksView } from "@/components/LongtasksView";
import { ResourcesView } from "@/components/ResourcesView";
import { VitalPill } from "@/components/VitalPill";
import { HISTO_BUCKETS, VITAL_CAP } from "@/lib/distribution";
import { fmtBorne, fmtVital } from "@/lib/format";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import type { SearchParams } from "@/lib/filters";
import { lire } from "@/lib/lecture";
import { pageFilters } from "@/lib/page-filters";
import {
  BREAKDOWN_NOTICES,
  BREAKDOWN_PARAM,
  availableBreakdowns,
  breakdownDrillHref,
  breakdownTabs,
  datasetAvailability,
  parseBreakdown,
} from "@/lib/breakdowns";
import { hrefWithQuery, paramReader } from "@/lib/query-contract";
import { dimensionSchema } from "@/lib/query-schema";
import {
  ROUTES_MAX,
  nombreDeRoutes,
  slowResourcesByRoute,
  slowRoutes,
  vitalHistogram,
  vitalPercentiles,
  type SlowResource,
} from "@/lib/queries";
import { VITALS_BREAKDOWN_DATASETS, vitalsBreakdown } from "@/lib/queries-breakdowns";
import { longtaskSeries, worstLongtasks } from "@/lib/queries-longtasks";
import { resourcesVue } from "@/lib/queries-resources";
import { RATING_HEX, THRESHOLDS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function SlowPages({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/pages");
  if (!ecran.ok) return <FilterProblemNotice title="Pages lentes" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = { label: ecran.label };

  // Découpage (P6.3) : jugé sur les Web Vitals, les mesures effectivement groupées.
  const schema = await dimensionSchema();
  const dispoDecoupage = datasetAvailability(VITALS_BREAKDOWN_DATASETS, schema);
  const decoupage = parseBreakdown(paramReader(sp).get(BREAKDOWN_PARAM), availableBreakdowns(dispoDecoupage));

  // Chaque lecture est indépendante (F02, § 3.8) : `lire()` ne lève pas, une
  // lecture en échec ne rend « Lecture en échec » que dans SA section. Les
  // ressources et les blocages rendaient autrefois une vue vide pendant une panne
  // (« aucune ressource », « aucun blocage ») ; toute autre lecture en échec
  // emportait l'écran entier.
  const [rows, routesTotal, resources, pcts, lcpH, inpH, clsH, decoupe, ressources, blocages, pires] =
    await Promise.all([
      lire(() => slowRoutes(f)),
      lire(() => nombreDeRoutes(f)),
      lire(() => slowResourcesByRoute(f)),
      lire(() => vitalPercentiles(f)),
      lire(() => vitalHistogram(f, "LCP", VITAL_CAP.LCP, HISTO_BUCKETS)),
      lire(() => vitalHistogram(f, "INP", VITAL_CAP.INP, HISTO_BUCKETS)),
      lire(() => vitalHistogram(f, "CLS", VITAL_CAP.CLS, HISTO_BUCKETS)),
      decoupage ? lire(() => vitalsBreakdown(f, decoupage)) : Promise.resolve({ ok: true as const, data: null }),
      lire(() => resourcesVue(f)),
      lire(() => longtaskSeries(f)),
      lire(() => worstLongtasks(f)),
    ]);

  /** Drill-down d'une route : cet écran, même plage, filtré sur elle. */
  const routeHref = (route: string) => breakdownDrillHref("/pages", ecran.query, "route", route, schema);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Pages lentes"
        sub="Les routes au chargement perçu le plus lent (LCP p75) et ce qui le cause — ressources et tâches JS longues."
      />

      {/* LA LISTE EST PLAFONNÉE, ET ELLE LE DIT (finding 2.6). Avant, elle
          rendait TOUTES les routes : sur un catalogue à forte cardinalité,
          plusieurs milliers de lignes en HTML, avec deux sous-requêtes
          corrélées chacune. Une liste coupée en silence ferait croire à un
          catalogue plus petit qu'il n'est. */}
      {routesTotal.ok && routesTotal.data > ROUTES_MAX && (
        <div
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
          data-testid="routes-tronquees"
        >
          <p className="font-semibold">
            {routesTotal.data.toLocaleString("fr-FR")} routes distinctes sur {period.label} — les{" "}
            {ROUTES_MAX} plus lentes sont affichées.
          </p>
          <p className="mt-1 text-xs">
            Au-delà de quelques centaines de routes, il y a une statistique par page, donc plus de
            statistique du tout. Une cardinalité qui grimpe ainsi vient presque toujours
            d&apos;identifiants non normalisés dans l&apos;URL — slugs, dates, numéros de dossier —
            que <code className="font-mono">normalizeRoute</code> ne reconnaît pas encore.
          </p>
        </div>
      )}
      {/* Le total illisible, on ne sait plus si la liste est coupée : on le dit,
          plutôt que de laisser croire qu'elle est complète. */}
      {!routesTotal.ok && rows.ok && rows.data.length >= ROUTES_MAX && (
        <div className="mb-6">
          <EtatSurface
            etat={{
              kind: "partiel",
              raison: `le nombre total de routes n'a pas pu être lu : la liste peut être coupée aux ${ROUTES_MAX} routes les plus lentes.`,
            }}
          />
        </div>
      )}

      <SectionErreur titre="Routes les plus lentes">
        {!rows.ok ? (
          <div className="card mb-6 p-5">
            <EchecLecture titre="Routes les plus lentes" />
          </div>
        ) : (
          (() => {
            // Hero : classement des routes par LCP p75 (le message central de la page).
            const lignes = rows.data;
            const ranked = [...lignes]
              .filter((r) => r.lcp_p75 != null)
              .sort((a, b) => Number(b.lcp_p75) - Number(a.lcp_p75))
              .slice(0, 8);
            const worst = ranked[0];
            const poorCount = lignes.filter(
              (r) => r.lcp_p75 != null && rating2026("LCP", Number(r.lcp_p75)) === "poor",
            ).length;
            const totalLongtasks = lignes.reduce((s, r) => s + (r.longtasks ?? 0), 0);
            return (
              <SupervisionHero
                chartTitle="Routes les plus lentes — LCP p75"
                state={ranked.length ? undefined : { kind: "vide", population: "route avec mesure LCP", plage: period.label }}
                chart={
                  <RankBar
                    data={ranked.map((r) => {
                      const rating = rating2026("LCP", Number(r.lcp_p75));
                      return {
                        label: r.route,
                        value: Number(r.lcp_p75),
                        display: fmtVital("LCP", Number(r.lcp_p75)),
                        color: rating ? RATING_HEX[rating] : "#94a3b8",
                        sub: `${r.views.toLocaleString("fr-FR")} vues${r.longtasks ? ` · ${r.longtasks} long tasks` : ""}`,
                        title: `${r.route} — LCP p75 ${fmtVital("LCP", Number(r.lcp_p75))}`,
                      };
                    })}
                    labelWidth="13rem"
                  />
                }
              >
                <HeroStat label={`Routes suivies · ${period.label}`} value={lignes.length.toLocaleString("fr-FR")} />
                <HeroStat
                  label="Routes « mauvais » LCP"
                  value={poorCount.toLocaleString("fr-FR")}
                  tone={poorCount > 0 ? "poor" : "good"}
                  hint={`LCP p75 > ${fmtBorne("LCP", THRESHOLDS.LCP[1])} (borne « Mauvais », web.dev)`}
                />
                <HeroStat
                  label="Route la plus lente"
                  value={worst ? fmtVital("LCP", Number(worst.lcp_p75)) : "—"}
                  hint={worst?.route}
                  tone="warn"
                />
                <HeroReading>
                  Chaque barre = une route, longueur et couleur = son LCP p75 (vert «&nbsp;bon&nbsp;» → rouge
                  «&nbsp;mauvais&nbsp;»). {totalLongtasks > 0 ? `${totalLongtasks} tâches JS longues au total sur la fenêtre. ` : ""}
                  Distribution complète et détail ressource par route ci-dessous.
                </HeroReading>
              </SupervisionHero>
            );
          })()
        )}
      </SectionErreur>

      {/* Découpage (P6.3) : les mêmes Web Vitals répartis par dimension, chaque
          groupe ouvrant cet écran filtré — même plage, condition en plus. */}
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
                tabs={breakdownTabs("/pages", ecran.query, decoupage, dispoDecoupage)}
                notice={BREAKDOWN_NOTICES[decoupage]}
                items={vitalsBreakdownItems(
                  { pathname: "/pages", query: ecran.query, schema, dimension: decoupage },
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

      {/* Distribution & percentiles (Lot 3) : ce que le p75 seul masque —
          longue traîne (p90/p95/p99) et forme de la distribution. Chaque figure
          a sa lecture : un histogramme en échec n'efface pas les deux autres. */}
      <section className="mb-6 space-y-4">
        <SectionErreur titre="Percentiles des Web Vitals">
          {pcts.ok ? <PercentileTable rows={pcts.data} /> : <EchecLecture titre="Percentiles des Web Vitals" />}
        </SectionErreur>
        <div className="grid gap-4 md:grid-cols-3">
          {(
            [
              ["LCP", lcpH],
              ["INP", inpH],
              ["CLS", clsH],
            ] as const
          ).map(([name, histo]) => (
            <SectionErreur key={name} titre={`Distribution ${name}`}>
              {histo.ok ? (
                <Histogram name={name} rows={histo.data} cap={VITAL_CAP[name]} />
              ) : (
                <div className="card p-4">
                  <EchecLecture compact titre={`Distribution ${name}`} />
                </div>
              )}
            </SectionErreur>
          ))}
        </div>
      </section>

      <h2 className="mb-2 text-sm font-semibold text-ink">Par route</h2>
      <SectionErreur titre="Par route">
        {!rows.ok ? (
          <EchecLecture titre="Par route" />
        ) : (
          <>
            {/* Les ressources lentes par route sont une lecture à part : en échec,
                la table reste juste mais perd ses replis — et le dit. */}
            {!resources.ok && (
              <div className="mb-2">
                <EtatSurface
                  compact
                  etat={{ kind: "partiel", raison: "les ressources lentes par route n'ont pas pu être lues ; elles ne sont pas listées sous les routes." }}
                />
              </div>
            )}
            <div className="card overflow-x-auto">
              <table className="w-full min-w-table text-sm">
                <caption className="sr-only">
                  Routes sur {period.label}, de la plus lente à la plus rapide. Chaque route ouvre cet écran filtré
                  sur elle, avec la même plage.
                </caption>
                <thead className="bg-panel2">
                  <tr>
                    <th scope="col" className="th">Route</th>
                    <th scope="col" className="th">Vues</th>
                    <th scope="col" className="th">LCP p75</th>
                    <th scope="col" className="th">INP p75</th>
                    <th scope="col" className="th">CLS p75</th>
                    <th scope="col" className="th">Long tasks</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.data.map((r) => {
                    const res = (resources.ok ? resources.data.get(r.route) : undefined) ?? [];
                    return (
                      <tr key={r.route} className="border-t border-line/60 align-top transition hover:bg-panel2/60">
                        <td className="px-4 py-3">
                          {/* Un seul lien par ligne : une tabulation par route au clavier. Le
                              repli des ressources lentes reste un contrôle natif distinct. */}
                          <Link
                            href={routeHref(r.route)}
                            aria-label={`Route ${r.route} — filtrer cet écran sur cette route`}
                            data-testid="route-drill"
                            className="block rounded font-mono text-xs text-ink hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                          >
                            {r.route}
                          </Link>
                          {res.length > 0 && <SlowResources items={res} />}
                        </td>
                        <td className="px-4 py-3 tabular-nums">{r.views}</td>
                        <td className="px-4 py-3"><VitalPill name="LCP" value={r.lcp_p75} /></td>
                        <td className="px-4 py-3"><VitalPill name="INP" value={r.inp_p75} /></td>
                        <td className="px-4 py-3"><VitalPill name="CLS" value={r.cls_p75} /></td>
                        <td className="px-4 py-3">
                          {r.longtasks > 0 ? (
                            <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-xs font-medium tabular-nums text-accent-deep dark:text-accent-soft">
                              {r.longtasks}
                            </span>
                          ) : (
                            <span className="text-ink-faint/60">0</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.data.length && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                        Aucune donnée sur {period.label}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </SectionErreur>

      {/* Ressources (P6.3) : ce qui est téléchargé, d'où, à quel coût — avec son
          avertissement de collecte, et un partage première/tierce partie lu sur
          les seules origines déclarées de l'application. */}
      <SectionErreur titre="Ressources">
        {ressources.ok ? (
          <ResourcesView vue={ressources.data} periodLabel={period.label} />
        ) : (
          <div className="mt-6">
            <EchecLecture titre="Ressources" />
          </div>
        )}
      </SectionErreur>

      {/* Blocages du fil principal (P6.3) : la série, et le chemin vers la session.
          Série et pires cas forment UNE section : l'un sans l'autre se lirait
          comme un tableau complet. */}
      <SectionErreur titre="Blocages du fil principal">
        {blocages.ok && pires.ok ? (
          <LongtasksView
            series={blocages.data}
            worst={pires.data}
            bucketSeconds={ecran.query.range.bucketSeconds}
            bucketLabel={ecran.bucketLabel}
            periodLabel={period.label}
            sessionHref={(id) => hrefWithQuery(`/sessions/${encodeURIComponent(id)}`, ecran.query)}
          />
        ) : (
          <div className="mt-6">
            <EchecLecture titre="Blocages du fil principal" />
          </div>
        )}
      </SectionErreur>
    </div>
  );
}

/** Top 3 ressources lentes de la route, repliées par défaut (élément details natif). */
function SlowResources({ items }: { items: SlowResource[] }) {
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer select-none font-sans text-xs font-medium text-brand hover:underline">
        {items.length} ressource(s) lente(s)
      </summary>
      <ul className="mt-1.5 flex flex-col gap-1">
        {items.map((it) => (
          <li key={it.url} className="flex items-center gap-2 font-sans text-xs text-ink-soft">
            <span className="chip-mono text-[11px]">{it.type ?? "?"}</span>
            <span className="max-w-md truncate font-mono text-[11px]" title={it.url}>
              {it.url}
            </span>
            <span className="font-semibold tabular-nums text-ink">{fmtVital("dur", Number(it.avg_ms))}</span>
            <span className="text-ink-faint">× {it.n}</span>
            {it.render_blocking && (
              <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                bloquant
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
