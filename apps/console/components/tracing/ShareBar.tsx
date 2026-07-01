// Barre de répartition front/serveur d'un appel API (part serveur en %).
// Rendu 100 % serveur. Extrait de app/tracing/page.tsx.

/** Jauge visuelle de la part serveur dans le temps total perçu. */
export function ShareBar({ share }: { share: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-panel2" title={`${share}% serveur`}>
        <span className="block h-full rounded-full bg-gradient-to-r from-accent-deep to-accent" style={{ width: `${share}%` }} />
      </span>
      <span className="text-xs tabular-nums text-ink-soft">{share}% serveur</span>
    </span>
  );
}
