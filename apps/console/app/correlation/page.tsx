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
import { blindSpots, correlationCards, correlationRoutes, correlationSeries, EFFECTIF_MIN_HEURE } from "@/lib/queries-v2";
import { ecrireSerie, libelleSerie, lireSerie, serieParDefaut } from "@/lib/correlation-serie";
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
  const [rows, couples, spots] = await Promise.all([
    correlationCards(f),
    correlationRoutes(f),
    blindSpots(f),
  ]);
  // `serie` choisit le couple (app, route) affiché, au format `<app>:<route>` encodé
  // (lib/correlation-serie.ts) ; `route`, filtre du contrat commun, restreint TOUTE la
  // page (cartes, angles morts) à une route.
  const requested = Array.isArray(sp.serie) ? sp.serie[0] : sp.serie;
  const selected = lireSerie(requested, couples) ?? serieParDefaut(couples, { route: ecran.query.filters.route });
  const selectedLabel = selected ? libelleSerie(selected, couples) : null;
  const series = selected ? await correlationSeries(selected.app_id, selected.route, f) : [];

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
          couples.length ? (
            <div className="flex max-w-full flex-wrap justify-end gap-1">
              {couples.slice(0, 6).map((c) => (
                <Link
                  key={ecrireSerie(c.app_id, c.route)}
                  href={hrefWithQuery("/correlation", ecran.query, { serie: ecrireSerie(c.app_id, c.route) })}
                  className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] transition ${
                    c.app_id === selected?.app_id && c.route === selected?.route
                      ? "bg-accent font-semibold text-navy-950 shadow-sm"
                      : "bg-panel2 text-ink-soft hover:bg-line/60"
                  }`}
                >
                  {libelleSerie(c, couples)}
                </Link>
              ))}
            </div>
          ) : undefined
        }
        chart={
          selected && series.length ? (
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
        <HeroStat label="Routes corrélées" value={couples.length.toLocaleString("fr-FR")} hint="robot ET réel disponibles" />
        <HeroStat
          label="Angles morts"
          value={spots.length.toLocaleString("fr-FR")}
          tone={spots.length > 0 ? "poor" : "good"}
          hint={`robot « ok » mais LCP p75 réel > ${fmtBorne("LCP", THRESHOLDS.LCP[0])}, heures d'au moins ${EFFECTIF_MIN_HEURE} mesures LCP`}
        />
        <HeroStat label="Route affichée" value={selectedLabel ?? "—"} hint="clique une puce pour changer" />
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
      <div className="card mt-8 overflow-hidden border-bad/60">
        <div className="border-b border-bad/30 bg-bad/10 px-4 py-3">
          <h2 className="text-sm font-bold text-bad-ink">
            ⚠ Angles morts — le robot ne le voit pas
          </h2>
          <p className="mt-0.5 text-xs text-bad-ink">
            Heures où le robot dit « ok » alors que le LCP p75 des utilisateurs réels dépasse la borne « Bon »
            ({fmtBorne("LCP", THRESHOLDS.LCP[0])}, seuil web.dev) : « À améliorer » ou « Mauvais », sur des heures
            d&apos;au moins {EFFECTIF_MIN_HEURE} mesures LCP · {ecran.label}
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
