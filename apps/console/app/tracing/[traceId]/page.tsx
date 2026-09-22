// Détail d'une trace — cascade « douleur utilisateur → cause backend » (Voie A).
// Reconstitue la chronologie complète d'un appel : span front (navigateur) →
// span back (serveur) → spans internes (requêtes DB, sous-appels) captés par
// l'auto-instrumentation OTel. Chaque segment est positionné par son offset réel
// (rum_span.ts = début de span) et sa durée. Rendu 100 % serveur.
//
// F07 : la cascade n'est plus dessinée à la main ici, elle est rendue par
// `Cascade` (components/charts/Cascade.tsx), le composant partagé avec les vues et
// les sessions — preuve de sa réutilisation. Deux changements de lecture (§ 5.9,
// TD2) : la COULEUR dit la sévérité (5xx = erreur, 4xx = à surveiller) et non plus
// le niveau ; le niveau devient une PISTE, écrite sous chaque segment.
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { Cascade, texteDuree, type ElementCascade, type PisteCascade, type TonCascade } from "@/components/charts/Cascade";
import { Figure } from "@/components/charts/Figure";
import { fmtMs } from "@/components/tracing/format";
import { getUser } from "@/lib/auth";
import { traceSpans, type TraceSpanRow } from "@/lib/queries-tracing";
import { authorizedAppsOf } from "@/lib/query-contract";

export const dynamic = "force-dynamic";

/** Les pistes d'une trace, dans l'ordre du trajet d'un appel (§ 5.9, TD2). */
const PISTES_TRACE: PisteCascade[] = [
  { cle: "navigateur", libelle: "Navigateur" },
  { cle: "serveur", libelle: "Serveur" },
  { cle: "base", libelle: "Base de données" },
  { cle: "interne", libelle: "Interne" },
];

function pisteDe(s: TraceSpanRow): string {
  if (s.tier === "front") return "navigateur";
  if (s.tier === "back") return "serveur";
  return s.kind === "db" ? "base" : "interne";
}

function tierLabel(s: TraceSpanRow): string {
  if (s.tier === "front") return "navigateur";
  if (s.tier === "back") return "serveur";
  return s.kind === "db" ? "base de données" : "interne";
}

/**
 * Sévérité d'un segment d'après son statut HTTP (TD2) : 5xx = erreur, 4xx = à
 * surveiller, le reste sans alerte. Aucun segment n'est « bon » ou « mauvais » par
 * sa DURÉE : une durée de span n'a pas de seuil publié (R-S).
 */
function tonDe(statut: number | null): TonCascade {
  if (statut == null) return "neutre";
  if (statut >= 500) return "erreur";
  if (statut >= 400) return "warn";
  return "neutre";
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
  const spans = await traceSpans(traceId, { apps: traceApps(first(sp.app), authorizedAppsOf(user)) });
  if (spans.length === 0) notFound();

  const byId = new Map(spans.map((s) => [s.span_id, s]));

  // fenêtre temporelle de la trace (offsets relatifs au 1er span)
  const starts = spans.map((s) => new Date(s.ts).getTime());
  const ends = spans.map((s, i) => starts[i] + s.duration_ms);
  const t0 = Math.min(...starts);
  const total = Math.max(Math.max(...ends) - t0, 1);

  // ?span : le span parent d'une erreur (P5.1), ou le segment cliqué dans la
  // cascade. Mis en évidence seulement s'il est parmi les spans affichés ; sinon on
  // le dit, plutôt que de laisser croire que la trace ne contient pas le contexte
  // attendu.
  const spanParam = first(sp.span);
  const wantedSpan = spanParam && SPAN_ID.test(spanParam) ? spanParam.toLowerCase() : null;
  const highlighted = wantedSpan && byId.has(wantedSpan) ? wantedSpan : null;
  const spanState = spanParam === undefined ? null : highlighted ? "found" : "missing";

  const front = spans.find((s) => s.tier === "front");
  const sessionSpan = spans.find((s) => s.session_id);
  const hasBackend = spans.some((s) => s.tier === "back" || s.tier === "detail");
  const rootMs = front?.duration_ms ?? total;

  // Un clic sur un segment le désigne par `?span=` ; l'app demandée suit (périmètre).
  const lienSegment = (spanId: string) => {
    const q = new URLSearchParams();
    const app = first(sp.app);
    if (app) q.set("app", app);
    q.set("span", spanId);
    return `/tracing/${encodeURIComponent(traceId)}?${q}`;
  };
  const elements: ElementCascade[] = spans.map((s, i) => ({
    id: s.span_id,
    piste: pisteDe(s),
    libelle: s.name ?? tierLabel(s),
    debutMs: starts[i] - t0,
    dureeMs: s.duration_ms,
    ton: tonDe(s.status_code),
    parentId: s.parent_span_id,
    href: lienSegment(s.span_id),
    detail: s.status_code != null ? `HTTP ${s.status_code}` : undefined,
  }));

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
        <div className="mb-5 rounded-lg border border-warn/50 bg-warn/10 px-4 py-3 text-sm text-warn-ink">
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
            spanState === "found" ? "border-perf/40 bg-perf/10 text-ink" : "border-warn/40 bg-warn/10 text-ink-soft"
          }`}
        >
          {/* Le segment se désigne depuis une erreur (span parent) OU d'un clic dans la
              cascade : le texte ne présume plus d'où vient la demande. */}
          {spanState === "found"
            ? "Segment demandé mis en évidence dans la chronologie."
            : "Span parent introuvable dans cette trace"}
        </p>
      )}

      <Figure
        titre="Chronologie de l'appel"
        id="chronologie"
        meta={
          <>
            <span>
              {spans.length} segment{spans.length > 1 ? "s" : ""}
            </span>
            <span>axe de 0 à {texteDuree(total)}, depuis le début du premier segment</span>
          </>
        }
        lecture={
          <>
            Chaque segment est placé à son début réel dans la trace ; l&apos;indentation suit la chaîne parent →
            enfant quand elle est connue. La couleur dit la sévérité : rouge hachuré = réponse 5xx, ambre = 4xx,
            gris = sans statut d&apos;erreur. La piste (navigateur, serveur, base de données, interne) est écrite
            sous chaque segment ; un clic sur un segment le met en évidence.
          </>
        }
      >
        <Cascade totalMs={total} pistes={PISTES_TRACE} elements={elements} selection={highlighted} />
      </Figure>
    </div>
  );
}
