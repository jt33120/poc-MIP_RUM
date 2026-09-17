import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { ObservedTrend } from "@/components/charts/ObservedTrend";
import { INPUT_CLASS } from "@/components/forms/Field";
import { getUser } from "@/lib/auth";
import { fmtDate } from "@/lib/format";
import { parseFilters, PERIODS, type SearchParams } from "@/lib/filters";
import {
  eventPageFilters,
  eventPagePagination,
  eventResetHref,
  eventSearchParams,
} from "@/lib/events-page-params";
import {
  EVENT_ATTRIBUTE_SOURCES,
  EVENT_ATTRIBUTE_TYPES,
  exploreEvents,
  parseEventCursor,
  parseEventPage,
  parseEventQuery,
} from "@/lib/queries-events";

export const dynamic = "force-dynamic";

function nextHref(current: URLSearchParams, cursor: string) {
  const next = new URLSearchParams(current);
  next.set("cursor", cursor);
  next.delete("offset");
  return `/events?${next}`;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const user = await getUser();
  const url = eventSearchParams(sp);
  const filters = eventPageFilters(parseFilters(sp, user?.apps ?? undefined), url);
  if (url && !url.has("kind")) url.set("kind", "event");
  const query = url ? parseEventQuery(url) : undefined;
  const cursor = url ? parseEventCursor(url.get("cursor")) : undefined;
  const page = url && cursor !== undefined
    ? eventPagePagination(parseEventPage(url), cursor)
    : undefined;

  if (!url || !query || cursor === undefined || !page) {
    return (
      <div className="animate-fade-up">
        <PageHeader title="Événements" sub="Explorer les événements custom et leurs attributs scrubbed." />
        <div role="alert" className="card border-bad/30 p-6 text-sm text-bad">
          Filtre invalide. Les noms sont bornés à 100 caractères ; une facette exige une source, une clé sûre,
          un type primitif et une valeur exacte.
        </div>
      </div>
    );
  }

  const result = await exploreEvents(filters, query, page, cursor);
  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Événements"
        sub={`Explorer les événements custom observés sur ${PERIODS[filters.period].label}, sans extrapolation du sampling.`}
      />

      <form method="get" className="card mb-6 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-6" aria-label="Filtres des événements">
        {filters.app && <input type="hidden" name="app" value={filters.app} />}
        <input type="hidden" name="period" value={filters.period} />
        {filters.device && <input type="hidden" name="device" value={filters.device} />}
        <input type="hidden" name="kind" value="event" />
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft lg:col-span-2">
          Nom d’événement
          <input name="name" defaultValue={query.name ?? ""} list="event-names" placeholder="checkout" className={INPUT_CLASS} />
          <datalist id="event-names">{result.facets.names.map((item) => <option key={item.value} value={item.value} />)}</datalist>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Source attribut
          <select name="attr_source" defaultValue={query.attribute?.source ?? ""} className={INPUT_CLASS}>
            <option value="">Aucune</option>
            {EVENT_ATTRIBUTE_SOURCES.map((source) => <option key={source} value={source}>{source}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Clé
          <input name="attr_key" defaultValue={query.attribute?.key ?? ""} placeholder="plan" className={INPUT_CLASS} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Type
          <select name="attr_type" defaultValue={query.attribute?.type ?? "string"} className={INPUT_CLASS}>
            {EVENT_ATTRIBUTE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
          Valeur exacte
          <input name="attr_value" list="event-values" defaultValue={query.attribute?.value == null ? "" : String(query.attribute.value)} className={INPUT_CLASS} />
          <datalist id="event-values">
            {result.facets.values.map((item) => item.value != null && <option key={`${item.type}:${item.value}`} value={item.value} />)}
          </datalist>
        </label>
        <div className="flex items-end gap-2 lg:col-span-6">
          <button className="btn-accent" type="submit">Appliquer</button>
          <Link href={eventResetHref(filters)} className="btn-ghost">Réinitialiser</Link>
        </div>
      </form>

      {!result.enrichment.available && (
        <p role="status" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {result.enrichment.diagnostic}
        </p>
      )}
      {result.sampling_notice && (
        <p role="note" className="mb-6 rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft">
          {result.sampling_notice.message}
        </p>
      )}

      <div className="mb-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
        <ObservedTrend
          title="Événements observés dans le temps"
          rows={result.trend.map((row) => ({ bucket: row.bucket, value: Number(row.count) }))}
          valueLabel="Événements"
        />
        <aside className="card p-4">
          <div className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Total observé</div>
          <div data-testid="events-total" className="mt-1 text-3xl font-bold tabular-nums text-ink">{result.total.toLocaleString("fr-FR")}</div>
          <h2 className="mt-5 text-xs font-semibold uppercase tracking-wider text-ink-faint">Attributs fréquents</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {result.facets.attributes.map((facet) => (
              <li key={`${facet.source}:${facet.key}`} className="flex justify-between gap-3">
                <code className="truncate text-ink-soft">{facet.source}.{facet.key}</code>
                <span className="tabular-nums text-ink-faint">{facet.count}</span>
              </li>
            ))}
            {!result.facets.attributes.length && <li className="text-ink-faint">Aucune facette primitive.</li>}
          </ul>
        </aside>
      </div>

      {result.events.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-table text-sm">
            <caption className="sr-only">Journal des événements custom correspondant aux filtres</caption>
            <thead className="bg-panel2"><tr>
              <th scope="col" className="th">Événement</th><th scope="col" className="th">Route</th><th scope="col" className="th">Attributs scrubbed</th><th scope="col" className="th">Session</th><th scope="col" className="th">Date</th>
            </tr></thead>
            <tbody>
              {result.events.map((event) => (
                <tr key={event.id} className="border-t border-line/60 align-top hover:bg-panel2/60">
                  <td className="px-4 py-3"><span className="font-semibold text-ink">{event.name ?? event.source_name ?? event.kind}</span><div className="mt-1 font-mono text-[11px] text-ink-faint">{event.app_id}</div></td>
                  <td className="px-4 py-3 font-mono text-xs text-ink-soft">{event.route ?? "—"}</td>
                  <td className="max-w-md px-4 py-3">
                    <details><summary className="cursor-pointer rounded text-xs text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">Voir le contexte</summary>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded bg-panel2 p-2 text-[11px] text-ink-soft">{JSON.stringify({ props: event.props ?? {}, context: event.context ?? {} }, null, 2)}</pre>
                    </details>
                  </td>
                  <td className="px-4 py-3 text-xs">{event.session_id ? <Link className="text-brand hover:underline" href={`/sessions/${encodeURIComponent(event.session_id)}?app=${encodeURIComponent(event.app_id)}`}>{event.session_id.slice(0, 8)}…</Link> : "—"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-ink-faint">{fmtDate(event.ts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card px-4 py-10 text-center text-sm text-ink-faint">
          Aucun événement ne correspond à ces filtres sur {PERIODS[filters.period].label}.
        </div>
      )}

      <nav className="mt-4 flex justify-end text-sm" aria-label="Pagination des événements">
        {result.page.next_cursor && <Link className="rounded text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf" href={nextHref(url, result.page.next_cursor)}>Événements suivants</Link>}
      </nav>
    </div>
  );
}
