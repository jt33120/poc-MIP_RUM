import { redirect } from "next/navigation";
import { ICON_PATHS, Icon } from "@/components/icons";
import { LoginSubmitButton } from "@/components/LoginSubmitButton";
import { getUser } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { isOidcEnabled } from "@/lib/oidc";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

/** Page de connexion (publique). Déjà connecté -> retour console. */
export default async function Login({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (await getUser()) redirect("/");
  const sp = await searchParams;
  const error = sp.error != null;
  const ssoEnabled = isOidcEnabled();

  return (
    // écran clair, épuré : léger halo accent, la carte porte toute l'attention
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="w-full max-w-sm">
        <div className="animate-fade-up overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
          <div className="h-1 bg-gradient-to-r from-accent-deep via-accent to-accent-soft" />
          <div className="p-8">
            <div className="mb-6">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
                  <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
                </span>
                <span className="leading-tight">
                  <span className="block text-base font-bold tracking-tight text-ink">
                    MIP <span className="text-accent">RUM</span>
                  </span>
                  <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-faint">
                    Real User Monitoring
                  </span>
                </span>
              </div>
              <p className="mt-3 text-sm text-ink-soft">Connexion à la console</p>
            </div>
            <form action={loginAction} className="flex flex-col gap-4" data-testid="login-form">
              <label className="text-sm font-medium text-ink-soft">
                Email
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  autoFocus
                  className="field mt-1 w-full"
                />
              </label>
              <label className="text-sm font-medium text-ink-soft">
                Mot de passe
                <input
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className="field mt-1 w-full"
                />
              </label>
              {error && (
                <p
                  data-testid="login-error"
                  className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
                >
                  Identifiants invalides.
                </p>
              )}
              <LoginSubmitButton />
            </form>
            {ssoEnabled && (
              <>
                <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-faint">
                  <span className="h-px flex-1 bg-line" />
                  ou
                  <span className="h-px flex-1 bg-line" />
                </div>
                <a
                  href="/api/auth/oidc/login"
                  data-testid="sso-login"
                  className="flex items-center justify-center gap-2 rounded-lg border border-line bg-panel2 py-2 text-sm font-medium text-ink-soft transition hover:bg-app"
                >
                  <Icon paths={ICON_PATHS.user} className="h-4 w-4" strokeWidth={2.2} />
                  Connexion SSO (entreprise)
                </a>
              </>
            )}
          </div>
        </div>
        <p className="mt-4 text-center text-[11px] tracking-wide text-ink-faint">
          Monitoring OTel-native · données hébergées en UE 🇪🇺
        </p>
      </div>
    </main>
  );
}
