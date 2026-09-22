"use client";
// TrafficTimeseries — volume et erreurs dans le temps, en DEUX PANNEAUX empilés qui
// partagent l'axe x (F04, plan § 4.1, P5).
//
// Avant : une aire de pages vues sur l'axe de gauche et une ligne d'erreurs sur un
// axe de droite. Deux échelles superposées se lisent comme une corrélation qu'aucune
// n'affirme : le croisement des deux courbes ne dépend que du choix des échelles. Ici,
// les pages vues sont des barres (`StackedBars`, un compte) et les occurrences
// d'erreurs un second panneau (`ThresholdSeries` en barres, un compte) : même grille,
// mêmes marges (`SERIE_MARGES`), survol synchronisé — la même heure se lit sur les
// deux, chacune sur SON axe.
//
// Un compte d'erreurs n'a pas de seuil publié (R-S) : aucune couleur de verdict,
// une couleur catégorielle.
import { useId } from "react";
import type { Annotation, PointSerie } from "@/lib/series";
import { StackedBars } from "./StackedBars";
import { ThresholdSeries } from "./ThresholdSeries";

export type TrafficPoint = {
  /** Élément de la grille (ISO UTC ou jour « AAAA-MM-JJ »). */
  t: string;
  pageviews: number | null;
  /** Somme des occurrences d'erreurs du seau. */
  errors: number | null;
};

export function TrafficTimeseries({
  grille,
  points,
  seauSecondes,
  fuseau,
  libelleErreurs = "Occurrences d'erreurs",
  hauteurPanneau = 130,
  zoomHref,
  annotations,
  annotationsIndisponibles,
}: {
  grille: string[];
  points: TrafficPoint[];
  seauSecondes: number;
  fuseau: string;
  /** Titre du panneau des erreurs : il dit la population comptée (« toutes sources »). */
  libelleErreurs?: string;
  hauteurPanneau?: number;
  zoomHref?: string;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
}) {
  const synchro = `trafic-${useId()}`;
  const lignes: PointSerie[] = points;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="traffic-timeseries">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-ink-soft">Pages vues</p>
        <StackedBars
          grille={grille}
          points={lignes}
          series={[{ cle: "pageviews", libelle: "Pages vues", categorieIndex: 0 }]}
          format="count"
          seauSecondes={seauSecondes}
          fuseau={fuseau}
          hauteur={hauteurPanneau}
          zoomHref={zoomHref}
          annotations={annotations}
          legendeAnnotations={false}
          synchro={synchro}
          ariaLabel={`Pages vues par seau, ${grille.length} seaux`}
        />
      </div>
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium text-ink-soft">{libelleErreurs}</p>
        <ThresholdSeries
          grille={grille}
          points={lignes}
          series={[{ cle: "errors", libelle: libelleErreurs, role: "categorie", categorieIndex: 1, forme: "barres", additive: true }]}
          format="count"
          seauSecondes={seauSecondes}
          fuseau={fuseau}
          hauteur={hauteurPanneau}
          zoomHref={zoomHref}
          annotations={annotations}
          annotationsIndisponibles={annotationsIndisponibles}
          synchro={synchro}
          ariaLabel={`${libelleErreurs} par seau, ${grille.length} seaux`}
        />
      </div>
    </div>
  );
}
