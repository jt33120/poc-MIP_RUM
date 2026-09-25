// LE CHARGEUR DE LA PAGE D'UNE TRACE (C4) — `app/tracing/[traceId]/page.tsx`.
//
// Un trace_id est émis par le client : deux tenants peuvent le partager, et le
// lien depuis une erreur de l'app A (P5.1) ne doit rien révéler de B. Les spans,
// les erreurs liées et la session ne sont lus que dans les apps autorisées ET
// demandées (`traceApps`) ; une trace dont il ne reste rien est introuvable, sans
// dire si elle existe ailleurs.
import { sessionMeta } from "../queries";
import { errorsOfTrace, traceSpans, type TraceSpanRow } from "../queries-tracing";
import { authorizedAppsOf } from "../query-contract";
import { mapSection, section, type Chargeur, type ParametresEcran } from "./commun";

const SPAN_ID = /^[0-9a-f]{16}$/i;

export function premier(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Apps dont la trace montre les spans. L'app demandée est bornée au périmètre
 * signé ; hors périmètre, aucune app. Sans app demandée (ou « all »), un
 * utilisateur restreint voit ses apps et un admin toute la trace.
 */
function traceApps(requested: string | undefined, scope: string[] | null): string[] | null {
  const app = requested && requested !== "all" ? requested : null;
  if (!app) return scope;
  return scope && !scope.includes(app) ? [] : [app];
}

/**
 * L'APPEL RÉSUMÉ d'une trace, et le span mis en évidence : ceux de `?span=` s'il est
 * parmi les spans lus, sinon le premier appel. La MÊME fonction pour le chargeur
 * (quelle session lire) et la page (quoi afficher).
 */
export function appelDeLaTrace<S extends Pick<TraceSpanRow, "span_id" | "parent_span_id" | "tier" | "session_id">>(
  spans: readonly S[],
  sp: ParametresEcran,
) {
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const spanParam = premier(sp.span);
  const wantedSpan = spanParam && SPAN_ID.test(spanParam) ? spanParam.toLowerCase() : null;
  const highlighted = wantedSpan && byId.has(wantedSpan) ? wantedSpan : null;
  const spanState = spanParam === undefined ? null : highlighted ? ("found" as const) : ("missing" as const);
  const fronts = spans.filter((s) => s.tier === "front");
  const appelDe = (id: string | null): S | undefined => {
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
  return { byId, highlighted, spanState, fronts, designe, front, sessionSpan };
}

/** `traceId` : l'identifiant DÉCODÉ (la page décode le segment d'URL, le routeur du service aussi). */
export const chargerTrace = (async (principal, sp, { traceId = "" }) => {
  const perimetre = authorizedAppsOf(principal);
  const apps = traceApps(premier(sp.app), perimetre);
  // Les spans hors périmètre ne sont jamais lus.
  const spans = await traceSpans(traceId, { apps });
  if (spans.length === 0) return { etat: "introuvable" } as const;
  const { sessionSpan } = appelDeLaTrace(spans, sp);
  // Erreurs liées (TD4) et session (TD3), lues pour elles-mêmes : un échec ne fait
  // tomber que leur bloc, jamais la cascade.
  const [erreurs, sessionLue] = await Promise.all([
    section(() => errorsOfTrace(traceId, { apps })),
    sessionSpan?.session_id ? section(() => sessionMeta(sessionSpan.session_id!)) : Promise.resolve(null),
  ]);
  // Session LISIBLE : elle existe encore, dans l'app du span et dans le périmètre.
  // Seul ce verdict voyage : l'écran n'affiche rien d'autre de la session.
  const session =
    sessionLue === null
      ? null
      : mapSection(sessionLue, (m) => ({
          lisible: !!m && m.app_id === sessionSpan?.app_id && (perimetre === null || perimetre.includes(m.app_id)),
        }));
  return { etat: "ok", spans, erreurs, session } as const;
}) satisfies Chargeur<unknown>;
