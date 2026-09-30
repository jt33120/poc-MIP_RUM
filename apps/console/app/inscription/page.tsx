// Inscription (publique) : l'entrée « S'inscrire » de la vitrine. L'inscription en
// libre-service n'existe pas encore — les comptes sont créés par un administrateur
// (commande users.create) — : la page le dit, et propose ce qui existe déjà, plutôt
// qu'un lien vers la connexion qui ferait croire à une erreur.
import Link from "next/link";
import { BrandMark } from "@/components/presentation/Cadre";

export default function Inscription() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-80 w-[42rem] -translate-x-1/2 rounded-full bg-accent/10 blur-3xl"
      />
      <div className="w-full max-w-sm animate-fade-up overflow-hidden rounded-2xl border border-line bg-panel shadow-pop">
        <div className="h-1 bg-gradient-to-r from-accent-deep via-accent to-accent-soft" />
        <div className="p-8" data-testid="inscription">
          <BrandMark />
          <h1 className="mt-4 text-lg font-semibold tracking-tight text-ink">Créer un compte</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            L&apos;inscription en libre-service arrive bientôt. En attendant, un compte se demande à
            l&apos;administrateur de votre console.
          </p>
          <div className="mt-6 flex flex-col gap-2.5">
            <a href="/login?demo=1" className="btn-accent flex items-center justify-center gap-2 py-2 text-center">
              Voir le compte démo <span aria-hidden>→</span>
            </a>
            <Link
              href="/login"
              className="rounded-lg border border-line bg-panel2 py-2 text-center text-sm font-medium text-ink-soft transition hover:bg-app"
            >
              Se connecter
            </Link>
          </div>
          <Link href="/presentation" className="mt-5 inline-block text-xs font-medium text-accent-ink underline-offset-2 hover:underline">
            ← Découvrir MIP RUM
          </Link>
        </div>
      </div>
    </main>
  );
}
