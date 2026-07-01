import { PageHeader } from "@/components/PageHeader";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { apiCalls, backRoutes, slowTraces, traceCoverage } from "@/lib/queries-tracing";
import { Stat } from "@/components/tracing/Stat";
import { Section } from "@/components/tracing/Section";
import { Empty } from "@/components/tracing/Empty";
import { ShareBar } from "@/components/tracing/ShareBar";
import { SlowRow } from "@/components/tracing/SlowRow";
import { fmtMs } from "@/components/tracing/format";

export const dynamic = "force-dynamic";

export default async function Tracing({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const f = parseFilters(await searchParams);
  const period = PERIODS[f.period];
  const [cov, calls, routes, slow] = await Promise.all([
    traceCoverage(f),
    apiCalls(f),
    backRoutes(f),
    slowTraces(f),
  ]);
  const covPct = cov.total ? Math.round((100 * cov.correlated) / cov.total) : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tracing front → back"
        help="tracing"
        sub={
          <>
            Chaque appel API du navigateur est corrélé à son exécution serveur par trace_id (W3C
            traceparent) · fenêtre {period.label}
          </>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Appels API (navigateur)" value={String(cov.total)} testid="trace-front-count" />
        <Stat
          label="Corrélés au backend"
          value={covPct == null ? "—" : `${covPct} %`}
          sub={`${cov.correlated} / ${cov.total}`}
          help="coverage"
          testid="trace-coverage"
        />
        <Stat label="p75 vu du navigateur" value={fmtMs(cov.front_p75)} />
        <Stat label="p75 temps serveur" value={fmtMs(cov.back_p75)} />
      </div>

      <Section
        title="Appels API vus du navigateur"
        sub="Temps total perçu (réseau + proxy + serveur) et part serveur quand le span backend existe"
      >
        <table className="w-full text-sm" data-testid="api-calls">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Appel</th>
              <th className="th">n</th>
              <th className="th">p75 total</th>
              <th className="th">p75 serveur</th>
              <th className="th">Répartition</th>
              <th className="th">Échecs</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const share =
                c.back_p75 != null && Number(c.front_p75) > 0
                  ? Math.min(100, Math.round((100 * Number(c.back_p75)) / Number(c.front_p75)))
                  : null;
              return (
                <tr key={`${c.method} ${c.url}`} className="border-t border-line/60 transition hover:bg-panel2/60">
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className="mr-1.5 rounded bg-panel2 px-1.5 py-0.5 font-semibold text-ink-soft">
                      {c.method}
                    </span>
                    {c.url}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{c.n}</td>
                  <td className="px-4 py-3 font-semibold tabular-nums">{fmtMs(c.front_p75)}</td>
                  <td className="px-4 py-3 tabular-nums">{fmtMs(c.back_p75)}</td>
                  <td className="px-4 py-3">
                    {share == null ? (
                      <span className="text-xs text-ink-faint/60">non corrélé</span>
                    ) : (
                      <ShareBar share={share} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.err > 0 ? (
                      <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {c.err}
                      </span>
                    ) : (
                      <span className="text-ink-faint/60">0</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {!calls.length && <Empty cols={6} msg="Aucun appel API instrumenté sur la fenêtre" />}
          </tbody>
        </table>
      </Section>

      <Section
        title="Routes backend"
        sub="Templates FastAPI, tout trafic confondu (y compris hors navigateur) — erreurs = statuts 5xx"
      >
        <table className="w-full text-sm" data-testid="back-routes">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Route serveur</th>
              <th className="th">n</th>
              <th className="th">p75</th>
              <th className="th">p95</th>
              <th className="th">5xx</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.route} className="border-t border-line/60 transition hover:bg-panel2/60">
                <td className="px-4 py-3 font-mono text-xs">{r.route}</td>
                <td className="px-4 py-3 tabular-nums">{r.n}</td>
                <td className="px-4 py-3 font-semibold tabular-nums">{fmtMs(r.p75)}</td>
                <td className="px-4 py-3 tabular-nums">{fmtMs(r.p95)}</td>
                <td className="px-4 py-3">
                  {r.err > 0 ? (
                    <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium tabular-nums text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                      {r.err}
                    </span>
                  ) : (
                    <span className="text-ink-faint/60">0</span>
                  )}
                </td>
              </tr>
            ))}
            {!routes.length && (
              <Empty cols={5} msg="Aucun span backend reçu — middleware non déployé ou trafic nul" />
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Traces les plus lentes" sub="Décomposition front / serveur / réseau, lien vers la session">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Appel</th>
              <th className="th">Statut</th>
              <th className="th">Total</th>
              <th className="th">Serveur</th>
              <th className="th">Réseau / proxy</th>
              <th className="th">Session</th>
            </tr>
          </thead>
          <tbody>
            {slow.map((t) => (
              <SlowRow key={t.trace_id} t={t} />
            ))}
            {!slow.length && <Empty cols={6} msg="Aucune trace sur la fenêtre" />}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
