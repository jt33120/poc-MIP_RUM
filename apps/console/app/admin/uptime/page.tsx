import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { listApps } from "@/lib/queries";
import { listUptimeStatus } from "@/lib/queries-uptime";
import {
  createUptimeCheckAction,
  deleteUptimeCheckAction,
  toggleUptimeCheckAction,
} from "./actions";

export const dynamic = "force-dynamic";

/** Monitoring synthétique (uptime) — checks HTTP actifs, admin only. */
export default async function UptimePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [apps, checks] = await Promise.all([listApps(), listUptimeStatus()]);
  const error = typeof sp.error === "string";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Uptime (monitoring synthétique)"
        sub={
          <>
            Checks HTTP <strong>actifs</strong> exécutés toutes les 5 min (edge function{" "}
            <code className="chip-mono">uptime</code>) — répond à « le site est-il debout même sans
            visiteur ? ». Une bascule UP→DOWN déclenche une alerte <code className="chip-mono">critical</code>.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          Domaine, nom et URL (http/https) requis.
        </div>
      )}

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Ajouter un check</h2>
        <form action={createUptimeCheckAction} className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-medium text-ink-soft">
            Nom
            <input name="name" required placeholder="Accueil prod" className="field mt-1 block w-44" />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            URL
            <input name="url" required placeholder="https://exemple.fr/health" className="field mt-1 block w-72" />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            App
            <select name="app" required defaultValue="" className="field mt-1 block">
              <option value="" disabled>
                choisir…
              </option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name} ({a.app_id})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Statut attendu
            <input
              name="expect_status"
              type="number"
              defaultValue={200}
              className="field mt-1 block w-24 tabular-nums"
            />
          </label>
          <button type="submit" className="btn-accent">
            Ajouter
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Statut</th>
              <th className="th">Check</th>
              <th className="th">Dispo 24 h</th>
              <th className="th">Latence</th>
              <th className="th">Dernière sonde</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {checks.map((c) => {
              const state = !c.enabled
                ? "off"
                : c.last_ok == null
                  ? "pending"
                  : c.last_ok
                    ? "up"
                    : "down";
              return (
                <tr key={c.id} className="transition hover:bg-panel2/60">
                  <td className="px-4 py-2">
                    <StatusPill state={state} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="font-medium text-ink">{c.name}</div>
                    <div className="font-mono text-xs text-ink-faint">{c.url}</div>
                    {state === "down" && c.last_error && (
                      <div className="mt-0.5 text-xs text-red-600 dark:text-red-400">{c.last_error}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums">
                    {c.uptime_pct_24h == null ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <span className={c.uptime_pct_24h >= 99 ? "text-emerald-600 dark:text-emerald-400" : c.uptime_pct_24h >= 95 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400"}>
                        {c.uptime_pct_24h}%
                      </span>
                    )}
                    <span className="ml-1 text-xs text-ink-faint">({c.checks_24h})</span>
                  </td>
                  <td className="px-4 py-2 tabular-nums text-ink-soft">
                    {c.last_latency_ms != null ? `${c.last_latency_ms} ms` : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs tabular-nums text-ink-faint">
                    {c.last_checked_at ? fmtDate(c.last_checked_at) : "en attente"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1">
                      <form action={toggleUptimeCheckAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="enabled" value={c.enabled ? "0" : "1"} />
                        <button
                          type="submit"
                          className={`btn-ghost px-2 py-1 text-xs ${c.enabled ? "text-ink-soft" : "text-emerald-600 dark:text-emerald-400"}`}
                        >
                          {c.enabled ? "Désactiver" : "Réactiver"}
                        </button>
                      </form>
                      <form action={deleteUptimeCheckAction}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className="btn-ghost px-2 py-1 text-xs text-red-600 dark:text-red-400">
                          Supprimer
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!checks.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                  Aucun check — ajoutes-en un ci-dessus
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: "up" | "down" | "pending" | "off" }) {
  const meta = {
    up: { label: "UP", cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300" },
    down: { label: "DOWN", cls: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300" },
    pending: { label: "en attente", cls: "border-line bg-panel2 text-ink-soft" },
    off: { label: "désactivé", cls: "border-line bg-panel2 text-ink-faint" },
  }[state];
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.cls}`}>{meta.label}</span>;
}
