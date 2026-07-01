import Link from "next/link";
import { notFound } from "next/navigation";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { TabLink } from "@/components/sessions/TabLink";
import { TimelineRow } from "@/components/sessions/Timeline";
import { browserFromUA, fmtDate } from "@/lib/format";
import { sessionMeta, sessionTimeline, type TimelineKind } from "@/lib/queries";
import { KIND_STYLE } from "@/lib/timeline-constants";

export const dynamic = "force-dynamic";

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
