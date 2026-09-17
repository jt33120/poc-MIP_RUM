// Tâches longues et Long Animation Frames (P6.3) : série temporelle et chemin
// vers les sessions concernées.
//
// CE QUI N'EST PAS AFFICHÉ, ET POURQUOI. Aucun cumul de durées. Additionner des
// blocages venus de sessions, d'onglets et de visiteurs différents produit un
// nombre de millisecondes qui n'est le temps perdu de personne ; présenté comme
// « temps d'attente », il serait faux d'un facteur égal au nombre de visiteurs.
// On compte donc des BLOCAGES, on en donne le p75 et le pire cas, et on offre le
// cas individuel — la session — plutôt qu'une somme.
import Link from "next/link";
import { StackedBars } from "@/components/charts/StackedBars";
import { bucketTick } from "@/components/errors/error-view";
import { GlossaryTip } from "@/components/GlossaryTip";
import { fmtDate, fmtVital } from "@/lib/format";
import type { LongtaskBucket, LongtaskWorst } from "@/lib/queries-longtasks";

const SERIES = [
  { key: "loaf", name: "Long Animation Frames", color: "#f89101" },
  { key: "longtask", name: "Long Tasks", color: "#2563eb" },
  { key: "inconnu", name: "API non distinguée", color: "#94a3b8" },
];

export function LongtasksView({
  series,
  worst,
  bucketSeconds,
  bucketLabel,
  periodLabel,
  sessionHref,
}: {
  series: LongtaskBucket[];
  worst: LongtaskWorst[];
  bucketSeconds: number;
  bucketLabel: string;
  periodLabel: string;
  /** Lien vers une session, filtres courants conservés. */
  sessionHref: (sessionId: string) => string;
}) {
  const total = series.reduce((somme, point) => somme + point.loaf + point.longtask + point.inconnu, 0);
  const data = series.map((point) => ({
    h: bucketTick(new Date(point.bucket), bucketSeconds),
    loaf: point.loaf,
    longtask: point.longtask,
    inconnu: point.inconnu,
  }));

  return (
    <section className="mb-8" data-testid="longtasks">
      <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
        Blocages du fil principal dans le temps
        <GlossaryTip id="blocages" />
      </h2>
      <div className="card p-4">
        {total > 0 ? (
          <>
            <StackedBars data={data} xKey="h" series={SERIES} yUnit="" />
            <details className="mt-3 text-xs text-ink-soft">
              <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf">
                Alternative textuelle de la série
              </summary>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full">
                  <caption className="sr-only">
                    Blocages par {bucketLabel} sur {periodLabel}, par API de mesure
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="py-1 text-left font-medium">Période</th>
                      <th scope="col" className="py-1 text-right font-medium">LoAF</th>
                      <th scope="col" className="py-1 text-right font-medium">Long Tasks</th>
                      <th scope="col" className="py-1 text-right font-medium">Non distinguées</th>
                      <th scope="col" className="py-1 text-right font-medium">Blocage p75</th>
                    </tr>
                  </thead>
                  <tbody>
                    {series.map((point) => (
                      <tr key={new Date(point.bucket).toISOString()} className="border-t border-line/60">
                        <th scope="row" className="py-1 text-left font-normal">{fmtDate(point.bucket)}</th>
                        <td className="py-1 text-right tabular-nums">{point.loaf.toLocaleString("fr-FR")}</td>
                        <td className="py-1 text-right tabular-nums">{point.longtask.toLocaleString("fr-FR")}</td>
                        <td className="py-1 text-right tabular-nums">{point.inconnu.toLocaleString("fr-FR")}</td>
                        <td className="py-1 text-right tabular-nums">
                          {point.p75_ms == null ? "pas de mesure" : fmtVital("dur", Number(point.p75_ms))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="py-10 text-center text-sm text-ink-faint">
            Aucun blocage mesuré sur {periodLabel}. Long Animation Frames n&apos;existe que sur Chromium ;
            ailleurs, le SDK retombe sur l&apos;API Long Tasks.
          </p>
        )}
        <p className="mt-3 text-xs leading-relaxed text-ink-faint">
          Une colonne = {bucketLabel}, empilée par API de mesure. Les deux API ne sont jamais actives ensemble
          sur un même navigateur : elles restent séparées parce qu&apos;un parc mixte en produit les deux, et
          qu&apos;un blocage compté deux fois n&apos;existe qu&apos;une. <strong>Aucun cumul de durées
          n&apos;est affiché</strong> : des blocages concurrents de plusieurs visiteurs ne s&apos;additionnent
          pas en temps d&apos;attente vécu.
        </p>
      </div>

      <h3 className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        Les blocages les plus longs, et leur session
      </h3>
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Blocages les plus longs sur {periodLabel}, avec leur session</caption>
          <thead className="bg-panel2">
            <tr>
              <th scope="col" className="th">Ce qui a bloqué</th>
              <th scope="col" className="th">Route</th>
              <th scope="col" className="th">Quand</th>
              <th scope="col" className="th text-right">Blocage</th>
              <th scope="col" className="th">Session</th>
            </tr>
          </thead>
          <tbody>
            {worst.map((ligne) => (
              <tr
                key={`${ligne.session_id ?? "-"}|${new Date(ligne.ts).toISOString()}|${ligne.quoi}`}
                className="border-t border-line/60 transition hover:bg-panel2/60"
              >
                <td className="max-w-xs px-4 py-2 font-mono text-xs text-ink" title={ligne.quoi}>
                  {ligne.quoi}
                  {ligne.source && <span className="ml-2 chip-mono text-[10px]">{ligne.source}</span>}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">{ligne.route ?? "—"}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-ink-soft">{fmtDate(ligne.ts)}</td>
                <td className="px-4 py-2 text-right font-medium tabular-nums text-ink">
                  {fmtVital("dur", Number(ligne.blocking_ms))}
                </td>
                <td className="px-4 py-2">
                  {ligne.session_id ? (
                    <Link
                      href={sessionHref(ligne.session_id)}
                      className="rounded font-mono text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      {ligne.session_id.slice(0, 8)}…
                    </Link>
                  ) : (
                    <span className="text-xs text-ink-faint">sans session rattachée</span>
                  )}
                </td>
              </tr>
            ))}
            {!worst.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  Aucun blocage sur {periodLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
