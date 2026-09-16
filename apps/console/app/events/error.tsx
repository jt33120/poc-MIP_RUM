"use client";

export default function EventsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card border-bad/30 p-8 text-center">
      <h1 className="text-lg font-semibold text-ink">Impossible de charger les événements</h1>
      <p className="mt-2 text-sm text-ink-soft">La requête est restée bornée et aucune donnée partielle n’est affichée.</p>
      <button className="btn-accent mt-4" type="button" onClick={reset}>Réessayer</button>
    </div>
  );
}
