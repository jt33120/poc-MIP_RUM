// Matrice de concordance robot × réel (F56, plan § 4.3 et § 5.7 CR8) — rendu serveur.
//
// POURQUOI UNE TABLE. Deux axes CATÉGORIELS (état du robot, verdict du LCP réel) :
// ce n'est pas une densité 2D, une heatmap y serait un contresens. Une `<table>` à
// `<th scope>` se lit au lecteur d'écran telle quelle — elle est sa propre
// alternative textuelle, aucun `role="img"` ne vient la masquer.
//
// LA COULEUR DIT UNE QUANTITÉ, SAUF LÀ OÙ ELLE DIT UN SENS. Le fond de chaque
// cellule suit l'échelle `SEQUENTIELLE` (une teinte, proportionnelle au compte) : il
// n'y a pas de verdict sur un compte. Seules les cellules `nommees` (« angle mort »,
// « alerte robot non ressentie ») portent une teinte de sens, en contour, et leur nom
// ÉCRIT dans la cellule (P15) : rien ne tient à la seule couleur.
//
// UN ZÉRO EST UN ZÉRO. Une cellule sans heure écrit « 0 » (vide réel, V3) ; ce qui
// n'entre pas dans la matrice (robot seul, réel seul, réel insuffisant, état robot
// inconnu) est compté À CÔTÉ, jamais versé dans une case.
import Link from "next/link";
import { SEQUENTIELLE } from "@/lib/palette";

export interface MatriceConcordanceProps {
  /** États robot : ok, warn, incident. */
  lignes: { cle: string; libelle: string }[];
  /** Verdicts réels : Bon, À améliorer, Mauvais. */
  colonnes: { cle: string; libelle: string }[];
  /** [ligne][colonne] = heures × route. */
  cellules: Record<string, Record<string, number>>;
  nommees: { ligne: string; colonne: string; nom: string; href?: string; ton: "bad" | "warn" | "neutre" }[];
  /** Robot seul, réel seul, réel insuffisant, état inconnu. */
  horsMatrice: { libelle: string; n: number }[];
  /** « heures × route ». */
  unite: string;
}

const CONTOUR: Record<"bad" | "warn" | "neutre", string> = {
  bad: "ring-2 ring-inset ring-bad",
  warn: "ring-2 ring-inset ring-warn",
  neutre: "ring-2 ring-inset ring-ink-soft",
};

const NOM: Record<"bad" | "warn" | "neutre", string> = {
  bad: "text-bad-ink",
  warn: "text-warn-ink",
  neutre: "text-ink",
};

/** Le compte d'une cellule ; une cellule absente de la lecture vaut 0 (c'est un compte). */
export function compteCellule(cellules: MatriceConcordanceProps["cellules"], ligne: string, colonne: string): number {
  const v = cellules[ligne]?.[colonne];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function MatriceConcordance({ lignes, colonnes, cellules, nommees, horsMatrice, unite }: MatriceConcordanceProps) {
  const max = Math.max(0, ...lignes.flatMap((l) => colonnes.map((c) => compteCellule(cellules, l.cle, c.cle))));
  const nommee = (l: string, c: string) => nommees.find((n) => n.ligne === l && n.colonne === c);
  const nombre = (n: number) => n.toLocaleString("fr-FR");

  return (
    <div className="min-w-0" data-testid="matrice-concordance">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[18rem] border-separate border-spacing-1 text-sm">
          <caption className="caption-top pb-2 text-left text-xs text-ink-soft">
            Nombre de {unite} par couple d&apos;états : état du robot en ligne, verdict du réel en colonne. Sur la
            diagonale, les deux s&apos;accordent.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="px-2 py-1 text-left text-[11px] font-semibold text-ink-soft">
                <span className="sr-only">État du robot / verdict du réel</span>
                <span aria-hidden="true">Robot ↓ · Réel →</span>
              </th>
              {colonnes.map((c) => (
                <th key={c.cle} scope="col" className="px-2 py-1 text-center text-[11px] font-semibold text-ink-soft">
                  {c.libelle}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.cle}>
                <th scope="row" className="px-2 py-1 text-left text-xs font-semibold text-ink">
                  {l.libelle}
                </th>
                {colonnes.map((c) => {
                  const n = compteCellule(cellules, l.cle, c.cle);
                  const nom = nommee(l.cle, c.cle);
                  const fond = n > 0 && max > 0 ? SEQUENTIELLE(n / max) : undefined;
                  const titre = `${nombre(n)} ${unite} : robot « ${l.libelle} », réel « ${c.libelle} »${nom ? ` — ${nom.nom}` : ""}`;
                  const contenu = (
                    <>
                      {/* Le chiffre sur une pastille : lisible sur tous les paliers, clair ou sombre. */}
                      <span className="rounded bg-panel/90 px-1 font-semibold tabular-nums text-ink" data-testid="concordance-compte">
                        {nombre(n)}
                      </span>
                      {nom && (
                        <span className={`mt-0.5 block rounded bg-panel/90 px-1 text-[10px] font-medium leading-tight ${NOM[nom.ton]}`}>
                          {nom.nom}
                        </span>
                      )}
                    </>
                  );
                  return (
                    <td
                      key={c.cle}
                      title={titre}
                      data-ligne={l.cle}
                      data-colonne={c.cle}
                      data-nommee={nom ? nom.ton : undefined}
                      className={`h-14 min-w-[4.5rem] rounded-md border border-line px-1 py-1 text-center align-middle ${nom ? CONTOUR[nom.ton] : ""} ${fond ? "" : "bg-panel2/60"}`}
                      style={fond ? { backgroundColor: fond } : undefined}
                    >
                      {nom?.href ? (
                        <Link
                          href={nom.href}
                          className="block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                          aria-label={titre}
                        >
                          {contenu}
                        </Link>
                      ) : (
                        contenu
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {horsMatrice.length > 0 && (
        <dl className="mt-3 grid min-w-0 gap-x-4 gap-y-1 text-xs sm:grid-cols-2" data-testid="concordance-hors-matrice">
          {horsMatrice.map((h) => (
            <div key={h.libelle} className="flex min-w-0 items-baseline justify-between gap-2 border-b border-line/60 py-0.5">
              <dt className="min-w-0 text-ink-soft">{h.libelle}</dt>
              <dd className="shrink-0 font-semibold tabular-nums text-ink">{nombre(h.n)}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
        Fond : intensité proportionnelle au compte (plus foncé = compte plus élevé), sans verdict. Seules les cases
        nommées portent un contour de couleur.
      </p>
    </div>
  );
}
