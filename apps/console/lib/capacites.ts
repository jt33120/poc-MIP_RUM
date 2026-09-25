// LES CAPACITÉS FERMÉES : annoncées, accès non ouvert — Logs, Supervision SVI,
// Supervision IA. UNE liste, lue par la sidebar (`components/nav-items.tsx`), par
// la page (`CapaciteFermee`) et par le chargeur de l'écran (`lib/chargeurs/`) :
// dans console-api non plus, une capacité fermée n'est pas lue — le cadenas n'est
// pas qu'un décor. La rouvrir, c'est retirer son chemin d'ici.
export const CAPACITES_FERMEES: readonly string[] = ["/logs", "/svi", "/ai"];

/** La capacité couvrant ce chemin est-elle fermée ? */
export function estFermee(href: string): boolean {
  return CAPACITES_FERMEES.some((c) => href === c || href.startsWith(`${c}/`));
}
