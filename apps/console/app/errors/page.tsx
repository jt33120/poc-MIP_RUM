import Link from "next/link";
import { Sparkline } from "@/components/features/Sparkline";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import { fmtDate } from "@/lib/format";
import {
  errorGroups,
  errorSparklines,
  filtersToQuery,
  parseFilters,
  periodLabel,
  periodNombreDeSeaux,
  periodSeauLabel,
  periodSeauSecondes,
  unfingerprintedCount,
  type SearchParams,
} from "@/lib/queries-v2";

export const dynamic = "force-dynamic";

export default async function Errors({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const f = parseFilters(await searchParams);
  const groups = await errorGroups(f);
  const [sparklines, legacyCount] = await Promise.all([
    errorSparklines(groups.map((g) => g.fingerprint), f),
    unfingerprintedCount(f),
  ]);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Erreurs JS"
        sub="Erreurs JavaScript regroupées par signature (type + message + frame) — une ligne = une cause récurrente."
      />

      {(() => {
        // Hero : volume d'erreurs par seau SUR LA PÉRIODE CHOISIE, empilé par
        // groupe dominant. Le graphique était figé sur 24 h pendant que le
        // classement des groupes, lui, suivait la période : sur 7 jours, on
        // empilait les 24 dernières heures des groupes classés sur la semaine.
        // errorSparklines : index 0 = seau le plus ancien, dernier = seau courant.
        const PALETTE = ["#ef4444", "#f89101", "#d97706", "#7c3aed", "#2563eb"];
        const TOP_N = 5;
        const top = groups.slice(0, TOP_N);
        const nbSeaux = periodNombreDeSeaux(f);
        const seauMs = periodSeauSecondes(f) * 1000;
        const now = Date.now();
        const stackData = Array.from({ length: nbSeaux }, (_v, i) => {
          const t = new Date(now - (nbSeaux - 1 - i) * seauMs);
          const row: Record<string, number | string> = {
            // Sur 7 jours l'heure seule est ambiguë : on date les seaux longs.
            h:
              seauMs >= 6 * 3_600_000
                ? t.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit" })
                : t.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
          };
          top.forEach((g, gi) => {
            row[`g${gi}`] = (sparklines.get(g.fingerprint) ?? [])[i] ?? 0;
          });
          row.autres = groups
            .slice(TOP_N)
            .reduce((s, g) => s + ((sparklines.get(g.fingerprint) ?? [])[i] ?? 0), 0);
          return row;
        });
        const series: StackSeries[] = top.map((g, gi) => ({
          key: `g${gi}`,
          name: (g.error_type ?? "Error").slice(0, 22),
          color: PALETTE[gi],
        }));
        if (groups.length > TOP_N) series.push({ key: "autres", name: "autres", color: "#94a3b8" });
        const total24 = stackData.reduce(
          (s, r) => s + series.reduce((a, se) => a + (Number(r[se.key]) || 0), 0),
          0,
        );
        const peak = stackData.reduce(
          (mx, r) => Math.max(mx, series.reduce((a, se) => a + (Number(r[se.key]) || 0), 0)),
          0,
        );
        // `totalOcc` est désormais VRAI : depuis que les compteurs sont bornés
        // par la fenêtre, la somme correspond au libellé de la tuile. Avant, elle
        // annonçait « Occurrences · 1 h » et affichait le cumul depuis toujours.
        const totalOcc = groups.reduce((s, g) => s + g.occurrences, 0);
        return (
          <SupervisionHero
            chartTitle={`Volume d'erreurs par ${periodSeauLabel(f)} (${periodLabel(f)}) — par groupe`}
            chart={
              groups.length ? (
                <StackedBars data={stackData} xKey="h" series={series} yUnit="" />
              ) : (
                <p className="py-12 text-center text-sm text-ink-faint">Aucune erreur sur la période 🎉</p>
              )
            }
          >
            <HeroStat
              label={`Occurrences · ${periodLabel(f)}`}
              value={totalOcc.toLocaleString("fr-FR")}
              tone={totalOcc > 0 ? "warn" : "good"}
            />
            <HeroStat label="Groupes distincts" value={groups.length.toLocaleString("fr-FR")} />
            <HeroStat
              label={`Pic par ${periodSeauLabel(f)}`}
              value={peak.toLocaleString("fr-FR")}
              hint={`${total24.toLocaleString("fr-FR")} erreurs sur ${periodLabel(f)}`}
            />
            <HeroReading>
              Chaque colonne = {periodSeauLabel(f)}, empilée par groupe d&apos;erreur dominant (les autres
              regroupés en gris). Une barre haute isolée = un pic à investiguer. Tous les compteurs de cet
              écran portent sur {periodLabel(f)} — sauf « Première vue », qui remonte à la première
              apparition connue, par définition hors fenêtre.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Groupe</th>
              <th className="th">Occurrences</th>
              <th className="th">Sessions</th>
              <th className="th">Utilisateurs</th>
              <th className="th">{periodLabel(f)}</th>
              <th className="th" title="Première apparition connue, toutes fenêtres confondues — bornée seulement par la rétention.">
                Première vue <span className="font-normal text-ink-faint">(depuis toujours)</span>
              </th>
              <th className="th">Dernière vue</th>
              <th className="th" />
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const href = `/errors/${encodeURIComponent(g.fingerprint)}${filtersToQuery(f)}`;
              const dim = g.status !== "open" && !g.regressed;
              return (
                <tr
                  key={`${g.app_id}|${g.fingerprint}`}
                  className={`border-t border-line/60 transition hover:bg-panel2/60 ${dim ? "opacity-60" : ""}`}
                  data-testid={`error-group-${g.fingerprint}`}
                >
                  <td className="max-w-md px-4 py-3">
                    <Link href={href} className="block">
                      <span className="mr-2 rounded border border-red-300 bg-red-100 px-1.5 py-0.5 font-mono text-xs text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
                        {g.error_type ?? "Error"}
                      </span>
                      {g.regressed && (
                        <span className="mr-2 rounded-full border border-amber-400/50 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
                          ⚠ régression
                        </span>
                      )}
                      {g.status === "resolved" && !g.regressed && (
                        <span className="mr-2 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
                          résolue
                        </span>
                      )}
                      {g.status === "ignored" && (
                        <span className="mr-2 rounded-full border border-line bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
                          ignorée
                        </span>
                      )}
                      <span className="font-medium text-ink" title={g.sample_message ?? ""}>
                        {(g.sample_message ?? "(sans message)").slice(0, 120)}
                      </span>
                      <span className="mt-0.5 block font-mono text-xs text-ink-faint">
                        {g.fingerprint} · {g.app_id}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-bold tabular-nums" data-testid="group-occurrences">
                    {g.occurrences}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{g.sessions}</td>
                  <td className="px-4 py-3 tabular-nums">{g.users_affected}</td>
                  <td className="px-4 py-3">
                    <Sparkline
                      values={sparklines.get(g.fingerprint) ?? new Array(periodNombreDeSeaux(f)).fill(0)}
                    />
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{fmtDate(g.first_seen)}</td>
                  <td className="px-4 py-3 text-xs text-ink-soft">{fmtDate(g.last_seen)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={href} className="text-xs font-medium text-brand hover:underline">
                      détail →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {!groups.length && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  Aucun groupe d&apos;erreur sur la période 🎉
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {legacyCount > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {legacyCount} erreur(s) v0.1 sans fingerprint (antérieures à la migration) non groupées.
        </p>
      )}
    </div>
  );
}
