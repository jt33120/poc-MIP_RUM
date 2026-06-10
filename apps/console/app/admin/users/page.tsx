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

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Utilisateurs</h1>
      <p className="mb-6 text-sm text-slate-500">
        Comptes console · rôle admin (tout) ou viewer (lecture, scopé à une liste d&apos;apps) ·
        toutes les actions sont tracées dans l&apos;audit
      </p>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {pwe && (
        <div
          data-testid="one-time-password"
          className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          {oneTime ? (
            <>
              Mot de passe de <strong>{decodeURIComponent(pwe)}</strong> (affiché une seule fois,
              note-le maintenant) :{" "}
              <code data-testid="generated-password" className="rounded bg-white px-2 py-0.5 font-mono">
                {oneTime}
              </code>
            </>
          ) : (
            <>Mot de passe de {decodeURIComponent(pwe)} déjà affiché — utilise « Reset mdp » si besoin.</>
          )}
        </div>
      )}

      <div className="mb-8 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Créer un utilisateur</h2>
        <form
          action={createUserAction}
          data-testid="create-user-form"
          className="flex flex-wrap items-end gap-3"
        >
          <label className="text-xs font-medium text-slate-600">
            Email
            <input
              name="email"
              type="email"
              required
              placeholder="prenom@client.fr"
              className="mt-1 block w-56 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-xs font-medium text-slate-600">
            Rôle
            <select
              name="role"
              className="mt-1 block rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            >
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            Apps autorisées
            <input
              name="apps"
              type="text"
              placeholder="vide = toutes · ex : demo-app, gip-plateforme"
              className="mt-1 block w-72 rounded-md border border-slate-300 px-2 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Créer (mot de passe généré)
          </button>
        </form>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Rôle</th>
              <th className="px-4 py-2">Apps</th>
              <th className="px-4 py-2">Statut</th>
              <th className="px-4 py-2">Dernier login</th>
              <th className="px-4 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((u) => (
              <tr key={u.email}>
                <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      u.role === "admin" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-600">
                  {u.apps?.length ? u.apps.join(", ") : "toutes"}
                </td>
                <td className="px-4 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      u.active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {u.active ? "actif" : "désactivé"}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-slate-500">
                  {u.last_login_at ? fmtDate(u.last_login_at) : "jamais"}
                </td>
                <td className="px-4 py-2">
                  <div className="flex gap-2">
                    <form action={toggleUserAction} data-testid={`toggle-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <button
                        type="submit"
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        {u.active ? "Désactiver" : "Activer"}
                      </button>
                    </form>
                    <form action={resetPasswordAction} data-testid={`reset-${u.email}`}>
                      <input type="hidden" name="email" value={u.email} />
                      <button
                        type="submit"
                        className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      >
                        Reset mdp
                      </button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {!users.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-400">
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
