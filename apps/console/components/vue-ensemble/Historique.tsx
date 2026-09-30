// Historique 14 jours de la Vue d'ensemble (F13, zone 9) — rendu serveur.
//
// 14 jours FIXES, jour × heure dans le fuseau de l'app, échelle SÉQUENTIELLE (90 % et
// 50 % ne sont pas des seuils publiés : R-S). Une case ouvre son heure en instants UTC.
//
// SUR LA PAGE, UNE VIGNETTE (recette du 30/09/2026) : la grille réduite à des cases de
// 5 px, sans légende ni phrase ; un clic ouvre la carte entière — la bascule « heures
// ouvrées », les cases cliquables, la légende, la fenêtre et le fuseau écrits, la
// méthode et l'alternative. Sans donnée, pas de vignette : une ligne le dit.
import Link from "next/link";
import { FicheMesure } from "@/components/charts/FicheMesure";
import { Figure } from "@/components/charts/Figure";
import { ApercuHistorique, HealthHeatmap, type CaseSante } from "@/components/charts/HealthHeatmap";
// Le module sans base (`fuseau-local`) : un composant n'atteint jamais la base (cliquet C-R).
import { nomFuseau } from "@/lib/fuseau-local";
import { DessinVignette, EnteteVignette } from "./Vignette";

/** La bascule 24 h/24 ↔ heures ouvrées (Lun–Ven, 8 h–19 h), portée par l'URL (`hours=business`). */
function BasculeHeures({ ouvrees, hrefs }: { ouvrees: boolean; hrefs: { tout: string; ouvrees: string } }) {
  const lien = (actif: boolean) =>
    `rounded-md px-2.5 py-1 text-xs font-medium transition ${actif ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-soft hover:text-ink"}`;
  return (
    <div className="mb-3 flex w-fit gap-0.5 rounded-lg border border-line bg-panel2 p-0.5">
      <Link href={hrefs.tout} scroll={false} aria-current={!ouvrees ? "true" : undefined} className={lien(!ouvrees)}>
        24 h/24
      </Link>
      <Link href={hrefs.ouvrees} scroll={false} aria-current={ouvrees ? "true" : undefined} className={lien(ouvrees)}>
        Heures ouvrées
      </Link>
    </div>
  );
}

/** La carte entière (la fenêtre de la vignette, ou l'état d'une lecture vide ou en échec). */
export function CarteHistorique({
  jours,
  lecture,
  fuseau,
  zoomHref,
  ouvrees,
  hrefs,
}: {
  jours: string[];
  /** `null` : lecture en échec. */
  lecture: CaseSante[] | null;
  fuseau: string;
  zoomHref: string;
  ouvrees: boolean;
  hrefs: { tout: string; ouvrees: string };
}) {
  const n = jours.length;
  return (
    <Figure
      titre={`Historique ${n} jours`}
      aide="healthGrid"
      id="historique"
      etat={
        lecture === null
          ? { kind: "erreur", titre: `Historique ${n} jours` }
          : lecture.length === 0
            ? { kind: "vide", population: "mesure Web Vitals", plage: `les ${n} derniers jours` }
            : undefined
      }
      meta={
        <>
          <span data-testid="historique-fenetre">{n} jours fixes, indépendants de la période ; le jour en cours est incomplet</span>
          <span>une case = une heure, fuseau de l&apos;app ({nomFuseau(fuseau)})</span>
          <span>% de mesures Bon, pondéré (LCP ×2)</span>
        </>
      }
      lecture={
        // Une phrase de lecture, pas deux (audit A1 T5 : 1 553 mots sur cet écran).
        ouvrees
          ? "Lun–Ven, 8 h–19 h. Plus foncé : plus de mesures « Bon » (une seule teinte, sans verdict). Source : SDK MIP RUM, mesures Web Vitals agrégées par heure dans le fuseau de l'app."
          : "Case vide : aucune visite sur ce créneau. Plus foncé : plus de mesures « Bon » (une seule teinte, sans verdict). Source : SDK MIP RUM, mesures Web Vitals agrégées par heure dans le fuseau de l'app."
      }
    >
      {/* Heures ouvrées (Lun–Ven, 8 h–19 h) : les créneaux où l'on attend du trafic. */}
      <BasculeHeures ouvrees={ouvrees} hrefs={hrefs} />
      {lecture && <HealthHeatmap jours={jours} cellules={lecture} fuseau={fuseau} zoomHref={zoomHref} businessOnly={ouvrees} />}
    </Figure>
  );
}

/** La vignette : la grille réduite ; un clic ouvre la carte entière. */
export function VignetteHistorique(props: {
  jours: string[];
  cellules: CaseSante[];
  fuseau: string;
  zoomHref: string;
  ouvrees: boolean;
  hrefs: { tout: string; ouvrees: string };
}) {
  const { jours, cellules, ouvrees } = props;
  return (
    <FicheMesure
      titre={`Historique ${jours.length} jours, jour × heure`}
      ariaLabel={`Historique ${jours.length} jours : part de mesures « Bon » par jour et par heure${ouvrees ? ", heures ouvrées" : ""} — ouvrir la carte`}
      testId="vignette-historique"
      case={
        <>
          <EnteteVignette titre={`Historique ${jours.length} jours`} meta={ouvrees ? "Lun–Ven · 8–19 h" : `${jours.length} j × 24 h`} />
          <DessinVignette>
            {/* Une rangée par jour (le plus ancien en haut), une colonne par heure. */}
            <ApercuHistorique jours={jours} cellules={cellules} businessOnly={ouvrees} />
            <span className="mt-1 flex justify-between text-[10px] tabular-nums text-ink-faint">
              <span>{ouvrees ? "8 h" : "0 h"}</span>
              <span>{ouvrees ? "13 h" : "12 h"}</span>
              <span>{ouvrees ? "19 h" : "23 h"}</span>
            </span>
          </DessinVignette>
        </>
      }
    >
      <div className="mt-3">
        <CarteHistorique {...props} lecture={cellules} />
      </div>
    </FicheMesure>
  );
}
