"use client";
// Bouton « Imprimer / enregistrer en PDF » — rend un document (ex. DPA) signable :
// impression navigateur puis signature manuscrite ou électronique sur le PDF.
export function PrintButton({ label = "Imprimer / enregistrer en PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-ink-soft transition hover:border-accent/40 hover:text-ink print:hidden"
    >
      {label}
    </button>
  );
}
