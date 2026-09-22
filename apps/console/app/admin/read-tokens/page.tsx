import { PageHeader } from "@/components/PageHeader";
import { popSecret, requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { listApps } from "@/lib/queries";
import { listReadTokens } from "@/lib/queries-read-tokens";
import { createReadTokenAction, revokeReadTokenAction } from "./actions";

export const dynamic = "force-dynamic";

/** Gestion des tokens de lecture (livrable UTI) — admin only. */
export default async function ReadTokens({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [apps, tokens] = await Promise.all([listApps(), listReadTokens()]);
  const tkt = typeof sp.tkt === "string" ? sp.tkt : null;
  const tka = typeof sp.tka === "string" ? sp.tka : null;
  const oneTime = tkt ? popSecret(tkt) : null;
  const error = typeof sp.error === "string" ? sp.error : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Tokens de lecture"
        sub={
          <>
            Tokens d&apos;accès en lecture pour l&apos;API <code className="chip-mono">/api/rum/summary</code>,
            scopés à une app. Le token n&apos;est affiché qu&apos;une fois (seul son hash est stocké).
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad-ink">
          Choisis une app.
        </div>
      )}

      {tka && (
        <div
          data-testid="one-time-token"
          className="mb-6 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn-ink"
        >
          {oneTime ? (
            <>
              Token pour <strong>{decodeURIComponent(tka)}</strong> (affiché une seule fois, copie-le
              maintenant) :{" "}
              <code className="mt-1 block break-all rounded bg-panel px-2 py-1 font-mono text-ink">{oneTime}</code>
            </>
          ) : (
            <>Token de {decodeURIComponent(tka)} déjà affiché — révoque puis recrée si besoin.</>
          )}
        </div>
      )}

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Générer un token</h2>
        <form action={createReadTokenAction} className="flex flex-wrap items-end gap-3" data-testid="create-read-token">
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
            Libellé
            <input name="label" placeholder="UTI Supervision" className="field mt-1 block w-52" />
          </label>
          <button type="submit" className="btn-accent">
            Générer
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">App</th>
              <th className="th">Libellé</th>
              <th className="th">Créé</th>
              <th className="th">Statut</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {tokens.map((t) => (
              <tr key={t.id} className="transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-mono text-xs">{t.app_id}</td>
                <td className="px-4 py-2 text-ink-soft">{t.label ?? "—"}</td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink-faint">{fmtDate(t.created_at)}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      t.revoked_at
                        ? "bg-bad/10 text-bad-ink"
                        : "bg-good/10 text-good-ink"
                    }`}
                  >
                    {t.revoked_at ? "révoqué" : "actif"}
                  </span>
                </td>
                <td className="px-4 py-2">
                  {!t.revoked_at && (
                    <form action={revokeReadTokenAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button type="submit" className="btn-ghost px-2 py-1 text-bad-ink">
                        Révoquer
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {!tokens.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-ink-faint">
                  Aucun token — génères-en un ci-dessus
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
