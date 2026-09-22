import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import { type SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import {
  ACTIONS_MAX_OFFSET,
  actionsDisponible,
  hasNextActionsPage,
  parseActionsPage,
  topActions,
  topActionsSummary,
} from "@/lib/queries-actions";

export const dynamic = "force-dynamic";

const SOUS_TITRE =
  "Interactions qui déclenchent le plus d’erreurs ou de temps réseau. La corrélation est heuristique, bornée à 5 secondes et figée au départ de chaque effet.";

export default async function ActionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  // Le périmètre signé est appliqué avant même de construire le SQL : demander
  // explicitement ?app=B hors de sa liste est refusé, jamais rabattu sur A.
  const ecran = await pageFilters(sp, "/actions");
  if (!ecran.ok) return <FilterProblemNotice title="Actions" problem={ecran.problem} />;
  const f = ecran.filters;
  const url = new URLSearchParams(
    Object.entries(sp).flatMap(([key, value]) => typeof value === "string" ? [[key, value] as [string, string]] : []),
  );
  const page = parseActionsPage(url);
  // Sans la table, les deux lectures rendraient des zéros : on ne les lance pas, et
  // l'écran dit « Non collecté » plutôt que « 0 action », qui serait un vide réel.
  if (!(await actionsDisponible())) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Actions" sub={SOUS_TITRE} />
        <div className="card px-4 py-10 text-center text-sm text-ink-soft" data-testid="actions-non-collecte">
          Non collecté : la table des actions n&apos;existe pas sur ce déploiement
        </div>
      </div>
    );
  }
  const [rows, summary] = await Promise.all([topActions(f, page), topActionsSummary(f)]);

  const href = (offset: number) => {
    const next = new URLSearchParams(url);
    if (offset > 0) next.set("offset", String(offset));
    else next.delete("offset");
    return `/actions${next.size ? `?${next}` : ""}`;
  };

  return (
    <div className="animate-fade-up">
      <PageHeader title="Actions" sub={SOUS_TITRE} />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label={`Actions · ${ecran.label}`} value={summary.actions.toLocaleString("fr-FR")} />
        <Stat label="Erreurs liées" value={summary.errors.toLocaleString("fr-FR")} tone={summary.errors ? "warn" : undefined} />
        <Stat label="Temps lié" value={`${Math.round(summary.total_ms).toLocaleString("fr-FR")} ms`} />
      </div>

      {summary.sampling_notice && (
        <p className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft" role="note">
          {summary.sampling_notice.message}
        </p>
      )}

      {rows.length ? (
        <div className="card overflow-x-auto">
        <table className="w-full min-w-table table-fixed text-sm">
          <colgroup>
            <col className="w-64" />
            <col className="w-56" />
            {[0, 1, 2, 3, 4].map((column) => <col key={column} className="w-20" />)}
            <col className="w-28" />
            <col className="w-32" />
          </colgroup>
          <thead className="bg-panel2">
            <tr>
              <th className="th">Action</th>
              <th className="th">Route</th>
              <th className="th text-right">Actions</th>
              <th className="th text-right">Sessions</th>
              <th className="th text-right">Erreurs</th>
              <th className="th text-right">Ressources</th>
              <th className="th text-right">API</th>
              <th className="th text-right">Temps lié</th>
              <th className="th">Dernière vue</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.app_id}|${row.name}|${row.type}|${row.route ?? ""}`} className="border-t border-line/60 hover:bg-panel2/60">
                <td className="px-4 py-3">
                  <div className="font-semibold text-ink">{row.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                    <span className="rounded border border-line px-1.5 py-0.5">{row.type === "click" ? "clic" : "manuelle"}</span>
                    <span className="font-mono">{row.app_id}</span>
                  </div>
                </td>
                <td className="break-all px-4 py-3 font-mono text-xs text-ink-soft">{row.route ?? "(inconnue)"}</td>
                <N value={row.actions} />
                <N value={row.sessions} />
                <N value={row.errors} danger={row.errors > 0} />
                <N value={row.resources} />
                <N value={row.api_calls} />
                <td className="px-4 py-3 text-right font-semibold tabular-nums">{Math.round(Number(row.total_ms)).toLocaleString("fr-FR")} ms</td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">{fmtDate(row.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : (
        <div className="card px-4 py-10 text-center text-sm text-ink-faint">
          Aucune action causale sur {ecran.label}.
        </div>
      )}

      <nav className="mt-4 flex items-center justify-between text-sm" aria-label="Pagination des actions">
        {page.offset > 0
          ? <Link className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf" href={href(Math.max(0, page.offset - page.limit))}>Précédentes</Link>
          : <span />}
        {hasNextActionsPage(page, rows.length) && <Link className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf" href={href(Math.min(ACTIONS_MAX_OFFSET, page.offset + page.limit))}>Suivantes</Link>}
      </nav>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${tone === "warn" ? "text-bad-ink" : "text-ink"}`}>{value}</div>
    </div>
  );
}

function N({ value, danger = false }: { value: number; danger?: boolean }) {
  return <td className={`px-4 py-3 text-right tabular-nums ${danger ? "font-semibold text-bad-ink" : ""}`}>{value.toLocaleString("fr-FR")}</td>;
}
