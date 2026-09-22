"use client";
// Graphique d'une carte analytique (P6.5). AUCUN graphique n'est écrit ici : les
// séries réutilisent `LineTrend` et `StackedBars`, les mêmes briques que le reste
// de la console. Une carte de tableau de bord ne doit pas inventer sa grammaire
// visuelle — elle ne serait plus comparable au graphique dont elle est extraite.
//
// EMPILER EST UNE AFFIRMATION. On empile quand la mesure s'ADDITIONNE : la hauteur
// totale est alors le total, et elle veut dire quelque chose. Sinon, une seule
// courbe par carte — empiler des p95 dessinerait une somme qui n'existe pas.
//
// UN SEAU SANS MESURE EST UN TROU (F30, CE1). `null` passe tel quel aux
// graphiques : la courbe s'interrompt (pas de `connectNulls`), la barre manque.
// L'ancien `?? 0` dessinait « LCP = 0 ms » sur une heure sans mesure.
import { LineTrend, type LineTrendPoint } from "@/components/charts/LineTrend";
import { StackedBars, type StackSeries } from "@/components/charts/StackedBars";
import type { WidgetData } from "@/lib/widget-data";
import { CATEGORIELLE } from "@/lib/palette";

// Même palette que Sankey : huit teintes distinguables, réutilisées cycliquement.
// Des groupes sans ordre ni verdict : jamais de vert, d'ambre ni de rouge (P15).
const PALETTE = CATEGORIELLE;

export function WidgetChart({ data, unit = "" }: { data: WidgetData; unit?: string }) {
  const serie = data.series;
  if (!serie || !serie.groups.length) return null;

  if (serie.stacked) {
    const rows: Record<string, number | string | null>[] = serie.buckets.map((seau, i) => {
      const ligne: Record<string, number | string | null> = { seau };
      for (const [rang, groupe] of serie.groups.entries()) ligne[`g${rang}`] = groupe.values[i] ?? null;
      return ligne;
    });
    const series: StackSeries[] = serie.groups.map((groupe, rang) => ({
      key: `g${rang}`,
      name: groupe.label,
      color: PALETTE[rang % PALETTE.length],
    }));
    return <StackedBars data={rows} xKey="seau" series={series} height={200} yUnit={unit} />;
  }

  // Non additive : une courbe PAR groupe, jamais une somme. Elles sont côte à
  // côte plutôt qu'empilées, et aucune n'est omise — un groupe absent du dessin
  // serait un groupe absent de la lecture.
  const hauteur = serie.groups.length > 1 ? 140 : 200;
  return (
    <div className="flex flex-col gap-3">
      {serie.groups.map((groupe, rang) => {
        const points: LineTrendPoint[] = serie.buckets.map((seau, i) => ({
          label: seau,
          value: groupe.values[i] ?? null,
        }));
        return (
          <LineTrend
            key={groupe.label}
            data={points}
            valueName={groupe.label}
            valueUnit={unit}
            color={PALETTE[rang % PALETTE.length]}
            height={hauteur}
          />
        );
      })}
    </div>
  );
}
