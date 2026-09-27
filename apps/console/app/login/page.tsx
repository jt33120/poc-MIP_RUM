import { redirect } from "next/navigation";
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import { LoginSubmitButton } from "@/components/LoginSubmitButton";
import { PasswordField } from "@/components/PasswordField";
import { getUser } from "@/lib/auth";
import type { SearchParams } from "@/lib/filters";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

/** Un identifiant de projet tel que l'URL peut en porter un (slug court) ; sinon rien. */
function projetDemande(brut: string | string[] | undefined): string | null {
  return typeof brut === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(brut) ? brut : null;
}

/**
 * Page de connexion (publique). Déjà connecté -> retour console, SUR LE PROJET que
 * l'URL demandait (recette du 26/09/2026 : `?app=` se perdait, il fallait rechoisir
 * le projet). Le middleware refuse un projet hors du périmètre de la session et le dit
 * sur /select : cette page n'a pas à le vérifier.
 */
export default async function Login({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  if (await getUser()) {
    const app = projetDemande(sp.app);
    redirect(app ? `/?app=${encodeURIComponent(app)}` : "/");
  }
  const error = sp.error != null;
  // C1 : console-api injoignable n'est pas un mot de passe faux — le dire.
  const indisponible = sp.error === "indisponible";
  const methodes = await methodesConnexion();
  const ssoEnabled = methodes.sso;

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
                  <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-soft">
                    Real User Monitoring
                  </span>
                </span>
              </div>
              <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">Connexion à la console</h1>
              <Link
                href="/presentation"
                className="mt-1 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline"
              >
                ← Découvrir MIP RUM
              </Link>
            </div>
            <form action={loginAction} className="flex flex-col gap-4" data-testid="login-form">
              <label className="text-sm font-medium text-ink-soft">
                Adresse e-mail
                <input
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  autoFocus
                  className="field mt-1 w-full"
                />
              </label>
              <PasswordField />
              {error && (
                <p
                  data-testid="login-error"
                  className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad-ink"
                >
                  {indisponible ? "Service de connexion indisponible : réessayer dans un instant." : "Identifiants invalides."}
                </p>
              )}
              <LoginSubmitButton />
            </form>
            {ssoEnabled && (
              <>
                <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-wider text-ink-soft">
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
            {/* Pas de réinitialisation de mot de passe : les comptes sont créés par un
                administrateur de la console, c'est donc à lui de s'adresser. */}
            <p className="mt-5 text-xs leading-relaxed text-ink-soft">
              Mot de passe oublié, ou pas encore de compte : demandez-le à l&apos;administrateur de votre
              console.
            </p>
            {methodes.demo && (
              <p className="mt-4 border-t border-line pt-4 text-sm text-ink-soft">
                {/* Navigation document : /demo ouvre une session (voir la présentation). */}
                <a
                  href="/demo"
                  data-testid="login-demo"
                  className="font-medium text-accent-ink underline-offset-2 hover:underline"
                >
                  Voir la démo, sans compte →
                </a>
              </p>
            )}
          </div>
        </div>
        {/* Sans drapeau ni « UE » seul : la donnée est en Union européenne, mais chez des
            hébergeurs de droit américain — la présentation le détaille (recette du 26/09/2026). */}
        <p className="mt-4 text-center text-[11px] tracking-wide text-ink-soft">
          Données hébergées en Union européenne, chez des hébergeurs de droit américain.
        </p>
      </div>
    </main>
  );
}
