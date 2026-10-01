"use client";

// La loupe de la barre du haut (recette du 01/10/2026) : un champ qui mène à un écran,
// à une action, à une session ou à une route. ⌘K (Ctrl+K) ou « / » l'ouvre de partout.
// La logique (ce qui se trouve, dans quel ordre) est pure et testée : `lib/loupe.ts`.
//
// <dialog> natif : focus piégé, Échap, page inerte derrière — comme les fenêtres des cases.
// Le champ est une « combobox » ARIA : ↑/↓ choisissent, Entrée ouvre.
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { avecContexte, chercher } from "@/lib/loupe";

function IconeLoupe({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function Loupe({ admin }: { admin: boolean }) {
  const fenetre = useRef<HTMLDialogElement>(null);
  const champ = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [saisie, setSaisie] = useState("");
  const [choix, setChoix] = useState(0);
  const idListe = useId();
  const resultats = useMemo(() => chercher(saisie, admin), [saisie, admin]);

  const ouvrir = () => {
    const d = fenetre.current;
    if (!d || d.open) return;
    setSaisie("");
    setChoix(0);
    d.showModal();
    champ.current?.focus();
  };

  useEffect(() => {
    const raccourci = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement | null;
      const enSaisie = !!cible && (cible.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName));
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !enSaisie)) {
        e.preventDefault();
        ouvrir();
      }
    };
    window.addEventListener("keydown", raccourci);
    return () => window.removeEventListener("keydown", raccourci);
  }, []);

  const aller = (i: number) => {
    const r = resultats[i];
    if (!r) return;
    fenetre.current?.close();
    router.push(avecContexte(r, window.location.search));
  };

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
        data-testid="loupe"
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K /"
        className="flex h-8 min-w-0 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-xs text-ink-soft transition hover:border-ink-faint/60 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf sm:w-56"
      >
        <IconeLoupe />
        <span className="hidden truncate sm:inline">Rechercher un écran, une action…</span>
        <span className="sr-only sm:hidden">Rechercher</span>
        <kbd className="ml-auto hidden rounded border border-line px-1 font-sans text-[10px] text-ink-faint sm:inline">⌘K</kbd>
      </button>
      <dialog
        ref={fenetre}
        aria-label="Rechercher"
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
        className="mt-[12vh] w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-line bg-panel p-0 text-ink shadow-pop backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <IconeLoupe className="h-4 w-4 shrink-0 text-ink-faint" />
          <input
            ref={champ}
            value={saisie}
            onChange={(e) => {
              setSaisie(e.target.value);
              setChoix(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setChoix((c) => Math.min(c + 1, resultats.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setChoix((c) => Math.max(c - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                aller(choix);
              }
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={idListe}
            aria-activedescendant={resultats[choix] ? `${idListe}-${choix}` : undefined}
            aria-label="Écran, action, identifiant de session ou route (/checkout)"
            placeholder="Écran, action, identifiant de session, /route…"
            data-testid="loupe-champ"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          <kbd className="rounded border border-line px-1 text-[10px] text-ink-faint">Échap</kbd>
        </div>
        <ul id={idListe} role="listbox" aria-label="Résultats" className="max-h-[50vh] overflow-y-auto p-1.5" data-testid="loupe-resultats">
          {resultats.map((r, i) => (
            <li
              key={r.cle}
              id={`${idListe}-${i}`}
              role="option"
              aria-selected={i === choix}
              onMouseEnter={() => setChoix(i)}
              onClick={() => aller(i)}
              className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm ${
                i === choix ? "bg-panel2 text-ink" : "text-ink-soft"
              }`}
            >
              <span className="min-w-0 truncate">{r.libelle}</span>
              <span className="shrink-0 text-[11px] text-ink-faint">{r.groupe}</span>
            </li>
          ))}
          {resultats.length === 0 && (
            <li role="status" className="px-2.5 py-2 text-xs text-ink-soft">
              <span aria-hidden className="mr-1.5 text-ink-faint">
                ⊘
              </span>
              Aucun écran ni aucune action pour « {saisie.trim()} ».
            </li>
          )}
        </ul>
      </dialog>
    </>
  );
}
