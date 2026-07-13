// Page « Carte d'expérience » : le graphe de service front→back (cartographie),
// pondéré par le volume (analyse de flux) et annoté d'une tendance (capacity).
// 100 % lecture sur rum_span/rum_metric — aucune ingestion spécifique.
import { fmtLatency, fmtPct } from "@/components/ai/format";
import { ExperienceMap } from "@/components/map/ExperienceMap";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import {
  apiHealth,
  atRisk,
  layoutGraph,
  pageHealth,
  trend,
  type GEdge,
  type GNode,
  type Health,
} from "@/lib/map";
import { mapEdges, mapNodes, mapPages } from "@/lib/queries-map";
import { parseFilters, periodLabel, type SearchParams } from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

const DOT: Record<Health, string> = { good: "bg-good", warn: "bg-warn", bad: "bg-bad" };
const CAP = 10; // nœuds affichés par colonne

export default async function ExperienceMapPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const f = parseFilters(await searchParams);
  const [nodes, edges, pages] = await Promise.all([mapNodes(f), mapEdges(f), mapPages(f)]);

  const toNode = (r: (typeof nodes)[number]): GNode => {
    const health = apiHealth(r.error_rate ?? 0, r.latency_p75);
    const dir = trend(r.recent, r.older);
    return { id: `${r.tier}:${r.route}`, tier: r.tier, route: r.route, calls: r.calls, health, dir, risk: atRisk(dir, health) };
  };
  const frontAll = nodes.filter((n) => n.tier === "front").map(toNode);
  const backAll = nodes.filter((n) => n.tier === "back").map(toNode);
  const front = frontAll.slice(0, CAP);
  const back = backAll.slice(0, CAP);
  const hidden = Math.max(0, frontAll.length - front.length) + Math.max(0, backAll.length - back.length);

  const gEdges: GEdge[] = edges.map((e) => ({
    from: `front:${e.front_route}`,
    to: `back:${e.back_route}`,
    calls: e.calls,
  }));
  const layout = layoutGraph(front, back, gEdges);

  const riskNodes = [...frontAll, ...backAll].filter((n) => n.risk);
  const talkers = [...frontAll, ...backAll].sort((a, b) => b.calls - a.calls).slice(0, 8);
  const empty = nodes.length === 0;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Carte d'expérience"
        help="experienceMap"
        sub={
          <>
            Le graphe de service vu du navigateur : pages → API → backend, coloré par santé et pondéré
            par le volume · fenêtre {periodLabel(f)}
          </>
        }
      />

      {empty ? (
        <div className="card p-8 text-center text-ink-soft">
          Aucun appel corrélé sur la période — la carte se remplit dès que le tracing front→back émet
          (voir Tracing).
        </div>
      ) : (
        <>
          {riskNodes.length > 0 && (
            <div className="mb-6 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-ink">
              <strong>{riskNodes.length} route(s) en hausse à surveiller</strong> — volume qui grimpe et
              santé déjà dégradée : {riskNodes.slice(0, 4).map((n) => n.route).join(", ")}
              {riskNodes.length > 4 && "…"}
            </div>
          )}

          {/* Hero : le graphe de service (node-link) est le visuel signature. */}
          <SupervisionHero
            layout="wide"
            chartTitle="Graphe de service — pages → API → backend"
            chartMeta={
              <span className="flex items-center gap-3 text-[11px] normal-case tracking-normal">
                <Legend tone="good" label="sain" />
                <Legend tone="warn" label="à surveiller" />
                <Legend tone="bad" label="dégradé" />
                <span className="text-ink-faint">▲ en hausse</span>
              </span>
            }
            chart={
              <div>
                <div className="mb-2 flex gap-x-6 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  <span>Navigateur — API appelées</span>
                  <span>Serveur — routes backend</span>
                </div>
                <ExperienceMap layout={layout} />
                {hidden > 0 && (
                  <p className="mt-2 text-xs text-ink-faint">
                    +{hidden} route(s) moins actives masquées (top {CAP} par colonne affichés).
                  </p>
                )}
              </div>
            }
          >
            <HeroStat
              label="Routes cartographiées"
              value={(frontAll.length + backAll.length).toLocaleString("fr-FR")}
              hint={hidden > 0 ? `${hidden} moins actives masquées` : "toutes affichées"}
            />
            <HeroStat
              label="Routes à risque"
              value={riskNodes.length.toLocaleString("fr-FR")}
              tone={riskNodes.length > 0 ? "warn" : "good"}
              hint="volume en hausse + santé dégradée"
            />
            <HeroStat
              label="Route la plus active"
              value={talkers[0]?.route ?? "—"}
              hint={talkers[0] ? `${talkers[0].calls.toLocaleString("fr-FR")} appels` : undefined}
            />
            <HeroReading>
              Colonne gauche = les API vues du navigateur, colonne droite = les routes serveur ; un ruban relie
              une API à son exécution backend, épaisseur = volume, couleur des nœuds = santé. Suivez un ruban
              épais rouge pour remonter une dégradation. Détail par route ci-dessous.
            </HeroReading>
          </SupervisionHero>

          {/* Top talkers (flux) */}
          <section className="card mt-8 overflow-hidden">
            <div className="border-b border-line bg-panel2 px-4 py-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                Top talkers — routes les plus actives
              </h2>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th text-left">Tier</th>
                  <th className="th text-left">Route</th>
                  <th className="th text-right">Appels</th>
                  <th className="th text-right">Latence p75</th>
                  <th className="th text-right">% erreur</th>
                  <th className="th text-left">Tendance</th>
                </tr>
              </thead>
              <tbody>
                {talkers.map((n) => {
                  const row = nodes.find((r) => `${r.tier}:${r.route}` === n.id)!;
                  return (
                    <tr key={n.id} className="border-t border-line/60">
                      <td className="px-4 py-2 text-ink-faint">{n.tier === "front" ? "navigateur" : "serveur"}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${DOT[n.health]}`} />
                          <span className="chip-mono">{n.route}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{n.calls}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{fmtLatency(row.latency_p75)}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{fmtPct(row.error_rate)}</td>
                      <td className="px-4 py-2 text-ink-soft">
                        {n.dir === "up" ? "▲ en hausse" : n.dir === "down" ? "▼ en baisse" : "— stable"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {/* Pages d'entrée */}
          {pages.length > 0 && (
            <section className="card mt-8 overflow-hidden">
              <div className="border-b border-line bg-panel2 px-4 py-3">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
                  Pages d&apos;entrée — trafic & vitesse perçue
                </h2>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-panel2">
                  <tr>
                    <th className="th text-left">Page</th>
                    <th className="th text-right">Sessions</th>
                    <th className="th text-right">LCP p75</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((p, i) => (
                    <tr key={`${p.route}|${i}`} className="border-t border-line/60">
                      <td className="px-4 py-2">
                        <span className="inline-flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 rounded-full ${DOT[pageHealth(p.lcp_p75)]}`} />
                          <span className="chip-mono">{p.route}</span>
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right font-semibold tabular-nums">{p.sessions}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">{fmtLatency(p.lcp_p75)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function Legend({ tone, label }: { tone: Health; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-soft">
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {label}
    </span>
  );
}
