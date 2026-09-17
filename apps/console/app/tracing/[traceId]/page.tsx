// Détail d'une trace — waterfall « douleur utilisateur → cause backend » (Voie A).
// Reconstitue la chronologie complète d'un appel : span front (navigateur) →
// span back (serveur) → spans internes (requêtes DB, sous-appels) captés par
// l'auto-instrumentation OTel. Chaque barre est positionnée par son offset réel
// (rum_span.ts = début de span) et sa durée. Rendu 100 % serveur.
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { fmtMs } from "@/components/tracing/format";
import { getUser } from "@/lib/auth";
import { traceSpans, type TraceSpanRow } from "@/lib/queries-tracing";

export const dynamic = "force-dynamic";

const TIER_DEPTH: Record<string, number> = { front: 0, back: 1, detail: 2 };

/** Couleur de barre selon le niveau : bleu front · orange serveur · violet DB. */
function barColor(s: TraceSpanRow): string {
  if (s.tier === "front") return "bg-perf";
  if (s.tier === "back") return "bg-accent";
  return s.kind === "db" ? "bg-ai" : "bg-ink-faint";
}
function tierLabel(s: TraceSpanRow): string {
  if (s.tier === "front") return "navigateur";
  if (s.tier === "back") return "serveur";
  return s.kind === "db" ? "base de données" : "interne";
}

const SPAN_ID = /^[0-9a-f]{16}$/i;

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Apps dont la trace montre les spans. Un trace_id est émis par le client : deux
 * tenants peuvent le partager, et le lien depuis une erreur de l'app A (P5.1) ne
 * doit rien révéler de B. L'app demandée est donc bornée au périmètre signé ;
 * hors périmètre, aucune app. Sans app demandée (ou « all »), un utilisateur
 * restreint voit ses apps et un admin toute la trace, comme avant.
 */
function traceApps(requested: string | undefined, scope: string[] | null): string[] | null {
  const app = requested && requested !== "all" ? requested : null;
  if (!app) return scope;
  return scope && !scope.includes(app) ? [] : [app];
}

export default async function TraceDetail({
  params,
  searchParams,
}: {
  params: Promise<{ traceId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ traceId: raw }, sp] = await Promise.all([params, searchParams]);
  let traceId: string;
  try {
    traceId = decodeURIComponent(raw);
  } catch {
    notFound();
  }
  const user = await getUser();
  // Les spans hors périmètre ne sont jamais lus : une trace dont il ne reste rien
  // est introuvable, sans dire si elle existe ailleurs.
  const spans = await traceSpans(traceId, { apps: traceApps(first(sp.app), user?.apps ?? null) });
  if (spans.length === 0) notFound();

  // profondeur : chaîne de parents si connue, sinon repli par tier
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depthOf = (s: TraceSpanRow, seen = new Set<string>()): number => {
    if (s.parent_span_id && byId.has(s.parent_span_id) && !seen.has(s.span_id)) {
      seen.add(s.span_id);
      return 1 + depthOf(byId.get(s.parent_span_id)!, seen);
    }
    return TIER_DEPTH[s.tier] ?? 0;
  };

  // fenêtre temporelle de la trace (offsets relatifs au 1er span)
  const starts = spans.map((s) => new Date(s.ts).getTime());
  const ends = spans.map((s, i) => starts[i] + s.duration_ms);
  const t0 = Math.min(...starts);
  const total = Math.max(Math.max(...ends) - t0, 1);

  // ?span : le span parent d'une erreur (P5.1). Mis en évidence seulement s'il est
  // parmi les spans affichés ; sinon on le dit, plutôt que de laisser croire que
  // la trace ne contient pas le contexte attendu.
  const spanParam = first(sp.span);
  const wantedSpan = spanParam && SPAN_ID.test(spanParam) ? spanParam.toLowerCase() : null;
  const highlighted = wantedSpan && byId.has(wantedSpan) ? wantedSpan : null;
  const spanState = spanParam === undefined ? null : highlighted ? "found" : "missing";

  const front = spans.find((s) => s.tier === "front");
  const sessionSpan = spans.find((s) => s.session_id);
  const hasBackend = spans.some((s) => s.tier === "back" || s.tier === "detail");
  const rootMs = front?.duration_ms ?? total;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Détail de la trace"
        sub={
          <>
            Chronologie complète de l&apos;appel — du navigateur à la cause backend. Trace{" "}
            <span className="font-mono text-xs">{traceId.slice(0, 16)}…</span>
          </>
        }
      >
        <Link href="/tracing" className="btn-ghost">
          ← Tracing
        </Link>
      </PageHeader>

      {/* résumé */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Latence perçue</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-ink">{fmtMs(rootMs)}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Spans</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-ink">{spans.length}</div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Route</div>
          <div className="mt-1 truncate text-sm font-medium text-ink" title={front?.route ?? front?.url ?? "—"}>
            {front?.route ?? front?.url ?? "—"}
          </div>
        </div>
        <div className="card p-4">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Session</div>
          <div className="mt-1 text-sm font-medium">
            {sessionSpan?.session_id ? (
              // L'app du span accompagne le lien : la page session refuse une
              // session d'une autre app que celle annoncée.
              <Link
                href={`/sessions/${encodeURIComponent(sessionSpan.session_id)}?app=${encodeURIComponent(sessionSpan.app_id)}`}
                className="font-mono text-xs text-brand hover:underline"
              >
                {sessionSpan.session_id.slice(0, 8)}…
              </Link>
            ) : (
              <span className="text-ink-faint/60">—</span>
            )}
          </div>
        </div>
      </div>

      {!hasBackend && (
        <div className="mb-5 rounded-lg border border-amber-300/50 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
          Aucun span backend reçu pour cette trace — le navigateur voit l&apos;appel mais le serveur n&apos;est
          pas instrumenté. Déployez le middleware MIP (ou un agent OpenTelemetry) pour révéler la cause serveur.
        </div>
      )}

      {spanState && (
        <p
          role="status"
          data-testid="trace-span-state"
          data-span-state={spanState}
          className={`mb-5 rounded-lg border px-4 py-3 text-sm ${
            spanState === "found" ? "border-accent/40 bg-accent/10 text-ink" : "border-warn/40 bg-warn/10 text-ink-soft"
          }`}
        >
          {spanState === "found"
            ? "Span parent de l'erreur mis en évidence dans la chronologie."
            : "Span parent introuvable dans cette trace"}
        </p>
      )}

      {/* waterfall */}
      <div className="card overflow-hidden">
        <div className="flex items-center gap-4 border-b border-line px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          <span className="w-[38%] min-w-0">Span</span>
          <span className="flex-1">Chronologie</span>
          <span className="w-16 text-right">Durée</span>
        </div>
        <ul>
          {spans.map((s, i) => {
            const leftPct = ((starts[i] - t0) / total) * 100;
            const widthPct = Math.max((s.duration_ms / total) * 100, 0.6);
            const depth = Math.min(depthOf(s), 5);
            return (
              <li
                key={s.span_id}
                aria-current={s.span_id === highlighted ? "true" : undefined}
                className={`flex items-center gap-4 border-t border-line/60 px-4 py-2.5 first:border-t-0 hover:bg-panel2/50 ${
                  s.span_id === highlighted ? "bg-accent/10 ring-1 ring-inset ring-accent" : ""
                }`}
              >
                <div className="w-[38%] min-w-0" style={{ paddingLeft: `${depth * 14}px` }}>
                  <div className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 shrink-0 rounded-sm ${barColor(s)}`} />
                    <span className="truncate text-sm font-medium text-ink" title={s.name ?? undefined}>
                      {s.name ?? s.tier}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 pl-3.5 text-[11px] text-ink-faint">
                    <span>{tierLabel(s)}</span>
                    {s.status_code != null && (
                      <span className="tabular-nums">· {s.status_code}</span>
                    )}
                  </div>
                </div>
                <div className="relative h-6 flex-1">
                  <div className="absolute inset-y-0 left-0 right-0 my-auto h-px bg-line" />
                  <div
                    className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-sm ${barColor(s)} opacity-90`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={`${fmtMs(s.duration_ms)} @ +${fmtMs(starts[i] - t0)}`}
                  />
                </div>
                <span className="w-16 text-right text-sm font-semibold tabular-nums text-ink">
                  {fmtMs(s.duration_ms)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="mt-4 max-w-3xl text-xs leading-relaxed text-ink-faint">
        Bleu = navigateur (front) · orange = serveur (back) · violet = base de données · gris = sous-appel
        interne. Les barres sont positionnées par leur début réel dans la trace ; la profondeur suit la chaîne
        parent → enfant quand elle est connue.
      </p>
    </div>
  );
}
