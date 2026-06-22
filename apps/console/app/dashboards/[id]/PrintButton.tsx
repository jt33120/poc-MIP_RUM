"use client";
// Bouton d'impression / export PDF : déclenche le dialogue d'impression du
// navigateur (PDF via « Enregistrer au format PDF »). Client component minimal.
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-ghost">
      Imprimer / PDF
    </button>
  );
}
