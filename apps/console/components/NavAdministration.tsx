"use client";
// Le bloc Administration de la sidebar et du tiroir mobile (admin seulement).
//
// Client parce qu'il lit le chemin : rendu en dur dans le layout, il n'allumait
// jamais l'écran courant — ni état actif, ni `aria-current` — alors que la
// navigation principale le fait (recette du 26/09/2026, écrans 14 à 17). Même
// allure que `Nav` : fond teinté et barre d'accent à gauche sur l'entrée active.
//
// REPLIABLE (recette du 30/09/2026 : « possibilité de toggle toutes les pages en
// dessous de ADMINISTRATION »). Onze entrées dépliées poussaient le compte et la
// déconnexion sous l'écran. Un bouton-disclosure (`aria-expanded`,
// `aria-controls`) les replie ; le choix est mémorisé dans ce navigateur, et le
// bloc s'ouvre d'office sur une page /admin — l'entrée courante doit rester
// visible.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useState } from "react";
import { NAV_BARRE_ACTIVE, NAV_ELEMENT } from "./Nav";
import { ADMINISTRATION, estAdministration, lienAdministrationActif } from "./nav-items";
import { ICON_PATHS, Icon } from "./icons";

/** Clé du choix mémorisé, commune à la barre latérale et au tiroir mobile. */
export const CLE_ADMINISTRATION = "mip-nav-administration";
/** Événement qui accorde les deux blocs d'une même page (barre latérale et tiroir). */
const EVENEMENT = "mip-nav-administration";

/** Le choix mémorisé : `null` quand il n'y en a pas, ou que le stockage est fermé. */
export function lireChoixAdministration(): boolean | null {
  try {
    const v = window.localStorage.getItem(CLE_ADMINISTRATION);
    return v === "ouvert" ? true : v === "replie" ? false : null;
  } catch {
    // Navigation privée, stockage bloqué : le bloc garde son état par défaut.
    return null;
  }
}

function ecrireChoix(ouvert: boolean) {
  try {
    window.localStorage.setItem(CLE_ADMINISTRATION, ouvert ? "ouvert" : "replie");
  } catch {
    // Sans stockage, le choix vaut pour la page affichée seulement.
  }
}

/**
 * État initial : ouvert sur une page /admin, sinon le choix mémorisé, sinon replié.
 * Replié par défaut : c'est l'allongement du bloc qui cachait la déconnexion.
 */
export function administrationOuverte(surAdmin: boolean, choix: boolean | null): boolean {
  return surAdmin || (choix ?? false);
}

export function NavAdministration() {
  const pathname = usePathname() ?? "";
  const actif = lienAdministrationActif(pathname);
  const surAdmin = estAdministration(pathname);
  const id = useId();
  // Le rendu serveur ne connaît pas le stockage du navigateur : il part de la page
  // (ouvert sur /admin, replié ailleurs), le choix mémorisé est lu au montage.
  const [ouvert, setOuvert] = useState(surAdmin);

  useEffect(() => {
    setOuvert(administrationOuverte(surAdmin, lireChoixAdministration()));
  }, [surAdmin]);

  useEffect(() => {
    const accorder = (e: Event) => setOuvert(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(EVENEMENT, accorder);
    return () => window.removeEventListener(EVENEMENT, accorder);
  }, []);

  const basculer = useCallback(() => {
    const suivant = !ouvert;
    ecrireChoix(suivant);
    // Tout bloc monté (barre latérale ET tiroir) suit, celui-ci compris.
    window.dispatchEvent(new CustomEvent<boolean>(EVENEMENT, { detail: suivant }));
  }, [ouvert]);

  return (
    <div data-testid="nav-administration">
      <button
        type="button"
        aria-expanded={ouvert}
        aria-controls={id}
        onClick={basculer}
        data-testid="nav-administration-bascule"
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint transition hover:bg-panel2 hover:text-ink-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-perf"
      >
        <span className="flex-1 text-left">Administration</span>
        {/* Replié sur une page d'administration : l'entrée courante reste nommée. */}
        {!ouvert && actif && <span className="sr-only">, page courante : {actif.label}</span>}
        {/* Replié, le nombre d'entrées cachées ; déplié, elles se comptent à l'œil. */}
        {!ouvert && (
          <span className="tabular-nums tracking-normal" aria-hidden>
            {ADMINISTRATION.length}
          </span>
        )}
        <Icon
          paths={ICON_PATHS.chevronRight}
          className={`h-3.5 w-3.5 shrink-0 transition-transform ${ouvert ? "rotate-90" : ""}`}
        />
      </button>
      {/* `hidden` ET la classe : `flex`, utilitaire de même spécificité que la règle
          `[hidden]` de la feuille de base mais écrit après elle, la ferait perdre. */}
      <nav
        id={id}
        aria-label="Administration"
        hidden={!ouvert}
        className={ouvert ? "mt-0.5 flex flex-col gap-0.5" : "hidden"}
      >
        {ADMINISTRATION.map((it) => {
          const estActif = it === actif;
          return (
            <Link
              key={it.href}
              href={it.href}
              aria-current={estActif ? "page" : undefined}
              className={`${NAV_ELEMENT} ${estActif ? "bg-perf/10 text-ink" : "text-ink-soft hover:bg-panel2 hover:text-ink"}`}
            >
              <span aria-hidden className={`${NAV_BARRE_ACTIVE} ${estActif ? "opacity-100" : "opacity-0"}`} />
              <Icon
                paths={ICON_PATHS[it.icon]}
                className={`h-4 w-4 shrink-0 ${estActif ? "text-perf" : "text-ink-faint group-hover:text-ink-soft"}`}
              />
              <span className="truncate">{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
