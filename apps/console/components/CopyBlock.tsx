"use client";
import { useState } from "react";

/**
 * Bloc de code copiable — le wizard d'onboarding en est truffé.
 *
 * Il ne doit JAMAIS élargir la page (recette du 26/09/2026 : fiche client à 719 px,
 * /api-docs à 517 px sur un écran de 390). Un `<pre>` défilant garde pourtant, comme
 * contribution de largeur minimale, sa plus longue ligne : dans une grille ou un
 * flex sans `min-w-0`, la colonne s'étirait jusqu'à elle. `[contain:inline-size]`
 * fait mesurer le bloc comme s'il était vide en largeur — il prend alors celle de
 * son conteneur, et c'est le `<pre>` qui défile. `pt-10` : le bouton « Copier »
 * recouvrait le début de la première ligne (« Copier l'URL » sur l'adresse).
 */
export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative min-w-0 max-w-full [contain:inline-size]">
      <pre className="max-w-full overflow-x-auto rounded-lg bg-slate-900 p-4 pt-10 text-xs leading-relaxed text-slate-100">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="absolute right-2 top-2 rounded bg-slate-700 px-2 py-1 text-[11px] font-medium text-slate-200 opacity-80 hover:bg-slate-600"
      >
        {copied ? "Copié ✓" : (label ?? "Copier")}
      </button>
    </div>
  );
}
