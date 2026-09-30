// « Lequel choisir ? » : les trois parcours de `/installer` en trois cartes courtes.
// Rendu serveur. Chaque carte mène à son onglet par son ancre (`#snippet`…), que
// `ParcoursInstallation` suit.
//
// Refonte du 01/10/2026 : une carte = une ligne (le nom, le badge, la portée en
// quelques mots, le voyant « données reçues ») ; la phrase qui explique le choix passe
// dans la bulle « ? ».
import { InfoTip } from "@/components/InfoTip";
import { LIBELLE_PARCOURS, PARCOURS, type Parcours } from "@/lib/installer";

export const CARTES_PARCOURS: Record<Parcours, { badge: string; ton: string; portee: string; texte: string }> = {
  snippet: {
    badge: "Recommandé",
    ton: "bg-good/15 text-good-ink",
    portee: "Tous les visiteurs · deux balises",
    texte: "Mesure tous les visiteurs du site. Un seul changement : deux balises dans le <head> de vos pages.",
  },
  extension: {
    badge: "Sans toucher au site",
    ton: "bg-panel2 text-ink-soft",
    portee: "Les postes équipés seulement",
    texte:
      "Ne mesure que les postes où elle est installée : un pilote, un parc géré, un site dont vous n'avez pas le code.",
  },
  serveur: {
    badge: "Recommandé",
    ton: "bg-good/15 text-good-ink",
    portee: "Du navigateur jusqu'au serveur",
    texte:
      "Plus seulement la vue du navigateur : chaque appel est suivi jusqu'au serveur, et sa lenteur localisée, dans le serveur ou dans le trajet (réseau, proxy).",
  },
};

export function ChoixParcours({ vert }: { vert: Record<Parcours, boolean> }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3" data-testid="choix-parcours">
      {PARCOURS.map((p) => (
        <li key={p} className="card flex min-w-0 items-center gap-2 px-3 py-2" data-testid={`carte-${p}`}>
          <a
            href={`#${p}`}
            className="flex min-w-0 flex-1 flex-col rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-ink">{LIBELLE_PARCOURS[p]}</span>
              <span className={`rounded-full px-2 py-px text-[10px] font-semibold leading-4 ${CARTES_PARCOURS[p].ton}`}>{CARTES_PARCOURS[p].badge}</span>
            </span>
            <span className="truncate text-[11px] text-ink-soft">
              {CARTES_PARCOURS[p].portee}
              <span className="sr-only"> — suivre ce parcours</span>
            </span>
          </a>
          {vert[p] && (
            <span className="shrink-0 whitespace-nowrap rounded-full bg-good/15 px-2 py-px text-[11px] font-medium leading-4 text-good-ink" title="Données déjà reçues">
              <span aria-hidden>✓ reçues</span>
              <span className="sr-only">Données déjà reçues</span>
            </span>
          )}
          <InfoTip label={`Pourquoi : ${LIBELLE_PARCOURS[p]}`} align="end">
            {CARTES_PARCOURS[p].texte}
          </InfoTip>
        </li>
      ))}
    </ul>
  );
}
