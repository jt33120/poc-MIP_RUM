// Les parties de la vitrine (/presentation), dans leur ordre d'affichage (plan § 8.2).
//
// UNE SEULE LISTE pour trois lecteurs qui doivent dire la même chose : le sommaire
// (Ancres.tsx) qui pointe vers les titres, chaque partie (Partie.tsx) qui porte son
// titre et son identifiant, et la recette e2e (tests/e2e/presentation.spec.ts)
// qui les cherche. Un identifiant tapé deux fois finit par diverger, et un lien de
// sommaire qui ne mène nulle part ne se voit pas à l'œil.
//
// Le sommaire vise le TITRE de la partie, pas la section : un titre `h2` porte
// `tabIndex={-1}`, donc la navigation vers son ancre y déplace aussi le focus
// (le clavier repart de là). Une section non focalisable laisserait le focus en
// haut de page.

export type PartieId = "contient" | "sait-faire" | "reste" | "detail";

export interface Partie {
  /** Identifiant de la section (`#contient`…), que les recettes ciblent. */
  id: PartieId;
  /** Titre `h2` de la partie, texte exact du plan. */
  titre: string;
  /** Libellé court du sommaire. */
  ancre: string;
}

export const PARTIES: readonly Partie[] = [
  { id: "contient", titre: "Ce qu'il contient", ancre: "Ce qu'il contient" },
  { id: "sait-faire", titre: "Ce qu'il sait faire", ancre: "Ce qu'il sait faire" },
  { id: "reste", titre: "Ce qui reste pour un vrai outil de RUM", ancre: "Ce qui reste" },
  { id: "detail", titre: "Le détail, ligne par ligne", ancre: "Le détail" },
];

export function partie(id: PartieId): Partie {
  const trouvee = PARTIES.find((p) => p.id === id);
  if (!trouvee) throw new Error(`partie inconnue : ${id}`);
  return trouvee;
}

/** Identifiant du titre `h2` d'une partie : la cible du sommaire. */
export function idTitre(id: PartieId): string {
  return `${id}-titre`;
}
