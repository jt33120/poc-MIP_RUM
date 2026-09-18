// Page « Appels » — Supervision SVI, incrément I0. Hero = répartition horaire des
// issues + taux dérivés ; table des derniers appels avec saut vers le déroulé.
// Alimentée par l'ingestion des spans svi.* (migration-v51).
//
// Deux partis pris d'affichage, tous deux destinés à ne pas mentir :
//   • les taux sont calculés sur les appels CLOS et le dénominateur est écrit à
//     l'écran — un appel en cours n'a pas d'issue ;
//   • la COUVERTURE du niveau « parcours » est affichée dès qu'elle est partielle.
//     Un entonnoir calculé sur 34 % des appels ne doit jamais se présenter comme
//     s'il portait sur la totalité.
import Link from "next/link";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate } from "@/lib/format";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { periodLabel, v2FiltersOf } from "@/lib/queries-v2";
import { sviCalls, sviOutcomesByHour, sviSummary } from "@/lib/queries-svi";
import { fmtDuration, journeyCoverage, outcomeLabel, outcomeRates } from "@/lib/svi-outcome";

export const dynamic = "force-dynamic";

const OUTCOME_STYLE: Record<string, string> = {
  contained: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  transferred: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
  abandoned: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  failed: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
  open: "border-line bg-panel2 text-ink-faint",
};

const SERIES: StackSeries[] = [
  { key: "contained", name: "résolus", color: "#10b981" },
  { key: "transferred", name: "transférés", color: "#0ea5e9" },
  { key: "abandoned", name: "abandonnés", color: "#f59e0b" },
  { key: "failed", name: "échecs", color: "#ef4444" },
];

export default async function AppelsSvi({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (estFermee("/svi")) {
    return (
      <CapaciteFermee
        titre="Supervision SVI"
        sujet="Supervision du serveur vocal interactif."
      />
    );
  }

  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/svi/appels");
  if (!ecran.ok) return <FilterProblemNotice title="Appels SVI" problem={ecran.problem} />;
  const f = v2FiltersOf(ecran.query);

  const [rows, sum, parHeure] = await Promise.all([
    sviCalls(f),
    sviSummary(f),
    sviOutcomesByHour(f),
  ]);

  const taux = outcomeRates(sum);
  const couverture = journeyCoverage(sum.total, sum.with_journey);

  // Histogramme empilé : une ligne par heure, une colonne par issue.
  const buckets = [...new Set(parHeure.map((r) => r.bucket))].sort();
  const data = buckets.map((b) => {
    const ligne: Record<string, number | string> = { heure: fmtDate(b) };
    for (const s of SERIES)
      ligne[s.key] = parHeure.find((r) => r.bucket === b && r.outcome === s.key)?.n ?? 0;
    return ligne;
  });

  return (
    <>
      <PageHeader
        title="Appels"
        sub={`Supervision du serveur vocal — ${periodLabel(f)}`}
      />

      <SupervisionHero
        chartTitle={`Issues des appels par heure — ${periodLabel(f)}`}
        chartMeta={
          <span className="text-xs text-ink-soft">
            {sum.total.toLocaleString("fr-FR")} appel(s)
          </span>
        }
        chart={<StackedBars data={data} xKey="heure" series={SERIES} />}
      >
        <HeroStat
          label="Résolus par le SVI"
          value={taux.closed > 0 ? `${taux.contained.toFixed(1)} %` : "—"}
        />
        <HeroStat label="Transférés" value={taux.closed > 0 ? `${taux.transferred.toFixed(1)} %` : "—"} />
        <HeroStat label="Abandonnés" value={taux.closed > 0 ? `${taux.abandoned.toFixed(1)} %` : "—"} />
        <HeroStat label="Durée moyenne" value={fmtDuration(sum.avg_duration_ms)} />
        <HeroReading>
          {taux.closed === 0 ? (
            <>Aucun appel clos sur la période : les taux ne sont pas calculables.</>
          ) : (
            <>
              Taux calculés sur les <strong>{taux.closed.toLocaleString("fr-FR")} appels clos</strong>
              {sum.open > 0 && <> ({sum.open} encore en cours, exclus du calcul)</>}.
              {couverture < 100 && (
                <>
                  {" "}Le détail de parcours n'est disponible que sur{" "}
                  <strong>{couverture.toFixed(0)} %</strong> des appels — l'entonnoir de menu
                  ne portera que sur ceux-là.
                </>
              )}
            </>
          )}
        </HeroReading>
      </SupervisionHero>

      <section className="mt-6">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Derniers appels
        </h2>
        {rows.length === 0 ? (
          <p className="rounded border border-line bg-panel p-4 text-sm text-ink-soft">
            Aucun appel sur la période. Envoie des spans <code className="chip-mono">svi.*</code> au
            format OTLP sur <code className="chip-mono">/v1/traces</code> pour les voir ici — ou
            joue <code className="chip-mono">node scripts/gen-svi-traffic.mjs</code> en local.
          </p>
        ) : (
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-sm">
              <thead className="bg-panel2 text-left text-xs uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-3 py-2">Début</th>
                  <th className="px-3 py-2">Issue</th>
                  <th className="px-3 py-2">Point d'entrée</th>
                  <th className="px-3 py-2">Parcours</th>
                  <th className="px-3 py-2 text-right">Attente</th>
                  <th className="px-3 py-2 text-right">Durée</th>
                  <th className="px-3 py-2 text-right">MOS</th>
                  <th className="px-3 py-2 text-right">Étapes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.call_id} className="border-t border-line hover:bg-panel2">
                    <td className="px-3 py-2 tabular-nums">
                      <Link className="hover:underline" href={`/svi/appels/${c.call_id}`}>
                        {fmtDate(c.started_at)}
                      </Link>
                      {/* Un appel de démonstration ne se fait jamais passer pour du trafic réel. */}
                      {c.is_test && (
                        <span className="ml-2 rounded border border-line bg-panel2 px-1.5 py-0.5 text-[10px] text-ink-faint">
                          {c.platform}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded border px-2 py-0.5 text-xs ${OUTCOME_STYLE[c.outcome ?? "open"]}`}
                      >
                        {outcomeLabel(c.outcome)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-soft">{c.entry_point ?? "—"}</td>
                    <td className="px-3 py-2 text-ink-soft">{c.menu_path_final ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(c.wait_ms)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtDuration(c.duration_ms)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {c.mos_avg == null ? "—" : c.mos_avg.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{c.steps}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
