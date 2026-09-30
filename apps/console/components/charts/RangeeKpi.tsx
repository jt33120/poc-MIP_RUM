// RangeeKpi — une rangée de tuiles qui dit UNE FOIS, au-dessus d'elle, pourquoi ses
// écarts ne sont pas affichés. Rendu serveur.
//
// POURQUOI (recette du 26/09/2026). Quand la période précédente est incomplète
// (collecte commencée pendant la plage de comparaison, rétention…), chaque tuile
// écrivait la même phrase : « période précédente incomplète : erreurs collectées
// depuis le 26/09 12:02 UTC seulement », quatre fois de suite, jusqu'à 18 lignes
// par tuile à 390 px. La raison est désormais dite dans un seul bandeau, et la
// phrase de chaque tuile (`data-motif="periode-incomplete"`, posé par `KpiTile`)
// est masquée dans la rangée. Les autres silences d'une tuile (échantillon faible,
// référence nulle) lui sont propres : ils restent sous son chiffre.
//
// La tuile garde sa phrase dans son HTML (et dans le nom annoncé d'une tuile-lien) :
// seul l'affichage change, rien de ce qu'elle refuse d'affirmer.
import type { ReactNode } from "react";
import type { CouverturePrecedente } from "@/lib/comparaison";

/** Classe qui masque, dans la rangée, la phrase de silence que le bandeau porte déjà. */
export const MASQUE_SILENCE_REPETE = "[&_[data-motif=periode-incomplete]]:hidden";

/**
 * Les raisons DISTINCTES des couvertures incomplètes d'une rangée, dans l'ordre.
 * Logique pure, exportée pour les tests. `undefined`/`null` : tuile sans
 * comparaison, ignorée.
 */
export function raisonsIncompletes(couvertures: readonly (CouverturePrecedente | null | undefined)[]): string[] {
  const raisons: string[] = [];
  for (const c of couvertures) {
    if (!c || c.etat === "complete") continue;
    const r = c.raison ?? "raison non lue";
    if (!raisons.includes(r)) raisons.push(r);
  }
  return raisons;
}

/** Le bandeau seul, pour une rangée que l'appelant compose lui-même. */
export function BandeauComparaison({
  couvertures,
}: {
  couvertures: readonly (CouverturePrecedente | null | undefined)[];
}) {
  const raisons = raisonsIncompletes(couvertures);
  if (raisons.length === 0) return null;
  const phrase = `période précédente incomplète : ${raisons.join(" ; ")}.`;
  // Recette du 30/09/2026 : une pastille, pas une phrase au-dessus de la rangée ; la
  // raison au survol et pour les lecteurs d'écran.
  return (
    <p
      role="note"
      data-testid="bandeau-comparaison"
      title={phrase}
      className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-panel2 px-2.5 py-0.5 text-[11px] text-ink-soft"
    >
      <span aria-hidden className="text-ink-faint">
        ⊘
      </span>
      <span className="font-medium text-ink">Écarts non affichés</span>
      <span className="sr-only"> — {phrase}</span>
    </p>
  );
}

export function RangeeKpi({
  couvertures,
  className,
  testId,
  children,
}: {
  /** Couvertures de la période précédente des tuiles de la rangée (celles qui en ont une). */
  couvertures: readonly (CouverturePrecedente | null | undefined)[];
  /** Classes de la grille (« grid grid-cols-2 gap-3 lg:grid-cols-4 »). */
  className: string;
  testId?: string;
  children: ReactNode;
}) {
  const avecBandeau = raisonsIncompletes(couvertures).length > 0;
  return (
    <>
      <BandeauComparaison couvertures={couvertures} />
      <div className={`${className} ${avecBandeau ? MASQUE_SILENCE_REPETE : ""}`} data-testid={testId}>
        {children}
      </div>
    </>
  );
}
