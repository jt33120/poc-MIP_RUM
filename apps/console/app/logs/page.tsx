// Page « Logs » — supervision du 3e signal OTel (rum_log). Hero = volume horaire
// empilé error/warn/autres + comptes par sévérité ; filtres de niveau ; table des
// derniers logs avec corrélation trace/session. Alimentée par l'ingestion /v1/logs.
import Link from "next/link";
import { ECRANS } from "@mip/console-contract";
import { CapaciteFermee, estFermee } from "@/components/CapaciteFermee";
import { PageHeader } from "@/components/PageHeader";
import { TableDefilante } from "@/components/TableDefilante";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate, fmtHeure, pluriel } from "@/lib/format";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { chargerLogs } from "@/lib/chargeurs/logs";
import { chargerEcran } from "@/lib/ecran";
import { hrefWithQuery } from "@/lib/query-contract";
import { severityBucket, type LevelKey } from "@/lib/queries-logs";

export const dynamic = "force-dynamic";

// Libellés en français (recette du 26/09/2026 : « Info+ », « Warn+ », « Error+ »
// étaient les noms des niveaux OpenTelemetry). Un niveau inclut les plus graves.
const LEVELS: { key: LevelKey; label: string }[] = [
  { key: "all", label: "Tous les niveaux" },
  { key: "info", label: "Info et plus grave" },
  { key: "warn", label: "Avertissement et plus grave" },
  { key: "error", label: "Erreur et plus grave" },
];

/** Nom d'un niveau quand le journal n'en porte pas lui-même (`severity_text` absent). */
const LIBELLE_GRAVITE: Record<string, string> = { error: "Erreur", warn: "Avertissement", info: "Info", debug: "Débogage" };

// Teintes par bucket de sévérité (badge + série du hero).
const SEV_STYLE: Record<string, string> = {
  error: "border-bad/30 bg-bad/10 text-bad-ink",
  warn: "border-warn/30 bg-warn/10 text-warn-ink",
  info: "border-sky-300 bg-sky-100 text-sky-800 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300",
  debug: "border-line bg-panel2 text-ink-faint",
};

export default async function Logs({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  if (estFermee("/logs")) {
    return (
      <CapaciteFermee
        titre="Logs"
        sujet="Les journaux envoyés par vos serveurs, et non par le navigateur des visiteurs."
      />
    );
  }

  // Le chargeur (`lib/chargeurs/logs.ts`) lit les entrées, les comptes, le volume et les anomalies.
  const ecran = await chargerEcran(ECRANS.logs, chargerLogs, (await searchParams) ?? {});
  if (ecran.etat === "fermee") {
    return <CapaciteFermee titre="Logs" sujet="Les journaux envoyés par vos serveurs, et non par le navigateur des visiteurs." />;
  }
  if (ecran.etat === "refus") return <FilterProblemNotice title="Logs" problem={ecran.problem} />;
  const { level, rows, counts, volume, anomalies, byRoute, periode } = ecran;
  const f = { app: ecran.app };

  const total = counts.error + counts.warn + counts.info + counts.debug;
  const now = Date.now();
  const stackData = Array.from({ length: 24 }, (_v, i) => {
    const t = new Date(now - (23 - i) * 3_600_000);
    return {
      // Heure de Paris : `toLocaleTimeString` sans fuseau prenait celui du serveur (UTC).
      h: `${fmtHeure(t).slice(0, 2)} h`,
      error: volume.error[i] ?? 0,
      warn: volume.warn[i] ?? 0,
      autres: volume.other[i] ?? 0,
    };
  });
  const series: StackSeries[] = [
    { key: "error", name: "Erreurs", color: "#ef4444" },
    { key: "warn", name: "Avertissements", color: "#f59e0b" },
    { key: "autres", name: "Autres", color: "#94a3b8" },
  ];
  const peak = stackData.reduce((mx, r) => Math.max(mx, r.error + r.warn + r.autres), 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Logs"
        sub="Les journaux de vos serveurs et de vos applications, rattachés aux sessions et aux traces."
      />

      <SupervisionHero
        chartTitle="Journaux par heure sur 24 h, par gravité"
        chart={
          total ? (
            <StackedBars data={stackData} xKey="h" series={series} yUnit="" />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">Aucun journal sur la période.</p>
          )
        }
      >
        {/* Des comptes, pas des verdicts : aucun seuil publié, donc aucune couleur
            (un volume n'est ni vert ni rouge, recette du 26/09/2026). */}
        <HeroStat label={`Erreurs · ${periode}`} value={counts.error.toLocaleString("fr-FR")} />
        <HeroStat label="Avertissements" value={counts.warn.toLocaleString("fr-FR")} />
        <HeroStat
          label="Tous niveaux"
          value={total.toLocaleString("fr-FR")}
          hint={`au plus ${pluriel(peak, "journal", "journaux")} en une heure`}
        />
        <HeroReading>
          Chaque colonne est une heure, empilée par gravité : rouge pour les erreurs, ambre pour les avertissements,
          gris pour le reste. Une colonne rouge qui monte signale un incident ; le lien de chaque ligne du tableau
          ouvre sa session ou sa trace.
        </HeroReading>
      </SupervisionHero>

      {/* Anomalies de volume d'erreurs (z-score horaire vs 7 j) — détection auto
          d'un pic anormal, sans seuil manuel. Masqué si aucune anomalie. Le z-score
          est la méthode : il passe dans l'infobulle, pas avant le chiffre. */}
      {anomalies.length > 0 && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-bad-ink">
            <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-bad" />
            Pics d&apos;erreurs inhabituels sur 24 h, comparés aux 7 derniers jours
          </div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {anomalies.slice(0, 4).map((a, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-x-2 text-ink-soft"
                title={`Écart à la moyenne horaire des 7 derniers jours : ${a.z_score.toLocaleString("fr-FR")} écarts-types`}
              >
                <span className="font-semibold text-bad-ink">{pluriel(a.errors, "erreur")}</span>
                <span className="text-ink-faint">à {fmtHeure(a.bucket)}</span>
                <span className="text-ink-faint">· d&apos;habitude ≈ {a.mean_7d.toLocaleString("fr-FR")} par heure</span>
                {f.app === "all" && <span className="font-mono text-[11px] text-ink-faint">{a.app_id}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filtres de niveau : le contexte global (app, période, segment) suit le lien. */}
      <div className="mb-4 flex flex-wrap gap-2">
        {LEVELS.map((l) => {
          const active = l.key === level;
          const href = hrefWithQuery("/logs", ecran.query, { level: l.key === "all" ? null : l.key });
          return (
            <Link
              key={l.key}
              href={href}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                active
                  ? "border-accent bg-accent/10 text-accent-ink"
                  : "border-line bg-panel text-ink-soft hover:border-ink-faint/40"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      {/* Défilant et signalé : `overflow-hidden` coupait Route et Corrélation (les
          liens vers la session et la trace) sur petit écran. */}
      <TableDefilante className="card" label="Derniers logs">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Heure</th>
              <th className="th">Gravité</th>
              <th className="th">Source</th>
              <th className="th">Message</th>
              <th className="th">Route</th>
              <th className="th">Session ou trace</th>
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
                      {r.severity_text ?? LIBELLE_GRAVITE[bucket] ?? bucket}
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
                        href={hrefWithQuery(`/sessions/${encodeURIComponent(r.session_id)}`, ecran.query)}
                        className="font-mono text-brand hover:underline"
                        title="Voir la session"
                      >
                        Session
                      </Link>
                    ) : r.trace_id ? (
                      <Link
                        href={hrefWithQuery(`/tracing/${encodeURIComponent(r.trace_id)}`, ecran.query)}
                        className="font-mono text-brand hover:underline"
                        title="Voir la trace, du navigateur au serveur"
                      >
                        Trace {r.trace_id.slice(0, 8)}…
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
                  Aucun journal sur la période. Pour les voir ici, envoyez les journaux de vos serveurs au format
                  OpenTelemetry sur <code className="chip-mono">/v1/logs</code>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableDefilante>

      {/* Routes qui produisent le plus de journaux — métrique dérivée des logs (d'où vient le bruit). */}
      {byRoute.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Routes qui produisent le plus de journaux · {periode}
          </h2>
          <TableDefilante className="card" label="Routes qui produisent le plus de journaux">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Route</th>
                  <th className="th text-right">Erreurs</th>
                  <th className="th text-right">Avertissements</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {byRoute.map((r, i) => (
                  <tr key={i} className="border-t border-line/60 transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs text-ink">{r.route}</td>
                    {/* Comptes neutres : l'en-tête dit la gravité, la couleur n'ajoute rien. */}
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-ink">
                      {r.errors.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink">
                      {r.warns.toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
                      {r.total.toLocaleString("fr-FR")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableDefilante>
        </div>
      )}
    </div>
  );
}
