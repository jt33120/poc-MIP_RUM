"use client";
// Rejeu synchronisé à la chronologie (F47, plan § 4.3, § 5.12.4 ; Datadog f006-f014).
// La chronologie est SSR (`Deroule`) : chaque ligne porte `data-ligne="evt-<rang>"` et
// un lien d'instant `?tab=deroule&at=<t>#evt-<rang>`, qui suffit sans JavaScript. Avec,
// l'îlot monte le lecteur, pose `aria-current="time"` sur la ligne que la tête a
// atteinte (recherche dichotomique), place la tête au FOCUS ou au CLIC d'une ligne, et
// garde `?at=` dans l'adresse. SOUS 640 PX, PAS DE REJEU SANS GESTE (§ 5.12.3) : un
// lien « Replay » suivi (`tab=replay`, `at`) est ce geste, à toutes les largeurs.
import { useCallback, useEffect, useRef, useState } from "react";
import ReplayPlayer, { type CommandeLecteur } from "./ReplayPlayer";
import { TEXTE_COUVERTURE, ligneActive, type LigneSynchro, type Marqueur } from "@/lib/replay-synchro";

export type { Marqueur } from "@/lib/replay-synchro";

/** À partir de 640 px, le lecteur se charge seul ; en deçà, sur un geste. */
const ECRAN_LARGE = "(min-width: 640px)";

export function ReplaySynchro({
  sessionId,
  atMs,
  items,
  marqueurs,
  demande = false,
}: {
  sessionId: string;
  atMs: number | null;
  /** Lignes de la chronologie SSR, triées par instant (epoch ms). */
  items: LigneSynchro[];
  marqueurs: Marqueur[];
  /** La page a été ouverte POUR le rejeu (`tab=replay`) : ce lien est le geste. */
  demande?: boolean;
}) {
  const lecteur = useRef<CommandeLecteur>(null);
  const active = useRef<Element | null>(null);
  /** `null` tant que l'îlot n'a pas décidé (rendu serveur) ; sinon, monté ou en attente d'un geste. */
  const [monte, setMonte] = useState<boolean | null>(null);
  const avecGeste = demande || atMs !== null;

  useEffect(() => {
    // Une fois monté, le lecteur le reste (un filtre `voir=` suivi n'annule pas le geste).
    setMonte((deja) => deja === true || avecGeste || window.matchMedia(ECRAN_LARGE).matches);
  }, [avecGeste]);

  /** `aria-current="time"` sur une ligne, retiré de la précédente ; rend la ligne si elle change. */
  const marquer = useCallback((ancre: string | null): Element | null => {
    const ligne = ancre ? document.querySelector(`#chronologie [data-ligne="${ancre}"]`) : null;
    if (ligne === active.current) return null;
    active.current?.removeAttribute("aria-current");
    ligne?.setAttribute("aria-current", "time");
    active.current = ligne;
    return ligne;
  }, []);

  const onTemps = useCallback(
    (t: number) => {
      const i = ligneActive(items, t);
      const ligne = marquer(i >= 0 ? items[i].ancre : null);
      // Défilement INTERNE de la chronologie (≥ 1280 px) : la page, elle, ne bouge pas.
      const zone = document.getElementById("chronologie");
      if (!ligne || !zone || zone.scrollHeight <= zone.clientHeight + 1) return;
      const l = ligne.getBoundingClientRect();
      const z = zone.getBoundingClientRect();
      if (l.top < z.top || l.bottom > z.bottom) zone.scrollTop += l.top - z.top - z.height / 3;
    },
    [items, marquer],
  );

  useEffect(() => {
    if (!monte) return;
    const zone = document.getElementById("chronologie");
    if (!zone) return;
    const instants = new Map(items.map((l) => [l.ancre, l.t]));
    const viser = (cible: EventTarget | null): boolean => {
      const ancre = (cible instanceof Element ? cible.closest("[data-ligne]") : null)?.getAttribute("data-ligne") ?? "";
      const t = instants.get(ancre);
      if (t === undefined) return false;
      lecteur.current?.allerA(t, "ligne");
      marquer(ancre);
      return true;
    };
    const auFocus = (e: FocusEvent) => void viser(e.target);
    const auClic = (e: MouseEvent) => {
      const lien = e.target instanceof Element ? e.target.closest("a") : null;
      // Un autre lien de la ligne (« Cette page pour tous »…) mène ailleurs : on le suit.
      if (lien && !lien.hasAttribute("data-instant")) return;
      if (!viser(e.target) || !lien || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      // Le lien d'instant ne recharge rien : la tête bouge, l'adresse garde `?at=`.
      e.preventDefault();
      window.history.replaceState(null, "", lien.getAttribute("href") ?? "");
    };
    zone.addEventListener("focusin", auFocus);
    zone.addEventListener("click", auClic);
    return () => {
      zone.removeEventListener("focusin", auFocus);
      zone.removeEventListener("click", auClic);
    };
  }, [monte, items, marquer]);

  if (monte) {
    return <ReplayPlayer ref={lecteur} sessionId={sessionId} atMs={atMs} marqueurs={marqueurs} onTemps={onTemps} />;
  }
  return (
    <div className="card min-w-0 p-4 sm:p-6" data-testid="replay-attente" data-attente={monte === null ? "decision" : "geste"}>
      <p className="mb-3 text-xs leading-relaxed text-ink-soft">{TEXTE_COUVERTURE}</p>
      <p className={`py-6 text-center text-sm text-ink-faint ${avecGeste ? "" : "hidden sm:block"}`}>Chargement du replay…</p>
      {!avecGeste && (
        <div className="sm:hidden">
          <button type="button" className="btn-accent" onClick={() => setMonte(true)}>
            Lancer le rejeu
          </button>
          <p className="mt-2 text-xs text-ink-soft">
            Sur un petit écran, le lecteur ne se charge qu&apos;à votre demande : il télécharge tout l&apos;enregistrement
            (1 Mo compressé au plus).
          </p>
        </div>
      )}
    </div>
  );
}
