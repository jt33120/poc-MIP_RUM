import Link from "next/link";
import { BlindSpotRow } from "@/components/correlation/BlindSpotRow";
import { RouteCard } from "@/components/correlation/RouteCard";
import { RobotVsRealChart } from "@/components/features/RobotVsRealChart";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { hrefWithQuery } from "@/lib/query-contract";
import { blindSpots, correlationCards, correlationRoutes, correlationSeries } from "@/lib/queries-v2";
import { fmtBorne } from "@/lib/format";
import { THRESHOLDS } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function Correlation({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const ecran = await pageFilters(sp, "/correlation");
  if (!ecran.ok) return <FilterProblemNotice title="Corrélation synthétique ↔ RUM" problem={ecran.problem} />;
  const f = ecran.filters;
  const [rows, routes, spots] = await Promise.all([
    correlationCards(f),
    correlationRoutes(f),
    blindSpots(f),
  ]);
  // `serie` choisit la courbe affichée ; `route`, filtre du contrat commun, restreint
  // TOUTE la page (cartes, angles morts) à une route.
  const requested = Array.isArray(sp.serie) ? sp.serie[0] : sp.serie;
  const selectedRoute = requested && routes.includes(requested) ? requested : routes[0] ?? null;
  const series = selectedRoute ? await correlationSeries(selectedRoute, f) : [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Corrélation synthétique ↔ RUM"
        sub="Ce que le robot MIP voit (DEM synthétique) face à ce que les utilisateurs réels subissent (RUM)."
      />

      {/* Hero : la série robot vs réel (le graphe qui « raconte » la corrélation). */}
      <SupervisionHero
        chartTitle={`Robot vs réel dans le temps (buckets horaires, ${ecran.label})`}
        chartMeta={
          routes.length ? (
            <div className="flex max-w-full flex-wrap justify-end gap-1">
              {routes.slice(0, 6).map((route) => (
                <Link
                  key={route}
                  href={hrefWithQuery("/correlation", ecran.query, { serie: route })}
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] transition ${
                    route === selectedRoute
                      ? "bg-accent font-semibold text-navy-950 shadow-sm"
                      : "bg-panel2 text-ink-soft hover:bg-line/60"
                  }`}
                >
                  {route}
                </Link>
              ))}
            </div>
          ) : undefined
        }
        chart={
          selectedRoute && series.length ? (
            <RobotVsRealChart
              data={series.map((s) => ({
                bucket: new Date(s.bucket).toISOString(),
                robot: s.syn_latency_avg != null ? Number(s.syn_latency_avg) : null,
                reel: s.rum_lcp_p75 != null ? Number(s.rum_lcp_p75) : null,
              }))}
            />
          ) : (
            <p className="py-10 text-center text-sm text-ink-faint">
              Pas encore de route avec données robot ET réel sur la période.
            </p>
          )
        }
      >
        <HeroStat label="Routes corrélées" value={routes.length.toLocaleString("fr-FR")} hint="robot ET réel disponibles" />
        <HeroStat
          label="Angles morts"
          value={spots.length.toLocaleString("fr-FR")}
          tone={spots.length > 0 ? "poor" : "good"}
          hint={`robot « ok » mais LCP p75 réel > ${fmtBorne("LCP", THRESHOLDS.LCP[0])}`}
        />
        <HeroStat label="Route affichée" value={selectedRoute ?? "—"} hint="clique une puce pour changer" />
        <HeroReading>
          Deux courbes : le robot synthétique (ce que MIP mesure en labo) et le réel (LCP p75 subi). Quand
          elles divergent — réel qui grimpe alors que le robot reste plat — c&apos;est un angle mort. Le détail
          par route et les angles morts sont listés ci-dessous.
        </HeroReading>
      </SupervisionHero>

      <div className="mb-2 mt-8 text-sm font-semibold text-ink">Par route — robot vs réel</div>
      <div className="flex flex-col gap-4">
        {rows.map((r) => (
          <RouteCard key={`${r.app_id}|${r.route}`} row={r} />
        ))}
        {!rows.length && (
          <p className="py-8 text-center text-ink-faint">
            Aucune donnée — lance le job sync-synthetic et la démo.
          </p>
        )}
      </div>

      {/* ----- Angles morts ----- */}
      <div className="card mt-8 overflow-hidden border-red-300/60 dark:border-red-400/30">
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/20 dark:bg-red-400/10">
          <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
            ⚠ Angles morts — le robot ne le voit pas
          </h2>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300/80">
            Heures où le robot dit « ok » alors que le LCP p75 des utilisateurs réels dépasse la borne « Bon »
            ({fmtBorne("LCP", THRESHOLDS.LCP[0])}, seuil web.dev) : « À améliorer » ou « Mauvais » ·
            {ecran.label}
          </p>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Route</th>
              <th className="th">Heure</th>
              <th className="th">Robot (latence moy.)</th>
              <th className="th">Réel (LCP p75)</th>
              <th className="th">Écart</th>
            </tr>
          </thead>
          <tbody>
            {spots.map((s, i) => (
              <BlindSpotRow key={i} spot={s} />
            ))}
            {!spots.length && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                  Aucun angle mort détecté sur la période
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
