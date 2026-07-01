// Corps d'un widget de tableau de bord : valeur unique, tableau, ou état vide.
// Rendu 100 % serveur (aucune interactivité). Extrait de app/dashboards/[id]/page.tsx.
import type { WidgetData } from "@/lib/widget-data";

export function WidgetBody({ data }: { data: WidgetData }) {
  const empty = !data.rows?.length && !data.value;
  if (empty) {
    return <p className="py-6 text-center text-sm text-ink-faint">aucune donnée</p>;
  }

  if (data.kind === "value") {
    return (
      <div className="py-2">
        <div className="text-3xl font-bold tabular-nums text-ink">{data.value ?? "—"}</div>
        {data.sub && <div className="mt-1 text-xs text-ink-soft">{data.sub}</div>}
      </div>
    );
  }

  return (
    <div>
      {data.value && <div className="mb-2 text-sm font-medium text-ink-soft">{data.value}</div>}
      {data.columns?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <th key={c} className="th text-left">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.rows ?? []).map((row, ri) => (
                <tr key={ri} className="border-t border-line/60">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 tabular-nums">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
