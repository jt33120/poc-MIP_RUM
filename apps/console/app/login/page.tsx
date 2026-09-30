import { redirect } from "next/navigation";
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import { LoginSubmitButton } from "@/components/LoginSubmitButton";
import { PasswordField } from "@/components/PasswordField";
import { getUser } from "@/lib/auth";
import { EMAIL_DEMO_PAR_DEFAUT, demoConfig } from "@/lib/demo";
import type { SearchParams } from "@/lib/filters";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { loginAction } from "./actions";

export const dynamic = "force-dynamic";

/** Un identifiant de projet tel que l'URL peut en porter un (slug court) ; sinon rien. */
function projetDemande(brut: string | string[] | undefined): string | null {
  return typeof brut === "string" && /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(brut) ? brut : null;
}

/**
 * Le formulaire du compte démo (`/login?demo=1`, depuis la vitrine) : l'écran de
 * connexion, pré-rempli. La démo n'a pas de mot de passe — /demo ouvre la session
 * elle-même —, donc rien n'est saisi ni envoyé : l'adresse est en lecture seule, le
 * mot de passe n'est qu'un champ dessiné (un vrai champ rempli ferait proposer aux
 * gestionnaires de mots de passe d'enregistrer un secret qui n'existe pas), et le
 * bouton mène à /demo par une navigation document (elle change de coquille).
 */
function FormulaireDemo() {
  const email = demoConfig()?.email ?? EMAIL_DEMO_PAR_DEFAUT;
  return (
    <form action="/demo" method="get" className="flex flex-col gap-4" data-testid="login-demo-form">
      <p className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm leading-relaxed text-ink">
        Compte démo : la console en lecture seule, sur ses propres mesures.
      </p>
      <label className="text-sm font-medium text-ink-soft">
        Adresse e-mail
        <input type="email" value={email} readOnly className="field mt-1 w-full text-ink" />
      </label>
      <div className="text-sm font-medium text-ink-soft">
        <span id="demo-mdp">Mot de passe</span>
        <div
          role="textbox"
          aria-labelledby="demo-mdp"
          aria-readonly="true"
          aria-description="aucun mot de passe : le compte démo s'ouvre sans"
          className="field mt-1 flex w-full items-center tracking-[0.3em] text-ink"
        >
          ••••••••••
        </div>
      </div>
      <button type="submit" autoFocus className="btn-accent flex items-center justify-center gap-2 py-2 text-center">
        Entrer dans la démo <span aria-hidden>→</span>
      </button>
      <Link href="/login" className="text-center text-xs font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">
        Se connecter avec son propre compte
      </Link>
    </form>
  );
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
  // La vitrine envoie ici le visiteur qui a choisi le compte démo ; démo fermée, il
  // retrouve la connexion ordinaire, avec la raison.
  const demoDemandee = sp.demo === "1";
  const formulaireDemo = demoDemandee && methodes.demo;

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
            {demoDemandee && !methodes.demo && (
              <p data-testid="login-demo-fermee" className="mb-4 rounded-lg border border-line bg-panel2 px-3 py-2 text-sm text-ink-soft">
                La démo est fermée pour le moment.
              </p>
            )}
            {formulaireDemo ? (
              <FormulaireDemo />
            ) : (
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
            )}
            {ssoEnabled && !formulaireDemo && (
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
                administrateur de la console, c'est donc à lui de s'adresser. Depuis le
                30/09/2026, un visiteur peut aussi ouvrir le sien, quand l'inscription
                est ouverte (console-api le dit). */}
            {formulaireDemo ? null : methodes.inscription ? (
              <p className="mt-5 text-xs leading-relaxed text-ink-soft">
                Pas encore de compte ?{" "}
                <Link href="/inscription" data-testid="login-inscription" className="font-medium text-accent-ink underline-offset-2 hover:underline">
                  Créer un compte d&apos;essai
                </Link>
                . Mot de passe oublié : demandez-le à l&apos;administrateur de votre console.
              </p>
            ) : (
              <p className="mt-5 text-xs leading-relaxed text-ink-soft">
                Mot de passe oublié, ou pas encore de compte : demandez-le à l&apos;administrateur de votre
                console.
              </p>
            )}
            {methodes.demo && !formulaireDemo && (
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
