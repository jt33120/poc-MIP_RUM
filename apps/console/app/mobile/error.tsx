"use client";

// Échec de `/mobile`. Aucune mesure partielle n'est affichée : un chiffre calculé
// sur une lecture interrompue serait pris pour une mesure.
export default function MobileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="card border-bad/30 p-8 text-center">
      <h1 className="text-lg font-semibold text-ink">Impossible de charger les mesures mobiles</h1>
      <p className="mt-2 text-sm text-ink-soft">
        La lecture est restée bornée et aucune donnée partielle n’est affichée. Un taux calculé sur une lecture
        interrompue se lirait comme une mesure.
      </p>
      <button className="btn-accent mt-4" type="button" onClick={reset}>Réessayer</button>
    </div>
  );
}
