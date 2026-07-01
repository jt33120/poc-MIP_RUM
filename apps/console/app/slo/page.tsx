import { PageHeader } from "@/components/PageHeader";
import { sloView } from "@/lib/alerting";
import { ALERT_METRICS, parseFilters, type SearchParams } from "@/lib/queries-v2";
import { registeredApps } from "@/lib/queries";
import { listSlo, sloStatus, type SloRaw, type SloStatusRow } from "@/lib/queries-alerting";
import { createSloAction, deleteSloAction, toggleSloAction } from "../alerts/actions";

export const dynamic = "force-dynamic";

const INPUT_CLASS = "field py-1";

/** Classes Tailwind de la barre/statut d'error-budget (ok/at_risk/breached). */
const STATUS_STYLE: Record<string, { bar: string; badge: string; label: string }> = {
  ok: {
    bar: "bg-emerald-500",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300",
    label: "ok",
  },
  at_risk: {
    bar: "bg-amber-500",
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300",
    label: "à risque",
  },
  breached: {
    bar: "bg-red-500",
    badge: "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300",
    label: "objectif manqué",
  },
};

const pct = (v: number) => `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

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
            Objectifs de service (part conforme sur la fenêtre) · budget consommé et burn-rate —
            un burn rapide déclenche une alerte critique (flux unifié).
          </>
        }
      />

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

function SloRow({ raw, status }: { raw: SloRaw; status?: SloStatusRow }) {
  const view = status ? sloView(status.attainment, status.objective) : null;
  const style = (view && STATUS_STYLE[view.status]) ?? STATUS_STYLE.ok;
  const burned = status ? status.burned_pct ?? view?.burnedPct ?? null : null;

  return (
    <tr data-testid={`slo-${raw.id}`} className={`border-t border-line/60 align-top ${raw.active ? "" : "opacity-60"}`}>
      <td className="px-4 py-2">
        <span className="font-medium text-ink">{raw.name}</span>
        <span className="ml-2 chip-mono text-xs">{raw.app_id}</span>
        {raw.route && <span className="ml-2 font-mono text-xs text-ink-faint">{raw.route}</span>}
        {!raw.active && (
          <span className="ml-2 rounded bg-panel2 px-2 py-0.5 text-xs text-ink-faint">désactivé</span>
        )}
        {status?.fast_burn && (
          <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-bold text-white">
            burn rapide
          </span>
        )}
      </td>
      <td className="px-4 py-2 text-ink-soft">{raw.metric}</td>
      <td className="px-4 py-2 tabular-nums text-ink-soft">{pct(raw.objective)}</td>
      <td className="px-4 py-2 tabular-nums text-ink-soft">{raw.window_days} j</td>
      <td className="px-4 py-2">
        {status ? (
          <div className="flex items-center gap-2">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-line">
              <div className={`h-full ${style.bar}`} style={{ width: `${Math.min(100, status.attainment * 100)}%` }} />
            </div>
            <span className="tabular-nums text-xs text-ink-faint">{pct(status.attainment)}</span>
            <span className={`rounded px-2 py-0.5 text-xs font-medium ${style.badge}`}>{style.label}</span>
          </div>
        ) : (
          <span className="text-xs text-ink-faint">—</span>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-ink-soft">
        {burned == null ? "—" : `${burned.toLocaleString("fr-FR", { maximumFractionDigits: 0 })} %`}
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-2">
          <form action={toggleSloAction}>
            <input type="hidden" name="id" value={raw.id} />
            <button
              type="submit"
              data-testid={`toggle-slo-${raw.id}`}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white transition ${
                raw.active ? "bg-slate-500 hover:bg-slate-600" : "bg-emerald-600 hover:bg-emerald-700"
              }`}
            >
              {raw.active ? "Désactiver" : "Activer"}
            </button>
          </form>
          <form action={deleteSloAction}>
            <input type="hidden" name="id" value={raw.id} />
            <button
              type="submit"
              data-testid={`delete-slo-${raw.id}`}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-red-700"
            >
              Supprimer
            </button>
          </form>
        </div>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}
