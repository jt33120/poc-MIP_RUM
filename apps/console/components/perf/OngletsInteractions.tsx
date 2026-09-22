// Onglets internes de l'entrée « Interactions » (F22, plan § 2.2, § 5.4) : deux
// routes gardées, une question — « quels gestes échouent, restent sans réponse ou
// font attendre ? ». Rendu serveur, liens simples (fonctionnent sans JavaScript).
//
// UN ONGLET NE CHANGE PAS LA POPULATION. Chaque lien reporte les paramètres du
// contrat (app, plage, appareil, segment…) et la comparaison (`contextHref`, F06) :
// passer de Frustration à Actions montre les mêmes sessions, sur la même fenêtre.
// Les réglages propres à l'écran quitté (`type`, `tri`, pagination) restent derrière.
//
// À 390 px, deux liens pleins (une moitié chacun) : une barre d'onglets qui défile
// cacherait le second.
import { TabLink } from "@/components/sessions/TabLink";
import type { ParamReader } from "@/lib/query-contract";
import { contextHref } from "@/lib/view-state";

export const ONGLETS_INTERACTIONS = [
  { href: "/ux", libelle: "Frustration" },
  { href: "/actions", libelle: "Actions" },
] as const;

export function OngletsInteractions({ actif, sp }: { actif: "/ux" | "/actions"; sp: ParamReader }) {
  return (
    <nav aria-label="Interactions" className="mb-4 flex border-b border-line" data-testid="onglets-interactions">
      {ONGLETS_INTERACTIONS.map((o) => (
        <TabLink key={o.href} href={contextHref(o.href, sp)} active={o.href === actif} className="flex-1 text-center sm:flex-none">
          {o.libelle}
        </TabLink>
      ))}
    </nav>
  );
}
