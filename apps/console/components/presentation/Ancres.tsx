// Sommaire de la vitrine (plan § 8.2, PS1) : un lien par partie, vers son TITRE.
//
// Le titre porte `tabIndex={-1}` (Partie.tsx) : suivre un lien du sommaire y
// déplace le focus, et le clavier repart de la partie choisie au lieu du haut de
// page. Liens et titres lisent la même liste (lib/presentation-parties.ts).
//
// Le sommaire reste collé en haut de l'écran pendant la lecture (recette du
// 26/09/2026 : la page faisait 28 800 px à 390 sans moyen de revenir aux parties). À
// 390 px, les liens passent à la ligne plutôt que de défiler : « Le détail » tombait
// hors de l'écran, sans rien qui l'annonce. Le conteneur garde `overflow-x-auto` pour
// ne jamais élargir la page, et `relative` : un élément positionné qu'il contiendrait
// se placerait sinon par rapport à la page, et l'élargirait.
import { PARTIES, idTitre } from "@/lib/presentation-parties";

export function Ancres() {
  return (
    <nav aria-label="Sommaire de la présentation" className="sticky top-0 z-30 border-y border-line bg-panel/85 backdrop-blur-md">
      <div className="relative mx-auto max-w-6xl overflow-x-auto px-4 sm:px-6">
        <ul className="flex flex-wrap gap-1 py-2">
          {PARTIES.map((p) => (
            <li key={p.id}>
              <a
                href={`#${idTitre(p.id)}`}
                className="block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                {p.ancre}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
