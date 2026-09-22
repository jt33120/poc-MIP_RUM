"use client";
// VitalsTimeseries — le p75 d'UN Web Vital dans le temps : une enveloppe de
// `ThresholdSeries` (F04, plan § 4.1).
//
// Ce qu'elle fixe pour l'appelant : les bandes Bon / À améliorer / Mauvais du vital
// (lues dans `lib/rating.ts` — plus de `thresholds` passés à la main, ni de deux
// pointillés), le format du vital (« 2,7 s », « 0,081 »), et le rôle « principale »
// de la série. La grille reste OBLIGATOIRE : une heure sans mesure est un trou,
// plus une pente tirée entre deux heures éloignées.
//
// R-V : `vital` n'est donné que pour un p75 — c'est ce que trace cette enveloppe.
import { bucketLabel } from "@/lib/query-contract";
import { formatDuVital, type VitalName } from "@/lib/fmt-ids";
import type { Annotation } from "@/lib/series";
import { ThresholdSeries } from "./ThresholdSeries";

export type VitalPoint = {
  /** Élément de la grille (ISO UTC ou jour « AAAA-MM-JJ »). */
  t: string;
  /** p75 du seau ; `null` = aucune mesure (un trou, jamais 0). */
  p75: number | null;
  /** Mesures du seau, si la lecture les compte : point creux sous 30. */
  n?: number | null;
};

export function VitalsTimeseries({
  vital,
  grille,
  points,
  seauSecondes,
  fuseau,
  hauteur = 260,
  zoomHref,
  annotations,
  annotationsIndisponibles,
  ariaLabel,
}: {
  vital: VitalName;
  grille: string[];
  points: VitalPoint[];
  seauSecondes: number;
  fuseau: string;
  hauteur?: number;
  zoomHref?: string;
  annotations?: Annotation[];
  annotationsIndisponibles?: string;
  /** Défaut : « <vital> p75 par seau de <largeur>, N seaux, 3 zones de seuil ». */
  ariaLabel?: string;
}) {
  const avecEffectif = points.some((p) => p.n != null);
  return (
    <ThresholdSeries
      grille={grille}
      points={points}
      series={[{ cle: "p75", libelle: `${vital} p75`, role: "principale", effectifCle: avecEffectif ? "n" : undefined }]}
      format={formatDuVital(vital)}
      vital={vital}
      seauSecondes={seauSecondes}
      fuseau={fuseau}
      hauteur={hauteur}
      zoomHref={zoomHref}
      annotations={annotations}
      annotationsIndisponibles={annotationsIndisponibles}
      ariaLabel={
        ariaLabel ??
        `${vital} p75 par seau de ${bucketLabel(seauSecondes)}, ${grille.length} seaux, 3 zones de seuil (Bon, À améliorer, Mauvais)`
      }
    />
  );
}
