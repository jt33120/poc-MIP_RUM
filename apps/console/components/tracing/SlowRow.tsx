// Ligne du tableau « Traces les plus lentes » (§ 5.8, T9) : un appel navigateur,
// sa durée décomposée TRACE PAR TRACE (serveur, trajet), le lien vers le détail de
// la trace, la session et son rejeu à l'instant de l'appel. Rendu serveur.
//
// « non suivi », jamais « 0 ms » : sans jumeau serveur (middleware absent, appel
// vers un tiers), la durée serveur est INCONNUE, pas nulle (V3).
//
// La couleur du statut est une sévérité (échec : statut ≥ 400, ou 0 = coupure
// réseau, requête annulée), jamais un verdict « vert » : un 200 n'a pas de seuil.
import Link from "next/link";
import type { SlowTrace } from "@/lib/queries-tracing";
import { hrefWithQuery, type AnalyticsQuery } from "@/lib/query-contract";
import { formater } from "@/lib/fmt-ids";

const HEURE_UTC = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "UTC",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Instant de l'appel en millisecondes epoch : le `at` du rejeu (`app/sessions/[id]/page.tsx`). */
export function instantAppelMs(ts: Date | string): number {
  return new Date(ts).getTime();
}

/** L'appel a-t-il échoué ? Même prédicat que `apiCallsDecomposition.err`. */
export function appelEnEchec(statut: number | null): boolean {
  return (statut ?? 0) >= 400 || (statut ?? 0) === 0;
}

/** Ligne détaillant une trace lente ; les filtres suivent ses liens. */
export function SlowRow({ t, query }: { t: SlowTrace; query: AnalyticsQuery }) {
  const echec = appelEnEchec(t.front_status);
  const at = instantAppelMs(t.ts);
  return (
    <tr className="border-t border-line/60 transition hover:bg-panel2/60" data-testid="trace-lente" data-appel={`${t.method} ${t.url}`}>
      <td className="sticky left-0 bg-panel px-4 py-3 text-xs tabular-nums text-ink-soft">
        {HEURE_UTC.format(new Date(t.ts))} UTC
      </td>
      <td className="max-w-[18rem] px-4 py-3 font-mono text-xs">
        {/* `span=` : une trace de page vue porte tous ses appels (E0) ; le détail
            résume CELUI-CI (latence, route, instant du rejeu), pas le premier venu. */}
        <Link
          href={hrefWithQuery(`/tracing/${encodeURIComponent(t.trace_id)}`, query, { span: t.span_id })}
          className="group inline-flex min-w-0 max-w-full items-center gap-1.5 hover:text-brand"
          title={`Détail de la trace ${t.trace_id}`}
        >
          <span className="shrink-0 rounded bg-panel2 px-1.5 py-0.5 font-semibold text-ink-soft">{t.method}</span>
          <span className="block min-w-0 truncate group-hover:underline">{t.url || "(sans URL)"}</span>
        </Link>
      </td>
      <td className="px-4 py-3">
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${
            echec ? "border-bad/30 bg-bad/10 text-bad-ink" : "border-line bg-panel2 text-ink-soft"
          }`}
        >
          {t.front_status || "réseau"}
        </span>
      </td>
      <td className="px-4 py-3 font-semibold tabular-nums">{formater("ms", t.front_ms)}</td>
      <td className="px-4 py-3 tabular-nums">
        {t.back_ms == null ? <span className="text-ink-soft">non suivi</span> : formater("ms", t.back_ms)}
      </td>
      <td className="px-4 py-3 tabular-nums">{t.network_ms == null ? <span className="text-ink-soft">—</span> : formater("ms", t.network_ms)}</td>
      <td className="px-4 py-3 text-xs">
        {t.session_id ? (
          <span className="flex flex-col gap-0.5">
            <Link href={hrefWithQuery(`/sessions/${encodeURIComponent(t.session_id)}`, query)} className="font-mono text-brand hover:underline">
              {t.session_id.slice(0, 8)}…
            </Link>
            <Link
              href={hrefWithQuery(`/sessions/${encodeURIComponent(t.session_id)}`, query, { tab: "replay", at: String(at) })}
              className="whitespace-nowrap text-perf hover:underline"
              data-testid="rejeu-instant"
            >
              Rejeu à cet instant
            </Link>
          </span>
        ) : (
          <span className="text-ink-soft">appel sans session</span>
        )}
      </td>
    </tr>
  );
}
