import Link from "next/link";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import {
  apiCalls,
  backRoutes,
  slowTraces,
  traceCoverage,
  type SlowTrace,
} from "@/lib/queries-tracing";

export const dynamic = "force-dynamic";

const fmtMs = (v: number | null | undefined) =>
  v == null ? "—" : `${Math.round(Number(v))} ms`;

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
    <div>
      <h1 className="mb-1 text-2xl font-bold">Tracing front → back</h1>
      <p className="mb-6 text-sm text-slate-500">
        Chaque appel API du navigateur est corrélé à son exécution serveur par trace_id (W3C
        traceparent) · fenêtre {period.label}
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat label="Appels API (navigateur)" value={String(cov.total)} testid="trace-front-count" />
        <Stat
          label="Corrélés au backend"
          value={covPct == null ? "—" : `${covPct} %`}
          sub={`${cov.correlated} / ${cov.total}`}
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
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Appel</th>
              <th className="px-4 py-3">n</th>
              <th className="px-4 py-3">p75 total</th>
              <th className="px-4 py-3">p75 serveur</th>
              <th className="px-4 py-3">Répartition</th>
              <th className="px-4 py-3">Échecs</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((c) => {
              const share =
                c.back_p75 != null && Number(c.front_p75) > 0
                  ? Math.min(100, Math.round((100 * Number(c.back_p75)) / Number(c.front_p75)))
                  : null;
              return (
                <tr key={`${c.method} ${c.url}`} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-mono text-xs">
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{c.method}</span>
                    {c.url}
                  </td>
                  <td className="px-4 py-3">{c.n}</td>
                  <td className="px-4 py-3 font-semibold">{fmtMs(c.front_p75)}</td>
                  <td className="px-4 py-3">{fmtMs(c.back_p75)}</td>
                  <td className="px-4 py-3">
                    {share == null ? (
                      <span className="text-xs text-slate-300">non corrélé</span>
                    ) : (
                      <ShareBar share={share} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {c.err > 0 ? (
                      <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                        {c.err}
                      </span>
                    ) : (
                      <span className="text-slate-300">0</span>
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
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Route serveur</th>
              <th className="px-4 py-3">n</th>
              <th className="px-4 py-3">p75</th>
              <th className="px-4 py-3">p95</th>
              <th className="px-4 py-3">5xx</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((r) => (
              <tr key={r.route} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs">{r.route}</td>
                <td className="px-4 py-3">{r.n}</td>
                <td className="px-4 py-3 font-semibold">{fmtMs(r.p75)}</td>
                <td className="px-4 py-3">{fmtMs(r.p95)}</td>
                <td className="px-4 py-3">
                  {r.err > 0 ? (
                    <span className="rounded border border-red-300 bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800">
                      {r.err}
                    </span>
                  ) : (
                    <span className="text-slate-300">0</span>
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
          <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-3">Appel</th>
              <th className="px-4 py-3">Statut</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3">Serveur</th>
              <th className="px-4 py-3">Réseau / proxy</th>
              <th className="px-4 py-3">Session</th>
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

function SlowRow({ t }: { t: SlowTrace }) {
  const bad = (t.front_status ?? 0) >= 400 || (t.front_status ?? 0) === 0;
  return (
    <tr className="border-t border-slate-100">
      <td className="px-4 py-3 font-mono text-xs">
        <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 font-semibold">{t.method}</span>
        {t.url}
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-medium ${
            bad ? "border-red-300 bg-red-100 text-red-800" : "border-emerald-300 bg-emerald-100 text-emerald-800"
          }`}
        >
          {t.front_status || "réseau"}
        </span>
      </td>
      <td className="px-4 py-3 font-semibold">{fmtMs(t.front_ms)}</td>
      <td className="px-4 py-3">{fmtMs(t.back_ms)}</td>
      <td className="px-4 py-3">{fmtMs(t.network_ms)}</td>
      <td className="px-4 py-3">
        {t.session_id ? (
          <Link href={`/sessions/${t.session_id}`} className="font-mono text-xs text-blue-600 hover:underline">
            {t.session_id.slice(0, 8)}…
          </Link>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
    </tr>
  );
}

function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded bg-blue-100" title={`${share}% serveur`}>
        <span className="block h-full bg-blue-600" style={{ width: `${share}%` }} />
      </span>
      <span className="text-xs text-slate-500">{share}% serveur</span>
    </span>
  );
}

function Section({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h2 className="mb-1 text-lg font-semibold">{title}</h2>
      <p className="mb-3 text-xs text-slate-500">{sub}</p>
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">{children}</div>
    </div>
  );
}

function Stat({ label, value, sub, testid }: { label: string; value: string; sub?: string; testid?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm" data-testid={testid}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}

function Empty({ cols, msg }: { cols: number; msg: string }) {
  return (
    <tr>
      <td colSpan={cols} className="px-4 py-8 text-center text-sm text-slate-400">
        {msg}
      </td>
    </tr>
  );
}
