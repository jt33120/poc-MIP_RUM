"use client";

// Le panneau d'un élément choisi sur la carte : ce que c'est, ses faits avec leurs
// sources (des liens vers le dépôt public, à la ligne), sa liste détaillée s'il en a
// une, et ses voisins — un clic sur un voisin y emmène la carte.
import { CARTOGRAPHIE } from "@/lib/cartographie/donnees";
import { FAMILLES, NATURES, STATUTS, adresseSource, type Element } from "@/lib/cartographie/types";

const PAR_ID = new Map(CARTOGRAPHIE.elements.map((e) => [e.id, e]));

export function PanneauElement({
  element: e,
  depot,
  onChoisir,
  onFermer,
}: {
  element: Element;
  depot: string;
  onChoisir: (id: string) => void;
  onFermer: () => void;
}) {
  const famille = FAMILLES[e.famille];
  const sortants = CARTOGRAPHIE.liens.filter((l) => l.de === e.id);
  const entrants = CARTOGRAPHIE.liens.filter((l) => l.vers === e.id);
  return (
    <aside className="carte-panneau" data-testid="carte-panneau" aria-label={`Fiche : ${e.titre}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="carte-panneau-famille" style={{ color: famille.couleur }}>
          {famille.libelle}
          {e.statut && e.statut !== "en-service" && <span className="carte-element-statut ml-2">{STATUTS[e.statut]}</span>}
        </p>
        <button type="button" className="carte-fermer" onClick={onFermer} aria-label="Fermer la fiche">
          ×
        </button>
      </div>
      <h3 className="carte-panneau-titre">{e.titre}</h3>
      <p className="carte-panneau-sous-titre">{e.sousTitre}</p>
      <p className="carte-panneau-resume">{e.resume}</p>

      {e.faits.length > 0 && (
        <ul className="carte-panneau-faits">
          {e.faits.map((f) => (
            <li key={f.texte}>
              <span>{f.texte}</span>
              {f.sources.length > 0 && (
                <span className="carte-panneau-sources">
                  {f.sources.map((s) => (
                    <a key={s} href={adresseSource(s, depot)} target="_blank" rel="noreferrer">
                      {s}
                    </a>
                  ))}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {e.liste && (
        <div className="mt-4">
          <p className="carte-panneau-intertitre">
            {e.liste.titre} · {e.liste.entrees.length}
          </p>
          <dl className="carte-panneau-liste">
            {e.liste.entrees.map((x) => (
              <div key={x.nom}>
                <dt>{x.nom}</dt>
                <dd>{x.role}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {[
        { titre: "Vers", liens: sortants, autre: (l: (typeof sortants)[number]) => l.vers },
        { titre: "Depuis", liens: entrants, autre: (l: (typeof entrants)[number]) => l.de },
      ].map(
        ({ titre, liens, autre }) =>
          liens.length > 0 && (
            <div key={titre} className="mt-4">
              <p className="carte-panneau-intertitre">{titre}</p>
              <ul className="carte-panneau-voisins">
                {liens.map((l) => {
                  const voisin = PAR_ID.get(autre(l));
                  if (!voisin) return null;
                  const nature = NATURES[l.nature];
                  return (
                    <li key={`${l.de}-${l.vers}-${l.nature}`}>
                      <button type="button" onClick={() => onChoisir(voisin.id)}>
                        <span className="carte-pastille" style={{ background: nature.couleur }} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold text-white">{voisin.titre}</span>
                          <span className="block text-xs text-white/55">{l.libelle ?? nature.libelle}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
      )}
    </aside>
  );
}
