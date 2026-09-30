// « Ce qui est propre à votre application, ce qui est pareil pour tous » : un tableau
// par parcours (`personnalisation` de `lib/installer.ts`, où chaque ligne est
// sourcée). Rendu serveur. Deux colonnes seulement, et des valeurs qui se coupent
// n'importe où : une adresse de collecte entière tient ainsi dans 390 px.
import { LIBELLE_PARCOURS, PARCOURS, type LignePersonnalisation, type Parcours } from "@/lib/installer";

function Groupe({ titre, lignes }: { titre: string; lignes: LignePersonnalisation[] }) {
  if (!lignes.length) return null;
  return (
    <tbody>
      <tr>
        <th colSpan={2} scope="colgroup" className="pb-1 pt-3 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {titre}
        </th>
      </tr>
      {lignes.map((l) => (
        <tr key={l.element} className="border-t border-line align-top">
          <th scope="row" className="py-1.5 pr-3 text-left font-medium text-ink [overflow-wrap:anywhere]">
            {l.element}
          </th>
          <td className="py-1.5 text-ink-soft [overflow-wrap:anywhere]">{l.valeur}</td>
        </tr>
      ))}
    </tbody>
  );
}

export function TableauxPersonnalisation({
  app,
  lignes,
}: {
  app: string;
  lignes: Record<Parcours, LignePersonnalisation[]>;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-3" data-testid="personnalisation">
      {PARCOURS.map((p) => (
        <div key={p} className="card min-w-0 p-4" data-testid={`personnalisation-${p}`}>
          <h3 className="text-sm font-semibold text-ink">{LIBELLE_PARCOURS[p]}</h3>
          <table className="mt-1 w-full table-fixed text-xs">
            <colgroup>
              <col className="w-[42%]" />
              <col />
            </colgroup>
            <Groupe titre={`Propre à ${app}`} lignes={lignes[p].filter((l) => l.propre)} />
            <Groupe titre="Pareil pour tous" lignes={lignes[p].filter((l) => !l.propre)} />
          </table>
        </div>
      ))}
    </div>
  );
}
