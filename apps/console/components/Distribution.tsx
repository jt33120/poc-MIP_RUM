// Percentiles & distribution — rendu (serveur, SVG déterministe, sans lib graphe).
// Ce que le p75 masque : la longue traîne (p90/p95/p99) et la forme de la
// distribution. Coloration par seuils 2026 (bon / à améliorer / mauvais).
import {
  histogramBins,
  labelPercentiles,
  maxCount,
  PCT_LABELS,
  totalCount,
} from "@/lib/distribution";
import { fmtVital } from "@/lib/format";
import type { HistoRow, VitalPercentiles } from "@/lib/queries";
import { RATING_CLASS, rating2026 } from "@/lib/rating";

const VITAL_ORDER = ["LCP", "INP", "CLS", "FCP", "TTFB"];
const RATING_FILL: Record<string, string> = {
  good: "#059669",
  "needs-improvement": "#d97706",
  poor: "#dc2626",
};

/** Table p50 → p99 par vital (colorée par rating). */
export function PercentileTable({ rows }: { rows: VitalPercentiles[] }) {
  const byName = new Map(rows.map((r) => [r.name, r]));
  const present = VITAL_ORDER.filter((n) => byName.has(n));
  if (!present.length) return null;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-panel2">
          <tr>
            <th className="th">Vital</th>
            {PCT_LABELS.map((p) => (
              <th key={p} className="th" title={pctHelp(p)}>
                {p}
              </th>
            ))}
            <th className="th">mesures</th>
          </tr>
        </thead>
        <tbody>
          {present.map((name) => {
            const r = byName.get(name)!;
            const cells = labelPercentiles(r.pcts);
            return (
              <tr key={name} className="border-t border-line/60">
                <td className="px-4 py-2.5 font-semibold text-ink">{name}</td>
                {cells.map((c) => {
                  const rating = c.value != null ? rating2026(name, c.value) : null;
                  return (
                    <td key={c.label} className="px-4 py-2.5">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${
                          rating ? RATING_CLASS[rating] : "text-ink-faint/60"
                        }`}
                      >
                        {fmtVital(name, c.value)}
                      </span>
                    </td>
                  );
                })}
                <td className="px-4 py-2.5 tabular-nums text-ink-soft">
                  {r.n.toLocaleString("fr-FR")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function pctHelp(p: string): string {
  const map: Record<string, string> = {
    p50: "médiane — la moitié des vues font mieux",
    p75: "seuil Core Web Vitals de référence",
    p90: "les 10 % les plus lents",
    p95: "les 5 % les plus lents",
    p99: "longue traîne — le 1 % le plus lent",
  };
  return map[p] ?? p;
}

/** Histogramme d'un vital sur [0, cap], barres colorées par rating de la tranche. */
export function Histogram({ name, rows, cap }: { name: string; rows: HistoRow[]; cap: number }) {
  const bins = histogramBins(rows, cap);
  const max = maxCount(bins);
  const total = totalCount(bins);
  const W = 320;
  const H = 92;
  const PADB = 16; // place pour les libellés d'axe
  const n = bins.length;
  const bw = W / n;
  const barH = (c: number) => (max ? (c / max) * (H - PADB - 4) : 0);

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Distribution {name}
        </span>
        <span className="text-[11px] tabular-nums text-ink-faint">
          {total.toLocaleString("fr-FR")} mesures
        </span>
      </div>
      {total === 0 ? (
        <div className="flex h-[92px] items-center justify-center text-xs text-ink-faint">
          pas de mesure sur la fenêtre
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Distribution de ${name}`}>
          {bins.map((b, i) => {
            const mid = (b.from + b.to) / 2;
            const rating = rating2026(name, mid);
            const h = barH(b.count);
            return (
              <rect
                key={i}
                x={i * bw + 0.5}
                y={H - PADB - h}
                width={Math.max(bw - 1, 0.5)}
                height={h}
                rx={0.5}
                fill={rating ? RATING_FILL[rating] : "#94a3b8"}
                opacity={0.85}
              >
                <title>
                  {`${fmtVital(name, b.from)} – ${fmtVital(name, b.to)} : ${b.count}`}
                </title>
              </rect>
            );
          })}
          {[0, 0.5, 1].map((t) => (
            <text
              key={t}
              x={t * W}
              y={H - 4}
              fontSize={8}
              fill="currentColor"
              textAnchor={t === 0 ? "start" : t === 1 ? "end" : "middle"}
              className="text-ink-faint"
            >
              {t === 1 ? `≥ ${fmtVital(name, cap)}` : fmtVital(name, t * cap)}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
}
