// Vitrine PUBLIQUE (/presentation) : UNE page pour tous (plan § 8.2, P**.2).
//
// Visiteur et connecté lisent les mêmes parties ; le connecté a seulement une autre
// action (« Ouvrir la console ») et, dans la partie 1, des écrans cliquables. Il
// n'y a plus de seconde rédaction pour le connecté : elle se croyait rendue dans la
// coquille de la console, alors que /presentation est un chemin public que le
// layout n'enveloppe jamais (lib/chemins-publics.ts), et elle disait autre chose.
//
// Ordre : en-tête (PS0) → sommaire (PS1) → « Ce qu'il contient » → « Ce qu'il sait
// faire » → « Ce qui reste » → « Le détail » → pied de page (PS12). Chaque partie
// est un fichier à elle, rempli par son lot (P**.3 à P**.6) : ce montage ne change
// pas quand elles se remplissent.
//
// Rendu serveur ; seule la bascule de thème est un îlot client. Le fond texturé vit
// dans globals.css (.mip-sci), pas ici : /select et /select/new le réutilisent, et
// importer ce module pour une chaîne CSS y tirerait toute la vitrine.
import Image from "next/image";
import Link from "next/link";
import { Ancres } from "@/components/presentation/Ancres";
import { Annexe } from "@/components/presentation/Annexe";
import { Contient } from "@/components/presentation/Contient";
import { Releve } from "@/components/presentation/Releve";
import { Reste } from "@/components/presentation/Reste";
import { SaitFaire } from "@/components/presentation/SaitFaire";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { SessionUser } from "@/lib/auth";
import { demoConfig } from "@/lib/demo";
import { DATA_SOURCES } from "@/lib/legal";

/** Marque MIP RUM — pouls sur carré orange + wordmark. */
function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
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
    </span>
  );
}

/** Label « POC » — une étiquette apposée sur le produit, pas un badge de marque :
 *  légèrement de travers, bord pointillé, comme collée là en attendant. */
function PocLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex -rotate-[5deg] items-center rounded-md border border-dashed border-accent/70 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.22em] text-accent-ink shadow-sm dark:bg-accent/15 ${className}`}
    >
      POC
    </span>
  );
}

const PLEIN =
  "bg-gradient-to-r from-accent via-[#fca62b] to-accent-deep text-navy-950 shadow-[0_8px_22px_-10px_rgba(248,145,1,0.9)] hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(248,145,1,0.95)]";
const CONTOUR = "border border-line bg-panel/70 text-ink backdrop-blur-sm hover:border-accent/50";
const VERROUILLE =
  "cursor-not-allowed border border-dashed border-line bg-panel/40 text-ink-faint";

/**
 * Les actions de la vitrine, en haut à droite (`size="sm"`) et sous le titre.
 *
 * Connecté : une seule, ouvrir la console. Visiteur : démo et connexion côte à
 * côte, toujours dans cet ordre ; sans DEMO_USER_APPS, la démo reste affichée mais
 * verrouillée — pas de lien mort, juste une promesse pas encore tenue, avec l'info
 * au survol.
 */
export function Actions({ size = "md", user }: { size?: "sm" | "md"; user: SessionUser | null }) {
  const suffixe = size === "sm" ? "-top" : "";
  if (user) {
    // <a>, PAS <Link>, pour la même raison que /demo plus bas : la vitrine est rendue
    // sans la coquille de la console, et une navigation client ne re-rend pas le
    // layout racine — la console s'afficherait un instant sans sa barre latérale.
    return (
      <a
        href="/"
        data-testid={`presentation-console${suffixe}`}
        className={`btn-accent inline-flex shrink-0 items-center gap-2 ${size === "sm" ? "" : "px-5 py-2.5 text-base"}`}
      >
        Ouvrir la console <span aria-hidden>→</span>
      </a>
    );
  }
  const demo = demoConfig();
  const pad = size === "sm" ? "px-4 py-2 text-sm" : "px-6 py-3 text-base";
  const base = `inline-flex shrink-0 items-center gap-2 rounded-xl font-semibold transition ${pad}`;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {demo ? (
        // <a>, PAS <Link> : /demo ouvre une session, donc change de coquille (nue ->
        // console). Une navigation client ne re-rend jamais le layout racine : la
        // Vue d'ensemble s'affichait sans sidebar ni en-tête jusqu'au rechargement.
        // Une navigation document re-rend tout, et ne préchargera jamais la route
        // (un prefetch ouvrirait une session démo au simple survol).
        <a href="/demo" data-testid={`presentation-demo${suffixe}`} className={`${base} ${PLEIN}`}>
          Voir la démo <span aria-hidden>→</span>
        </a>
      ) : (
        <span
          aria-disabled="true"
          title="Démo bientôt disponible"
          data-testid={`presentation-demo${suffixe}`}
          className={`${base} ${VERROUILLE}`}
        >
          <Icon paths={ICON_PATHS.lock} className="h-3.5 w-3.5" strokeWidth={2.4} />
          Voir la démo
        </span>
      )}
      <Link
        href="/login"
        data-testid={`presentation-login${suffixe}`}
        className={`${base} ${demo ? CONTOUR : PLEIN}`}
      >
        Se connecter {!demo && <span aria-hidden>→</span>}
      </Link>
    </div>
  );
}

export function Landing({ user }: { user: SessionUser | null }) {
  return (
    <div className="mip-sci flex min-h-screen flex-col">
      {/* Barre ------------------------------------------------------------- */}
      <header className="border-b border-line bg-panel/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/presentation" aria-label="MIP RUM — accueil">
            <BrandMark />
          </Link>
          {/* Doublon du label du titre : masqué sous sm, où la barre déborderait
              — le H1 juste dessous le porte déjà. */}
          <PocLabel className="hidden sm:inline-flex" />
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <Actions size="sm" user={user} />
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* PS0 — ce que c'est, de quand date l'état décrit, et une vraie capture */}
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-14 lg:grid-cols-[minmax(0,27rem)_minmax(0,1fr)] lg:py-20">
          <div className="min-w-0 animate-fade-up">
            <h1 className="flex flex-wrap items-center gap-x-3 gap-y-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              MIP <span className="text-accent">RUM</span>
              <PocLabel className="translate-y-1" />
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-soft">
              Mesure de l&apos;expérience vécue par les visiteurs réels d&apos;un site ou d&apos;une
              application : vitesse d&apos;affichage, réactivité, erreurs, parcours. Collecte au format
              OpenTelemetry, données hébergées en Union européenne.
            </p>
            <Releve />
            <div className="mt-8">
              <Actions user={user} />
            </div>
          </div>

          {/* Capture réelle du portail (vue d'ensemble), une par thème.
              Le cadre reste DANS sa colonne — le ratio 8/5 fait que le cadrage
              s'arrête toujours à 1056 px de la capture, pile dans la gouttière
              après la carte CLS, quelle que soit la largeur rendue. La légende ne
              porte pas de date : celle des captures actuelles n'est pas établie
              (elle viendra du manifeste des captures, lot P**.7). */}
          <div className="min-w-0 animate-fade-up">
            <div className="relative aspect-[8/5] overflow-hidden rounded-xl border border-line shadow-pop">
              <Image
                src="/portail/overview-light.png"
                alt="Le portail MIP RUM : score de santé, Core Web Vitals au p75, sessions et taux d'erreur."
                fill
                sizes="(min-width: 1024px) 40rem, 100vw"
                priority
                className="object-cover object-left-top dark:hidden"
              />
              <Image
                src="/portail/overview-dark.png"
                alt=""
                aria-hidden
                fill
                sizes="(min-width: 1024px) 40rem, 100vw"
                className="hidden object-cover object-left-top dark:block"
              />
            </div>
            <p className="mt-3 text-xs text-ink-soft">
              Capture réelle de la console. Les chiffres affichés viennent d&apos;un jeu de
              démonstration, pas d&apos;un client en production.
            </p>
          </div>
        </div>

        <Ancres />
        <Contient user={user} />
        <SaitFaire />
        <Reste />
        <Annexe />
      </main>

      {/* Pied de page (PS12) ------------------------------------------------ */}
      <footer className="border-t border-line bg-panel/60 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-5 text-xs text-ink-soft">
          <span>MIP RUM — POC · OpenTelemetry · données hébergées en UE, hébergeurs de droit américain</span>
          <Link href="/legal/cgu" className="hover:text-ink">CGU</Link>
          <Link href="/legal/cgv" className="hover:text-ink">CGV</Link>
          <Link href="/legal/confidentialite" className="hover:text-ink">Confidentialité</Link>
          {/* CC BY 4.0 : l'attribution de la base GeoIP doit être visible (lib/legal.ts). */}
          {DATA_SOURCES.map((s) => (
            <a key={s.name} href={s.url} className="hover:text-ink" rel="noopener noreferrer">
              {s.attribution}
            </a>
          ))}
        </div>
      </footer>
    </div>
  );
}
