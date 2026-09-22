/** Aucun avis noté : ne jamais habiller l'absence d'une courbe ou d'une note numérique. */
export function ExperienceUnavailable() {
  return (
    <div className="flex h-[260px] flex-col items-center justify-center gap-2 text-center" data-testid="xp-unavailable">
      <p className="text-lg font-semibold text-ink">Données insuffisantes</p>
      <p className="max-w-xs text-xs text-ink-faint">Aucun avis noté sur cette période : la satisfaction ne se trace pas.</p>
    </div>
  );
}
