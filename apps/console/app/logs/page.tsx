// Page « Logs » — supervision du 3e signal OTel (rum_log). Hero = volume horaire
// empilé error/warn/autres + comptes par sévérité ; filtres de niveau ; table des
// derniers logs avec corrélation trace/session. Alimentée par l'ingestion /v1/logs.
import Link from "next/link";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate } from "@/lib/format";
import { parseFilters, periodLabel, filtersToQuery, type SearchParams } from "@/lib/queries-v2";
import {
  logAnomalies,
  logEntries,
  logSeverityCounts,
  logsByRoute,
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
  if (estFermee("/logs")) {
    return (
      <CapaciteFermee
        titre="Logs"
        sujet="Signal LOGS d'OpenTelemetry, alimenté par le serveur et non par le navigateur."
      />
    );
  }

  const sp = await searchParams;
  const f = parseFilters(sp);
  const level = parseLevel(sp?.level);

  const [rows, counts, volume, anomalies, byRoute] = await Promise.all([
    logEntries(f, level),
    logSeverityCounts(f),
    logVolumeByHour(f),
    logAnomalies(f),
    logsByRoute(f),
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
        sub="Logs applicatifs (3ᵉ signal OpenTelemetry) — SDK, extension, backend, syslog — corrélés aux traces."
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

      {/* Anomalies de volume d'erreurs (z-score horaire vs 7 j) — détection auto
          d'un pic anormal, sans seuil manuel. Masqué si aucune anomalie. */}
      {anomalies.length > 0 && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50/70 p-4 dark:border-red-400/30 dark:bg-red-400/5">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-700 dark:text-red-300">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-red-500" />
            Pics d&apos;erreurs anormaux (24 h) · z-score horaire vs moyenne 7 j
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {anomalies.slice(0, 4).map((a, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-ink-soft">
                <span className="font-semibold text-red-700 dark:text-red-300">
                  {a.errors.toLocaleString("fr-FR")} logs error
                </span>
                <span className="text-ink-faint">
                  à {new Date(a.bucket).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-ink-faint">
                  · normal ≈ {a.mean_7d.toLocaleString("fr-FR")} · <strong className="text-red-600 dark:text-red-400">z {a.z_score > 0 ? "+" : ""}{a.z_score}</strong>
                </span>
                {f.app === "all" && <span className="font-mono text-[11px] text-ink-faint">{a.app_id}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

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
                      <Link
                        href={`/tracing/${encodeURIComponent(r.trace_id)}`}
                        className="font-mono text-brand hover:underline"
                        title="Voir la trace (waterfall front → back)"
                      >
                        trace {r.trace_id.slice(0, 8)}…
                      </Link>
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

      {/* Routes les plus bruyantes — métrique dérivée des logs (d'où vient le bruit). */}
      {byRoute.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Routes les plus bruyantes · {periodLabel(f)}
          </h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Route</th>
                  <th className="th text-right">Erreurs</th>
                  <th className="th text-right">Warnings</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {byRoute.map((r, i) => (
                  <tr key={i} className="border-t border-line/60 transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs text-ink">{r.route}</td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-red-600 dark:text-red-400">
                      {r.errors.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-amber-600 dark:text-amber-400">
                      {r.warns.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                      {r.total.toLocaleString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
