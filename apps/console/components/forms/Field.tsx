// Primitives de formulaire partagées par les pages de configuration (alerts, slo,
// dashboards). Évite la redéfinition à l'identique de Field/INPUT_CLASS page par page.
import type { ReactNode } from "react";

/** Classe des champs de saisie compacts (input/select) — s'appuie sur la classe globale `field`. */
export const INPUT_CLASS = "field py-1";

/** Label vertical + contrôle, style uniforme des formulaires de la console. */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // `min-w-0 max-w-full` : un `select` aux options longues (« Part des mesures LCP
    // notées Bon ») ne porte plus la page au-delà de 390 px ; il prend la largeur offerte.
    <label className="flex min-w-0 max-w-full flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      {children}
    </label>
  );
}
