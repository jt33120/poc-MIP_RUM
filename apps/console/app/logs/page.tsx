// Page « Logs » — supervision du 3e signal OTel (rum_log). Hero = volume horaire
// empilé error/warn/autres + comptes par sévérité ; filtres de niveau ; table des
// derniers logs avec corrélation trace/session. Alimentée par l'ingestion /v1/logs.
import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate } from "@/lib/format";
import { parseFilters, periodLabel, filtersToQuery, type SearchParams } from "@/lib/queries-v2";
import {
  logEntries,
  logSeverityCounts,
  logVolumeByHour,
  parseLevel,
  severityBucket,
  type LevelKey,
} from "@/lib/queries-logs";

export const dynamic = "force-dynamic";

const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "info", label: "Info+" },
  { key: "warn", label: "Warn+" },
  { key: "error", label: "Error+" },
];

// Teintes par bucket de sévérité (badge + série du hero).
const SEV_STYLE: Record<string, string> = {
  error: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
  warn: "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300",
  info: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
  debug: "border-line bg-panel2 text-ink-faint",
};

export default async function Logs({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const level = parseLevel(sp?.level);

  const [rows, counts, volume] = await Promise.all([
    logEntries(f, level),
    logSeverityCounts(f),
    logVolumeByHour(f),
  ]);

  const total = counts.error + counts.warn + counts.info + counts.debug;
  const now = Date.now();
  const stackData = Array.from({ length: 24 }, (_v, i) => {
    const t = new Date(now - (23 - i) * 3_600_000);
    return {
      h: t.toLocaleTimeString("fr-FR", { hour: "2-digit" }),
      error: volume.error[i] ?? 0,
      warn: volume.warn[i] ?? 0,
      autres: volume.other[i] ?? 0,
    };
  });
  const series: StackSeries[] = [
    { key: "error", name: "error", color: "#ef4444" },
    { key: "warn", name: "warn", color: "#f59e0b" },
    { key: "autres", name: "autres", color: "#94a3b8" },
  ];
  const peak = stackData.reduce((mx, r) => Math.max(mx, r.error + r.warn + r.autres), 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Logs"
        sub={
          <>
            Logs applicatifs (3ᵉ signal OpenTelemetry) — SDK, extension, backend, syslog — corrélés aux
            traces · fenêtre {periodLabel(f)}
          </>
        }
      />

      <SupervisionHero
        chartTitle="Volume de logs par heure (24 h) — error / warn / autres"
        chart={
          total ? (
            <StackedBars data={stackData} xKey="h" series={series} yUnit="" />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">Aucun log sur la période.</p>
          )
        }
      >
        <HeroStat
          label={`Erreurs · ${periodLabel(f)}`}
          value={counts.error.toLocaleString("fr-FR")}
          tone={counts.error > 0 ? "poor" : "good"}
        />
        <HeroStat
          label="Avertissements"
          value={counts.warn.toLocaleString("fr-FR")}
          tone={counts.warn > 0 ? "warn" : "good"}
        />
        <HeroStat
          label="Total logs"
          value={total.toLocaleString("fr-FR")}
          hint={`pic horaire ${peak.toLocaleString("fr-FR")}`}
        />
        <HeroReading>
          Chaque colonne = une heure, empilée par sévérité (rouge error, ambre warn, gris le reste). Une barre
          rouge qui monte = un incident applicatif à investiguer ; clique une ligne du tableau pour remonter à
          sa trace ou sa session.
        </HeroReading>
      </SupervisionHero>

      {/* Filtres de niveau (préservent app/période via filtersToQuery). */}
      <div className="mb-4 flex flex-wrap gap-2">
        {LEVELS.map((l) => {
          const active = l.key === level;
          const href = `/logs${filtersToQuery(f, l.key !== "all" ? { level: l.key } : {})}`;
          return (
            <Link
              key={l.key}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-accent bg-accent/10 text-accent-deep dark:text-accent"
                  : "border-line bg-panel text-ink-soft hover:border-ink-faint/40"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Heure</th>
              <th className="th">Sévérité</th>
              <th className="th">Source</th>
              <th className="th">Message</th>
              <th className="th">Route</th>
              <th className="th">Corrélation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const bucket = severityBucket(r.severity_num);
              return (
                <tr key={r.id} className="border-t border-line/60 align-top transition hover:bg-panel2/60">
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft tabular-nums">
                    {fmtDate(r.ts)}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${SEV_STYLE[bucket]}`}>
                      {r.severity_text ?? bucket}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{r.source ?? "—"}</td>
                  <td className="max-w-lg px-4 py-2">
                    <span className="line-clamp-2 font-mono text-xs text-ink" title={r.body ?? ""}>
                      {r.body ?? "(vide)"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-ink-faint">
                    {r.route ?? "—"}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-xs">
                    {r.session_id ? (
                      <Link
                        href={`/sessions/${encodeURIComponent(r.session_id)}${filtersToQuery(f)}`}
                        className="font-mono text-brand hover:underline"
                        title="Voir la session"
                      >
                        session
                      </Link>
                    ) : r.trace_id ? (
                      <span className="font-mono text-ink-faint" title={r.trace_id}>
                        {r.trace_id.slice(0, 8)}…
                      </span>
                    ) : (
                      <span className="text-ink-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-ink-faint">
                  Aucun log sur la période. Envoie des logs au format OTLP sur{" "}
                  <code className="chip-mono">/v1/logs</code> (SDK, collecteur, ou backend) pour les voir ici.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
