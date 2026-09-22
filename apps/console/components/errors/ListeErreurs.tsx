// Présentation PARTAGÉE des deux listes de l'écran Erreurs (F19, plan § 5.3.1-5.3.2) :
// la liste historique (`app/errors/page.tsx`) et la liste des issues (`IssueList`).
// Rendu serveur, aucune lecture ici.
//
// TROIS RÈGLES, communes aux deux listes.
//   1. ÉCHELLE COMMUNE. Les sparklines d'une liste partagent le même haut d'échelle
//      (`echelleCommune`) : deux lignes à la même valeur ont la même hauteur, et la
//      plus haute se voit. Une échelle par ligne ferait d'un groupe à 2 occurrences
//      le jumeau visuel d'un groupe à 500. Le maximum est DIT (`noteEchelle`), à
//      toutes les largeurs — l'aria de `Sparkline` le répète pour qui n'y voit pas.
//   2. CARTES SOUS 640 px. Sous `sm`, la table devient une pile de cartes (le même
//      balisage, en `block`) : occurrences et sessions restent lisibles sans
//      défilement horizontal à 390 px (critère du § 5.3.2). Chaque cellule porte
//      alors son libellé, sinon un nombre seul ne dit plus ce qu'il compte.
//   3. FILTRE DE STATUT. Un formulaire GET, jamais un filtre implicite : ce qui est
//      filtré est écrit dans l'URL, dans la légende de la table et dans le titre.
import Link from "next/link";
import type { ReactNode } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";
import { STATUTS_ERREUR, type StatutErreur } from "@/lib/view-state";

/** Une cellule de table au-dessus de 640 px, une ligne de carte en dessous. */
export const CELLULE_GROUPE = "sm:table-cell sm:px-4 sm:py-3 sm:align-top";

/** Cellule à libellé : le libellé n'apparaît qu'en carte, où l'en-tête a disparu. */
export function CelluleGroupe({
  libelle,
  children,
  className = "",
  testId,
}: {
  libelle: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <td className={`mt-1 flex min-w-0 items-baseline gap-2 text-xs ${CELLULE_GROUPE} ${className}`} data-testid={testId}>
      <span className="shrink-0 text-ink-soft sm:hidden">{libelle}</span>
      {children}
    </td>
  );
}

/**
 * Haut d'échelle partagé par les sparklines d'une liste : la plus grande valeur de
 * seau, toutes lignes confondues. `undefined` (pas 0) quand aucune ligne n'a de
 * série ou que toutes sont à zéro — il n'y a alors rien à comparer, et `Sparkline`
 * n'annonce pas une échelle commune qui ne dirait rien.
 */
export function echelleCommune(lignes: { series?: number[] }[]): number | undefined {
  let max = 0;
  for (const ligne of lignes) {
    for (const valeur of ligne.series ?? []) {
      if (Number.isFinite(valeur) && valeur > max) max = valeur;
    }
  }
  return max > 0 ? max : undefined;
}

/**
 * La phrase qui DIT l'échelle, sous la liste comme en carte. Sans maximum, elle dit
 * pourquoi il n'y en a pas : une sparkline plate sur une liste vide n'est pas une
 * tendance nulle.
 */
export function noteEchelle(max: number | undefined, parSeau: string | null = null): string {
  const seau = parSeau ? ` par seau de ${parSeau}` : "";
  return max === undefined
    ? "Tendances à l'échelle commune : aucune occurrence sur la période, aucune hauteur à comparer."
    : `Tendances à l'échelle commune, de 0 à ${max.toLocaleString("fr-FR")} occurrence(s)${seau} : deux lignes à la même valeur ont la même hauteur.`;
}

/** Libellés des statuts de triage de la liste historique (badges de `ErrorBadges`). */
export const STATUT_LABELS: Record<StatutErreur, string> = {
  open: "Ouverts",
  regressed: "Régressés",
  resolved: "Résolus",
  ignored: "Ignorés",
};

/**
 * Filtre de statut de la liste historique (§ 5.3.2, « aucun filtre ignoré en
 * silence »). Formulaire GET : l'état filtré est dans l'URL, donc partageable, et
 * la page repart du premier groupe (aucun `offset` caché).
 *
 * `caches` porte les filtres de population et les réglages d'affichage à conserver
 * (l'app en tête) : sans eux, filtrer par statut rendrait aussi le périmètre au
 * cookie de projet.
 */
export function FiltreStatut({
  caches,
  statut,
  hrefSansFiltre,
}: {
  caches: [string, string][];
  statut: StatutErreur | null;
  hrefSansFiltre: string;
}) {
  return (
    <form
      method="get"
      action="/errors"
      className="card mb-3 flex flex-wrap items-end gap-3 p-3"
      aria-label="Filtre de statut des groupes"
      data-testid="filtre-statut"
    >
      {caches.map(([nom, valeur]) => (
        <input key={nom} type="hidden" name={nom} value={valeur} />
      ))}
      <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
        Statut de triage
        {/* Aucun `aria-label` : le libellé visible de ce `label` nomme déjà le champ,
            et un aria-label le remplacerait au lieu de le confirmer. */}
        <select name="statut" defaultValue={statut ?? ""} className={INPUT_CLASS}>
          <option value="">Tous les statuts</option>
          {STATUTS_ERREUR.map((valeur) => (
            <option key={valeur} value={valeur}>
              {STATUT_LABELS[valeur]}
            </option>
          ))}
        </select>
      </label>
      <button className="btn-accent" type="submit">
        Filtrer
      </button>
      {statut && (
        <Link href={hrefSansFiltre} className="btn-ghost">
          Tous les statuts
        </Link>
      )}
    </form>
  );
}
