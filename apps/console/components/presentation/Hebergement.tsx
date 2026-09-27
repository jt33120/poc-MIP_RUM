// « Où sont les données, et sous quel droit » — LA source de l'hébergement sur les
// pages publiques (recette du 26/09/2026). Il s'écrivait à sept endroits de l'ancienne
// vitrine (en-tête, chemin de la mesure, cette table, positionnement, une carte, les
// spécifications, le pied de page) ; il n'est plus écrit qu'ici, et les autres
// endroits y renvoient (`#hebergement`).
//
// Société, région et lieu sont LUS dans lib/legal.ts (lib/presentation-topologie.ts),
// comme la politique de confidentialité : jamais retapés.
//
// La phrase sous la table est la seule sur la souveraineté que le test de lexique
// admet (couverture-site, n° 5). Elle parle des MESURES : aucune adresse IP de
// visiteur n'y est conservée (le pays est estimé). Elle ne dit plus « sous aucune
// forme » : la connexion à la console, elle, garde l'adresse d'un compte bloqué pour
// trop d'échecs dans son journal d'audit — un compte de la console n'est pas un
// visiteur mesuré, mais la promesse ne doit pas couvrir plus qu'elle ne tient.
//
// À 390 px, la table défile dans son cadre et le signale (TableDefilante).
import { TableDefilante } from "@/components/TableDefilante";
import { HEBERGEMENT } from "@/lib/presentation-topologie";

const CELLULE = "px-3 py-2.5 align-top sm:px-4";

export function Hebergement() {
  return (
    <section id="hebergement" aria-labelledby="hebergement-titre" className="border-t border-line">
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:py-16">
        <h2
          id="hebergement-titre"
          tabIndex={-1}
          className="scroll-mt-6 rounded-md text-2xl font-bold tracking-tight text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf sm:text-3xl"
        >
          Où sont les données, et sous quel droit
        </h2>
        <TableDefilante className="card mt-6" label="Hébergement des données">
          <table aria-labelledby="hebergement-titre" className="w-full min-w-[34rem] text-left text-[13px] sm:text-sm" data-testid="hebergement">
            <thead className="border-b border-line bg-panel2/60">
              <tr>
                {["Pièce", "Hébergeur", "Région", "Droit de l'hébergeur"].map((c) => (
                  <th key={c} scope="col" className={`${CELLULE} text-[11px] font-semibold uppercase tracking-wider text-ink-soft`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HEBERGEMENT.map((l) => (
                <tr key={l.piece} className="border-b border-line/60 last:border-0">
                  <th scope="row" className={`${CELLULE} font-medium text-ink`}>
                    {l.piece}
                  </th>
                  <td className={`${CELLULE} text-ink-soft`}>{l.hebergeur}</td>
                  <td className={`${CELLULE} text-ink-soft`}>{l.lieu}</td>
                  <td className={`${CELLULE} text-ink-soft`}>{l.droit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableDefilante>
        <p className="mt-4 max-w-3xl text-sm leading-relaxed text-ink-soft" data-testid="hebergement-droit">
          La donnée et le calcul sont en Union européenne ; les trois hébergeurs relèvent d&apos;un droit
          tiers. Ce POC n&apos;est pas une offre souveraine. Les mesures ne conservent aucune adresse IP
          de visiteur : le pays est estimé.
        </p>
      </div>
    </section>
  );
}
