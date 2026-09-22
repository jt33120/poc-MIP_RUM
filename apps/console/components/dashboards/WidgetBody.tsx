// Corps d'une carte de tableau de bord : valeur, classement, série, tableau,
// diagnostic ou état vide. Rendu serveur, sauf le graphique (recharts, client).
//
// UNE SÉRIE A TOUJOURS SON ÉQUIVALENT TEXTUEL. Le dessin est décoratif ; la table
// repliée « Alternative textuelle » porte chaque seau et sa valeur exacte, comme
// sur l'Explorer d'événements. Aucun nombre n'est visible au seul pixel près.
import { RankBar } from "@/components/charts/RankBar";
import type { WidgetData } from "@/lib/widget-data";
import { WidgetChart } from "./WidgetChart";

export function WidgetBody({ data }: { data: WidgetData }) {
  if (data.kind === "invalid" || data.kind === "error") {
    return (
      <div role="note" className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-3 text-sm text-ink-soft">
        <p className="font-semibold text-ink">
          {data.kind === "invalid" ? "Configuration illisible" : "Mesure indisponible"}
        </p>
        <p className="mt-1 break-words">{data.reason}</p>
        {data.sub && <p className="mt-1 text-xs text-ink-faint">{data.sub}</p>}
      </div>
    );
  }

  const vide =
    !data.rows?.length && !data.ranks?.length && !data.series?.groups.length && !data.value;
  if (vide) {
    return <p className="py-6 text-center text-sm text-ink-faint">aucune donnée</p>;
  }

  return (
    <div className="min-w-0">
      {data.kind === "value" ? (
        <div className="py-2">
          <div className="text-3xl font-bold tabular-nums text-ink">{data.value ?? "—"}</div>
          {data.sub && <div className="mt-1 text-xs text-ink-soft">{data.sub}</div>}
        </div>
      ) : (
        data.value && <div className="mb-2 text-sm font-medium text-ink-soft">{data.value}</div>
      )}

      {data.kind === "toplist" && data.ranks && (
        <RankBar
          data={data.ranks.map((rang) => ({
            label: rang.label,
            value: rang.value,
            display: rang.display,
            sub: rang.sub,
          }))}
          labelWidth="8rem"
          emptyLabel="Aucun groupe sur la fenêtre."
        />
      )}

      {data.kind === "timeseries" && data.series && (
        <>
          <WidgetChart data={data} />
          <details className="mt-2 text-xs text-ink-soft">
            <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
              Alternative textuelle de la série
            </summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="py-1 text-left">Période</th>
                    {data.series.groups.map((groupe) => (
                      <th key={groupe.label} className="py-1 text-right">
                        {groupe.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.series.buckets.map((seau, i) => (
                    <tr key={seau} className="border-t border-line/60">
                      <td className="py-1">{seau}</td>
                      {data.series!.groups.map((groupe) => (
                        <td key={groupe.label} className="py-1 text-right tabular-nums">
                          {/* Seau sans mesure : « — », comme le trou de la courbe (CE1). */}
                          {groupe.values[i] == null ? "—" : groupe.values[i]!.toLocaleString("fr-FR")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}

      {data.kind === "table" && data.columns?.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                {data.columns.map((c) => (
                  <th key={c} scope="col" className="th text-left">
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

      {data.notes?.map((note) => (
        <p key={note} role="note" className="mt-2 text-xs text-ink-faint">
          {note}
        </p>
      ))}
    </div>
  );
}
