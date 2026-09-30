// « Lequel choisir ? » : les trois parcours de `/installer` en trois cartes courtes.
// Rendu serveur. Chaque carte mène à son onglet par son ancre (`#snippet`…), que
// `ParcoursInstallation` suit.
import { LIBELLE_PARCOURS, PARCOURS, type Parcours } from "@/lib/installer";

export const CARTES_PARCOURS: Record<Parcours, { badge: string; ton: string; texte: string }> = {
  snippet: {
    badge: "Recommandé",
    ton: "bg-good/15 text-good-ink",
    texte: "Mesure tous les visiteurs du site. Un seul changement : deux balises dans le <head> de vos pages.",
  },
  extension: {
    badge: "Sans toucher au site",
    ton: "bg-panel2 text-ink-soft",
    texte:
      "Ne mesure que les postes où elle est installée : un pilote, un parc géré, un site dont vous n'avez pas le code.",
  },
  serveur: {
    badge: "Recommandé",
    ton: "bg-good/15 text-good-ink",
    texte:
      "Plus seulement la vue du navigateur : chaque appel est suivi jusqu'au serveur, et sa lenteur localisée, dans le serveur ou dans le trajet (réseau, proxy).",
  },
};

export function ChoixParcours({ vert }: { vert: Record<Parcours, boolean> }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-3" data-testid="choix-parcours">
      {PARCOURS.map((p) => (
        <li key={p} className="card flex min-w-0 flex-col p-4" data-testid={`carte-${p}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="min-w-0 text-sm font-semibold text-ink">{LIBELLE_PARCOURS[p]}</h3>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CARTES_PARCOURS[p].ton}`}>{CARTES_PARCOURS[p].badge}</span>
          </div>
          <p className="mt-2 flex-1 text-xs leading-relaxed text-ink-soft">{CARTES_PARCOURS[p].texte}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={`#${p}`}
              className="text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
            >
              Suivre ce parcours →
            </a>
            {vert[p] && <span className="text-[11px] font-medium text-good-ink">Données déjà reçues</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}
