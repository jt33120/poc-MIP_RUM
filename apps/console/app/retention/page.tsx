import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { LineTrend } from "@/components/charts/LineTrend";
import { parseFilters, type SearchParams } from "@/lib/filters";
import { retentionCohorts, weekIndexToDate } from "@/lib/queries-cohorts";

export const dynamic = "force-dynamic";

const WEEK_CHOICES = [4, 8, 12];
const fmtWeek = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });

export default async function Retention({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);
  const wRaw = Number(typeof sp.weeks === "string" ? sp.weeks : 8);
  const weeks = Number.isFinite(wRaw) ? Math.min(26, Math.max(2, Math.trunc(wRaw))) : 8;
  const cohorts = await retentionCohorts(f, weeks);
  const cols = Math.max(0, ...cohorts.map((c) => c.cells.length)); // nb de colonnes d'offset

  const weekHref = (w: number) => {
    const p = new URLSearchParams(
      Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "weeks" ? [[k, v] as [string, string]] : [])),
    );
    p.set("weeks", String(w));
    return `/retention?${p.toString()}`;
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Rétention"
        sub="Part des visiteurs identifiés qui reviennent, par cohorte de première activité hebdomadaire."
      />

      <div className="mb-4 flex items-center gap-2 text-xs">
        <span className="text-ink-faint">Fenêtre :</span>
        {WEEK_CHOICES.map((w) => (
          <Link
            key={w}
            href={weekHref(w)}
            className={`rounded-full border px-2.5 py-1 font-medium transition ${
              w === weeks ? "border-brand bg-brand/10 text-brand" : "border-line text-ink-soft hover:bg-panel2"
            }`}
          >
            {w} sem.
          </Link>
        ))}
      </div>

      {!cohorts.length ? (
        <div className="card p-8 text-center text-ink-faint">
          Aucun visiteur identifié sur la fenêtre. Les sessions collectées avant le 09/09/2026 ne portent pas
          d&apos;identifiant de visiteur et n&apos;entrent donc dans aucune cohorte.
        </div>
      ) : (
        <>
          {(() => {
            // Courbe de rétention moyenne : à chaque offset S+o, part retenue
            // pondérée par la taille des cohortes ayant atteint cet offset.
            const curve = Array.from({ length: cols }, (_v, o) => {
              let ret = 0;
              let size = 0;
              for (const c of cohorts) {
                const cell = c.cells[o];
                if (cell) {
                  ret += cell.retained;
                  size += c.size;
                }
              }
              return { label: `S+${o}`, value: size ? Math.round((ret / size) * 100) : 0 };
            });
            const totalUsers = cohorts.reduce((s, c) => s + c.size, 0);
            const s1 = curve[1]?.value;
            const s4 = curve[4]?.value;
            return (
              <SupervisionHero
                chartTitle="Courbe de rétention moyenne"
                chart={
                  cols > 1 ? (
                    <LineTrend data={curve} valueName="Rétention" valueUnit="%" color="#059669" domain={[0, 100]} />
                  ) : (
                    <p className="py-12 text-center text-sm text-ink-faint">
                      Pas encore assez de recul (une seule semaine observée).
                    </p>
                  )
                }
              >
                <HeroStat label="Cohortes suivies" value={cohorts.length.toLocaleString("fr-FR")} hint={`${totalUsers.toLocaleString("fr-FR")} utilisateurs`} />
                <HeroStat
                  label="Rétention S+1"
                  value={s1 != null ? `${s1} %` : "—"}
                  tone={s1 != null ? (s1 >= 40 ? "good" : s1 >= 20 ? "warn" : "poor") : "neutral"}
                  hint="reviennent la semaine suivante"
                />
                <HeroStat label="Rétention S+4" value={s4 != null ? `${s4} %` : "—"} hint="4 semaines après" />
                <HeroReading>
                  La courbe montre la vitesse de décrochage : chute forte entre S+0 et S+1 = problème
                  d&apos;activation ; plateau = cœur d&apos;utilisateurs fidèles. Le détail cohorte par cohorte
                  est dans la matrice ci-dessous.
                </HeroReading>
              </SupervisionHero>
            );
          })()}
          <div className="card overflow-x-auto p-4">
          <table className="text-sm">
            <thead>
              <tr className="text-ink-faint">
                <th className="px-3 py-2 text-left text-xs font-semibold">Cohorte</th>
                <th className="px-3 py-2 text-right text-xs font-semibold">Taille</th>
                {Array.from({ length: cols }, (_, o) => (
                  <th key={o} className="px-3 py-2 text-center text-xs font-semibold">
                    S+{o}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.cohort}>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs text-ink-soft">
                    sem. {fmtWeek(weekIndexToDate(c.cohort))}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-soft">{c.size}</td>
                  {Array.from({ length: cols }, (_, o) => {
                    const cell = c.cells[o];
                    if (!cell) return <td key={o} className="px-1 py-1.5" />;
                    const light = cell.rate < 0.5;
                    return (
                      <td key={o} className="px-1 py-1.5 text-center">
                        <div
                          className="mx-auto w-14 rounded py-1 text-xs font-semibold tabular-nums"
                          style={{
                            backgroundColor: `rgba(16, 185, 129, ${(0.12 + cell.rate * 0.88).toFixed(3)})`,
                            color: light ? "rgb(6,78,59)" : "white",
                          }}
                          title={`${cell.retained} / ${c.size}`}
                        >
                          {Math.round(cell.rate * 100)}%
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>
      )}
      <p className="mt-3 text-[11px] text-ink-faint">
        S+0 = semaine de la cohorte (100 %). Les cases vides correspondent à des semaines encore à venir
        pour une cohorte récente (matrice triangulaire).
      </p>
    </div>
  );
}
