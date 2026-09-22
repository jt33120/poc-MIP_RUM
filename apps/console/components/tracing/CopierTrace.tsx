"use client";
// Copie de l'identifiant COMPLET d'une trace (32 caractères, § 5.9 TD1, F61) ; repli sans presse-papiers : le champ, en lecture seule, se sélectionne.
import { useState } from "react";

export function CopierTrace({ traceId }: { traceId: string }) {
  const [etat, setEtat] = useState<"" | "copie" | "echec">("");
  const copier = () => (navigator.clipboard ? navigator.clipboard.writeText(traceId).then(() => setEtat("copie"), () => setEtat("echec")) : setEtat("echec"));
  return (
    <span className="relative flex w-full min-w-0 max-w-xl items-center gap-2">
      <input readOnly value={traceId} aria-label="Identifiant de trace" onFocus={(e) => e.currentTarget.select()} data-testid="trace-id" className="min-w-0 flex-1 rounded-md border border-line bg-panel2 px-2 py-1 font-mono text-xs text-ink" />
      <button type="button" onClick={copier} title="Copier l'identifiant de trace" data-testid="copier-trace" className="btn-ghost shrink-0 whitespace-nowrap text-xs">
        {etat === "copie" ? "Copié" : "Copier l'identifiant"}
      </button>
      <span role="status" className="sr-only">{etat === "copie" ? "Identifiant de trace copié" : etat === "echec" ? "Copie impossible : sélectionnez le champ" : ""}</span>
    </span>
  );
}
