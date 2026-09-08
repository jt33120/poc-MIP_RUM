"use client";
// Roue de réglage d'un tableau de bord : quels blocs le composent. Le catalogue
// reçu décide de tout — libellés, blocs, mesures non couvertes, cookie — donc
// une même fenêtre sert la Vue d'ensemble, les Sessions et les SLO.
//
// L'état est LOCAL tant que la fenêtre est ouverte, et n'est envoyé qu'à
// « Appliquer ». Basculer chaque interrupteur via une action serveur
// re-rendrait la page entière à chaque clic — sur un écran qui porte neuf
// requêtes, ça se voit.
import { useEffect, useRef, useState, useTransition } from "react";
import { ICON_PATHS, Icon } from "./icons";
import type { Catalogue } from "@/lib/dashboard-blocs";

export function DashboardSettings({
  catalogue,
  choix,
  action,
}: {
  catalogue: Catalogue;
  choix: Record<string, boolean>;
  action: (fd: FormData) => Promise<void>;
}) {
  const BLOCS = catalogue.blocs;
  const [ouvert, setOuvert] = useState(false);
  const [etat, setEtat] = useState(choix);
  const [envoi, demarrer] = useTransition();
  const boite = useRef<HTMLDivElement>(null);

  // La soumission est portée ICI, pas par le <form>. Fermer la fenêtre depuis le
  // onClick d'un bouton submit démonte le formulaire dans le même événement et
  // ANNULE l'envoi — la fenêtre se referme, l'air d'avoir marché, et rien n'est
  // enregistré. Constaté à l'écran avant correction.
  const appliquer = () => {
    const fd = new FormData();
    fd.set("catalogue", catalogue.href);
    for (const b of BLOCS) if (etat[b.id]) fd.set(`bloc:${b.id}`, "1");
    demarrer(async () => {
      await action(fd);
      setOuvert(false);
    });
  };

  // Le serveur reste la source de vérité : après « Appliquer », la page se
  // re-rend et `choix` change — l'état local doit suivre, sinon rouvrir la
  // fenêtre montrerait l'ancienne sélection.
  useEffect(() => setEtat(choix), [choix]);

  // Échap ferme, comme partout ailleurs. Le focus part sur la fenêtre à
  // l'ouverture pour que la touche soit reçue sans clic préalable.
  useEffect(() => {
    if (!ouvert) return;
    boite.current?.focus();
    const surTouche = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    addEventListener("keydown", surTouche);
    return () => removeEventListener("keydown", surTouche);
  }, [ouvert]);

  const actifs = BLOCS.filter((b) => etat[b.id]).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-haspopup="dialog"
        aria-label={`Composer le tableau de bord — ${catalogue.titre}`}
        title={`Composer — ${catalogue.titre}`}
        data-testid="ouvrir-reglages"
        className="shrink-0 rounded-lg p-1.5 text-ink-faint transition hover:bg-panel2 hover:text-ink"
      >
        <Icon paths={ICON_PATHS.settings} className="h-4 w-4" strokeWidth={2} />
      </button>

      {ouvert && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-navy-950/40 p-4 backdrop-blur-sm sm:p-8"
          onClick={() => setOuvert(false)}
        >
          <div
            ref={boite}
            tabIndex={-1}
            role="dialog"
            aria-modal
            aria-label={`Composer le tableau de bord — ${catalogue.titre}`}
            data-testid="reglages-blocs"
            // Sans ça, un clic n'importe où DANS la fenêtre remonterait jusqu'au
            // fond et la refermerait — y compris un clic sur un interrupteur.
            onClick={(e) => e.stopPropagation()}
            className="my-auto w-full max-w-lg rounded-2xl border border-line bg-panel shadow-pop outline-none"
          >
            <header className="flex items-start gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-semibold text-ink">
                  Composer — {catalogue.titre}
                </h2>
                <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
                  Choisissez les mesures affichées sur cet écran. Un bloc désactivé n&apos;est pas
                  seulement masqué : sa requête n&apos;est pas exécutée.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOuvert(false)}
                aria-label="Fermer"
                className="ml-auto rounded-lg p-1 text-ink-faint transition hover:bg-panel2 hover:text-ink"
              >
                <Icon paths={ICON_PATHS.close} className="h-4 w-4" strokeWidth={2.2} />
              </button>
            </header>

            <div>
              <div className="max-h-[60vh] overflow-y-auto px-5 py-3">
                <ul className="divide-y divide-line/60">
                  {BLOCS.map((b) => (
                    <li key={b.id} className="flex items-start gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink">{b.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-soft">
                          {b.desc}
                        </span>
                      </span>
                      <Interrupteur
                        id={b.id}
                        actif={etat[b.id]}
                        label={b.label}
                        onChange={(v) => setEtat((e) => ({ ...e, [b.id]: v }))}
                      />
                    </li>
                  ))}
                </ul>

                <h3 className="mt-5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <Icon paths={ICON_PATHS.lock} className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Non couvert par ce produit
                </h3>
                <ul className="mt-2 divide-y divide-line/60">
                  {catalogue.indisponibles.map((m) => (
                    <li key={m.label} className="flex items-start gap-3 py-3 opacity-60">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-ink-soft">{m.label}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-ink-faint">
                          {m.raison}
                        </span>
                      </span>
                      <span className="mt-0.5 shrink-0 rounded-full border border-line bg-panel2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
                        Indisponible
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <footer className="flex items-center gap-3 border-t border-line px-5 py-3">
                <span className="text-xs text-ink-faint">
                  {actifs} bloc{actifs > 1 ? "s" : ""} sur {BLOCS.length}
                </span>
                <button
                  type="button"
                  onClick={appliquer}
                  disabled={envoi}
                  data-testid="appliquer-reglages"
                  className="btn-accent ml-auto px-4 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {envoi ? "Application…" : "Appliquer"}
                </button>
              </footer>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/** Interrupteur. Une vraie case à cocher masquée porte l'état : le clavier, le
 *  libellé et l'envoi du formulaire fonctionnent alors sans être réécrits. */
function Interrupteur({
  id,
  actif,
  label,
  onChange,
}: {
  id: string;
  actif: boolean;
  label: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="mt-0.5 shrink-0 cursor-pointer" aria-label={label}>
      <input
        type="checkbox"
        name={`bloc:${id}`}
        value="1"
        checked={actif}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={`bascule-${id}`}
        className="peer sr-only"
      />
      {/* Le curseur est déplacé via [&>span] depuis le rail : `peer-checked`
          cible un FRÈRE de la case, et le curseur en est un descendant — la
          variante ne l'atteindrait pas directement. */}
      <span className="block h-5 w-9 rounded-full bg-line transition peer-checked:bg-accent peer-checked:[&>span]:translate-x-[1.125rem] peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-panel">
        <span className="block h-4 w-4 translate-x-0.5 translate-y-0.5 rounded-full bg-white shadow transition" />
      </span>
    </label>
  );
}
