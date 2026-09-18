"use client";

export default function ExplorerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card border-bad/30 p-8 text-center">
      <h1 className="text-lg font-semibold text-ink">Impossible d’exécuter cette requête</h1>
      <p className="mt-2 text-sm text-ink-soft">
        Aucun chiffre partiel n’est affiché : un résultat incomplet se lirait comme un résultat.
      </p>
      <button className="btn-accent mt-4" type="button" onClick={reset}>
        Réessayer
      </button>
    </div>
  );
}
