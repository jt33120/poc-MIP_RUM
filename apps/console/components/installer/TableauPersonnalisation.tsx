// « Ce qui est propre à votre application, ce qui est pareil pour tous » : un tableau
// par parcours (`personnalisation` de `lib/installer.ts`, où chaque ligne est
// sourcée). Rendu serveur. Des valeurs qui se coupent n'importe où : une adresse de
// collecte entière tient ainsi dans 390 px.
//
// Refonte du 01/10/2026 : `TableauPersonnalisation` (un parcours) se range en tête de
// l'onglet de son parcours, en deux colonnes denses (propre / pareil pour tous) sur
// toute la largeur — au lieu de trois cartes de 540 px en tête de page, ou d'une
// colonne étroite qui laissait du vide sous elle le long de la check-list.
import { InfoTip } from "@/components/InfoTip";
import { LIBELLE_PARCOURS, PARCOURS, type LignePersonnalisation, type Parcours } from "@/lib/installer";

function Groupe({ titre, lignes }: { titre: string; lignes: LignePersonnalisation[] }) {
  if (!lignes.length) return null;
  return (
    <div className="min-w-0">
      <h4 className="pb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{titre}</h4>
      <dl className="grid grid-cols-[minmax(0,42%)_minmax(0,1fr)] gap-x-3 text-xs">
        {lignes.map((l) => (
          <div key={l.element} className="contents">
            <dt className="border-t border-line py-1 font-medium text-ink [overflow-wrap:anywhere]">{l.element}</dt>
            <dd className="border-t border-line py-1 font-mono text-[11px] text-ink-soft [overflow-wrap:anywhere]">{l.valeur}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Les valeurs d'UN parcours : ce qui est propre à l'application, puis ce qui est pareil
 * pour tous, côte à côte dès 1 024 px. `dansSonOnglet` : rangé en tête de l'onglet du
 * parcours, REPLIÉ sur une ligne — les codes de la check-list portent déjà ces valeurs ;
 * on ne l'ouvre que pour les recopier à la main.
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
  if (dansSonOnglet) {
    const propres = lignes.filter((l) => l.propre).length;
    return (
      <details className="card group min-w-0 px-3 py-2" data-testid={`personnalisation-${parcours}`}>
        <summary className="flex cursor-pointer select-none list-none flex-wrap items-center gap-x-2 gap-y-1 text-[11px] [&::-webkit-details-marker]:hidden">
          <span aria-hidden className="text-ink-faint transition group-open:rotate-90">
            ▸
          </span>
          <span className="font-semibold uppercase tracking-[0.08em] text-ink-soft">Vos valeurs</span>
          <span className="text-ink-faint">
            {propres} propres à <code className="chip-mono py-0 text-[11px]">{app}</code> · {lignes.length - propres} communes · déjà dans les codes ci-dessous
          </span>
        </summary>
        <div className="mt-2 grid gap-x-6 gap-y-2 lg:grid-cols-2">
          <Groupe titre={`Propre à ${app}`} lignes={lignes.filter((l) => l.propre)} />
          <Groupe titre="Pareil pour tous" lignes={lignes.filter((l) => !l.propre)} />
        </div>
      </details>
    );
  }
  return (
    <div className="card min-w-0 px-3 py-2.5" data-testid={`personnalisation-${parcours}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-soft">Vos valeurs · {LIBELLE_PARCOURS[parcours]}</h3>
        <InfoTip label={`Aide : valeurs du parcours ${LIBELLE_PARCOURS[parcours]}`} align="start">
          Les codes de cette page sont déjà remplis avec ces valeurs ; seule la clé d&apos;API reste à poser.
        </InfoTip>
      </div>
      <div className="grid gap-x-6 gap-y-2">
        <Groupe titre={`Propre à ${app}`} lignes={lignes.filter((l) => l.propre)} />
        <Groupe titre="Pareil pour tous" lignes={lignes.filter((l) => !l.propre)} />
      </div>
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
