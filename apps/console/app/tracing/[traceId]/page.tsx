// Détail d'une trace (§ 5.9, F61) : « Pour cet appel, où est passé le temps,
// segment par segment, et qu'a vécu le visiteur à ce moment ? »
//
// La cascade (TD2) est rendue par `Cascade` (F07), partagée avec les vues et les
// sessions : chaque segment à son début réel sur un axe commun, la COULEUR dit la
// sévérité (5xx = erreur, 4xx = à surveiller), jamais un verdict de durée — une
// durée de span n'a pas de seuil publié (R-S). La piste est écrite sous chaque
// segment.
//
// ISOLATION PAR TENANT (conservée). Un trace_id est émis par le client : deux
// tenants peuvent le partager. Les spans, les erreurs liées et la session ne sont
// lus que dans les apps autorisées ET demandées (`traceApps`) ; une trace dont il
// ne reste rien est introuvable (`notFound()`), sans dire si elle existe ailleurs.
//
// Ce que F61 ajoute : puces d'identité (apps multiples comprises), copie de
// l'identifiant COMPLET (32 caractères, l'en-tête n'en montrait que 16), rejeu à
// l'instant de l'appel, « Erreurs liées à cette trace » et la table des segments.
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Cascade, texteDuree, type ElementCascade, type PisteCascade, type TonCascade } from "@/components/charts/Cascade";
import { Figure } from "@/components/charts/Figure";
import { EtatSurface } from "@/components/states/EtatSurface";
import { EchecLecture } from "@/components/states/SectionErreur";
import { CopierTrace } from "@/components/tracing/CopierTrace";
import { getUser } from "@/lib/auth";
import { formater } from "@/lib/fmt-ids";
import { lire } from "@/lib/lecture";
import { sessionMeta } from "@/lib/queries";
import { errorsOfTrace, traceSpans, type TraceSpanRow } from "@/lib/queries-tracing";
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

/** Une puce d'identité, au modèle de `DetailPanel.puces` : libellé, valeur (texte ou lien). */
function Puce({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex min-w-0 max-w-full items-baseline gap-1 rounded-md bg-panel2 px-2 py-0.5 text-xs" data-testid={testId}>
      <dt className="shrink-0 text-ink-soft">{label}</dt>
      <dd className="min-w-0 truncate font-medium text-ink">{children}</dd>
    </div>
  );
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
  const perimetre = authorizedAppsOf(user);
  const apps = traceApps(first(sp.app), perimetre);
  // Les spans hors périmètre ne sont jamais lus : une trace dont il ne reste rien
  // est introuvable, sans dire si elle existe ailleurs.
  const spans = await traceSpans(traceId, { apps });
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

  // L'APPEL RÉSUMÉ. Depuis E0, une trace est celle d'une page vue : elle porte tous
  // ses appels API. Latence, route, session et instant du rejeu sont ceux de
  // l'appel désigné par `?span=` (« Traces les plus lentes » le transmet) — ou du
  // span navigateur dont descend le segment désigné ; à défaut, le premier appel,
  // et on le dit. Prendre toujours le premier ouvrait « 100 ms, /api/config » sur
  // un clic sur `/api/search`.
  const fronts = spans.filter((s) => s.tier === "front");
  const appelDe = (id: string | null): TraceSpanRow | undefined => {
    const vus = new Set<string>();
    let s = id ? byId.get(id) : undefined;
    while (s && s.tier !== "front" && s.parent_span_id && !vus.has(s.span_id)) {
      vus.add(s.span_id);
      s = byId.get(s.parent_span_id);
    }
    return s?.tier === "front" ? s : undefined;
  };
  const designe = appelDe(highlighted);
  const front = designe ?? fronts[0];
  const sessionSpan = front?.session_id ? front : spans.find((s) => s.session_id);
  const hasBackend = spans.some((s) => s.tier === "back" || s.tier === "detail");
  const rootMs = front?.duration_ms ?? total;
  const appsDistinctes = [...new Set(spans.map((s) => s.app_id))].sort();

  // Erreurs liées (TD4) et session (TD3), lues pour elles-mêmes : un échec ne fait
  // tomber que leur bloc, jamais la cascade.
  const [erreurs, session] = await Promise.all([
    lire(() => errorsOfTrace(traceId, { apps })),
    sessionSpan?.session_id ? lire(() => sessionMeta(sessionSpan.session_id!)) : Promise.resolve(null),
  ]);
  // Session LISIBLE : elle existe encore, dans l'app du span et dans le périmètre.
  const sessionLisible =
    session?.ok && session.data && session.data.app_id === sessionSpan?.app_id && (perimetre === null || perimetre.includes(session.data.app_id));
  const instantAppel = front ? new Date(front.ts).getTime() : null;

  // Un clic sur un segment le désigne par `?span=` ; l'app demandée suit (périmètre).
  const lienTrace = (spanId?: string) => {
    const q = new URLSearchParams();
    const app = first(sp.app);
    if (app) q.set("app", app);
    if (spanId) q.set("span", spanId);
    const qs = q.toString();
    return `/tracing/${encodeURIComponent(traceId)}${qs ? `?${qs}` : ""}`;
  };
  const lienSession = (id: string, app: string, extra: Record<string, string> = {}) =>
    `/sessions/${encodeURIComponent(id)}?${new URLSearchParams({ app, ...extra })}`;
  const retour = first(sp.app) ? `/tracing?app=${encodeURIComponent(first(sp.app)!)}` : "/tracing";

  const elements: ElementCascade[] = spans.map((s, i) => ({
    id: s.span_id,
    piste: pisteDe(s),
    libelle: s.name ?? tierLabel(s),
    debutMs: starts[i] - t0,
    dureeMs: s.duration_ms,
    ton: tonDe(s.status_code),
    parentId: s.parent_span_id,
    href: lienTrace(s.span_id),
    detail: s.status_code != null ? `HTTP ${s.status_code}` : undefined,
  }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Détail de la trace"
        domain="robot"
        sub="Pour cet appel, où est passé le temps, segment par segment, et qu'a vécu le visiteur à ce moment ?"
      >
        <Link href={retour} className="btn-ghost">
          ← Tracing
        </Link>
      </PageHeader>

      {/* TD1 — identité de l'appel : des puces, pas une mesure agrégée. */}
      <section aria-label="Identité de l'appel" className="mb-5 flex flex-col gap-3">
        <CopierTrace traceId={traceId} />
        <dl className="flex flex-wrap gap-1.5" data-testid="trace-puces">
          {front && (
            <Puce label="Appel" testId="trace-appel">
              <span title={`${front.method ?? ""} ${front.url ?? ""}`.trim()}>
                {`${front.method ?? ""} ${front.url ?? "(sans URL)"}`.trim()}
              </span>
            </Puce>
          )}
          <Puce label="Latence perçue" testId="trace-latence">
            {formater("ms", rootMs)}
          </Puce>
          <Puce label="Segments">{formater("count", spans.length)}</Puce>
          <Puce label="Route">
            <span title={front?.route ?? front?.url ?? undefined}>{front?.route ?? front?.url ?? "—"}</span>
          </Puce>
          <Puce label="Session" testId="trace-session">
            {sessionSpan?.session_id ? (
              // L'app du span accompagne le lien : la page session refuse une
              // session d'une autre app que celle annoncée.
              <Link href={lienSession(sessionSpan.session_id, sessionSpan.app_id)} className="font-mono text-brand hover:underline">
                {sessionSpan.session_id.slice(0, 8)}…
              </Link>
            ) : (
              "—"
            )}
          </Puce>
          {appsDistinctes.length > 1 && (
            <Puce label="Apps" testId="trace-apps">
              {appsDistinctes.join(", ")}
            </Puce>
          )}
        </dl>

        {fronts.length > 1 && !designe && (
          <p role="note" className="text-xs text-ink-soft" data-testid="trace-plusieurs-appels">
            Cette trace est celle d&apos;une page vue : elle porte {fronts.length} appels navigateur. Le premier est
            résumé ci-dessus ; un clic sur un segment de la chronologie résume son appel.
          </p>
        )}

        {/* TD3 — rejeu à l'instant de l'appel. */}
        <p className="text-sm" data-testid="trace-rejeu">
          {!sessionSpan?.session_id ? (
            <span className="text-ink-soft">Appel sans session (hors navigateur) : pas de rejeu.</span>
          ) : session && !session.ok ? (
            <span className="text-ink-soft">Session non lue (lecture en échec) : rejeu indisponible.</span>
          ) : sessionLisible && instantAppel !== null ? (
            <Link
              href={lienSession(sessionSpan.session_id, sessionSpan.app_id, { tab: "replay", at: String(instantAppel) })}
              className="font-medium text-perf underline-offset-2 hover:underline"
              data-testid="rejeu-appel"
            >
              Rejeu à l&apos;instant de l&apos;appel →
            </Link>
          ) : sessionLisible ? (
            <span className="text-ink-soft">Aucun segment navigateur : l&apos;instant de l&apos;appel est inconnu, pas de rejeu.</span>
          ) : (
            <span className="text-ink-soft">Session introuvable (purgée par la rétention ou hors périmètre) : pas de rejeu.</span>
          )}
        </p>
      </section>

      {/* Bandeaux d'état. */}
      <div className="mb-5 flex flex-col gap-3">
        {!hasBackend && (
          <EtatSurface
            etat={{
              kind: "non_collecte",
              manque: "aucun span serveur reçu pour cette trace : déployez le middleware MIP ou un agent OpenTelemetry",
            }}
          />
        )}
        {spanState && (
          <p
            role="status"
            data-testid="trace-span-state"
            data-span-state={spanState}
            className={`rounded-lg border px-4 py-3 text-sm ${
              spanState === "found" ? "border-perf/40 bg-perf/10 text-ink" : "border-warn/40 bg-warn/10 text-ink-soft"
            }`}
          >
            {/* Le segment se désigne depuis une erreur (span parent) OU d'un clic dans la
                cascade : le texte ne présume plus d'où vient la demande. */}
            {spanState === "found"
              ? "Segment demandé mis en évidence dans la chronologie."
              : "Segment introuvable dans cette trace (ou hors des applications affichées)."}
          </p>
        )}
      </div>

      {/* TD2 — la cascade, pleine largeur. */}
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

      {/* TD4 — erreurs JS qui portent cet identifiant de trace. */}
      <section id="erreurs-liees" className="card mt-6 min-w-0 p-4 sm:p-5" data-testid="erreurs-liees">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Erreurs liées à cette trace</h2>
        {!erreurs.ok ? (
          <EchecLecture titre="Erreurs liées à cette trace" />
        ) : erreurs.data.length === 0 ? (
          <p className="text-sm text-ink-soft">Aucune erreur JS ne porte cet identifiant de trace.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60">
            {erreurs.data.map((e) => (
              <li key={`${e.app_id}-${e.fingerprint}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <Link
                  href={`/errors/${encodeURIComponent(e.fingerprint)}?app=${encodeURIComponent(e.app_id)}`}
                  className="min-w-0 max-w-full flex-1 truncate font-medium text-ink hover:text-brand hover:underline"
                  title={e.message ?? e.fingerprint}
                >
                  {e.message ?? "(sans message)"}
                </Link>
                <span className="shrink-0 font-mono text-xs text-ink-soft">{e.fingerprint.slice(0, 12)}</span>
                <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                  {formater("count", e.occurrences)} occurrence{e.occurrences > 1 ? "s" : ""}
                </span>
                {appsDistinctes.length > 1 && <span className="shrink-0 text-xs text-ink-soft">{e.app_id}</span>}
                {e.source_parent_span_id && (
                  <Link href={lienTrace(e.source_parent_span_id)} className="shrink-0 text-xs text-perf underline-offset-2 hover:underline">
                    Segment parent
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* TD5 — table des segments : les lignes de la cascade, avec statut et app. */}
      <section className="card mt-6 min-w-0 p-4 sm:p-5" data-testid="table-segments">
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Segments</h2>
        {/* `relative` : la légende est `sr-only`, donc en position ABSOLUE ; sans
            ancêtre positionné, elle se placerait par rapport à la page et la
            pousserait quand la table est plus large que l'écran (piège constaté
            sur la table des appels de /tracing). */}
        <div className="relative overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Segments de la trace, dans l&apos;ordre de leur début</caption>
            <thead className="bg-panel2">
              <tr>
                <th scope="col" className="th sticky left-0 z-10 bg-panel2">Segment</th>
                <th scope="col" className="th">Piste</th>
                <th scope="col" className="th">Début</th>
                <th scope="col" className="th">Durée</th>
                <th scope="col" className="th">Statut</th>
                <th scope="col" className="th">App</th>
              </tr>
            </thead>
            <tbody>
              {spans.map((s, i) => (
                <tr key={s.span_id} className="border-t border-line/60">
                  <th scope="row" className="sticky left-0 z-10 max-w-[14rem] bg-panel px-4 py-2 text-left font-normal">
                    <span className="block truncate" title={s.name ?? tierLabel(s)}>
                      {s.name ?? tierLabel(s)}
                    </span>
                  </th>
                  <td className="whitespace-nowrap px-4 py-2 text-ink-soft">{tierLabel(s)}</td>
                  <td className="px-4 py-2 tabular-nums">+{texteDuree(starts[i] - t0)}</td>
                  <td className="px-4 py-2 tabular-nums">{texteDuree(s.duration_ms)}</td>
                  <td className="px-4 py-2 tabular-nums">{s.status_code ?? "—"}</td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-ink-soft">{s.app_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
