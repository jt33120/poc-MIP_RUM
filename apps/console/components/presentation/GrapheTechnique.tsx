// Le GRAPHE TECHNIQUE (/presentation/graphe-technique, 30/09/2026) : tout le texte
// d'explication des pages d'avant le menu, rassemblé sur une seule page en attendant
// sa place définitive.
//
//   · de l'ancienne vitrine (jusqu'au 30/09/2026) : la promesse, où en est le POC, les
//     trois preuves visuelles, le tableau « Où sont les données, et sous quel droit » ;
//   · de l'ancien dossier technique (/presentation/dossier) : le relevé, ce qu'il
//     contient, ce qu'il sait faire, le détail ligne par ligne.
//
// « Ce qui reste pour un vrai outil de RUM » est passé dans la page À faire, avec les
// hypothèses réductrices du POC : les renvois de l'annexe y mènent (SaitFaire.tsx).
// Les garanties des anciennes pages suivent leurs composants, inchangés : chaque
// carte, chaque point et le registre restent confrontés au document de couverture
// (couverture-site, SaitFaire, Annexe, e2e presentation.spec.ts).
import { Ancres } from "@/components/presentation/Ancres";
import { Annexe } from "@/components/presentation/Annexe";
import { PocLabel } from "@/components/presentation/Cadre";
import { Contient } from "@/components/presentation/Contient";
import { Hebergement } from "@/components/presentation/Hebergement";
import { Preuves } from "@/components/presentation/Preuves";
import { Releve } from "@/components/presentation/Releve";
import { SaitFaire } from "@/components/presentation/SaitFaire";
import { StatutPoc } from "@/components/presentation/StatutPoc";
import { Icon } from "@/components/icons";
import type { SessionUser } from "@/lib/auth";

/** Coche des promesses (le jeu d'icônes partagé n'en a pas). */
const COCHE = <path d="M20 6 9 17l-5-5" />;

/** Ce que l'outil apporte, en trois phrases vérifiables (la suite de la page en donne les limites). */
const PROMESSES: readonly string[] = [
  "Une balise dans les pages du site, ou une extension installée sur les postes de l'entreprise, sans toucher au site.",
  "Chaque erreur remonte à la session, à l'action et à l'appel serveur qui l'ont produite.",
  "Une collecte au format OpenTelemetry, un standard ouvert.",
];

/**
 * Le récit de l'ancienne vitrine : la promesse et le statut daté, les preuves,
 * l'hébergement. Séparé du reste pour être rendu seul (tests) : la suite lit la base.
 */
export function Recit() {
  return (
    <>
      {/* La promesse et le statut daté : le premier écran de l'ancienne vitrine. */}
      <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 pb-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)]">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-4 text-lg leading-relaxed text-ink">
            <PocLabel />
          </p>
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
          <Releve />
        </div>
        <div className="min-w-0">
          <StatutPoc />
        </div>
      </div>

      <Preuves />
      <Hebergement />
    </>
  );
}

export function GrapheTechnique({ user, demoOuverte }: { user: SessionUser | null; demoOuverte: boolean }) {
  return (
    <>
      <Recit />
      <Ancres sans={["reste"]} />
      <Contient user={user} demoOuverte={demoOuverte} />
      <SaitFaire />
      <Annexe />
    </>
  );
}
