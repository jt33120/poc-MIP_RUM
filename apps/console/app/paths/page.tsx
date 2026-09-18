import { FunnelChart, StepPicker } from "@/components/Funnel";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Sankey } from "@/components/Sankey";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { PERIODS } from "@/lib/filters";
import { availableEvents, funnelReport } from "@/lib/queries-funnel";
import { entryExitRoutes, routeTransitions } from "@/lib/queries-paths";
import { buildSankey } from "@/lib/sankey";

export const dynamic = "force-dynamic";

export default async function Paths({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/paths");
  if (!ecran.ok) return <FilterProblemNotice title="Parcours" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = PERIODS[f.period];
  // Lot 6c : étapes du funnel depuis s1..s4 (form GET), ordonnées, vides ignorées.
  const steps = [1, 2, 3, 4]
    .map((i) => (typeof sp[`s${i}`] === "string" ? (sp[`s${i}`] as string) : ""))
    .filter(Boolean);
  const [transitions, { entries, exits }, events, funnel] = await Promise.all([
    routeTransitions(f),
    entryExitRoutes(f),
    availableEvents(f),
    steps.length >= 2 ? funnelReport(f, steps) : Promise.resolve([]),
  ]);
  const maxT = transitions[0]?.n ?? 0;
  // Lot 6b : flux Sankey (source -> cible) construit sur les mêmes transitions.
  const sankey = buildSankey(
    transitions.map((t) => ({ from: t.from_route, to: t.to_route, count: t.n })),
  );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Parcours"
        sub="Comment les visiteurs circulent entre les routes — pages d'entrée et de sortie, transitions les plus fréquentes (recharges exclues)."
      />

      {/* Hero : le flux de navigation (Sankey) est le graphe signature de la page. */}
      <SupervisionHero
        layout="wide"
        chartTitle="Flux de navigation — route → route"
        chartMeta={
          sankey.totalFlow > sankey.shownFlow ? (
            <span className="text-[11px] text-ink-faint">
              top routes · {sankey.shownFlow} / {sankey.totalFlow} transitions affichées
            </span>
          ) : undefined
        }
        chart={
          transitions.length ? (
            <Sankey model={sankey} />
          ) : (
            <p className="py-12 text-center text-sm text-ink-faint">
              Aucune transition sur {period.label} (il faut ≥ 2 pages vues par session).
            </p>
          )
        }
      >
        <HeroStat label="Page d'entrée n°1" value={entries[0]?.route ?? "—"} hint={entries[0] ? `${entries[0].n} sessions y démarrent` : undefined} />
        <HeroStat label="Page de sortie n°1" value={exits[0]?.route ?? "—"} hint={exits[0] ? `${exits[0].n} sessions s'y terminent` : undefined} />
        <HeroStat label="Transitions distinctes" value={transitions.length.toLocaleString("fr-FR")} hint="paires route → route (recharges exclues)" />
        <HeroReading>
          Chaque ruban relie une route source à une route cible, son épaisseur = le volume de passages. Les
          chemins épais = les autoroutes du produit ; un ruban inattendu = un contournement à comprendre.
          Entrées/sorties détaillées et transitions exactes ci-dessous.
        </HeroReading>
      </SupervisionHero>

      {/* Entrées / sorties : où commencent et se terminent les sessions. */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <BoundaryCard title="Pages d'entrée" hint="1re route de la session" rows={entries} />
        <BoundaryCard title="Pages de sortie" hint="dernière route de la session" rows={exits} />
      </div>

      {/* Transitions route → route (arêtes du graphe de navigation). */}
      <h2 className="mb-2 text-sm font-semibold text-ink">Transitions les plus fréquentes</h2>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">De</th>
              <th className="th">Vers</th>
              <th className="th w-40">Volume</th>
            </tr>
          </thead>
          <tbody>
            {transitions.map((t) => (
              <tr
                key={`${t.from_route}→${t.to_route}`}
                className="border-t border-line/60 transition hover:bg-panel2/60"
              >
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{t.from_route}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink">
                  <span className="mr-1 text-accent/70">→</span>
                  {t.to_route}
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{ width: `${maxT ? Math.max(3, (t.n / maxT) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="w-10 text-right text-xs tabular-nums text-ink-soft">{t.n}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!transitions.length && (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-ink-faint">
                  Aucune transition sur {period.label} (il faut ≥ 2 pages vues par session)
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Entonnoir de conversion (Lot 6c) sur événements custom (rum_event). */}
      <section className="mt-8">
        <h2 className="mb-1 text-sm font-semibold text-ink">Entonnoir de conversion</h2>
        <p className="mb-3 text-xs text-ink-faint">
          Choisis 2 à 4 événements custom dans l&apos;ordre : conversion et abandon à chaque étape,
          par session (ordre temporel respecté).
        </p>
        <div className="card p-4">
          {events.length ? (
            <StepPicker events={events} selected={steps} sp={sp} />
          ) : (
            <p className="text-sm text-ink-faint">
              Aucun événement custom sur {period.label}. Émets-en via{" "}
              <code className="chip-mono">MIPRum.track(&quot;nom&quot;)</code> pour construire un entonnoir.
            </p>
          )}
          {funnel.length > 0 && <FunnelChart steps={funnel} />}
          {steps.length >= 2 && funnel.length > 0 && funnel[0].reached === 0 && (
            <p className="mt-3 text-xs text-ink-faint">
              Aucune session n&apos;a réalisé l&apos;étape 1 sur {period.label}.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function BoundaryCard({
  title,
  hint,
  rows,
}: {
  title: string;
  hint: string;
  rows: { route: string; n: number }[];
}) {
  const total = rows.reduce((acc, r) => acc + r.n, 0);
  return (
    <div className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <span className="text-[11px] text-ink-faint">{hint}</span>
      </div>
      <div className="flex flex-col gap-1.5">
        {rows.map((r) => {
          const pct = total ? Math.round((r.n / total) * 100) : 0;
          return (
            <div key={r.route} className="flex items-center gap-2 text-xs">
              <span className="w-14 shrink-0 text-right tabular-nums text-ink-soft">{pct}%</span>
              <span className="flex-1 truncate font-mono text-ink" title={r.route}>
                {r.route}
              </span>
              <span className="w-10 text-right tabular-nums text-ink-faint">{r.n}</span>
            </div>
          );
        })}
        {!rows.length && <p className="py-4 text-center text-ink-faint">Aucune donnée</p>}
      </div>
    </div>
  );
}
