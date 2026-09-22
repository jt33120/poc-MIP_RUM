// Figure — le cadre commun de toute figure d'écran (F03, plan § 4.2, P10 et P11).
// Rendu serveur.
//
// CE QU'UNE FIGURE DIT, TOUJOURS :
//   - ce qu'elle montre : un titre-question (jamais du langage de requête) et, au
//     besoin, une phrase de lecture — « ce que montre / ne montre pas » ;
//   - sur quoi elle porte : la zone `meta` (effectif, plage réellement lue, seau,
//     échantillonnage, troncature, « approché ») — P11 ;
//   - la même chose sans les yeux : une alternative textuelle, tableau construit
//     avec les MÊMES lignes que le dessin, repliée sous la figure — P10 ;
//   - où creuser : « Ouvrir dans l'Explorer » quand la figure s'y exprime (§ 3.4).
//
// UN ÉTAT REMPLACE LE DESSIN. Si `etat` est fourni, les enfants ne sont pas rendus :
// un axe vide à côté d'un « Aucune mesure » se lirait comme une période calme, et
// une lecture en échec ne dessine rien du tout (§ 3.8). L'alternative suit : pas de
// tableau de données quand il n'y a pas de données.
import Link from "next/link";
import type { ReactNode } from "react";
import { GlossaryTip } from "../GlossaryTip";
import { ICON_PATHS, Icon } from "../icons";
import { EtatSurface, type Etat } from "../states/EtatSurface";
import { EchecLecture } from "../states/SectionErreur";
import type { GlossaryId } from "@/lib/glossary";

export interface AlternativeTexte {
  /** <caption> du tableau. */
  legende: string;
  /** En-têtes ; la 1re est le libellé de ligne. */
  colonnes: string[];
  /** Une ligne par élément dessiné ; `null` → « — ». */
  lignes: (string | number | null)[][];
}

/** Ancre stable dérivée du titre, quand l'appelant n'en donne pas. */
function ancreDe(titre: string): string {
  const slug = titre
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return `figure-${slug || "sans-titre"}`;
}

function cellule(v: ReactNode): ReactNode {
  if (v == null || v === false) return "—";
  return typeof v === "number" ? v.toLocaleString("fr-FR") : v;
}

/**
 * Le tableau de l'alternative, replié : il double le dessin sans le remplacer.
 * Exporté pour les composants qui portent leur alternative eux-mêmes (`RankBar`) ;
 * leurs cellules peuvent être du texte déjà mis en forme (`RankDatum.display`).
 */
export function TableAlternative({
  alternative,
}: {
  alternative: { legende: string; colonnes: string[]; lignes: ReactNode[][] };
}) {
  const [premiere, ...autres] = alternative.colonnes;
  return (
    <details className="mt-3 text-xs" data-testid="alternative">
      <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-ink">
        Alternative textuelle
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-max text-left">
          <caption className="caption-top pb-1 text-left text-ink-soft">{alternative.legende}</caption>
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="py-1 pr-3 font-semibold text-ink-soft">
                {premiere}
              </th>
              {autres.map((c) => (
                <th key={c} scope="col" className="py-1 pr-3 text-right font-semibold text-ink-soft">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alternative.lignes.map((ligne, i) => {
              const [tete, ...reste] = ligne;
              return (
                <tr key={i} className="border-b border-line/60 last:border-0">
                  <th scope="row" className="py-1 pr-3 font-normal text-ink">
                    {cellule(tete ?? null)}
                  </th>
                  {reste.map((v, j) => (
                    <td key={j} className="py-1 pr-3 text-right tabular-nums text-ink">
                      {cellule(v)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export function Figure({
  titre,
  aide,
  meta,
  etat,
  alternative,
  lecture,
  explorer,
  id,
  children,
}: {
  /** Question courte ou mesure, jamais du langage de requête. */
  titre: string;
  aide?: GlossaryId;
  /** Effectif, plage, seau, « approché », troncature (P11). */
  meta?: ReactNode;
  /** Si présent, remplace children. */
  etat?: Etat;
  /** Obligatoire quand children dessine des données (P10). */
  alternative?: AlternativeTexte;
  /** Phrase « ce que montre / ne montre pas ». */
  lecture?: ReactNode;
  /** href « Ouvrir dans l'Explorer », calculé côté serveur. */
  explorer?: string;
  /** Ancre, cible des tests e2e. */
  id?: string;
  children?: ReactNode;
}) {
  const ancre = id ?? ancreDe(titre);
  const titreId = `${ancre}-titre`;
  const zone = !etat ? (
    children
  ) : etat.kind === "erreur" ? (
    <EchecLecture titre={etat.titre} digest={etat.digest} />
  ) : (
    <EtatSurface etat={etat} />
  );

  return (
    <section id={ancre} className="card min-w-0 p-4 sm:p-5" data-testid="figure" data-etat={etat?.kind}>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2
          id={titreId}
          className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-soft"
        >
          {/* La bulle OUVRE le titre : posée après un titre long, sa bulle de 288 px
              centrée sur l'icône sortait de l'écran et portait la page à 471 px sur
              une fenêtre de 390 (même cause que le bandeau de santé). En tête, elle
              déborde vers la gauche, ce qui n'élargit pas la page. F09 bornera InfoTip. */}
          {aide && <GlossaryTip id={aide} />}
          <span className="min-w-0 break-words">{titre}</span>
        </h2>
        {explorer && (
          <Link
            href={explorer}
            title="Ouvrir dans l'Explorer"
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-soft transition hover:bg-panel2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            <Icon paths={ICON_PATHS.compass} className="h-4 w-4" />
            <span className="sr-only">Ouvrir dans l&apos;Explorer</span>
          </Link>
        )}
      </div>
      {meta && (
        <div className="mb-3 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-soft" data-testid="figure-meta">
          {meta}
        </div>
      )}
      <div role="figure" aria-labelledby={titreId} className="min-w-0">
        {zone}
      </div>
      {lecture && <p className="mt-3 text-xs leading-relaxed text-ink-soft">{lecture}</p>}
      {alternative && !etat && <TableAlternative alternative={alternative} />}
    </section>
  );
}
