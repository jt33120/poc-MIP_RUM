import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

/** Page de connexion (publique). Déjà connecté -> retour console. */
export default async function Login({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (await getUser()) redirect("/");
  const sp = await searchParams;
  const error = sp.error != null;

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="text-lg font-bold tracking-tight">MIP RUM</span>
          </div>
          <p className="mt-1 text-sm text-slate-500">Connexion à la console</p>
        </div>
        <form action={loginAction} className="flex flex-col gap-4" data-testid="login-form">
          <label className="text-sm font-medium text-slate-700">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Mot de passe
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </label>
          {error && (
            <p data-testid="login-error" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
              Identifiants invalides.
            </p>
          )}
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Se connecter
          </button>
        </form>
      </div>
    </main>
  );
}
