import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import {
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  type WidgetType,
} from "@/lib/dashboards";
import { parseFilters, type Filters, type SearchParams } from "@/lib/filters";
import { getDashboard } from "@/lib/queries-dashboards";
import { registeredApps } from "@/lib/queries";
import { resolveWidget, type WidgetData } from "@/lib/widget-data";
import {
  addWidgetAction,
  deleteDashboardAction,
  moveWidgetAction,
  removeWidgetAction,
  renameDashboardAction,
} from "../actions";
import { PrintButton } from "./PrintButton";

export const dynamic = "force-dynamic";

const INPUT_CLASS = "field py-1";

/** Querystring des filtres globaux (préservation des liens internes + export). */
function filterQs(f: Filters): string {
  const p = new URLSearchParams();
  if (f.app) p.set("app", f.app);
  if (f.period !== "24h") p.set("period", f.period);
  if (f.device) p.set("device", f.device);
  return p.toString();
}

export default async function D({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const idNum = Number(id);
  const dash = Number.isInteger(idNum) ? await getDashboard(idNum) : null;
  if (!dash) notFound();

  const f = parseFilters((await searchParams) ?? {});
  const eff: Filters = { ...f, app: dash.app_id ?? f.app };
  const data = await Promise.all(dash.layout.map((w) => resolveWidget(w, eff)));
  const apps = await registeredApps();

  const qs = filterQs(f);
  const exportHref = `/api/dashboards/${dash.id}/export${qs ? `?${qs}` : ""}`;
  const scope = dash.app_id ?? "toutes les apps";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={dash.name}
        sub={
          <>
            Scope : {scope} · période {f.period}
            {f.device ? ` · ${f.device}` : ""}
          </>
        }
      >
        <Link href="/dashboards" className="btn-ghost">
          ← Tous
        </Link>
        <a href={exportHref} className="btn-ghost" data-testid="export-csv">
          Export CSV
        </a>
        <PrintButton />
      </PageHeader>

      {/* ----- Grille de widgets ----- */}
      {dash.layout.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {dash.layout.map((w, i) => (
            <WidgetCard
              key={i}
              id={dash.id}
              index={i}
              count={dash.layout.length}
              title={w.title}
              data={data[i]}
            />
          ))}
        </div>
      ) : (
        <p className="card px-4 py-8 text-center text-sm text-ink-faint">
          Aucun widget — ajoute-en via « Éditer le tableau de bord » ci-dessous.
        </p>
      )}

      {/* ----- Édition ----- */}
      <details className="card mt-8" data-testid="edit-panel">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          Éditer le tableau de bord
        </summary>
        <div className="flex flex-col gap-6 border-t border-line p-4">
          {/* Ajouter un widget */}
          <form action={addWidgetAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={dash.id} />
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Type
              <select name="type" defaultValue={WIDGET_TYPES[0]} className={INPUT_CLASS}>
                {WIDGET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {WIDGET_META[t as WidgetType].label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Métrique (vital)
              <select name="metric" defaultValue="LCP" className={INPUT_CLASS}>
                {WIDGET_VITALS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" data-testid="add-widget" className="btn-accent">
              + Ajouter un widget
            </button>
          </form>

          {/* Renommer / re-scoper */}
          <form action={renameDashboardAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={dash.id} />
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              Nom
              <input
                name="name"
                required
                defaultValue={dash.name}
                className={`${INPUT_CLASS} w-56`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
              App
              <select name="app_id" defaultValue={dash.app_id ?? ""} className={INPUT_CLASS}>
                <option value="">(toutes apps)</option>
                {apps.map((a) => (
                  <option key={a.app_id} value={a.app_id}>
                    {a.app_id}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="btn-ghost">
              Enregistrer
            </button>
          </form>

          {/* Supprimer */}
          <form action={deleteDashboardAction}>
            <input type="hidden" name="id" value={dash.id} />
            <button
              type="submit"
              data-testid="delete-dashboard"
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
            >
              Supprimer ce tableau de bord
            </button>
          </form>
        </div>
      </details>
    </div>
  );
}

function WidgetCard({
  id,
  index,
  count,
  title,
  data,
}: {
  id: number;
  index: number;
  count: number;
  title: string;
  data: WidgetData;
}) {
  return (
    <div className="card flex flex-col gap-3 p-4" data-testid={`widget-${index}`}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold tracking-tight">{title}</h3>
        <div className="flex shrink-0 items-center gap-1">
          <form action={moveWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <input type="hidden" name="dir" value="up" />
            <button
              type="submit"
              disabled={index === 0}
              aria-label="Monter"
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              ↑
            </button>
          </form>
          <form action={moveWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <input type="hidden" name="dir" value="down" />
            <button
              type="submit"
              disabled={index === count - 1}
              aria-label="Descendre"
              className="btn-ghost px-2 py-1 disabled:opacity-30"
            >
              ↓
            </button>
          </form>
          <form action={removeWidgetAction}>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="index" value={index} />
            <button
              type="submit"
              aria-label="Retirer"
              className="btn-ghost px-2 py-1 text-red-600"
            >
              ✕
            </button>
          </form>
        </div>
      </div>
      <WidgetBody data={data} />
    </div>
  );
}

function WidgetBody({ data }: { data: WidgetData }) {
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
