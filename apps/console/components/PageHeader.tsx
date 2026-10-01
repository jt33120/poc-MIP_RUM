"use client";
// En-tête de page standard : le titre, sa bulle d'aide, les actions à droite.
//
// Recette du 30/09/2026 : plus de surtitre ni de sous-titre. Le surtitre redisait la
// catégorie que la barre latérale allume déjà (« Performance » deux fois à l'écran),
// et la phrase-question sous le titre (« Les vrais visiteurs vont-ils bien… ») ne
// disait rien qu'un chiffre ne dise mieux. `sub` et `domain` restent acceptés, sans
// effet, pour ne pas réécrire les 47 écrans qui les passent.
//
// Recette du 01/10/2026 : sur l'écran d'un onglet, le titre REDISAIT l'onglet allumé
// juste au-dessus (« Pages » sous l'onglet Pages, « Alertes » sous Alertes). Il y reste
// pour les lecteurs d'écran (`titre-onglet`, app/globals.css), et l'aide et les actions
// (sélecteur de vital, « Évaluer maintenant »…) montent à droite des onglets, dans la
// place libre de leur rangée : l'écran commence par son contenu. Sous 1 024 px, elles
// restent ici, sur une rangée compacte alignée à droite. Un écran sans onglets
// (administration, API et MCP) garde un titre écrit, plus petit qu'avant.
import { Deporte, useOngletExact } from "./emplacements-coquille";
import { GlossaryTip } from "./GlossaryTip";
import type { PageDomain } from "./SurtitreDomaine";
import type { GlossaryId } from "@/lib/glossary";

export type { PageDomain };

export function PageHeader({
  title,
  help,
  children,
}: {
  title: React.ReactNode;
  /** Sans effet depuis le 30/09/2026 (voir l'en-tête du fichier). */
  sub?: React.ReactNode;
  /** Clé de glossaire : ajoute une bulle d'aide « ? » à côté du titre. */
  help?: GlossaryId;
  /** Sans effet depuis le 30/09/2026 : la barre latérale dit la catégorie. */
  domain?: PageDomain;
  children?: React.ReactNode;
}) {
  const exact = useOngletExact();

  if (exact) {
    const outils = help || children;
    return (
      <>
        <h1 className="titre-onglet mb-3 flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-ink" data-titre-page>
          {title}
        </h1>
        {outils && (
          <Deporte vers="onglets" repli="entete" des={1024} ordre={1} className="mb-3 flex min-w-0 flex-wrap items-center justify-end gap-2">
            {help && <GlossaryTip id={help} />}
            {children}
          </Deporte>
        )}
      </>
    );
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="min-w-0">
        {/* La bulle d'aide est la SŒUR du titre, pas son enfant : dans le h1, son
            texte faisait partie du nom du titre (« SatisfactionSatisfactionTechnique
            Ce que… » à la lecture d'écran, recette du 26/09/2026). */}
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold tracking-tight text-ink" data-titre-page>
            {title}
          </h1>
          {help && <GlossaryTip id={help} />}
        </div>
      </div>
      {/* Les actions PASSENT À LA LIGNE plutôt que de déborder. `shrink-0` les
          gardait sur une seule ligne : une quatrième action (« Dupliquer », P6.5)
          poussait l'en-tête au-delà de 390 px de large. Wrapper n'enlève rien aux
          en-têtes qui tiennent déjà ; il évite qu'une action de plus ne casse la
          page la plus étroite. */}
      {children && (
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{children}</div>
      )}
    </div>
  );
}
