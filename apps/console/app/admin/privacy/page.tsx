import Link from "next/link";
import { PageHeader } from "@/components/PageHeader";
import { requireAdmin } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { listApps } from "@/lib/queries";
import { DSAR_MESSAGES } from "@/lib/dsar";
import { dsarCible, dsarCounts, dsarTotalRows } from "@/lib/queries-dsar";
import { eraseUserAction } from "./actions";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  empty: "Renseigne un identifiant de visiteur.",
  confirm: "La confirmation ne correspond pas à l'identifiant — effacement annulé.",
  // Le motif de refus renvoyé par la Server Action, mot pour mot.
  refus_empreinte: DSAR_MESSAGES.refus_empreinte,
  inconnu: DSAR_MESSAGES.inconnu,
};

/** DSAR (Lot 5b, admin only) : accès/portabilité (export) et effacement RGPD par visitor_id. */
export default async function AdminPrivacy({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const apps = await listApps();
  const app = typeof sp.app === "string" && sp.app ? sp.app : "all";
  const user = typeof sp.user === "string" ? sp.user.trim() : "";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  const erased = typeof sp.erased === "string" ? sp.erased : null;

  // On INSTRUIT avant de compter : sur une ancienne empreinte de terminal, il
  // n'y a rien à afficher — ni volume, ni bouton. Voir lib/dsar.ts.
  const cible = user ? await dsarCible(app, user) : null;
  const counts = cible?.verdict === "execute" ? await dsarCounts(app, user) : null;
  const total = counts ? dsarTotalRows(counts) : 0;
  const exportHref = `/admin/privacy/export?app=${encodeURIComponent(app)}&user=${encodeURIComponent(user)}`;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Vie privée · DSAR"
        sub={
          <>
            Droits RGPD par <code className="rounded bg-panel2 px-1 py-0.5 font-mono text-xs">visitor_id</code> (identifiant
            tiré au hasard par le SDK) : <strong>accès/portabilité</strong> (export JSON) et{" "}
            <strong>effacement</strong>. Toutes les actions sont tracées dans l&apos;audit, refus compris.
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {error}
        </div>
      )}
      {erased != null && (
        <div className="mb-6 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
          Effacement effectué — <strong>{erased}</strong> ligne(s) supprimée(s).
        </div>
      )}

      {/* Recherche : app + visitor_id */}
      <div className="card mb-6 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Rechercher un visiteur</h2>
        <form method="GET" className="flex flex-wrap items-end gap-3" data-testid="dsar-search-form">
          <label className="text-xs font-medium text-ink-soft">
            App
            <select name="app" defaultValue={app} className="field mt-1 block">
              <option value="all">toutes</option>
              {apps.map((a) => (
                <option key={a.app_id} value={a.app_id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            visitor_id
            <input
              name="user"
              type="text"
              defaultValue={user}
              required
              placeholder="identifiant de visiteur"
              className="field mt-1 block w-96 font-mono text-xs"
            />
          </label>
          <button type="submit" className="btn-accent">
            Chercher
          </button>
        </form>
      </div>

      {/* REFUS. Le cas qui a motivé tout ce garde-fou : l'identifiant saisi ne
          correspond à aucun visiteur, mais à des sessions portant l'ANCIENNE
          empreinte de terminal — qui peut désigner plusieurs personnes. On dit
          ce qu'on a trouvé, et pourquoi on n'y touche pas. */}
      {cible?.verdict === "refus_empreinte" && (
        <div
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
          data-testid="dsar-refus"
        >
          <p className="font-semibold">Demande non exécutable sur cet identifiant</p>
          <p className="mt-1">{DSAR_MESSAGES.refus_empreinte}</p>
          <p className="mt-2 text-xs">
            {cible.sessionsHeritees.toLocaleString("fr-FR")} session(s) portent cette valeur en{" "}
            <code className="font-mono">user_hash</code>. Elles ne sont ni exportées ni effacées ici.
          </p>
        </div>
      )}

      {cible?.verdict === "inconnu" && (
        <div className="mb-6 rounded-xl border border-line bg-panel2 px-4 py-3 text-sm text-ink-soft" data-testid="dsar-inconnu">
          {DSAR_MESSAGES.inconnu}
        </div>
      )}

      {counts && (
        <div className="card mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-semibold text-ink">
              Données de <code className="font-mono text-xs text-brand">{user}</code>
              {app !== "all" && <span className="text-ink-faint"> · app {app}</span>}
            </h2>
            <span className="text-xs tabular-nums text-ink-soft">{total} ligne(s) au total</span>
          </div>

          {total === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-faint">
              Aucune donnée pour cet identifiant de visiteur sur ce périmètre.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-panel2">
                <tr>
                  <th className="th">Table</th>
                  <th className="th">Lignes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60">
                {counts.map((c) => (
                  <tr key={c.table} className="transition hover:bg-panel2/60">
                    <td className="px-4 py-2 font-mono text-xs">{c.table}</td>
                    <td className="px-4 py-2 tabular-nums text-ink-soft">{c.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {counts && total > 0 && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Accès / portabilité */}
          <div className="card p-4">
            <h2 className="mb-1 text-sm font-semibold text-ink">Accès & portabilité</h2>
            <p className="mb-3 text-xs text-ink-faint">
              Export JSON complet des données du visiteur (une clé par table).
            </p>
            <Link href={exportHref} prefetch={false} className="btn-accent inline-block" data-testid="dsar-export">
              Exporter en JSON
            </Link>
          </div>

          {/* Effacement */}
          <div className="card border-red-300/60 p-4 dark:border-red-400/20">
            <h2 className="mb-1 text-sm font-semibold text-red-700 dark:text-red-300">Effacement</h2>
            <p className="mb-3 text-xs text-ink-faint">
              Supprime <strong>définitivement</strong> toutes les lignes ci-dessus (transaction).
              Irréversible — re-saisis l&apos;identifiant de visiteur pour confirmer.
            </p>
            <form action={eraseUserAction} className="flex flex-col gap-2" data-testid="dsar-erase-form">
              <input type="hidden" name="app" value={app} />
              <input type="hidden" name="user" value={user} />
              <input
                name="confirm"
                type="text"
                required
                placeholder="re-saisir l'identifiant de visiteur"
                className="field w-full font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="submit"
                className="rounded-lg border border-red-400 bg-red-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
              >
                Effacer définitivement
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
