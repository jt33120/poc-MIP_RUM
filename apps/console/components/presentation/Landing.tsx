// La présentation PUBLIQUE (/presentation) : une vitrine de deux à trois écrans,
// pour une DSI qui découvre le produit.
//
// POURQUOI SI COURTE (recette du 26/09/2026). La page faisait 15 400 px à 1440 et
// environ 10 700 mots : le message clé — ce que fait l'outil, où sont les données, où
// en est le POC — se perdait sous les cartes, les codes de lot et les chemins du code.
// Elle garde désormais, dans cet ordre : la promesse et le statut daté (premier
// écran), trois preuves visuelles lisibles, le tableau « Où sont les données, et sous
// quel droit » (seule source de l'hébergement), puis l'invitation à la démo. Le
// détail vérifiable — capacités, limites, ce qui reste, registre, spécifications —
// est dans le dossier technique (/presentation/dossier, Dossier.tsx), en un clic.
//
// Visiteur ou connecté, la même page : seule l'action change (« Ouvrir la console »
// au lieu de la démo et de la connexion). /presentation est un chemin public
// (lib/chemins-publics.ts), que le layout ne met jamais dans la coquille de la
// console. Rendu serveur ; les seuls îlots client sont la bascule de thème et le
// cadre défilant de la table d'hébergement.
import Link from "next/link";
import { EnTete, Pied, PocLabel } from "@/components/presentation/Cadre";
import { Hebergement } from "@/components/presentation/Hebergement";
import { Preuves } from "@/components/presentation/Preuves";
import { StatutPoc } from "@/components/presentation/StatutPoc";
import { ICON_PATHS, Icon } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";
import { demoConfig } from "@/lib/demo";

const PLEIN =
  "bg-gradient-to-r from-accent via-[#fca62b] to-accent-deep text-navy-950 shadow-[0_8px_22px_-10px_rgba(248,145,1,0.9)] hover:brightness-110 hover:shadow-[0_10px_26px_-8px_rgba(248,145,1,0.95)]";
const CONTOUR = "border border-line bg-panel/70 text-ink backdrop-blur-sm hover:border-accent/50";
const VERROUILLE = "cursor-not-allowed border border-dashed border-line bg-panel/40 text-ink-soft";

/**
 * Les actions de la présentation, dans l'en-tête (`size="sm"`) et sous le titre.
 *
 * Connecté : une seule, ouvrir la console. Visiteur : démo et connexion côte à
 * côte, toujours dans cet ordre ; sans DEMO_USER_APPS, la démo reste affichée mais
 * verrouillée — pas de lien mort, juste une promesse pas encore tenue, avec l'info
 * au survol.
 */
export function Actions({
  size = "md",
  user,
  demoOuverte,
  fin = false,
}: {
  size?: "sm" | "md";
  user: SessionUser | null;
  demoOuverte?: boolean;
  /** Le rappel en bas de page : ses repères de test ne doivent pas doubler ceux du titre. */
  fin?: boolean;
}) {
  const suffixe = fin ? "-fin" : size === "sm" ? "-top" : "";
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
  // C1c : la page dit si la démo est ouverte (console-api, `lib/methodes-connexion.ts`) ;
  // sans elle, la variable de Vercel.
  const demo = demoOuverte ?? demoConfig() !== null;
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

/** Coche des promesses (le jeu d'icônes partagé n'en a pas). */
const COCHE = <path d="M20 6 9 17l-5-5" />;

/** Ce que l'outil apporte, en trois phrases vérifiables (le dossier technique en donne les limites). */
const PROMESSES: readonly string[] = [
  "Une balise dans les pages du site, ou une extension installée sur les postes de l'entreprise, sans toucher au site.",
  "Chaque erreur remonte à la session, à l'action et à l'appel serveur qui l'ont produite.",
  "Une collecte au format OpenTelemetry, un standard ouvert.",
];

export function Landing({ user, demoOuverte }: { user: SessionUser | null; demoOuverte?: boolean }) {
  return (
    <div className="mip-sci flex min-h-screen flex-col">
      <EnTete>
        <Actions size="sm" user={user} demoOuverte={demoOuverte} />
      </EnTete>

      <main className="flex-1">
        {/* Premier écran : la promesse, les actions, et où en est le POC. */}
        <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:py-16">
          <div className="min-w-0 animate-fade-up">
            <h1 className="flex flex-wrap items-center gap-x-4 gap-y-2 text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              <span>
                MIP <span className="text-accent">RUM</span>
              </span>
              <PocLabel className="translate-y-1" />
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink">
              Voir ce que vivent vraiment les visiteurs d&apos;un site ou d&apos;une application : vitesse
              d&apos;affichage, réactivité, erreurs et parcours, mesurés dans leurs propres navigateurs.
            </p>
            <ul className="mt-6 max-w-xl space-y-2.5">
              {PROMESSES.map((p) => (
                <li key={p} className="flex gap-3 text-[15px] leading-relaxed text-ink-soft">
                  <Icon paths={COCHE} className="mt-1 h-4 w-4 shrink-0 text-accent-ink" strokeWidth={2.4} />
                  {p}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <Actions user={user} demoOuverte={demoOuverte} />
            </div>
          </div>
          <div className="min-w-0 animate-fade-up">
            <StatutPoc />
          </div>
        </div>

        <Preuves />
        <Hebergement />

        {/* Dernier écran : l'invitation, sans rien redire de ce qui précède. */}
        <section aria-labelledby="suite-titre" className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-12 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:py-16">
            <div className="max-w-2xl">
              <h2 id="suite-titre" className="text-2xl font-bold tracking-tight text-ink">
                Voir par vous-même
              </h2>
              <p className="mt-2 leading-relaxed text-ink-soft">
                La démo ouvre la console en lecture seule, sur un jeu de données de démonstration. Le{" "}
                <Link href="/presentation/dossier" className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink">
                  dossier technique
                </Link>{" "}
                détaille chaque capacité, ses limites et ce qui reste à faire.
              </p>
            </div>
            <Actions user={user} demoOuverte={demoOuverte} fin />
          </div>
        </section>
      </main>

      <Pied />
    </div>
  );
}
