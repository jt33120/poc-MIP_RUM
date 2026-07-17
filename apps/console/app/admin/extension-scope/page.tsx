import { ExtensionActivationGuide } from "@/components/ExtensionActivationGuide";
import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { listApps } from "@/lib/queries";
import { listExtensionScopes } from "@/lib/queries-extension-scope";
import { createExtensionScopeAction, toggleExtensionScopeAction } from "./actions";

export const dynamic = "force-dynamic";

/** Registre domaine -> app_id pour l'extension navigateur (Ext-C) — admin only. */
export default async function ExtensionScope({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [apps, scopes] = await Promise.all([listApps(), listExtensionScopes()]);
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Domaines de l'extension"
        sub={
          <>
            Domaines observés par l&apos;extension navigateur (2ᵉ capteur RUM). Un domaine
            absent de cette liste — ou désactivé — n&apos;est <strong>jamais</strong> observé
            par l&apos;extension. Voir <code className="chip-mono">docs/CADRAGE_EXTENSION.md</code>.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          Domaine et app requis.
        </div>
      )}

      <ExtensionActivationGuide />

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Enregistrer un domaine</h2>
        <form
          action={createExtensionScopeAction}
          className="flex flex-wrap items-end gap-3"
          data-testid="create-extension-scope"
        >
          <label className="text-xs font-medium text-ink-soft">
            Domaine
            <input
              name="domain"
              required
              placeholder="app.client.fr"
              className="field mt-1 block w-56"
            />
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
          <button type="submit" className="btn-accent">
            Enregistrer
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Domaine</th>
              <th className="th">App</th>
              <th className="th">Créé</th>
              <th className="th">Statut</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {scopes.map((s) => (
              <tr key={s.id} className="transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-mono text-xs">{s.domain}</td>
                <td className="px-4 py-2 text-ink-soft">{s.app_id}</td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink-faint">{fmtDate(s.created_at)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      s.active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"
                        : "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300"
                    }`}
                  >
                    {s.active ? "actif" : "désactivé"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <form action={toggleExtensionScopeAction}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="active" value={s.active ? "0" : "1"} />
                    <button
                      type="submit"
                      className={`btn-ghost px-2 py-1 ${s.active ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
                    >
                      {s.active ? "Désactiver" : "Réactiver"}
                    </button>
                  </form>
                </td>
              </tr>
            ))}
            {!scopes.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  Aucun domaine — enregistres-en un ci-dessus
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
