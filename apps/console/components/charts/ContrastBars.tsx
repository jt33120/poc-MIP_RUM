// « Qu'ont en commun les touchés ? » (F05, plan § 4.2) — le pendant des « Outliers »
// de Datadog, en mieux : les deux parts ET les comptes, et un rapport écrit.
// Rendu serveur.
//
// CE QUE LA FIGURE COMPARE. Pour chaque valeur d'une dimension (« Chrome Mobile »),
// sa part parmi les TOUCHÉS (sessions avec l'erreur, mesures LCP « Mauvais ») et sa
// part dans la BASE (toutes les sessions de la fenêtre). Une valeur deux fois plus
// présente chez les touchés que dans la base est un indice, pas une cause : le
// rapport est écrit (« × 2,4 »), les effectifs aussi, et une valeur trop peu
// touchée (moins de 10) n'est pas classée — un rapport sur 3 cas ne dit rien.
//
// SANS DÉNOMINATEUR, PAS DE FIGURE. Les parts de la base exigent, par valeur, le
// compte de la population de base, que les lectures ne rendent pas encore
// (backend B3). Tant qu'il manque, le composant dit « non disponible » avec la
// raison — jamais des barres à zéro (§ 0.5).
import Link from "next/link";
import { TableAlternative } from "./Figure";
import { formater } from "@/lib/fmt-ids";
import { SERIE } from "@/lib/palette";

export interface LigneContraste {
  /** « Chrome Mobile », « Inconnu ». */
  valeur: string;
  nTouches: number;
  nBase: number;
  /** nTouches / totalTouches. */
  partTouches: number | null;
  /** nBase / totalBase. */
  partBase: number | null;
  href: string;
  /** P*.6 : test de sur-représentation (jamais pour « Inconnu »). */
  test?: { pAjuste: number; retenu: boolean };
}

/** Sous ce nombre de touchés, une valeur n'est pas classée par son rapport. */
export const TOUCHES_MIN = 10;

const INCONNU = "Inconnu";

/** Rapport des parts (touchés / base) ; sans part de base non nulle, pas de rapport. */
export function rapport(l: Pick<LigneContraste, "partTouches" | "partBase">): number | null {
  return l.partTouches != null && l.partBase != null && l.partBase > 0 ? l.partTouches / l.partBase : null;
}

/**
 * Ordre d'affichage : rapport décroissant pour les valeurs d'au moins `TOUCHES_MIN`
 * touchés dont le rapport se calcule ; puis les autres (et « Inconnu », jamais
 * candidat), dans l'ordre reçu. Aucune ligne ajoutée ni retirée.
 */
export function ordonnerContraste<T extends LigneContraste>(lignes: readonly T[]): T[] {
  const classable = (l: T) => l.valeur !== INCONNU && l.nTouches >= TOUCHES_MIN && rapport(l) != null;
  const classees = lignes.filter(classable).sort((a, b) => (rapport(b) ?? 0) - (rapport(a) ?? 0));
  return [...classees, ...lignes.filter((l) => !classable(l))];
}

const texteRapport = (r: number | null) =>
  r == null ? "pas de rapport" : `× ${r.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;

export function ContrastBars({
  dimensionLibelle,
  populationTouchee,
  populationBase,
  lignes,
  testees,
  regle,
  indisponible,
  alternative = true,
}: {
  dimensionLibelle: string;
  /** « sessions avec cette erreur », « mesures LCP Mauvais ». */
  populationTouchee: string;
  /** « toutes les sessions de la fenêtre ». */
  populationBase: string;
  lignes: LigneContraste[];
  /** P*.6 : nombre de valeurs testées (toutes dimensions de l'écran). */
  testees?: number;
  /** P*.6 : « test exact de Fisher unilatéral, Benjamini-Hochberg 5 % ». */
  regle?: string;
  /** Raison tant que B3 n'est pas livré : remplace la figure. */
  indisponible?: string;
  /** false : l'alternative est portée par la `Figure` englobante. */
  alternative?: boolean;
}) {
  if (indisponible) {
    return (
      <div
        role="note"
        data-testid="contrast-bars"
        data-etat="indisponible"
        className="rounded-lg border border-dashed border-line bg-panel2/40 px-3 py-3 text-sm text-ink-soft"
      >
        <p className="font-medium text-ink">
          {dimensionLibelle} : {populationTouchee} face à {populationBase}
        </p>
        <p className="mt-1">Non disponible, raison : {indisponible}</p>
      </div>
    );
  }

  const ordre = ordonnerContraste(lignes);
  if (ordre.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-soft" data-testid="contrast-bars" data-etat="vide">
        Aucune valeur de {dimensionLibelle.toLowerCase()} parmi les {populationTouchee}.
      </p>
    );
  }
  const pct = (v: number | null) => formater("pct", v);
  const largeur = (v: number | null) => `${v == null ? 0 : Math.max(1, Math.min(v, 1) * 100)}%`;

  return (
    <div className="min-w-0" data-testid="contrast-bars">
      <ul className="flex flex-col gap-2">
        {ordre.map((l) => {
          const r = rapport(l);
          const nonClassee = l.valeur === INCONNU || l.nTouches < TOUCHES_MIN || r == null;
          return (
            <li key={l.valeur} data-testid="contraste-ligne">
              <Link
                href={l.href}
                aria-label={`${dimensionLibelle} ${l.valeur} : ${pct(l.partTouches)} des ${populationTouchee} (${l.nTouches.toLocaleString(
                  "fr-FR",
                )}), ${pct(l.partBase)} de la base (${l.nBase.toLocaleString("fr-FR")}), ${texteRapport(r)} — filtrer`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 transition hover:bg-panel2/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              >
                <span className="min-w-0 basis-full truncate text-xs font-medium text-ink sm:basis-40" title={l.valeur}>
                  {l.valeur}
                </span>
                <span className="flex min-w-24 flex-1 flex-col gap-0.5" aria-hidden="true">
                  <span className="relative h-2.5 overflow-hidden rounded bg-panel2">
                    <span className="absolute inset-y-0 left-0 rounded" style={{ width: largeur(l.partTouches), backgroundColor: SERIE.principale }} />
                  </span>
                  <span className="relative h-2.5 overflow-hidden rounded bg-panel2">
                    <span className="absolute inset-y-0 left-0 rounded" style={{ width: largeur(l.partBase), backgroundColor: SERIE.reference }} />
                  </span>
                </span>
                <span className="flex basis-full flex-wrap items-center gap-x-3 text-xs tabular-nums text-ink-soft sm:basis-auto sm:shrink-0">
                  <span>
                    touchés <span className="text-ink">{pct(l.partTouches)}</span> ({l.nTouches.toLocaleString("fr-FR")})
                  </span>
                  <span>
                    base <span className="text-ink">{pct(l.partBase)}</span> ({l.nBase.toLocaleString("fr-FR")})
                  </span>
                  <span className="font-semibold text-ink" data-testid="contraste-rapport">
                    {texteRapport(r)}
                  </span>
                  {nonClassee && (
                    <span className="text-[10px]">
                      {l.valeur === INCONNU ? "non testé" : `non classé (moins de ${TOUCHES_MIN} touchés)`}
                    </span>
                  )}
                  {l.test && l.valeur !== INCONNU && (
                    <span className="text-[10px]">
                      {l.test.retenu ? "sur-représentée" : "non retenue"} (p ajusté{" "}
                      {l.test.pAjuste.toLocaleString("fr-FR", { maximumSignificantDigits: 2 })})
                    </span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
        Barre orange : part parmi les {populationTouchee} ; barre grise : part parmi {populationBase} ; « × » : rapport
        des deux parts. Classées par rapport à partir de {TOUCHES_MIN} touchés ; un rapport est un indice, pas une cause.
        {regle ? ` Test : ${regle}` : ""}
        {testees != null ? ` — ${testees.toLocaleString("fr-FR")} valeurs testées.` : ""}
      </p>
      {alternative && (
        <TableAlternative
          alternative={{
            legende: `${dimensionLibelle} : ${populationTouchee} face à ${populationBase}`,
            colonnes: ["Valeur", "Touchés", "Part des touchés", "Base", "Part de la base", "Rapport", ...(regle ? ["Test"] : [])],
            lignes: ordre.map((l) => [
              l.valeur,
              l.nTouches,
              pct(l.partTouches),
              l.nBase,
              pct(l.partBase),
              texteRapport(rapport(l)),
              ...(regle ? [l.valeur === INCONNU || !l.test ? "non testé" : l.test.retenu ? "retenue" : "non retenue"] : []),
            ]),
          }}
        />
      )}
    </div>
  );
}
