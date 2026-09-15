import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { fmtDate } from "@/lib/format";
import { type Filters, type SearchParams } from "@/lib/filters";
import { listDashboards } from "@/lib/queries-dashboards";
import { registeredApps } from "@/lib/queries";
import { getUser } from "@/lib/auth";
import { canCreateDashboard, dashboardApps, dashboardListFilters } from "@/lib/dashboard-access";
import { INPUT_CLASS } from "@/components/forms/Field";
import { createDashboardAction } from "./actions";

export const dynamic = "force-dynamic";

/** Querystring des filtres globaux (préservation des liens internes). */
function filterQs(f: Filters): string {
  const p = new URLSearchParams();
  if (f.app) p.set("app", f.app);
  if (f.period !== "24h") p.set("period", f.period);
  if (f.device) p.set("device", f.device);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default async function Dashboards({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const user = await getUser();
  // L'accès normal est garanti par le middleware. Ne pas afficher une liste
  // vide à un visiteur sans session évite néanmoins d'exposer ses métadonnées.
  if (!user) return null;
  const rawSearchParams = (await searchParams) ?? {};
  const f = dashboardListFilters(rawSearchParams, user);
  if (!f) return null;
  const [dashboards, allApps] = await Promise.all([listDashboards(f.app), registeredApps()]);
  const apps = dashboardApps(allApps, user);
  const qs = filterQs(f);
  const canCreateGlobal = canCreateDashboard(user, null);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tableaux de bord"
        sub="Assemble tes propres vues à partir de widgets (vitals, trafic, routes lentes, erreurs, frustration), puis exporte en CSV / PDF."
      />

      {/* ----- Création ----- */}
      <details className="card mb-6" open={!dashboards.length}>
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink">
          + Nouveau dashboard
        </summary>
        <form
          action={createDashboardAction}
          className="flex flex-wrap items-end gap-3 border-t border-line p-4"
        >
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            Nom
            <input
              name="name"
              required
              placeholder="Mon tableau de bord"
              className={`${INPUT_CLASS} w-56`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
            App
            <select name="app_id" defaultValue={f.app ?? ""} className={INPUT_CLASS}>
              {canCreateGlobal && <option value="">(toutes apps)</option>}
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.app_id}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" data-testid="create-dashboard" className="btn-accent">
            Créer
          </button>
        </form>
      </details>

      {/* ----- Liste ----- */}
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="th text-left">Nom</th>
              <th className="th text-left">App</th>
              <th className="th text-right">Widgets</th>
              <th className="th text-right">Mise à jour</th>
            </tr>
          </thead>
          <tbody>
            {dashboards.map((d) => (
              <tr key={d.id} className="border-t border-line hover:bg-panel2">
                <td className="px-3 py-2 font-medium">
                  <Link href={`/dashboards/${d.id}${qs}`} className="text-accent hover:underline">
                    {d.name}
                  </Link>
                </td>
                <td className="px-3 py-2 text-ink-soft">{d.app_id ?? "toutes"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.layout.length}</td>
                <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-soft">
                  {fmtDate(d.updated_at)}
                </td>
              </tr>
            ))}
            {!dashboards.length && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-sm text-ink-faint">
                  Aucun tableau de bord — crée le premier ci-dessus.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
