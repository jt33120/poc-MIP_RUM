"use client";
// Les trois parcours de `/installer` en onglets (ancres `#snippet`, `#extension`,
// `#serveur`), et le SONDAGE du test « ça arrive ».
//
// LE SONDAGE réutilise le mécanisme de la fiche d'un client (`useRelecturePeriodique`,
// celui d'`AutoRefresh` : `router.refresh()` toutes les 5 s, jamais onglet masqué,
// jamais deux à la fois), BORNÉ par `decisionSondage` (`lib/installer.ts`) : il
// s'arrête dès que le parcours affiché est tout vert, et après 120 relectures
// (10 minutes d'onglet visible) ; « Vérifier à nouveau » en rouvre autant. La base
// est payée à l'usage : une page oubliée ouverte ne l'interroge pas indéfiniment.
// Le rafraîchissement général de la console est coupé sur cette route
// (`SANS_RAFRAICHISSEMENT`) : sans quoi il relirait la page toutes les 5 s, sans fin.
//
// Les panneaux sont rendus par le serveur et restent montés (masqués) d'un onglet à
// l'autre : les cases cochées d'une check-list survivent au changement d'onglet.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRelecturePeriodique } from "@/components/useRelecturePeriodique";
import { fmtHeure } from "@/lib/format";
import {
  ANCRE_PARCOURS,
  INTERVALLE_SONDAGE_MS,
  LIBELLE_PARCOURS,
  PARCOURS,
  decisionSondage,
  minutesRestantes,
  parcoursDuFragment,
  type EtatSondage,
  type Parcours,
} from "@/lib/installer";

interface Sondage {
  etat: EtatSondage;
  minutes: number;
  luA: Date | null;
  verifierANouveau: () => void;
}

const SondageCtx = createContext<Sondage | null>(null);

export function ParcoursInstallation({
  vert,
  panneaux,
  entetes,
}: {
  /** Le test « ça arrive » de chaque parcours est-il tout vert ? (lu par la page, à chaque relecture) */
  vert: Record<Parcours, boolean>;
  panneaux: Record<Parcours, ReactNode>;
  /**
   * Ce qui précède la check-list de chaque parcours, dans son onglet (refonte du
   * 01/10/2026 : ses valeurs, sur toute la largeur).
   */
  entetes?: Record<Parcours, ReactNode>;
}) {
  const [actif, setActif] = useState<Parcours>("snippet");
  const ongletsRef = useRef<HTMLDivElement>(null);

  // L'onglet suit l'ancre : un lien partagé (`/installer#serveur`), une carte
  // « Lequel choisir ? » (`#extension`), le retour arrière du navigateur.
  useEffect(() => {
    const suivre = (defiler: boolean) => {
      const fragment = window.location.hash;
      setActif(parcoursDuFragment(fragment));
      if (defiler && fragment) requestAnimationFrame(() => ongletsRef.current?.scrollIntoView({ block: "start" }));
    };
    suivre(true);
    const surAncre = () => suivre(true);
    window.addEventListener("hashchange", surAncre);
    return () => window.removeEventListener("hashchange", surAncre);
  }, []);

  const choisir = useCallback((p: Parcours) => {
    setActif(p);
    // L'ancre suit l'onglet (lien partageable) sans ajouter d'entrée d'historique.
    window.history.replaceState(window.history.state, "", `#${p}`);
  }, []);

  // Flèches gauche/droite entre onglets (motif « tablist » de l'ARIA).
  const surTouche = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const i = PARCOURS.indexOf(actif);
    const suivant = PARCOURS[(i + (e.key === "ArrowRight" ? 1 : PARCOURS.length - 1)) % PARCOURS.length];
    choisir(suivant);
    document.getElementById(`onglet-${suivant}`)?.focus();
  };

  // ─── Le sondage ───
  const [relectures, setRelectures] = useState(0);
  const relecturesRef = useRef(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const maj = () => setVisible(document.visibilityState === "visible");
    maj();
    document.addEventListener("visibilitychange", maj);
    return () => document.removeEventListener("visibilitychange", maj);
  }, []);

  const toutVert = vert[actif];
  const actifSondage = decisionSondage({ relectures, toutVert, visible: true, enCours: false }).relire;
  const { pending, relire } = useRelecturePeriodique({
    actif: actifSondage,
    intervalMs: INTERVALLE_SONDAGE_MS,
    // Le hook a déjà écarté l'onglet masqué et la relecture en cours : reste le
    // vert et le plafond, relus au tic (le parcours affiché a pu changer).
    autoriser: () => {
      if (!decisionSondage({ relectures: relecturesRef.current, toutVert, visible: true, enCours: false }).relire) return false;
      relecturesRef.current += 1;
      setRelectures(relecturesRef.current);
      return true;
    },
  });
  const { etat } = decisionSondage({ relectures, toutVert, visible, enCours: pending });

  // L'heure de la dernière lecture, posée côté client : rendue au serveur, elle
  // différerait de celle du navigateur et casserait l'hydratation.
  const [luA, setLuA] = useState<Date | null>(null);
  useEffect(() => {
    if (!pending) setLuA(new Date());
  }, [pending]);

  const verifierANouveau = useCallback(() => {
    relecturesRef.current = 0;
    setRelectures(0);
    relire();
  }, [relire]);

  return (
    <div id={ANCRE_PARCOURS} ref={ongletsRef} className="scroll-mt-24">
      <div
        role="tablist"
        aria-label="Parcours d'installation"
        className="mb-4 grid grid-cols-3 gap-1 rounded-xl border border-line bg-panel2/60 p-1"
        data-testid="onglets-parcours"
      >
        {PARCOURS.map((p) => {
          const choisi = p === actif;
          return (
            <button
              key={p}
              type="button"
              role="tab"
              id={`onglet-${p}`}
              aria-selected={choisi}
              aria-controls={`panneau-${p}`}
              tabIndex={choisi ? 0 : -1}
              onClick={() => choisir(p)}
              onKeyDown={surTouche}
              data-testid={`onglet-${p}`}
              className={`min-w-0 rounded-lg px-2 py-2 text-center text-xs font-semibold leading-tight transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf sm:text-sm ${
                choisi ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-soft hover:text-ink"
              }`}
            >
              {LIBELLE_PARCOURS[p]}
              {vert[p] && (
                <span className="ml-1 text-good-ink" aria-label="tout est arrivé">
                  ✓
                </span>
              )}
            </button>
          );
        })}
      </div>
      <SondageCtx.Provider value={{ etat, minutes: minutesRestantes(relectures), luA, verifierANouveau }}>
        {PARCOURS.map((p) => (
          <div
            key={p}
            role="tabpanel"
            id={`panneau-${p}`}
            aria-labelledby={`onglet-${p}`}
            hidden={p !== actif}
            data-testid={`parcours-${p}`}
          >
            {entetes && <div className="mb-3">{entetes[p]}</div>}
            {panneaux[p]}
          </div>
        ))}
      </SondageCtx.Provider>
    </div>
  );
}

const TEXTES: Record<EtatSondage, string> = {
  en_cours: "Vérification en direct toutes les 5 secondes.",
  en_pause: "Vérification en pause tant que l'onglet est masqué ; elle reprend à votre retour.",
  vert: "Tout est arrivé : la vérification s'est arrêtée.",
  delai: "Vérification arrêtée après 10 minutes, pour ne pas interroger la base sans fin.",
};

/** L'état du sondage, dans l'étape « Vérifier » du parcours affiché. */
export function EtatSondageEnDirect() {
  const s = useContext(SondageCtx);
  if (!s) return null;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-xs ${
        s.etat === "vert" ? "border-good/30 bg-good/10 text-good-ink" : "border-line bg-panel2/60 text-ink-soft"
      }`}
      role="status"
      data-testid="etat-sondage"
      data-etat={s.etat}
    >
      {s.etat === "en_cours" && <span className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-good" aria-hidden />}
      <span className="min-w-0">
        {TEXTES[s.etat]}
        {s.etat === "en_cours" && <> Encore {s.minutes} min au plus.</>}
        {s.luA && s.etat !== "vert" && <> Dernière lecture à {fmtHeure(s.luA, { secondes: true })}.</>}
      </span>
      {s.etat === "delai" && (
        <button type="button" onClick={s.verifierANouveau} className="btn-accent ml-auto px-3 py-1 text-xs" data-testid="verifier-a-nouveau">
          Vérifier à nouveau
        </button>
      )}
    </div>
  );
}
