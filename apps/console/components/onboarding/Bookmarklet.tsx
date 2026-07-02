"use client";
// Bouton « bookmarklet » à glisser dans la barre de favoris. React refuse de
// rendre un href `javascript:` (sécurité) — on le pose donc impérativement via
// ref, ce qui préserve le drag-to-bookmark. Un clic dans l'app est neutralisé
// (le bookmarklet n'a de sens que collé dans un favori et lancé sur le site cible).
import { useEffect, useRef, useState } from "react";

export function Bookmarklet({ code, label }: { code: string; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    ref.current?.setAttribute("href", code);
  }, [code]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* presse-papier indisponible : l'utilisateur peut sélectionner le code affiché */
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* eslint-disable-next-line jsx-a11y/anchor-is-valid */}
      <a
        ref={ref}
        draggable
        onClick={(e) => e.preventDefault()}
        title="Glissez-moi dans votre barre de favoris"
        className="btn-accent cursor-grab select-none"
      >
        📊 Monitorer ce site
      </a>
      <span className="text-xs text-ink-faint">← glissez ce bouton dans votre barre de favoris</span>
      <button type="button" onClick={copy} className="btn-ghost">
        {copied ? "Copié ✓" : "Copier le code"}
      </button>
      <span className="sr-only">{label}</span>
    </div>
  );
}
