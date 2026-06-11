"use client";
import { useState } from "react";

/** Bloc de code copiable — le wizard d'onboarding en est truffé. */
export function CopyBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="group relative">
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
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
