import Link from "next/link";
import { notFound } from "next/navigation";
import { browserFromUA, fmtDate, fmtVital } from "@/lib/format";
import { sessionMeta, sessionTimeline, type TimelineItem, type TimelineKind } from "@/lib/queries";
import { RATING_CLASS, type Rating } from "@/lib/rating";

export const dynamic = "force-dynamic";

// styles + pictos par type d'événement de la timeline
const KIND_STYLE: Record<TimelineKind, { label: string; dot: string; badge: string }> = {
  pageview: { label: "Page vue", dot: "bg-blue-500", badge: "bg-blue-100 text-blue-800 border-blue-300" },
  vital: { label: "Vital", dot: "bg-emerald-500", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  error: { label: "Erreur JS", dot: "bg-red-500", badge: "bg-red-100 text-red-800 border-red-300" },
  breadcrumb: { label: "Breadcrumb", dot: "bg-violet-500", badge: "bg-violet-100 text-violet-800 border-violet-300" },
  longtask: { label: "Long task", dot: "bg-orange-500", badge: "bg-orange-100 text-orange-800 border-orange-300" },
  event: { label: "Event métier", dot: "bg-cyan-600", badge: "bg-cyan-100 text-cyan-800 border-cyan-300" },
};

const KIND_ICON: Record<TimelineKind, React.ReactNode> = {
  pageview: <Icon d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 0v4h4" />,
  vital: <Icon d="M2 9h3l2-5 3 9 2-4h4" />,
  error: <Icon d="M9 2 16 15H2L9 2Zm0 5v4m0 2v.5" />,
  breadcrumb: <Icon d="M4 3l9 5-4 1.5L7.5 14 4 3Z" />,
  longtask: <Icon d="M9 4.5V9l3 2M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14Z" />,
  event: <Icon d="M3 3h6l6 6-6 6-6-6V3Zm3 3h.5" />,
};

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 18 18" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function fmtOffset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `+${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export default async function SessionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [meta, timeline] = await Promise.all([sessionMeta(id), sessionTimeline(id)]);
  if (!meta) notFound();

  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v] as [string, string]] : [])),
  ).toString();
  const t0 = new Date(meta.started_at).getTime();
  const durationMs = new Date(meta.last_seen_at).getTime() - t0;
  const counts = timeline.reduce<Partial<Record<TimelineKind, number>>>((acc, it) => {
    acc[it.kind] = (acc[it.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div>
      <Link href={`/sessions${qs ? `?${qs}` : ""}`} className="text-sm text-blue-600 hover:underline">
        ← Sessions
      </Link>
      <h1 className="mb-1 mt-2 text-2xl font-bold">
        Session <span className="font-mono text-xl text-slate-600">{meta.session_id.slice(0, 8)}…</span>
      </h1>
      <p className="mb-6 text-sm text-slate-500">
        Timeline fusionnée : pages vues, vitals, erreurs, breadcrumbs, long tasks et events métier
      </p>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
        <Meta label="App" value={meta.app_id} />
        <Meta label="Device" value={meta.device_type ?? "—"} />
        <Meta label="Navigateur" value={browserFromUA(meta.user_agent)} />
        <Meta label="Pays" value={meta.geo_country ?? "—"} />
        <Meta label="Utilisateur (hash)" value={meta.user_hash ? `${meta.user_hash.slice(0, 10)}…` : "—"} mono />
        <Meta label="Durée" value={fmtDuration(durationMs)} />
        <Meta label="Pages" value={String(meta.page_count)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          {fmtDate(meta.started_at)} → {fmtDate(meta.last_seen_at)}
        </span>
        <span className="text-slate-300">·</span>
        {(Object.keys(KIND_STYLE) as TimelineKind[])
          .filter((k) => counts[k])
          .map((k) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 font-medium ${KIND_STYLE[k].badge}`}>
              {counts[k]} {KIND_STYLE[k].label.toLowerCase()}
            </span>
          ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        {timeline.length ? (
          <ol className="relative ml-2 border-l-2 border-slate-200" data-testid="timeline">
            {timeline.map((it, i) => (
              <TimelineRow key={i} item={it} t0={t0} />
            ))}
          </ol>
        ) : (
          <p className="py-8 text-center text-sm text-slate-400">Aucun événement enregistré pour cette session</p>
        )}
      </div>
    </div>
  );
}

function TimelineRow({ item, t0 }: { item: TimelineItem; t0: number }) {
  const st = KIND_STYLE[item.kind];
  const offset = new Date(item.ts).getTime() - t0;
  return (
    <li className="relative pb-4 pl-6 last:pb-0">
      <span
        className={`absolute -left-[9px] top-1 flex h-4 w-4 items-center justify-center rounded-full text-white ${st.dot}`}
      >
        {KIND_ICON[item.kind]}
      </span>
      <div className="flex flex-wrap items-baseline gap-2 text-sm">
        <span className="w-20 shrink-0 font-mono text-xs text-slate-400" title={fmtDate(item.ts)}>
          {fmtOffset(Math.max(0, offset))}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${st.badge}`}>{st.label}</span>
        <ItemBody item={item} />
      </div>
    </li>
  );
}

function ItemBody({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "pageview":
      return (
        <>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{item.title}</span>
          {item.detail && <span className="text-xs text-slate-400">{item.detail}</span>}
        </>
      );
    case "vital": {
      const cls = item.rating ? RATING_CLASS[item.rating as Rating] : "";
      return (
        <>
          <span className="font-semibold">{item.title}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${cls}`}>
            {fmtVital(item.title ?? "", item.value != null ? Number(item.value) : null)}
          </span>
          {item.detail && <span className="font-mono text-xs text-slate-400">{item.detail}</span>}
        </>
      );
    }
    case "error":
      return (
        <>
          <span className="font-semibold text-red-700">{item.title}</span>
          <span className="max-w-xl truncate text-xs text-slate-600" title={item.detail ?? ""}>
            {item.detail}
          </span>
        </>
      );
    case "breadcrumb":
      return (
        <>
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700">{item.title}</span>
          {item.detail && (
            <span className="max-w-xl truncate text-xs text-slate-600" title={item.detail}>
              {item.detail}
            </span>
          )}
        </>
      );
    case "longtask":
      return (
        <>
          <span className="font-semibold text-orange-700">
            {item.value != null ? `${Math.round(Number(item.value))} ms` : "—"}
          </span>
          {item.detail && <span className="font-mono text-xs text-slate-400">{item.detail}</span>}
        </>
      );
    case "event":
      return (
        <>
          <span className="font-semibold text-cyan-700">{item.title}</span>
          {item.detail && item.detail !== "null" && (
            <span className="max-w-xl truncate font-mono text-xs text-slate-500" title={item.detail}>
              {item.detail}
            </span>
          )}
        </>
      );
  }
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}
