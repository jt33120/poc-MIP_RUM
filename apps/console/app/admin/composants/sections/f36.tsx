// Vitrine — F36 : la barre de population d'un tableau de bord (plan § 4.2, W-B1).
// Données FIXES écrites ici, aucune lecture en base.
//
// Fichier propre au lot (les lots d'une même vague ajoutent chacun le leur) : la
// page n'en porte que l'import et une ligne de rendu.
import type { ReactNode } from "react";
import { PopulationBar } from "@/components/PopulationBar";

const CHEMIN = "/admin/composants";

function Section({ id, titre, sous, children }: { id: string; titre: string; sous: string; children: ReactNode }) {
  return (
    <section id={id} className="mb-10 min-w-0" aria-labelledby={`${id}-titre`}>
      <h2 id={`${id}-titre`} className="text-base font-semibold text-ink">
        {titre}
      </h2>
      <p className="mb-4 mt-1 text-sm text-ink-soft">{sous}</p>
      {children}
    </section>
  );
}

function Exemple({ etat, children }: { etat: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-xs font-medium text-ink-soft">{etat}</p>
      {children}
    </div>
  );
}

export function SectionF36() {
  return (
    <Section
      id="f36-population"
      titre="Barre de population (W-B1)"
      sous="components/PopulationBar.tsx : chaque carte d’une grille hérite de cette population — la barre reste écrite même quand rien n’est filtré."
    >
      <div className="flex min-w-0 flex-col gap-6">
        <Exemple etat="Aucun filtre : la population non restreinte s’écrit quand même">
          <PopulationBar
            puces={[
              { libelle: "Toutes les apps autorisées" },
              { libelle: "Tous les visiteurs" },
              { libelle: "Robots exclus" },
              { libelle: "Jours et heures locales lus en Europe/Paris" },
            ]}
            plage="24 h"
            fuseau="UTC"
          />
        </Exemple>
        <Exemple etat="Conditions posées : chacune porte le lien qui la retire ; « Robots exclus » n’est pas un lien">
          <PopulationBar
            puces={[
              { libelle: "Apps : demo-app" },
              { libelle: "Appareil = mobile", retirerHref: `${CHEMIN}#f36-population` },
              { libelle: "Navigateur = Firefox", retirerHref: `${CHEMIN}#f36-population` },
              { libelle: "Robots exclus" },
              { libelle: "Jours et heures locales lus en Europe/Paris" },
            ]}
            plage="du 16/09 12:00 au 17/09 12:00"
            fuseau="UTC"
          />
        </Exemple>
      </div>
    </Section>
  );
}
