// Recette « aucun débordement horizontal » (plan § 0.4, extraite par F09).
//
// Copie de `debordements` de `analyses-drilldowns.spec.ts` (elle-même reprise des
// recettes de P5) : les specs qui en ont une copie la gardent jusqu'à ce que leur
// lot les reprenne ; les nouveaux specs importent celle-ci.
import type { Page } from "@playwright/test";

/** Largeurs de la définition de « fait » : téléphone, tablette, bureau. */
export const LARGEURS = [390, 768, 1440] as const;

/**
 * Débordement horizontal : la liste des éléments fautifs, pas un simple booléen.
 * Un échec doit NOMMER le coupable — sans quoi la recette dit qu'il y a un
 * problème sans jamais dire où. Un élément dans un conteneur défilant est
 * légitime (tableau large) ; un élément positionné qui en échappe ne l'est pas.
 * Liste vide : la page tient dans la fenêtre.
 */
export async function debordements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const largeur = document.documentElement.clientWidth;
    const totale = document.documentElement.scrollWidth;
    if (totale <= largeur) return [];
    const dansDefilant = (el: Element) => {
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (["auto", "scroll", "hidden"].includes(getComputedStyle(parent).overflowX)) return true;
      }
      return false;
    };
    const fautifs = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        if (el.getBoundingClientRect().right <= largeur + 1) return false;
        return ["absolute", "fixed"].includes(getComputedStyle(el).position) || !dansDefilant(el);
      })
      .slice(0, 5)
      .map((el) => {
        // Un repère LISIBLE : le libellé d'aide de la bulle, le titre de la
        // section, ou le début du texte. Une liste de classes Tailwind dit
        // quel composant déborde, jamais lequel de ses dix exemplaires.
        const parent = el.parentElement;
        const repere =
          parent?.querySelector("[aria-label]")?.getAttribute("aria-label") ??
          el.closest("section, h1, h2, h3")?.textContent?.trim().slice(0, 60) ??
          el.textContent?.trim().slice(0, 60) ??
          "";
        return `${el.tagName.toLowerCase()} « ${repere} » → ${Math.round(el.getBoundingClientRect().right)} px`;
      });
    return [`page ${totale} px > fenêtre ${largeur} px`, ...fautifs];
  });
}
