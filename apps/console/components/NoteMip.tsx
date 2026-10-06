// Une valeur notée par une RÈGLE MIP (vague 4, amendement de R-S du 29/09/2026).
//
// POURQUOI UN COMPOSANT. L'amendement de R-S (plan de la refonte du frontend, hors dépôt,
// § 1.5) autorise vert / ambre / rouge sur une mesure sans seuil publié à trois
// conditions, qu'aucun écran ne doit pouvoir oublier une à une :
//   1. la note vient de `noteMip` (`lib/seuils.ts`), jamais d'une borne recopiée ;
//   2. la couleur est doublée d'une forme (● ▲ ■, `FORME_RATING`), comme les vitals ;
//   3. la règle est ÉCRITE à côté de la valeur (« règle MIP : DNS > … », la borne « mauvais » lue dans `SEUILS_MIP`).
// Réunies ici, elles voyagent ensemble. Une mesure sans règle MIP (formulaire, nom
// inconnu) ou sans valeur rend un texte neutre : jamais « bon » par défaut.
//
// Composant de présentation pur (aucun hook) : utilisable côté serveur et client.
import { FORME_RATING, RATING_CLASS, RATING_LABEL } from "@/lib/rating";
import { noteMip, texteRegleMip } from "@/lib/seuils";

/** La règle écrite, seule : pour un en-tête de colonne ou une légende qui vaut pour plusieurs valeurs. */
export function RegleMip({ mesure, className = "" }: { mesure: string; className?: string }) {
  const texte = texteRegleMip(mesure);
  if (!texte) return null;
  return (
    <span data-regle-mip={mesure} className={`min-w-0 text-[11px] font-normal text-ink-faint [overflow-wrap:anywhere] ${className}`}>
      {texte}
    </span>
  );
}

/**
 * La valeur, notée : pastille colorée + forme + libellé de note pour les lecteurs
 * d'écran, et la règle écrite à côté (sauf `regle={false}`, quand l'écran l'écrit
 * une fois pour toute une colonne avec `RegleMip`).
 */
export function ValeurNoteeMip({
  mesure,
  valeur,
  texte,
  regle = true,
  className = "",
}: {
  /** Clé de `SEUILS_MIP` (« DNS », « RESOURCE », « API »…). */
  mesure: string;
  valeur: number | null | undefined;
  /** La valeur déjà formatée (« 212 ms », « 4,2 % »). */
  texte: string;
  regle?: boolean;
  className?: string;
}) {
  const note = noteMip(mesure, valeur);
  if (!note) {
    return (
      <span data-note="" data-mesure={mesure} className={`tabular-nums ${className}`}>
        {texte}
      </span>
    );
  }
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-baseline gap-x-1.5 ${className}`}>
      {/* `relative` : le libellé `sr-only` (position absolue) se place dans la pastille.
          Sans ancêtre positionné, il se plaçait par rapport à la PAGE et, dans un tableau
          défilant (`ResourcesView`), l'élargissait à 499 px sur 390 (piège 16). */}
      <span
        data-note={note}
        data-mesure={mesure}
        className={`relative rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums ${RATING_CLASS[note]}`}
      >
        <span aria-hidden="true" className="mr-1">
          {FORME_RATING[note]}
        </span>
        {texte}
        <span className="sr-only"> — {RATING_LABEL[note]}</span>
      </span>
      {regle && <RegleMip mesure={mesure} />}
    </span>
  );
}
