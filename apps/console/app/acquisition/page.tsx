import { PageHeader } from "@/components/PageHeader";
import type { Channel } from "@/lib/acquisition";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { acquisition } from "@/lib/queries-acquisition";

export const dynamic = "force-dynamic";

const LABEL: Record<Channel, string> = {
  direct: "Direct",
  search: "Recherche",
  social: "Social",
  referral: "Référent",
  internal: "Interne",
};
const DOT: Record<Channel, string> = {
  direct: "bg-slate-400",
  search: "bg-blue-500",
  social: "bg-fuchsia-500",
  referral: "bg-emerald-500",
  internal: "bg-amber-500",
};

export default async function Acquisition({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const rep = await acquisition(f);
  const total = rep.total;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Acquisition"
        sub={
          <>
            D&apos;où viennent les visiteurs — canal d&apos;entrée (direct, recherche, social, référent)
            et sites référents · fenêtre {period.label}
          </>
        }
      />

      {!total ? (
        <div className="card p-8 text-center text-ink-faint">Aucune session sur {period.label}</div>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold text-ink">Par canal</h2>
          <div className="card mb-8 p-4">
            <div className="flex flex-col gap-2">
              {rep.channels.map((c) => {
                const w = total ? (c.sessions / total) * 100 : 0;
                return (
                  <div key={c.channel} className="flex items-center gap-3 text-sm">
                    <span className="flex w-24 shrink-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 rounded-full ${DOT[c.channel]}`} />
                      {LABEL[c.channel]}
                    </span>
                    <div className="h-3 flex-1 overflow-hidden rounded-full bg-panel2">
                      <div className={`h-full rounded-full ${DOT[c.channel]}`} style={{ width: `${w}%` }} />
                    </div>
                    <span className="w-12 text-right tabular-nums text-ink-soft">{Math.round(w)}%</span>
                    <span className="w-16 text-right tabular-nums text-ink-faint">
                      {c.sessions.toLocaleString("fr-FR")}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <h2 className="mb-2 text-sm font-semibold text-ink">Sites référents</h2>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Hôte</th>
                  <th className="th">Canal</th>
                  <th className="th">Sessions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {rep.referrers.map((r) => (
                  <tr key={r.host} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs">{r.host}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
                        <span className={`h-2 w-2 rounded-full ${DOT[r.channel]}`} />
                        {LABEL[r.channel]}
                      </span>
                    </td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">{r.sessions}</td>
                  </tr>
                ))}
                {!rep.referrers.length && (
                  <tr>
                    <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                      Aucun site référent externe (trafic direct/interne)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-ink-faint">
            Note : les paramètres de campagne (UTM) ne sont pas captés (URL nettoyée côté SDK) —
            détection de campagne = évolution SDK à prévoir.
          </p>
        </>
      )}
    </div>
  );
}
