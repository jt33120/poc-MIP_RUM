// Bandeau permanent de la session de démonstration, en haut de chaque écran de la
// console (recette du 26/09/2026).
//
// Un visiteur venu de « Voir la démo » arrivait dans la console sans aucun cadre :
// rien ne disait que c'était une démo en lecture seule, rien ne ramenait à la
// présentation, et rien ne proposait par où commencer. Le seul indice (« VIEWER »
// dans la barre latérale) disparaît à 390 px. Ce bandeau dit les trois, sur une ligne
// qui passe à la ligne sur un téléphone.
//
// À MONTER PAR LE LAYOUT, pour une session démo seulement (`user.demo`), au-dessus du
// contenu : la coquille de la console n'appartient pas à la vitrine. Composant
// serveur, sans état.
//
// Les pistes ouvrent des écrans en navigation DOCUMENT (<a>) : elles gardent ainsi le
// projet courant que le middleware réinjecte, sans dépendre du contexte de filtres.
const PISTES: readonly { href: string; libelle: string }[] = [
  { href: "/errors", libelle: "Une erreur et sa session" },
  { href: "/sessions", libelle: "Revoir une session" },
  { href: "/?cmp=release", libelle: "Comparer deux versions" },
];

const LIEN =
  "rounded font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf";

export function BandeauDemo() {
  return (
    <div
      role="note"
      aria-label="Démonstration en lecture seule"
      data-testid="bandeau-demo"
      className="border-b border-accent/30 bg-accent/10 px-4 py-2 text-sm text-ink"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <span className="font-semibold">Démo · lecture seule · données de démonstration</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-soft">
          <span>Par où commencer :</span>
          {PISTES.map((p) => (
            <a key={p.href} href={p.href} className={LIEN}>
              {p.libelle}
            </a>
          ))}
        </span>
        <a href="/presentation" className={`ml-auto ${LIEN}`}>
          ← Présentation
        </a>
      </div>
    </div>
  );
}
