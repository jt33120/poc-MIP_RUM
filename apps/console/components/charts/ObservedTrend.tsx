// Série observée dans le temps : histogramme compact ET table équivalente. Extrait
// de l'Explorer d'événements (P4) pour que le détail d'erreur (P5.1) dise ses
// seaux de la même façon. Rendu 100 % serveur, sans lib.
//
// Les barres sont décoratives (aria-hidden) : la seule lecture accessible est la
// table repliée « Alternative textuelle de la série », qui donne chaque seau et
// sa valeur exacte. Une barre ne porte aucun nombre qu'on ne retrouve pas là.
import { fmtDate } from "@/lib/format";

export interface ObservedTrendRow {
  bucket: Date;
  value: number;
}

export function ObservedTrend({
  title,
  rows,
  valueLabel,
}: {
  title: string;
  rows: ObservedTrendRow[];
  /** En-tête de la colonne des valeurs dans l'alternative textuelle. */
  valueLabel: string;
}) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  // La légende nomme la figure : pas d'identifiant à inventer, deux séries
  // peuvent cohabiter sur une page.
  return (
    <figure className="card p-4">
      <figcaption className="text-sm font-semibold text-ink">{title}</figcaption>
      <div className="mt-4 flex h-36 items-end gap-1" aria-hidden="true">
        {rows.map((row) => (
          <div
            key={new Date(row.bucket).toISOString()}
            className="min-w-1 flex-1 rounded-t bg-perf/80"
            style={{ height: `${Math.max(2, (row.value / max) * 100)}%` }}
            title={`${fmtDate(row.bucket)} · ${row.value}`}
          />
        ))}
      </div>
      <details className="mt-3 text-xs text-ink-soft">
        <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
          Alternative textuelle de la série
        </summary>
        <table className="mt-2 w-full">
          <thead><tr><th className="py-1 text-left">Période</th><th className="py-1 text-right">{valueLabel}</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={new Date(row.bucket).toISOString()} className="border-t border-line/60">
                <td className="py-1">{fmtDate(row.bucket)}</td>
                <td className="py-1 text-right tabular-nums">{row.value.toLocaleString("fr-FR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
