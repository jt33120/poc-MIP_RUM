import Link from "next/link";
import { notFound } from "next/navigation";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { browserFromUA, fmtDate, fmtVital } from "@/lib/format";
import { sessionMeta, sessionTimeline, type TimelineItem, type TimelineKind } from "@/lib/queries";
import { RATING_CLASS, type Rating } from "@/lib/rating";

export const dynamic = "force-dynamic";

// styles + pictos par type d'événement de la timeline
const KIND_STYLE: Record<TimelineKind, { label: string; dot: string; badge: string }> = {
  pageview: {
    label: "Page vue",
    dot: "bg-blue-500",
    badge:
      "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-400/10 dark:text-blue-300 dark:border-blue-400/30",
  },
  vital: {
    label: "Vital",
    dot: "bg-emerald-500",
    badge:
      "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-400/10 dark:text-emerald-300 dark:border-emerald-400/30",
  },
  error: {
    label: "Erreur JS",
    dot: "bg-red-500",
    badge: "bg-red-100 text-red-800 border-red-300 dark:bg-red-400/10 dark:text-red-300 dark:border-red-400/30",
  },
  breadcrumb: {
    label: "Breadcrumb",
    dot: "bg-violet-500",
    badge:
      "bg-violet-100 text-violet-800 border-violet-300 dark:bg-violet-400/10 dark:text-violet-300 dark:border-violet-400/30",
  },
  longtask: {
    label: "Long task",
    dot: "bg-orange-500",
    badge:
      "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-400/10 dark:text-orange-300 dark:border-orange-400/30",
  },
  event: {
    label: "Event métier",
    dot: "bg-cyan-600",
    badge:
      "bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-400/10 dark:text-cyan-300 dark:border-cyan-400/30",
  },
  api: {
    label: "Appel API",
    dot: "bg-sky-600",
    badge: "bg-sky-100 text-sky-800 border-sky-300 dark:bg-sky-400/10 dark:text-sky-300 dark:border-sky-400/30",
  },
};

const KIND_ICON: Record<TimelineKind, React.ReactNode> = {
  pageview: <Icon d="M4 2h6l4 4v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm6 0v4h4" />,
  vital: <Icon d="M2 9h3l2-5 3 9 2-4h4" />,
  error: <Icon d="M9 2 16 15H2L9 2Zm0 5v4m0 2v.5" />,
  breadcrumb: <Icon d="M4 3l9 5-4 1.5L7.5 14 4 3Z" />,
  longtask: <Icon d="M9 4.5V9l3 2M9 16A7 7 0 1 0 9 2a7 7 0 0 0 0 14Z" />,
  event: <Icon d="M3 3h6l6 6-6 6-6-6V3Zm3 3h.5" />,
  api: <Icon d="M2 9h5m4 0h5M7 9l2-3m0 6 2-3" />,
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

  // scoping viewer : une session d'une app hors périmètre est invisible (404)
  const { getUser } = await import("@/lib/auth");
  const user = await getUser();
  if (user?.apps && !user.apps.includes(meta.app_id)) notFound();

  // filtres globaux conservés dans les liens, onglet exclu (propre au détail)
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" && k !== "tab" ? [[k, v] as [string, string]] : [],
    ),
  ).toString();
  const tab: "timeline" | "replay" = sp.tab === "replay" ? "replay" : "timeline";
  const tabHref = (t: "timeline" | "replay") => {
    const p = new URLSearchParams(qs);
    if (t === "replay") p.set("tab", "replay");
    const s = p.toString();
    return `/sessions/${meta.session_id}${s ? `?${s}` : ""}`;
  };
  const t0 = new Date(meta.started_at).getTime();
  const durationMs = new Date(meta.last_seen_at).getTime() - t0;
  const counts = timeline.reduce<Partial<Record<TimelineKind, number>>>((acc, it) => {
    acc[it.kind] = (acc[it.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-up">
      <Link href={`/sessions${qs ? `?${qs}` : ""}`} className="text-sm text-brand hover:underline">
        ← Sessions
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-bold tracking-tight">
        Session <span className="font-mono text-lg text-ink-soft">{meta.session_id.slice(0, 8)}…</span>
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        Timeline fusionnée : pages vues, vitals, erreurs, breadcrumbs, long tasks et events métier
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Meta label="App" value={meta.app_id} />
        <Meta label="Device" value={meta.device_type ?? "—"} />
        <Meta label="Navigateur" value={browserFromUA(meta.user_agent)} />
        <Meta label="Pays" value={meta.geo_country ?? "—"} />
        <Meta label="Utilisateur (hash)" value={meta.user_hash ? `${meta.user_hash.slice(0, 10)}…` : "—"} mono />
        <Meta label="Durée" value={fmtDuration(durationMs)} />
        <Meta label="Pages" value={String(meta.page_count)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="tabular-nums">
          {fmtDate(meta.started_at)} → {fmtDate(meta.last_seen_at)}
        </span>
        <span className="text-ink-faint/50">·</span>
        {(Object.keys(KIND_STYLE) as TimelineKind[])
          .filter((k) => counts[k])
          .map((k) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 font-medium ${KIND_STYLE[k].badge}`}>
              {counts[k]} {KIND_STYLE[k].label.toLowerCase()}
            </span>
          ))}
      </div>

      {/* v0.3 — onglets Timeline | Replay (B2) */}
      <div className="mb-4 flex gap-1 border-b border-line" data-testid="session-tabs">
        <TabLink href={tabHref("timeline")} active={tab === "timeline"}>
          Timeline
        </TabLink>
        <TabLink href={tabHref("replay")} active={tab === "replay"}>
          Replay
        </TabLink>
      </div>

      {tab === "replay" ? (
        <ReplayPlayer sessionId={meta.session_id} />
      ) : (
        <div className="card p-6">
          {timeline.length ? (
            <ol className="relative ml-2 border-l-2 border-line" data-testid="timeline">
              {timeline.map((it, i) => (
                <TimelineRow key={i} item={it} t0={t0} />
              ))}
            </ol>
          ) : (
            <p className="py-8 text-center text-sm text-ink-faint">
              Aucun événement enregistré pour cette session
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
        active ? "border-accent text-ink" : "border-transparent text-ink-faint hover:text-ink-soft"
      }`}
    >
      {children}
    </Link>
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
        <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-ink-faint" title={fmtDate(item.ts)}>
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
          <span className="chip-mono">{item.title}</span>
          {item.detail && <span className="text-xs text-ink-faint">{item.detail}</span>}
        </>
      );
    case "vital": {
      const cls = item.rating ? RATING_CLASS[item.rating as Rating] : "";
      return (
        <>
          <span className="font-semibold">{item.title}</span>
          <span className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${cls}`}>
            {fmtVital(item.title ?? "", item.value != null ? Number(item.value) : null)}
          </span>
          {item.detail && <span className="font-mono text-xs text-ink-faint">{item.detail}</span>}
        </>
      );
    }
    case "error":
      return (
        <>
          <span className="font-semibold text-red-700 dark:text-red-400">{item.title}</span>
          <span className="max-w-xl truncate text-xs text-ink-soft" title={item.detail ?? ""}>
            {item.detail}
          </span>
        </>
      );
    case "breadcrumb":
      return (
        <>
          <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-400/10 dark:text-violet-300">
            {item.title}
          </span>
          {item.detail && (
            <span className="max-w-xl truncate text-xs text-ink-soft" title={item.detail}>
              {item.detail}
            </span>
          )}
        </>
      );
    case "longtask":
      return (
        <>
          <span className="font-semibold tabular-nums text-orange-700 dark:text-orange-400">
            {item.value != null ? `${Math.round(Number(item.value))} ms` : "—"}
          </span>
          {item.detail && <span className="font-mono text-xs text-ink-faint">{item.detail}</span>}
        </>
      );
    case "event":
      return (
        <>
          <span className="font-semibold text-cyan-700 dark:text-cyan-400">{item.title}</span>
          {item.detail && item.detail !== "null" && (
            <span className="max-w-xl truncate font-mono text-xs text-ink-faint" title={item.detail}>
              {item.detail}
            </span>
          )}
        </>
      );
    case "api":
      // title = 'GET /api/aos', detail = '200 · serveur 211 ms', value = ms total
      return (
        <>
          <span className="chip-mono">{item.title}</span>
          <span
            className={`font-semibold tabular-nums ${
              item.rating === "poor" ? "text-red-700 dark:text-red-400" : "text-sky-700 dark:text-sky-400"
            }`}
          >
            {item.value != null ? `${Math.round(Number(item.value))} ms` : "—"}
          </span>
          {item.detail && <span className="text-xs text-ink-soft">{item.detail}</span>}
        </>
      );
  }
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${mono ? "font-mono" : ""}`} title={value}>
        {value}
      </div>
    </div>
  );
}
