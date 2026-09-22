// Matrice cohorte × semaine de la rétention (F49, plan § 4.3, § 5.17) — rendu
// serveur, une <table> qui est sa propre alternative textuelle.
//
// LA SEULE FIGURE QUI MONTRE LA TAILLE À CÔTÉ DU TAUX. Chaque case écrit « 12 / 28 »
// puis « 43 % » : un 50 % sur 2 visiteurs et un 50 % sur 400 ne se lisent pas pareil,
// et la couleur seule les confondrait.
//
// CE QU'ELLE REFUSE.
//   - Un verdict : aucun seuil de rétention n'est publié (R-S). Le fond est une
//     INTENSITÉ sans verdict, l'échelle `SEQUENTIELLE` (une teinte, cinq paliers) —
//     plus de vert « bon » ni de rgba écrits en dur.
//   - Une semaine inachevée lue comme une semaine : la case de la semaine en cours
//     est hachurée et dite « semaine incomplète ».
//   - Un zéro pour l'avenir : au-delà de la semaine en cours, la case est vide.
// Les chiffres sont posés sur une pastille `bg-panel/90` : lisibles sur le palier le
// plus soutenu, en clair comme en sombre.
import { formater } from "@/lib/fmt-ids";
import { PALIERS_SEQUENTIELLE, SEQUENTIELLE } from "@/lib/palette";

export interface LigneCohorte {
  cohorte: string;
  taille: number;
  cellules: { offset: number; retenus: number; taux: number | null; incomplete: boolean }[];
}

/** Hachures de la semaine en cours : un motif, pas une couleur de plus (§ 3.9). */
const HACHURES = "repeating-linear-gradient(135deg, rgb(var(--c-ink-soft) / 0.35) 0 2px, transparent 2px 6px)";

const nombre = (n: number) => n.toLocaleString("fr-FR");

export function MatriceCohortes({
  lignes,
  colonnes,
  faibleSous = 10,
}: {
  lignes: { cohorte: string; taille: number; cellules: { offset: number; retenus: number; taux: number | null; incomplete: boolean }[] }[];
  colonnes: number;
  /** Défaut 10 : « effectif faible ». */
  faibleSous?: number;
}) {
  const offsets = Array.from({ length: Math.max(0, colonnes) }, (_v, i) => i);
  return (
    <div className="min-w-0" data-testid="matrice-cohortes">
      {/* `relative` : les textes sr-only (position absolue) des cases hors champ se
          rangent DANS la zone défilante ; sans ancêtre positionné, ils se plaçaient
          par rapport à la page et la portaient à 465 px sur 390 (piège 16). */}
      <div className="relative overflow-x-auto">
        <table className="min-w-max border-separate border-spacing-1 text-sm">
          <caption className="sr-only">
            Rétention par cohorte : visiteurs revenus sur taille de la cohorte, et part, pour chaque semaine depuis
            l&apos;arrivée
          </caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 bg-panel px-2 py-1 text-left text-[11px] font-semibold text-ink-soft">
                Cohorte
              </th>
              <th scope="col" className="px-2 py-1 text-right text-[11px] font-semibold text-ink-soft">
                Taille
              </th>
              {offsets.map((o) => (
                <th key={o} scope="col" className="px-1 py-1 text-center text-[11px] font-semibold text-ink-soft">
                  S+{o}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const faible = l.taille < faibleSous;
              return (
                <tr key={l.cohorte} data-testid="cohorte-ligne">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap bg-panel px-2 py-1 text-left font-mono text-xs font-normal text-ink-soft"
                  >
                    {l.cohorte}
                  </th>
                  <td className={`whitespace-nowrap px-2 py-1 text-right text-xs tabular-nums ${faible ? "text-ink-soft" : "text-ink"}`}>
                    {nombre(l.taille)}
                    {faible && <span className="block text-[10px] font-medium text-ink-soft">effectif faible</span>}
                  </td>
                  {offsets.map((o) => {
                    const c = l.cellules.find((x) => x.offset === o);
                    if (!c) {
                      return (
                        <td key={o} className="px-1 py-1">
                          <span className="sr-only">semaine à venir</span>
                        </td>
                      );
                    }
                    const fond = c.taux === null ? "transparent" : SEQUENTIELLE(c.taux);
                    const titre = `${l.cohorte}, S+${o} : ${nombre(c.retenus)} / ${nombre(l.taille)} (${formater("pct", c.taux)})${c.incomplete ? ", semaine incomplète" : ""}`;
                    return (
                      <td
                        key={o}
                        data-testid="cohorte-cellule"
                        data-incomplete={c.incomplete ? "1" : undefined}
                        title={titre}
                        className="h-12 w-16 min-w-[4rem] rounded px-1 py-1 text-center align-middle"
                        style={{ backgroundColor: fond, backgroundImage: c.incomplete ? HACHURES : undefined }}
                      >
                        <span className="inline-flex flex-col items-center rounded bg-panel/90 px-1 leading-tight">
                          <span className="text-[11px] tabular-nums text-ink">
                            {nombre(c.retenus)} / {nombre(l.taille)}
                          </span>
                          <span className="text-xs font-semibold tabular-nums text-ink">{formater("pct", c.taux)}</span>
                          {c.incomplete && (
                            <span className="text-[10px] text-ink-soft">
                              <span className="sr-only">semaine </span>incomplète
                            </span>
                          )}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft" aria-hidden="true">
        <span>Part revenue (intensité, sans verdict) :</span>
        {PALIERS_SEQUENTIELLE.map((couleur, i) => (
          <span key={couleur} className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: couleur }} />
            {i * 20}–{(i + 1) * 20} %
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm border border-line" style={{ backgroundImage: HACHURES }} />
          semaine incomplète
        </span>
      </div>
    </div>
  );
}
