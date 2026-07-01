// Rendu d'une ligne de timeline session (puce + offset + badge + corps typé).
// Composants présentationnels purs (serveur), extraits de app/sessions/[id]/page.tsx.
import { fmtDate, fmtVital } from "@/lib/format";
import type { TimelineItem } from "@/lib/queries";
import { RATING_CLASS, type Rating } from "@/lib/rating";
import { KIND_ICON, KIND_STYLE } from "@/lib/timeline-constants";

function fmtOffset(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60_000) return `+${(ms / 1000).toFixed(1).replace(".", ",")} s`;
  return `+${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function TimelineRow({ item, t0 }: { item: TimelineItem; t0: number }) {
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
