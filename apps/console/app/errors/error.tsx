"use client";

// Couvre la liste ET le détail d'un groupe : aucune donnée partielle n'est montrée,
// un compteur à moitié calculé contredirait ceux de l'écran précédent.
export default function ErrorsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card border-bad/30 p-8 text-center">
      <h1 className="text-lg font-semibold text-ink">Impossible de charger les erreurs</h1>
      <p className="mt-2 text-sm text-ink-soft">La lecture a échoué ; aucun chiffre partiel n’est affiché.</p>
      <button className="btn-accent mt-4" type="button" onClick={reset}>Réessayer</button>
    </div>
  );
}
