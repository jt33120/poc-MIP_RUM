import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { RankBar } from "@/components/charts/RankBar";
import { getUser } from "@/lib/auth";
import { FilterProblemNotice } from "@/components/FilterProblemNotice";
import type { SearchParams } from "@/lib/filters";
import { pageFilters } from "@/lib/page-filters";
import { PERIODS } from "@/lib/filters";
import { listApps } from "@/lib/queries";
import { listGoals } from "@/lib/queries-goals";
import { goalConversions } from "@/lib/queries-goals";
import { createGoalAction, deleteGoalAction, toggleGoalAction } from "./actions";

export const dynamic = "force-dynamic";

const pctFmt = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)} %`);

export default async function Goals({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const ecran = await pageFilters(sp, "/goals");
  if (!ecran.ok) return <FilterProblemNotice title="Objectifs" problem={ecran.problem} />;
  const f = ecran.filters;
  const period = PERIODS[f.period];
  const [user, { total, rows }] = await Promise.all([getUser(), goalConversions(f)]);
  const isAdmin = user?.role === "admin";
  const [apps, allGoals] = isAdmin
    ? await Promise.all([listApps(), listGoals(f.app)])
    : [[], []];
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Objectifs"
        sub={
          <>
            Taux de conversion par objectif (page vue ou événement atteint au moins une fois par
            session) · {total.toLocaleString("fr-FR")} session(s)
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          Champs invalides — objectif non créé.
        </div>
      )}

      {rows.length > 0 && (() => {
        // Un taux `null` (aucune session sur la fenêtre) n'entre pas dans le
        // classement : une barre de longueur nulle se lirait « 0 % ».
        const byRate = rows
          .filter((g): g is typeof g & { rate: number } => g.rate != null)
          .sort((a, b) => b.rate - a.rate);
        const best = byRate[0];
        const topConv = [...rows].sort((a, b) => b.conversions - a.conversions)[0];
        return (
          <SupervisionHero
            chartTitle="Taux de conversion par objectif"
            chart={
              <RankBar
                data={byRate.slice(0, 8).map((g) => ({
                  label: g.name,
                  value: g.rate * 100,
                  display: pctFmt(g.rate),
                  color: "#059669",
                  sub: `${g.conversions.toLocaleString("fr-FR")} conversions`,
                  title: `${g.name} — ${pctFmt(g.rate)} (${g.conversions} conversions)`,
                }))}
                max={100}
                labelWidth="12rem"
              />
            }
          >
            <HeroStat label={`Sessions · ${period.label}`} value={total.toLocaleString("fr-FR")} />
            <HeroStat label="Objectifs suivis" value={rows.length.toLocaleString("fr-FR")} />
            <HeroStat
              label="Meilleur taux"
              value={best ? pctFmt(best.rate) : "—"}
              tone="good"
              hint={best?.name}
            />
            <HeroReading>
              Chaque barre = un objectif, longueur = sa part de sessions qui l&apos;atteignent (échelle
              absolue 0–100 %). {topConv ? `« ${topConv.name} » concentre le plus de conversions en volume. ` : ""}
              Les objectifs sont indépendants (pas des étapes d&apos;un même entonnoir). Détail et gestion
              ci-dessous.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

      <div className="card mb-8 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Objectif</th>
              <th className="th">Condition</th>
              <th className="th">Conversions</th>
              <th className="th w-48">Taux</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {rows.map((g) => (
              <tr key={g.id} className="transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-medium text-ink">{g.name}</td>
                <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                  {g.kind === "event" ? "événement" : "page"} {g.match_type === "contains" ? "⊃" : "="}{" "}
                  {g.pattern}
                </td>
                <td className="px-4 py-2 tabular-nums text-ink-soft">{g.conversions.toLocaleString("fr-FR")}</td>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-panel2">
                      {g.rate != null && (
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(100, g.rate * 100)}%` }} />
                      )}
                    </div>
                    <span className="w-14 text-right text-xs font-semibold tabular-nums">{pctFmt(g.rate)}</span>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-ink-faint">
                  Aucun objectif actif{isAdmin ? " — crées-en un ci-dessous" : ""}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isAdmin && (
        <>
          <h2 className="mb-3 text-sm font-semibold text-ink-soft">Gérer les objectifs (admin)</h2>
          <div className="card mb-6 p-4">
            <form action={createGoalAction} className="flex flex-wrap items-end gap-3" data-testid="create-goal">
              <label className="text-xs font-medium text-ink-soft">
                App
                <select name="app" className="field mt-1 block" required defaultValue={f.app ?? ""}>
                  <option value="" disabled>
                    choisir…
                  </option>
                  {apps.map((a) => (
                    <option key={a.app_id} value={a.app_id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs font-medium text-ink-soft">
                Nom
                <input name="name" required placeholder="Inscription" className="field mt-1 block w-40" />
              </label>
              <label className="text-xs font-medium text-ink-soft">
                Type
                <select name="kind" className="field mt-1 block">
                  <option value="pageview">page vue</option>
                  <option value="event">événement</option>
                </select>
              </label>
              <label className="text-xs font-medium text-ink-soft">
                Correspondance
                <select name="match_type" className="field mt-1 block">
                  <option value="exact">exacte</option>
                  <option value="contains">contient</option>
                </select>
              </label>
              <label className="text-xs font-medium text-ink-soft">
                Motif
                <input name="pattern" required placeholder="/merci ou nom_evenement" className="field mt-1 block w-52 font-mono text-xs" />
              </label>
              <button type="submit" className="btn-accent">
                Créer
              </button>
            </form>
          </div>

          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Objectif</th>
                  <th className="th">App</th>
                  <th className="th">Condition</th>
                  <th className="th">Statut</th>
                  <th className="th">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {allGoals.map((g) => (
                  <tr key={g.id} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-medium text-ink">{g.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">{g.app_id}</td>
                    <td className="px-4 py-2 font-mono text-xs text-ink-soft">
                      {g.kind} {g.match_type === "contains" ? "⊃" : "="} {g.pattern}
                    </td>
                    <td className="px-4 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${g.active ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-panel2 text-ink-faint"}`}>
                        {g.active ? "actif" : "inactif"}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-2">
                        <form action={toggleGoalAction}>
                          <input type="hidden" name="id" value={g.id} />
                          <button type="submit" className="btn-ghost px-2 py-1">
                            {g.active ? "Désactiver" : "Activer"}
                          </button>
                        </form>
                        <form action={deleteGoalAction}>
                          <input type="hidden" name="id" value={g.id} />
                          <button type="submit" className="btn-ghost px-2 py-1 text-red-600 dark:text-red-400">
                            Supprimer
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
                {!allGoals.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-ink-faint">
                      Aucun objectif défini
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
