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
import { fmtInstant } from "@/lib/format";


/** Instant de l'appel en millisecondes epoch : le `at` du rejeu (`app/sessions/[id]/page.tsx`). */
export function instantAppelMs(ts: Date | string): number {
  return new Date(ts).getTime();
}

/** L'appel a-t-il échoué ? Même prédicat que `apiCallsDecomposition.err`. */
export function appelEnEchec(statut: number | null): boolean {
  return (statut ?? 0) >= 400 || (statut ?? 0) === 0;
}

/** Cellule chiffrée : une carte sous 640 px (libellé écrit devant), une cellule au-delà. */
const CHIFFRE =
  "mr-4 mt-1 inline-flex items-baseline gap-1 text-xs tabular-nums sm:mr-0 sm:mt-0 sm:table-cell sm:px-4 sm:py-3 sm:text-sm";

/**
 * Ligne détaillant une trace lente ; les filtres suivent ses liens.
 *
 * UNE CARTE SOUS 640 PX (recette du 26/09/2026). À 390 px, le tableau ne montrait que
 * l'heure et l'appel : Navigateur, Serveur et Trajet — la raison d'être du tableau —
 * restaient hors champ, derrière un défilement. Sous 640 px, chaque trace devient une
 * carte : heure et appel, puis les trois durées libellées, puis la session et son rejeu.
 */
export function SlowRow({ t, query }: { t: SlowTrace; query: AnalyticsQuery }) {
  const echec = appelEnEchec(t.front_status);
  const at = instantAppelMs(t.ts);
  return (
    <tr
      className="block border-t border-line/60 px-4 py-3 transition hover:bg-panel2/60 sm:table-row sm:p-0"
      data-testid="trace-lente"
      data-appel={`${t.method} ${t.url}`}
    >
      <td className="block text-xs tabular-nums text-ink-soft sm:sticky sm:left-0 sm:table-cell sm:bg-panel sm:px-4 sm:py-3">
        {fmtInstant(t.ts, { secondes: true, sansA: true })}
      </td>
      <td className="mt-1 block min-w-0 font-mono text-xs sm:mt-0 sm:table-cell sm:max-w-[18rem] sm:px-4 sm:py-3">
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
      <td className={CHIFFRE}>
        <span className="text-ink-soft sm:hidden">Statut</span>
        <span
          className={`rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${
            echec ? "border-bad/30 bg-bad/10 text-bad-ink" : "border-line bg-panel2 text-ink-soft"
          }`}
        >
          {t.front_status || "réseau"}
        </span>
      </td>
      <td className={`${CHIFFRE} font-semibold`}>
        <span className="font-normal text-ink-soft sm:hidden">Navigateur</span>
        {formater("ms", t.front_ms)}
      </td>
      <td className={CHIFFRE}>
        <span className="text-ink-soft sm:hidden">Serveur</span>
        {t.back_ms == null ? <span className="text-ink-soft">non suivi</span> : formater("ms", t.back_ms)}
      </td>
      <td className={CHIFFRE}>
        <span className="text-ink-soft sm:hidden">Trajet</span>
        {t.network_ms == null ? <span className="text-ink-soft">—</span> : formater("ms", t.network_ms)}
      </td>
      <td className="mt-2 block text-xs sm:mt-0 sm:table-cell sm:px-4 sm:py-3">
        {t.session_id ? (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 sm:flex-col">
            <Link href={hrefWithQuery(`/sessions/${encodeURIComponent(t.session_id)}`, query)} className="font-mono text-brand hover:underline">
              <span className="text-ink-soft sm:hidden">Session </span>
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
