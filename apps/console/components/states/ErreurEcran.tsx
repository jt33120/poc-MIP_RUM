"use client";
// État « erreur » d'un ÉCRAN entier : le corps commun des `error.tsx` de route
// (F02, § 3.8 règle 3). Il prend le relais quand l'écran n'a pas pu être rendu
// du tout — typiquement, la base ne répond plus et même les filtres de la page
// n'ont pas pu être vérifiés. Les sections, elles, ont leur propre frontière
// (`SectionErreur`) : ceci est le dernier filet, pas le premier.
//
// Aucun chiffre partiel n'est affiché : un compteur à moitié calculé contredirait
// ceux de l'écran précédent. Le message d'exception n'est jamais montré (il peut
// nommer un hôte ou une table) ; seul le `digest` de Next l'est, qui relie cet
// écran à la ligne correspondante des journaux serveur.
import type { ReactNode } from "react";
import { CadreEtat } from "./EtatSurface";
import { Reessayer } from "./SectionErreur";

const NBSP = "\u00a0";

export function ErreurEcran({
  titre,
  error,
  reset,
  detail,
}: {
  /** Nom de l'écran, tel que la navigation le nomme. */
  titre: string;
  error: Error & { digest?: string };
  reset: () => void;
  /** Ce que l'échec ne touche PAS, quand l'écran a quelque chose de précis à en dire. */
  detail?: ReactNode;
}) {
  return (
    <section className="animate-fade-up" data-testid="erreur-ecran">
      <h1 className="mb-4 text-xl font-bold tracking-tight text-ink">{titre}</h1>
      <CadreEtat ton="erreur" role="alert" etat="erreur" className="max-w-2xl">
        <p>
          <strong className="font-semibold text-bad-ink">Lecture en échec.</strong> La lecture de l&apos;écran «{NBSP}
          {titre}
          {NBSP}» a échoué{NBSP}; aucun chiffre partiel n&apos;est affiché.
        </p>
        {detail && <p className="mt-1 text-ink-soft">{detail}</p>}
        {error.digest && (
          <p className="mt-1 font-mono text-[11px] text-ink-soft">
            Référence{NBSP}: {error.digest}
          </p>
        )}
        <div className="mt-3">
          {/* Une erreur SERVEUR ne se répare pas en re-rendant le client : `Reessayer`
              relance les lectures, puis rouvre la frontière (`reset`). */}
          <Reessayer onReset={reset} />
        </div>
      </CadreEtat>
    </section>
  );
}
