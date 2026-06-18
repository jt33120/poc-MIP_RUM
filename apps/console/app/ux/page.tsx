import { PageHeader } from "@/components/PageHeader";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { fmtVital } from "@/lib/format";
import { inpOffenders, topFrustrations } from "@/lib/queries-frustration";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

export const dynamic = "force-dynamic";

/** Signaux de frustration (P1) : rage/dead clicks + éléments lents à l'INP. */
export default async function UxFrustration({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const [signals, inp] = await Promise.all([topFrustrations(f), inpOffenders(f)]);

  const rage = signals.filter((s) => s.kind === "rage").reduce((n, s) => n + s.n, 0);
  const dead = signals.filter((s) => s.kind === "dead").reduce((n, s) => n + s.n, 0);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Frustration UX"
        sub={
          <>
            Rage clicks &amp; dead clicks · élément responsable des interactions lentes (attribution INP) · fenêtre{" "}
            {period.label}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-4 sm:max-w-md">
        <Stat label="Rage clicks" value={rage} tone="text-red-600 dark:text-red-400" />
        <Stat label="Dead clicks" value={dead} tone="text-amber-600 dark:text-amber-400" />
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">Signaux de frustration</h2>
      <div className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Type</th>
              <th className="th">Cible</th>
              <th className="th">Route</th>
              <th className="th text-right">Occurrences</th>
            </tr>
          </thead>
          <tbody>
            {signals.map((s) => (
              <tr key={`${s.kind}-${s.route}-${s.target}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className="px-4 py-2">
                  <KindChip kind={s.kind} />
                </td>
                <td className="px-4 py-2 font-medium text-ink">{s.target}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{s.route}</td>
                <td className="px-4 py-2 text-right tabular-nums">{s.n.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
            {!signals.length && <Empty cols={4} period={period.label} />}
          </tbody>
        </table>
      </div>

      <h2 className="mb-2 text-sm font-semibold text-ink">
        Interactions lentes — éléments responsables (attribution INP)
      </h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Élément (interactionTarget)</th>
              <th className="th text-right">Interactions</th>
              <th className="th text-right">INP p75</th>
              <th className="th text-right">Pire</th>
            </tr>
          </thead>
          <tbody>
            {inp.map((o) => (
              <tr key={o.target} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-mono text-xs text-ink" title={o.target}>
                  {o.target}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{o.n.toLocaleString("fr-FR")}</td>
                <td className="px-4 py-2 text-right"><InpCell v={o.p75} /></td>
                <td className="px-4 py-2 text-right"><InpCell v={o.worst} /></td>
              </tr>
            ))}
            {!inp.length && <Empty cols={4} period={period.label} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-0.5 text-2xl font-bold tabular-nums ${tone}`}>{value.toLocaleString("fr-FR")}</div>
    </div>
  );
}

function KindChip({ kind }: { kind: "rage" | "dead" }) {
  const cls =
    kind === "rage"
      ? "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
      : "border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>
      {kind === "rage" ? "rage" : "dead"}
    </span>
  );
}

function InpCell({ v }: { v: number | null }) {
  if (v == null) return <span className="text-ink-faint/60">—</span>;
  const rating = rating2026("INP", Number(v));
  return (
    <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${rating ? RATING_CLASS[rating] : ""}`}>
      {fmtVital("INP", Number(v))}
    </span>
  );
}

function Empty({ cols, period }: { cols: number; period: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-ink-faint">
        Aucun signal sur {period}
      </td>
    </tr>
  );
}
