import { PageHeader } from "@/components/PageHeader";
import { SupervisionHero, HeroStat, HeroReading } from "@/components/SupervisionHero";
import { Gauge, type GaugeTone } from "@/components/charts/Gauge";
import { ALERT_METRICS, parseFilters, type SearchParams } from "@/lib/queries-v2";
import { registeredApps } from "@/lib/queries";
import { listSlo, sloStatus } from "@/lib/queries-alerting";
import { createSloAction } from "../alerts/actions";
import { Field, INPUT_CLASS } from "@/components/forms/Field";
import { SloRow } from "@/components/slo/SloStatusRow";

export const dynamic = "force-dynamic";

export default async function Slo({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const sp = (await searchParams) ?? {};
  const f = parseFilters(sp);
  const [statuses, slos, apps] = await Promise.all([sloStatus(f.app), listSlo(f.app), registeredApps()]);
  // slo_status() ne renvoie que les SLO actifs → on indexe pour superposer le statut
  // sur la liste complète (actifs + désactivés), afin de pouvoir réactiver.
  const statusById = new Map(statuses.map((s) => [s.slo_id, s]));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="SLO & error-budget"
        sub={
          <>
            Part des mesures conformes à l&apos;objectif, budget d&apos;erreur restant et vitesse de
            consommation (burn-rate) — un burn trop rapide lève une alerte critique.
          </>
        }
      />

      {statuses.length > 0 && (() => {
        const sloTone = (b: number | null, fast: boolean): GaugeTone => {
          if (fast || (b != null && b >= 100)) return "poor";
          if (b != null && b >= 75) return "warn";
          return "good";
        };
        const breached = statuses.filter((s) => s.burned_pct != null && s.burned_pct >= 100).length;
        const fastBurn = statuses.filter((s) => s.fast_burn).length;
        return (
          <SupervisionHero
            layout="wide"
            chartTitle="Budget d'erreur consommé — par SLO"
            chart={
              <div className="flex flex-wrap gap-x-6 gap-y-4">
                {statuses.slice(0, 10).map((s) => (
                  <Gauge
                    key={s.slo_id}
                    value={s.burned_pct ?? 0}
                    tone={sloTone(s.burned_pct, s.fast_burn)}
                    label={s.name}
                    sub={`${s.metric} · ${s.window_days} j`}
                  />
                ))}
              </div>
            }
          >
            <HeroStat label="SLO actifs" value={statuses.length.toLocaleString("fr-FR")} />
            <HeroStat
              label="En dépassement"
              value={breached.toLocaleString("fr-FR")}
              tone={breached > 0 ? "poor" : "good"}
              hint="budget d'erreur épuisé"
            />
            <HeroStat
              label="Burn rapide"
              value={fastBurn.toLocaleString("fr-FR")}
              tone={fastBurn > 0 ? "warn" : "good"}
              hint="consommation anormalement vite"
            />
            <HeroReading>
              Chaque jauge = la part du budget d&apos;erreur déjà dépensée sur la fenêtre du SLO (0 % = intact,
              100 % = objectif tenu tout juste, au-delà = dépassé). Rouge = à traiter. Le détail atteinte /
              burn-rate est dans le tableau ci-dessous.
            </HeroReading>
          </SupervisionHero>
        );
      })()}

      {/* ----- Création ----- */}
      <details className="card mb-6" open={!slos.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouveau SLO
        </summary>
        <form action={createSloAction} className="flex flex-wrap items-end gap-3 border-t border-line p-4">
          <Field label="App">
            <select
              name="app_id"
              defaultValue={f.app !== "all" ? f.app : apps[0]?.app_id}
              className={INPUT_CLASS}
            >
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.app_id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nom">
            <input name="name" required placeholder="LCP 99% / 28 j" className={`${INPUT_CLASS} w-44`} />
          </Field>
          <Field label="Métrique">
            <select name="metric" defaultValue="LCP" className={INPUT_CLASS}>
              {ALERT_METRICS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Objectif (%)">
            <input
              name="objective"
              type="number"
              step="0.1"
              min={0.1}
              max={99.99}
              required
              defaultValue={99}
              className={`${INPUT_CLASS} w-24`}
            />
          </Field>
          <Field label="Fenêtre (j)">
            <input
              name="window_days"
              type="number"
              min={1}
              max={90}
              defaultValue={28}
              className={`${INPUT_CLASS} w-20`}
            />
          </Field>
          <Field label="Route (optionnel)">
            <input
              name="route"
              placeholder="/login (vide = toutes)"
              className={`${INPUT_CLASS} w-40 font-mono`}
            />
          </Field>
          <button type="submit" data-testid="create-slo" className="btn-accent">
            Créer
          </button>
        </form>
      </details>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">SLO</th>
              <th className="th">Métrique</th>
              <th className="th">Objectif</th>
              <th className="th">Fenêtre</th>
              <th className="th">Atteinte</th>
              <th className="th text-right">Budget consommé</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {slos.map((s) => (
              <SloRow key={s.id} raw={s} status={statusById.get(s.id)} />
            ))}
            {!slos.length && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                  Aucun SLO — crée le premier ci-dessus.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
