// CLIQUER UNE SOURCE, C'EST VOIR LE CHIFFRE — le surlignage d'un fait sur la page.
//
// La source d'une réponse désigne un repère que la page porte déjà (`#sante`,
// `[data-testid="tuile-LCP"]`…). Le clic fait défiler la page jusqu'à lui et le
// surligne 2,5 s : un anneau orange qui pulse (`.assistant-surlignage`, fin de
// `app/globals.css`), immobile sous `prefers-reduced-motion`.
//
// Un repère peut manquer : bloc éteint, onglet du graphique principal fermé, ligne
// d'une liste repliée. On essaie alors le repli du fait ; un `<details>` fermé qui
// contient la cible est ouvert, sinon le surlignage ne se verrait pas.

export const CLASSE_SURLIGNAGE = "assistant-surlignage";
export const DUREE_SURLIGNAGE_MS = 2500;

const minuteries = new WeakMap<Element, ReturnType<typeof setTimeout>>();

/** L'élément que vise un fait, ou son repli ; `null` si aucun des deux n'est dans la page. */
export function trouverCible(racine: Pick<Document, "querySelector">, cible: string, repli?: string): Element | null {
  for (const selecteur of [cible, repli]) {
    if (!selecteur) continue;
    try {
      const el = racine.querySelector(selecteur);
      if (el) return el;
    } catch {
      // Un sélecteur illisible ne vise rien : on passe au repli.
    }
  }
  return null;
}

/**
 * Fait défiler jusqu'à `el` et le surligne ; relancé à chaque clic (la pulsation
 * repart). `reduit` : sans animation de défilement.
 */
export function surligner(el: Element, { reduit = false }: { reduit?: boolean } = {}): void {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.tagName === "DETAILS" && !(p as HTMLDetailsElement).open) (p as HTMLDetailsElement).open = true;
  }
  el.scrollIntoView({ behavior: reduit ? "auto" : "smooth", block: "center" });
  const precedente = minuteries.get(el);
  if (precedente) clearTimeout(precedente);
  el.classList.remove(CLASSE_SURLIGNAGE);
  // Relire la mise en page entre le retrait et l'ajout : sans cela, l'animation ne
  // repartirait pas sur un deuxième clic de la même source.
  void (el as HTMLElement).offsetWidth;
  el.classList.add(CLASSE_SURLIGNAGE);
  minuteries.set(
    el,
    setTimeout(() => {
      el.classList.remove(CLASSE_SURLIGNAGE);
      minuteries.delete(el);
    }, DUREE_SURLIGNAGE_MS),
  );
}
