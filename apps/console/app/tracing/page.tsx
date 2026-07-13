import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { PERIODS, parseFilters, type SearchParams } from "@/lib/filters";
import { apiCalls, backRoutes, slowTraces, traceCoverage } from "@/lib/queries-tracing";
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

      {(() => {
        // Hero : décomposition de la latence perçue par appel — part serveur
        // (bleu) vs réseau/proxy (ambre). Fait ressortir où se perd le temps.
        const ranked = [...calls].sort((a, b) => Number(b.front_p75) - Number(a.front_p75)).slice(0, 8);
        const data = ranked.map((c) => {
          const front = Number(c.front_p75);
          const back = c.back_p75 != null ? Number(c.back_p75) : null;
          const segments =
            back != null
              ? [
                  { value: back, color: "#2563eb", label: `serveur ${fmtMs(back)}` },
                  { value: Math.max(0, front - back), color: "#f59e0b", label: `réseau/proxy ${fmtMs(front - back)}` },
                ]
              : [{ value: front, color: "#94a3b8", label: "non corrélé au backend" }];
          return {
            label: `${c.method} ${c.url}`,
            value: front,
            display: fmtMs(front),
            segments,
            sub: c.err > 0 ? `${c.err} échec(s)` : undefined,
            title: `${c.method} ${c.url} — total ${fmtMs(front)}`,
          };
        });
        return (
          <SupervisionHero
            chartTitle="Latence par appel API — serveur vs réseau"
            chartHelp="coverage"
            chartMeta={
              <span className="flex items-center gap-3 text-[11px] text-ink-faint">
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#2563eb" }} />serveur</span>
                <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: "#f59e0b" }} />réseau/proxy</span>
              </span>
            }
            chart={
              data.length ? (
                <RankBar data={data} labelWidth="14rem" />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Aucun appel API instrumenté sur {period.label}.</p>
              )
            }
          >
            <HeroStat
              label="Appels API (navigateur)"
              value={<span data-testid="trace-front-count">{cov.total.toLocaleString("fr-FR")}</span>}
            />
            <HeroStat
              label="Corrélés au backend"
              value={<span data-testid="trace-coverage">{covPct == null ? "—" : `${covPct} %`}</span>}
              tone={covPct == null ? "neutral" : covPct >= 80 ? "good" : covPct >= 50 ? "warn" : "poor"}
              hint={`${cov.correlated} / ${cov.total} appels`}
            />
            <HeroStat label="p75 navigateur" value={fmtMs(cov.front_p75)} hint={`serveur : ${fmtMs(cov.back_p75)}`} />
            <HeroReading>
              Chaque barre = un appel : la portion bleue est le temps passé sur le serveur, l&apos;ambre le
              réseau/proxy (front − back). Une barre à dominante ambre = latence côté transport, pas côté code.
              Détail appel par appel et traces les plus lentes ci-dessous.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

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
