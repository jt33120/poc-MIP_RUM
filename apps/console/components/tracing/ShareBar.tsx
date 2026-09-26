// Barre de répartition front/serveur d'un appel API (part serveur en %).
// Rendu 100 % serveur. Extrait de app/tracing/page.tsx.
// Espace insécable avant « % » : « 99% » collé se lisait à l'anglaise, à côté des
// « 16,5 % » du reste de l'écran (recette du 26/09/2026).
const NBSP = String.fromCharCode(0xa0);

/** Jauge visuelle de la part serveur dans le temps total perçu. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-panel2" title={`${share}${NBSP}% serveur`}>
        <span className="block h-full rounded-full bg-gradient-to-r from-accent-deep to-accent" style={{ width: `${share}%` }} />
      </span>
      <span className="text-xs tabular-nums text-ink-soft">
        {share}
        {NBSP}% serveur
      </span>
    </span>
  );
}
