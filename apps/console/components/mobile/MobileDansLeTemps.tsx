// « Sessions et erreurs JS dans le temps » de `/mobile` (F39, W-M10, plan § 5.6.4).
// Rendu serveur : le cadre (`Figure`), les états et l'alternative ; les deux
// panneaux sont des `ThresholdSeries` (client) qui partagent l'axe x.
//
// LA MÊME COHORTE QUE LES TUILES. Les seaux viennent de `mobileResumeEtSerie`, qui
// découpe la cohorte de l'écran (runtime déclaré `react_native`, sessions COMMENCÉES
// dans la fenêtre, release lue sur la session) dans la MÊME transaction que le
// résumé : la somme des barres du premier panneau est la tuile « Sessions React
// Native commencées », celle du second la tuile « Occurrences d'erreurs JS » — le
// texte de lecture l'affirme, et c'est cette transaction commune qui le garantit.
//
// DEUX PANNEAUX, UN AXE CHACUN (P5). Des sessions et des occurrences ne se lisent
// pas sur la même échelle : le croisement de deux courbes sur deux axes dépendrait
// du choix des échelles. Même grille, mêmes marges, survol synchronisé.
//
// JAMAIS UN AXE VIDE. Aucune session React Native sur la plage : l'état vide, pas
// deux axes plats. Erreurs JS déclarées non collectées : « Non collecté », pas un
// panneau de zéros. Un compte d'erreurs n'a pas de seuil publié (R-S) : couleur
// catégorielle, aucun verdict.
import type { ReactNode } from "react";
import { Figure } from "@/components/charts/Figure";
import { ThresholdSeries } from "@/components/charts/ThresholdSeries";
import { EtatSurface } from "@/components/states/EtatSurface";
import { formater } from "@/lib/fmt-ids";
import type { Lecture } from "@/lib/lecture";
import { pointsMobileTemps, type CapabilityState } from "@/lib/mobile-capabilities";
import type { MobileSerie } from "@/lib/queries-mobile";
import { bucketLabel } from "@/lib/query-contract";
import { grilleIso, libelleSeauComplet, type Annotation, type PointSerie } from "@/lib/series";

export const TITRE_TEMPS = "Sessions et erreurs JS dans le temps";
const PANNEAU_SESSIONS = "Sessions React Native commencées";
const PANNEAU_ERREURS = "Occurrences d'erreurs JS";

/** Sous un état « Inconnu » de la capacité, la tuile le dit ; le panneau aussi. */
export const NOTE_CAPACITE_INCONNUE = "Capacité non déclarée par le SDK : 0 ne prouve pas l'absence d'erreur.";

function Panneau({ titre, id, children }: { titre: string; id: string; children: ReactNode }) {
  return (
    <div className="min-w-0" data-testid={`panneau-${id}`}>
      <p className="mb-1 text-[11px] font-medium text-ink-soft">{titre}</p>
      {children}
    </div>
  );
}

export function MobileDansLeTemps({
  lecture,
  starts,
  seauSecondes,
  plage,
  zoomHref,
  annotations,
  annotationsIndisponibles,
  capaciteJs,
  explorer,
}: {
  lecture: Lecture<MobileSerie>;
  /** Débuts de seau attendus (`bucketStarts(query.range)`). */
  starts: number[];
  seauSecondes: number;
  /** Plage lue, en toutes lettres (« 24 h »…). */
  plage: string;
  /** Gabarit `{from}` `{to}` du zoom au clic (même écran, seule la plage change). */
  zoomHref: string;
  annotations: Annotation[];
  /** Raison d'absence des annotations (B1, lecture en échec). */
  annotationsIndisponibles: string | null;
  /** État de la capacité `js_errors` sur le périmètre, celui de la tuile W-M4. */
  capaciteJs: CapabilityState;
  /** Explorer rejouant le panneau des sessions (`seg=v2:runtime:eq:react_native`) ; absent s'il ne s'y exprime pas. */
  explorer?: string;
}) {
  const id = "mobile-temps";
  if (!lecture.ok) return <Figure titre={TITRE_TEMPS} id={id} etat={{ kind: "erreur", titre: TITRE_TEMPS }} />;
  if (!lecture.data.disponible) {
    return <Figure titre={TITRE_TEMPS} id={id} etat={{ kind: "partiel", raison: `Série non disponible : ${lecture.data.raison}.` }} />;
  }

  const { raisonErreurs, seaux } = lecture.data;
  const { points, totalSessions, totalOccurrences, ignores } = pointsMobileTemps(starts, seaux, raisonErreurs === null);
  const grille = grilleIso(starts);
  const seau = bucketLabel(seauSecondes);

  // Aucune session de la cohorte : ni axe de sessions, ni axe d'erreurs (qui ne
  // peuvent venir que de ces sessions). L'état vide DIT la population et la plage.
  if (totalSessions === 0) {
    return (
      <Figure
        titre={TITRE_TEMPS}
        id={id}
        etat={{
          kind: "vide",
          population: "session React Native commencée",
          plage,
          borne: "Aucune série n'est dessinée : un axe plat se lirait comme une période calme.",
        }}
      />
    );
  }

  const nonCollecte = capaciteJs === "unavailable";
  // Ce qu'on affiche des occurrences : « Non collecté » et « non lu » valent `null`, jamais 0.
  const occurrencesAffichees = nonCollecte ? null : totalOccurrences;
  const dessinErreurs = !nonCollecte && totalOccurrences !== null && totalOccurrences > 0;
  const lignes: PointSerie[] = points.map((p) => ({ t: p.t, sessions: p.sessions, occurrences: nonCollecte ? null : p.occurrences }));
  const synchro = "mobile-temps";
  const partage = { grille, seauSecondes, fuseau: "UTC", zoomHref, synchro, hauteur: 120, annotations };

  return (
    <Figure
      titre={TITRE_TEMPS}
      id={id}
      explorer={explorer}
      meta={
        <>
          <span>seau de {seau}</span>
          <span>{grille.length} seaux</span>
          <span>{formater("count", totalSessions)} sessions commencées</span>
          <span>
            {nonCollecte
              ? "occurrences d'erreurs JS : non collectées"
              : occurrencesAffichees === null
                ? "occurrences d'erreurs JS : non lues"
                : `${formater("count", occurrencesAffichees)} occurrences d'erreurs JS`}
          </span>
          {ignores > 0 && <span>{ignores} seau(x) hors grille écarté(s)</span>}
          <span>{plage}, UTC</span>
        </>
      }
      lecture={
        <>
          Les mêmes sessions que les tuiles : la cohorte React Native (runtime déclaré, jamais déduit), sessions
          commencées dans chaque seau ; les occurrences sont la somme des erreurs JavaScript de ces sessions, datées
          à leur réception. La somme des seaux est la tuile. Deux panneaux, un axe chacun : aucune grandeur ne se lit
          sur l&apos;échelle de l&apos;autre.
          {explorer &&
            " L'Explorer rejoue le panneau des sessions (runtime = react_native) ; les erreurs JavaScript n'y sont pas isolables, faute de dimension de source d'erreur."}
        </>
      }
      alternative={{
        legende: `Sessions React Native commencées et occurrences d'erreurs JS par seau de ${seau} (UTC)`,
        colonnes: ["Seau (UTC)", PANNEAU_SESSIONS, PANNEAU_ERREURS],
        lignes: points.map((p) => [
          libelleSeauComplet(p.t, seauSecondes, "UTC"),
          p.sessions,
          nonCollecte ? null : p.occurrences,
        ]),
      }}
    >
      <div className="flex min-w-0 flex-col gap-3" data-testid="mobile-temps-panneaux">
        <Panneau titre={PANNEAU_SESSIONS} id="sessions">
          <ThresholdSeries
            {...partage}
            points={lignes}
            series={[{ cle: "sessions", libelle: PANNEAU_SESSIONS, role: "categorie", categorieIndex: 0, forme: "barres", additive: true }]}
            format="count"
            annotationsIndisponibles={annotationsIndisponibles ?? undefined}
            // Les déploiements ne sont listés en liens qu'une fois : sous le dernier panneau dessiné.
            legendeAnnotations={!dessinErreurs}
            ariaLabel={`${PANNEAU_SESSIONS} par seau de ${seau}, ${grille.length} seaux`}
          />
        </Panneau>
        <Panneau titre={PANNEAU_ERREURS} id="erreurs">
          {nonCollecte ? (
            <EtatSurface
              compact
              etat={{ kind: "non_collecte", manque: "les erreurs JavaScript sont déclarées non collectées sur ce périmètre" }}
            />
          ) : totalOccurrences === null ? (
            <EtatSurface compact etat={{ kind: "partiel", raison: `occurrences d'erreurs JS non lues (${raisonErreurs}).` }} />
          ) : totalOccurrences === 0 ? (
            <EtatSurface
              compact
              etat={{
                kind: "vide",
                population: "occurrence d'erreur JS",
                plage,
                ...(capaciteJs === "unknown" ? { borne: NOTE_CAPACITE_INCONNUE } : {}),
              }}
            />
          ) : (
            <ThresholdSeries
              {...partage}
              points={lignes}
              series={[{ cle: "occurrences", libelle: PANNEAU_ERREURS, role: "categorie", categorieIndex: 3, forme: "barres", additive: true }]}
              format="count"
              annotationsIndisponibles={annotationsIndisponibles ?? undefined}
              legendeAnnotations
              ariaLabel={`${PANNEAU_ERREURS} par seau de ${seau}, ${grille.length} seaux`}
            />
          )}
          {dessinErreurs && capaciteJs === "unknown" && (
            <p role="note" className="mt-1 text-xs text-ink-soft" data-testid="mobile-temps-capacite-inconnue">
              {NOTE_CAPACITE_INCONNUE}
            </p>
          )}
        </Panneau>
      </div>
    </Figure>
  );
}
