"use client";

// Le bouton « Copier pour mon IA de code » d'un parcours de /installer : il copie un
// prompt (lib/prompts-ia.ts) à coller dans Claude Code, Cursor, Copilot… L'icône :
// un presse-papiers marqué d'une étincelle, le signe courant de « ce qui part vers
// une IA ». Le prompt ne porte jamais la clé d'API (voir prompts-ia.ts).
import { useState } from "react";

/** Presse-papiers et étincelle, 24 × 24, trait courant. */
function IconePromptIA({ className }: { className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 4h6v3H9z" />
      <path d="M9 5.5H7a2 2 0 0 0-2 2V19a2 2 0 0 0 2 2h5" />
      <path d="M15 5.5h2a2 2 0 0 1 2 2V11" />
      <path d="M17.5 14l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" fill="currentColor" />
    </svg>
  );
}

/** Le texte copié : l'API du presse-papiers, et l'ancienne voie quand elle manque. */
async function copier(texte: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texte);
    return true;
  } catch {
    const zone = document.createElement("textarea");
    zone.value = texte;
    zone.setAttribute("readonly", "");
    zone.style.position = "fixed";
    zone.style.opacity = "0";
    document.body.appendChild(zone);
    zone.select();
    const ok = document.execCommand("copy");
    zone.remove();
    return ok;
  }
}

export function CopierPourIA({ prompt, libelle = "Copier pour mon IA de code", testId }: { prompt: string; libelle?: string; testId: string }) {
  const [etat, setEtat] = useState<"attente" | "copie" | "echec">("attente");
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        data-testid={testId}
        title="Un prompt à coller dans Claude Code, Cursor ou Copilot : il installe ce parcours dans votre projet. Sans la clé d'API."
        onClick={async () => {
          setEtat((await copier(prompt)) ? "copie" : "echec");
          setTimeout(() => setEtat("attente"), 2500);
        }}
        className="btn-accent inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
      >
        <IconePromptIA className="h-4 w-4" />
        {etat === "copie" ? "Prompt copié ✓" : libelle}
      </button>
      <span role="status" className="text-[11px] text-ink-soft">
        {etat === "copie" && "Collez-le dans Claude Code, Cursor ou Copilot, à la racine du projet."}
        {etat === "echec" && "Copie refusée par le navigateur."}
      </span>
    </span>
  );
}
