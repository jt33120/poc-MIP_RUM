// Deuxième écran de la vitrine : deux entrées, rien d'autre. À gauche, le compte démo
// (la connexion pré-remplie, puis la console en lecture seule) ; à droite, la
// connexion, et l'inscription dessous — sur une seconde rangée de la grille, pour que
// les deux tuiles gardent la même hauteur. Connecté : une seule entrée, la console.
//
// L'écran entier, à lui seul : ni le film au-dessus ni l'aperçu dessous n'y
// dépassent, et les tuiles montent une à une au fil du défilement (SectionDefilee).
//
// <a>, PAS <Link>, vers la console : la vitrine est rendue sans la coquille de la
// console, et une navigation client ne re-rend pas le layout racine (voir Actions.tsx).
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";
import { SectionDefilee } from "./SectionDefilee";

const TUILE =
  "group relative flex h-full min-h-[11rem] flex-col justify-between overflow-hidden rounded-3xl p-7 transition duration-300 sm:min-h-[13rem] sm:p-9";
const PLEINE = `${TUILE} bg-gradient-to-br from-[#fca62b] via-accent to-accent-deep text-navy-950 shadow-[0_30px_80px_-30px_rgba(248,145,1,0.8)] hover:-translate-y-1 hover:shadow-[0_40px_90px_-30px_rgba(248,145,1,0.95)]`;
const VITREE = `${TUILE} border border-white/15 bg-white/[0.04] text-ink backdrop-blur-sm hover:-translate-y-1 hover:border-accent/60 hover:bg-white/[0.07]`;

function Fleche({ bord }: { bord: string }) {
  return (
    <span
      aria-hidden
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border text-xl transition group-hover:translate-x-1 ${bord}`}
    >
      →
    </span>
  );
}

export function Entrees({ id, user, demoOuverte }: { id: string; user: SessionUser | null; demoOuverte: boolean }) {
  return (
    <SectionDefilee
      id={id}
      aria-labelledby={`${id}-titre`}
      className="flex min-h-[100svh] flex-col justify-center px-4 py-16 sm:px-6"
    >
      <h2 id={`${id}-titre`} className="sr-only">
        Entrer dans la console
      </h2>
      {user ? (
        <div className="entrees-piece mx-auto w-full max-w-xl" style={{ ["--i" as string]: 0 }}>
          <a href="/" data-testid="vitrine-console" className={PLEINE}>
            <span className="text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Ouvrir la console</span>
            <span className="flex items-end justify-between gap-4">
              <span className="text-sm font-medium text-navy-950/75">Vos applications, vos mesures.</span>
              <Fleche bord="border-navy-950/25" />
            </span>
          </a>
        </div>
      ) : (
        <div className="mx-auto grid w-full max-w-5xl gap-5 md:grid-cols-2 md:gap-6">
          <div className="entrees-piece" style={{ ["--i" as string]: 0 }}>
            {demoOuverte ? (
              <a href="/login?demo=1" data-testid="vitrine-demo" className={PLEINE}>
                <span>
                  <span className="block text-xs font-bold uppercase tracking-[0.22em] text-navy-950/70">Sans compte</span>
                  <span className="mt-3 block text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Voir le compte démo</span>
                </span>
                <span className="flex items-end justify-between gap-4">
                  <span className="max-w-xs text-sm font-medium text-navy-950/75">
                    La console en lecture seule, sur ses propres mesures : elle se surveille elle-même.
                  </span>
                  <Fleche bord="border-navy-950/25" />
                </span>
              </a>
            ) : (
              <span
                aria-disabled="true"
                data-testid="vitrine-demo"
                className={`${TUILE} cursor-not-allowed border border-dashed border-white/20 text-ink-soft`}
              >
                <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.22em]">
                  <Icon paths={ICON_PATHS.lock} className="h-3.5 w-3.5" strokeWidth={2.4} />
                  Bientôt
                </span>
                <span className="text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Compte démo</span>
              </span>
            )}
          </div>
          <div className="entrees-piece" style={{ ["--i" as string]: 1 }}>
            <Link href="/login" data-testid="vitrine-connexion" className={VITREE}>
              <span>
                <span className="block text-xs font-bold uppercase tracking-[0.22em] text-ink-soft">Avec un compte</span>
                <span className="mt-3 block text-3xl font-extrabold tracking-[-0.03em] sm:text-4xl">Se connecter</span>
              </span>
              <span className="flex items-end justify-between gap-4">
                <span className="max-w-xs text-sm font-medium text-ink-soft">Vos applications, vos mesures.</span>
                <Fleche bord="border-white/25" />
              </span>
            </Link>
          </div>
          <p className="entrees-piece text-center text-sm text-ink-soft md:col-start-2 md:-mt-2" style={{ ["--i" as string]: 2 }}>
            Pas encore de compte ?{" "}
            <Link
              href="/inscription"
              data-testid="vitrine-inscription"
              className="font-semibold text-accent-ink underline-offset-4 hover:underline"
            >
              S&apos;inscrire
            </Link>
          </p>
        </div>
      )}
    </SectionDefilee>
  );
}
