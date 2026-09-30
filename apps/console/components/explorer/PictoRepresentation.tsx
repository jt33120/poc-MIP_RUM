// Le pictogramme d'une représentation de l'Explorer (recette du 30/09/2026 : des images
// plutôt que du texte) : jauge pour une valeur, barres pour un classement, courbe pour
// une série, lignes pour un journal. Décoratif : le libellé écrit à côté reste le nom.
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import type { Visualization } from "@/lib/analytics-schema";

const PICTO: Record<Visualization | "distribution", IconName> = {
  value: "gauge",
  toplist: "barChart",
  timeseries: "activity",
  table: "list",
  distribution: "signal",
};

export function PictoRepresentation({ representation, className = "h-3.5 w-3.5" }: { representation: Visualization | "distribution"; className?: string }) {
  return <Icon paths={ICON_PATHS[PICTO[representation]]} className={`shrink-0 ${className}`} />;
}
