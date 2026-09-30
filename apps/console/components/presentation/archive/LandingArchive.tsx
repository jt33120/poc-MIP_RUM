// ARCHIVE (30/09/2026). La vitrine publique telle qu'elle était jusqu'au 30/09/2026 :
// la refonte « démo » a remplacé /presentation par un film, deux entrées et un aperçu
// défilant (components/presentation/Landing.tsx). Son texte n'est pas supprimé : il
// attend d'être replacé ailleurs, et reste lisible sur /presentation/archive.
//
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
import { Actions } from "@/components/presentation/Actions";
import { ICON_PATHS, Icon } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";

/** Coche des promesses (le jeu d'icônes partagé n'en a pas). */
const COCHE = <path d="M20 6 9 17l-5-5" />;

/** Ce que l'outil apporte, en trois phrases vérifiables (le dossier technique en donne les limites). */
const PROMESSES: readonly string[] = [
  "Une balise dans les pages du site, ou une extension installée sur les postes de l'entreprise, sans toucher au site.",
  "Chaque erreur remonte à la session, à l'action et à l'appel serveur qui l'ont produite.",
  "Une collecte au format OpenTelemetry, un standard ouvert.",
];

export function LandingArchive({ user, demoOuverte }: { user: SessionUser | null; demoOuverte?: boolean }) {
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
