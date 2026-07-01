// Ligne de tableau d'un SLO : nom/app/route, métrique, objectif, fenêtre,
// barre d'atteinte + badge de statut (ok/à risque/manqué) et actions
// activer/désactiver/supprimer. Rendu 100 % serveur. Extrait de app/slo/page.tsx.
import { sloView } from "@/lib/alerting";
import type { SloRaw, SloStatusRow as SloStatusData } from "@/lib/queries-alerting";
import { deleteSloAction, toggleSloAction } from "@/app/alerts/actions";

/** Classes Tailwind de la barre/statut d'error-budget (ok/at_risk/breached). */
export const STATUS_STYLE: Record<string, { bar: string; badge: string; label: string }> = {
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

/** Formate une fraction [0..1] en pourcentage localisé (fr-FR). */
export const pct = (v: number) => `${(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`;

/** Ligne de tableau d'un SLO avec son statut d'error-budget superposé (si actif). */
export function SloRow({ raw, status }: { raw: SloRaw; status?: SloStatusData }) {
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
