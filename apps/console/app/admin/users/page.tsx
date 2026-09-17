import { PageHeader } from "@/components/PageHeader";
import { popSecret, requireAdmin } from "@/lib/auth";
import { q } from "@/lib/db";
import type { SearchParams } from "@/lib/filters";
import { fmtDate } from "@/lib/format";
import { createUserAction, resetPasswordAction, toggleUserAction } from "./actions";

export const dynamic = "force-dynamic";

interface UserRow {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

const ERRORS: Record<string, string> = {
  email: "Email invalide.",
  exists: "Cet email existe déjà.",
  self: "Impossible de désactiver son propre compte.",
  unknown: "Utilisateur inconnu.",
};

/** Gestion des utilisateurs console (admin only). */
export default async function AdminUsers({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin();
  const sp = await searchParams;
  const users = await q<UserRow>(
    `select email, role, apps, active, created_at, last_login_at from console_user order by email`,
  );
  // mot de passe généré : consommé du stash, affiché une seule fois
  const pwt = typeof sp.pwt === "string" ? sp.pwt : null;
  const pwe = typeof sp.pwe === "string" ? sp.pwe : null;
  const oneTime = pwt ? popSecret(pwt) : null;
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;
  // arrivée depuis le wizard client : préremplit un viewer scopé sur l'app
  const prefillApp = typeof sp.app === "string" ? sp.app : null;

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Utilisateurs"
        sub={
          <>
            Comptes console · rôle admin (tout) ou viewer (lecture, scopé à une liste d&apos;apps) ·
            toutes les actions sont tracées dans l&apos;audit
          </>
        }
      />

      {error && (
        <div className="mb-6 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300">
          {error}
        </div>
      )}

      {pwe && (
        <div
          data-testid="one-time-password"
          className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
        >
          {oneTime ? (
            <>
              Mot de passe de <strong>{decodeURIComponent(pwe)}</strong> (affiché une seule fois,
              note-le maintenant) :{" "}
              <code
                data-testid="generated-password"
                className="rounded bg-panel px-2 py-0.5 font-mono text-ink"
              >
                {oneTime}
              </code>
            </>
          ) : (
            <>Mot de passe de {decodeURIComponent(pwe)} déjà affiché — utilise « Reset mdp » si besoin.</>
          )}
        </div>
      )}

      <div className="card mb-8 p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink-soft">Créer un utilisateur</h2>
        <form
          action={createUserAction}
          data-testid="create-user-form"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="text-xs font-medium text-ink-soft">
            Email
            <input
              name="email"
              type="email"
              required
              placeholder="prenom@client.fr"
              className="field mt-1 block w-56"
            />
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Rôle
            <select name="role" className="field mt-1 block">
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-soft">
            Apps autorisées
            <input
              name="apps"
              type="text"
              defaultValue={prefillApp ?? undefined}
              placeholder="vide = toutes · ex : demo-app, gip-plateforme"
              className="field mt-1 block w-72"
            />
          </label>
          <button type="submit" className="btn-accent">
            Créer (mot de passe généré)
          </button>
        </form>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-panel2">
            <tr>
              <th className="th">Email</th>
              <th className="th">Rôle</th>
              <th className="th">Apps</th>
              <th className="th">Statut</th>
              <th className="th">Dernier login</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/60">
            {users.map((u) => (
              <tr key={u.email} className="transition hover:bg-panel2/60">
                <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin"
                        ? "bg-accent/15 text-accent-deep dark:text-accent-soft"
                        : "bg-panel2 text-ink-soft"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-ink-soft">
                  {u.apps === null ? "toutes" : u.apps.length ? u.apps.join(", ") : "aucune"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.active
                        ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"
                        : "bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-300"
                    }`}
                  >
                    {u.active ? "actif" : "désactivé"}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs tabular-nums text-ink-soft">
                  {u.last_login_at ? fmtDate(u.last_login_at) : "jamais"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <form action={toggleUserAction} data-testid={`toggle-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <button type="submit" className="btn-ghost px-2 py-1">
                        {u.active ? "Désactiver" : "Activer"}
                      </button>
                    </form>
                    <form action={resetPasswordAction} data-testid={`reset-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <button type="submit" className="btn-ghost px-2 py-1">
                        Reset mdp
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink-faint">
                  Aucun utilisateur — lance scripts/seed-admin.mjs
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
