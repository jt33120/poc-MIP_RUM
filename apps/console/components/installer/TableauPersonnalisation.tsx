// « Ce qui est propre à votre application, ce qui est pareil pour tous » : un tableau
// par parcours (`personnalisation` de `lib/installer.ts`, où chaque ligne est
// sourcée). Rendu serveur. Deux colonnes seulement, et des valeurs qui se coupent
// n'importe où : une adresse de collecte entière tient ainsi dans 390 px.
//
// Refonte du 01/10/2026 : `TableauPersonnalisation` (un parcours) se range à côté de
// sa check-list, dans l'onglet du parcours — les valeurs restent sous les yeux pendant
// l'installation, au lieu de trois cartes de 540 px en tête de page.
import { InfoTip } from "@/components/InfoTip";
import { LIBELLE_PARCOURS, PARCOURS, type LignePersonnalisation, type Parcours } from "@/lib/installer";

function Groupe({ titre, lignes }: { titre: string; lignes: LignePersonnalisation[] }) {
  if (!lignes.length) return null;
  return (
    <tbody>
      <tr>
        <th colSpan={2} scope="colgroup" className="pb-1 pt-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
          {titre}
        </th>
      </tr>
      {lignes.map((l) => (
        <tr key={l.element} className="border-t border-line align-top">
          <th scope="row" className="py-1 pr-3 text-left font-medium text-ink [overflow-wrap:anywhere]">
            {l.element}
          </th>
          <td className="py-1 font-mono text-[11px] text-ink-soft [overflow-wrap:anywhere]">{l.valeur}</td>
        </tr>
      ))}
    </tbody>
  );
}

/**
 * Les valeurs d'UN parcours : ce qui est propre à l'application, puis ce qui est pareil
 * pour tous. `dansSonOnglet` : rangé dans l'onglet du parcours, le titre ne le renomme pas.
 */
export function TableauPersonnalisation({
  app,
  parcours,
  lignes,
  dansSonOnglet = false,
}: {
  app: string;
  parcours: Parcours;
  lignes: LignePersonnalisation[];
  dansSonOnglet?: boolean;
}) {
  return (
    <div className="card min-w-0 px-3 py-2.5" data-testid={`personnalisation-${parcours}`}>
      <div className="flex items-center gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
          {dansSonOnglet ? "Vos valeurs" : `Vos valeurs · ${LIBELLE_PARCOURS[parcours]}`}
        </h3>
        <InfoTip label={`Aide : valeurs du parcours ${LIBELLE_PARCOURS[parcours]}`} align="end">
          Les codes de cette page sont déjà remplis avec ces valeurs ; seule la clé d&apos;API reste à poser.
        </InfoTip>
      </div>
      <table className="w-full table-fixed text-xs">
        <colgroup>
          <col className="w-[44%]" />
          <col />
        </colgroup>
        <Groupe titre={`Propre à ${app}`} lignes={lignes.filter((l) => l.propre)} />
        <Groupe titre="Pareil pour tous" lignes={lignes.filter((l) => !l.propre)} />
      </table>
    </div>
  );
}

/** Les trois parcours côte à côte (vitrine, tests) : le même tableau, une fois par parcours. */
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
        <TableauPersonnalisation key={p} app={app} parcours={p} lignes={lignes[p]} />
      ))}
    </div>
  );
}
