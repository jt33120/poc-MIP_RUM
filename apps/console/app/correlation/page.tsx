import Link from "next/link";
import { BlindSpotRow } from "@/components/correlation/BlindSpotRow";
import { RouteCard } from "@/components/correlation/RouteCard";
import { RobotVsRealChart } from "@/components/features/RobotVsRealChart";
import { PageHeader } from "@/components/PageHeader";
import {
  blindSpots,
  correlationCards,
  correlationRoutes,
  correlationSeries,
  filtersToQuery,
  parseFilters,
  periodLabel,
  type SearchParams,
} from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export default async function Correlation({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = (await searchParams) ?? {};
  const f = parseFilters(sp);
  const [rows, routes, spots] = await Promise.all([
    correlationCards(f),
    correlationRoutes(f),
    blindSpots(f),
  ]);
  const requested = Array.isArray(sp.route) ? sp.route[0] : sp.route;
  const selectedRoute = requested && routes.includes(requested) ? requested : routes[0] ?? null;
  const series = selectedRoute ? await correlationSeries(selectedRoute, f) : [];

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Corrélation synthétique ↔ RUM"
        sub={
          <>
            Ce que le robot MIP voit (DEM synthétique) face à ce que les utilisateurs réels subissent (RUM) ·
            fenêtre {periodLabel(f)}
          </>
        }
      />

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

      {/* ----- Série historisée robot vs réel ----- */}
      <div className="card mt-8 p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Robot vs réel dans le temps (buckets horaires, vue v_correlation)
          </h2>
          <div className="ml-auto flex flex-wrap gap-1">
            {routes.map((route) => (
              <Link
                key={route}
                href={`/correlation${filtersToQuery(f, { route })}`}
                className={`rounded-full px-3 py-1 font-mono text-xs transition ${
                  route === selectedRoute
                    ? "bg-accent font-semibold text-navy-950 shadow-sm"
                    : "bg-panel2 text-ink-soft hover:bg-line/60"
                }`}
              >
                {route}
              </Link>
            ))}
          </div>
        </div>
        {selectedRoute && series.length ? (
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
        )}
      </div>

      {/* ----- Angles morts ----- */}
      <div className="card mt-8 overflow-hidden border-red-300/60 dark:border-red-400/30">
        <div className="border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-400/20 dark:bg-red-400/10">
          <h2 className="text-sm font-bold text-red-800 dark:text-red-300">
            ⚠ Angles morts — le robot ne le voit pas
          </h2>
          <p className="mt-0.5 text-xs text-red-700 dark:text-red-300/80">
            Routes où le robot dit « ok » alors que les utilisateurs réels sont en « poor » (LCP p75 &gt; 2,5 s) ·
            vue v_blind_spot
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
                  Aucun angle mort détecté sur la période 👍
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
