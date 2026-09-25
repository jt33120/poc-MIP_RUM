// Panneau latéral d'un groupe d'erreurs (F20, plan § 5.3.3 et § 3.5). Rendu serveur.
//
// QUALIFIER SANS QUITTER LA LISTE. `panel=error:<empreinte>` ouvre ICI les blocs 1
// à 5 du détail — en-tête, phrase d'impact, versions touchées, occurrences dans le
// temps, ce que les touchés ont en commun. Les blocs 6 à 8 (pile, table des
// occurrences, triage) restent à la page : ils demandent de la largeur, et le
// triage est un geste, pas une qualification.
//
// PAS DE FENÊTRE PROPRE (§ 3.5) : le panneau lit la plage de l'écran, et l'écrit
// dans son contenu. Il ne se lit pas non plus une liste : `précédent` / `suivant`
// lui sont donnés par l'écran, qui seul connaît son ordre.
//
// CE QU'IL AFFICHE EST LU PAR LE CHARGEUR DE L'ÉCRAN (`lib/chargeurs/panneau-erreur.ts`,
// C4) : un groupe n'est pas dans la ligne de liste (ni sa tendance, ni ses releases,
// ni ses occurrences). Chaque lecture est indépendante (§ 3.8) : l'échec de l'une
// laisse les autres blocs.
import Link from "next/link";
import { DetailPanel, type PuceDetail } from "@/components/DetailPanel";
import { ErrorSourceBadge, ErrorTypeBadge, HandledBadge } from "@/components/errors/ErrorBadges";
import {
  BoutonRejeu,
  OccurrencesDansLeTemps,
  PhraseImpact,
  QuOntEnCommun,
  TuilesDetailErreur,
  VersionsTouchees,
  porteeOccurrences,
} from "@/components/errors/DetailErreur";
import { ERROR_LINK } from "@/components/errors/ErrorOccurrences";
import { EchecLecture, SectionErreur } from "@/components/states/SectionErreur";
import { annotationsDeploiements } from "@/lib/annotations";
import type { LecturePanneauErreur } from "@/lib/chargeurs/panneau-erreur";
import { fmtDate } from "@/lib/format";
import type { ErrorGroupRef } from "@/lib/queries-errors";
import { bucketStarts, type ResolvedRange } from "@/lib/query-contract";
import { grilleIso } from "@/lib/series";
import type { Fil } from "@mip/console-contract";

export function PanneauErreur({
  groupe,
  lecture,
  range,
  label,
  bucketLabel,
  fermerHref,
  pageHref,
  precedentHref,
  suivantHref,
  hrefValeur,
}: {
  groupe: ErrorGroupRef;
  /** Ce que le chargeur de l'écran a lu pour ce groupe, sur le fil. */
  lecture: Fil<LecturePanneauErreur>;
  range: ResolvedRange;
  label: string;
  bucketLabel: string;
  fermerHref: string;
  pageHref: string;
  precedentHref?: string | null;
  suivantHref?: string | null;
  hrefValeur: (cle: "route" | "release" | "device", valeur: string) => string | null;
}) {
  const { detail, part, releases, deploys } = lecture;

  // Le groupe a disparu entre la liste et le panneau (rétention, purge) : on le dit,
  // on ne rend pas un panneau vide qu'on lirait comme « aucune occurrence ».
  if (!detail.ok || detail.data === null) {
    return (
      <DetailPanel
        type="error"
        titre={groupe.fingerprint}
        fermerHref={fermerHref}
        pageHref={pageHref}
        precedentHref={precedentHref}
        suivantHref={suivantHref}
      >
        {detail.ok ? (
          <p className="text-sm text-ink-soft">
            Ce groupe n&apos;a plus d&apos;occurrence sur {label} : purgé par la rétention, ou filtré depuis
            l&apos;ouverture de la liste.
          </p>
        ) : (
          <EchecLecture titre="Détail du groupe" />
        )}
      </DetailPanel>
    );
  }

  const { group, last, occurrences, trend, page } = detail.data;
  // Le panneau lit la première page (les plus récentes), jamais une page suivante.
  const portee = porteeOccurrences({ curseur: false, suite: page.next_cursor !== null });
  const puces: PuceDetail[] = [
    { label: "Empreinte", valeur: group.fingerprint },
    { label: "App", valeur: group.app_id },
    { label: "Première vue", valeur: `${fmtDate(group.first_seen)} (depuis toujours)` },
    { label: "Dernière vue", valeur: fmtDate(group.last_seen) },
  ];
  const annotations = annotationsDeploiements(deploys.ok ? deploys.data : [], range, {
    lien: () => pageHref,
  });

  return (
    <DetailPanel
      type="error"
      titre={group.sample_message ?? "(sans message)"}
      puces={puces}
      fermerHref={fermerHref}
      pageHref={pageHref}
      precedentHref={precedentHref}
      suivantHref={suivantHref}
    >
      {/* ── Bloc 1 : type, source, caractère géré, et le rejeu au premier niveau ── */}
      <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
        <ErrorTypeBadge type={group.error_type} />
        <ErrorSourceBadge source={last?.error_source ?? null} />
        <HandledBadge handled={last?.handled ?? null} />
        <span className="basis-full sm:ml-auto sm:basis-auto">
          <BoutonRejeu occurrences={occurrences} appId={group.app_id} portee={portee} />
        </span>
      </div>

      {/* ── Bloc 2 : phrase d'impact, puis quatre tuiles ── */}
      <SectionErreur titre="Impact de ce groupe">
        <PhraseImpact impact={group} plage={label} part={part} hrefSessions={null} />
        <TuilesDetailErreur impact={group} plage={label} />
      </SectionErreur>

      {/* ── Bloc 3 ── */}
      <SectionErreur titre="Versions touchées">
        <VersionsTouchees releases={releases} />
      </SectionErreur>

      {/* ── Bloc 4 ── */}
      <div className="mb-4">
        <SectionErreur titre="Occurrences dans le temps">
          <OccurrencesDansLeTemps
            trend={trend}
            grille={grilleIso(bucketStarts(range))}
            plage={label}
            bucketLabel={bucketLabel}
            seauSecondes={range.bucketSeconds}
            annotations={annotations.annotations}
            annotationsIndisponibles={
              deploys.ok ? (annotations.indisponible ?? undefined) : "marqueurs de déploiement non lus"
            }
          />
        </SectionErreur>
      </div>

      {/* ── Bloc 5 : repli tant que B3 manque ── */}
      <div className="mb-4">
        <SectionErreur titre="Qu'ont en commun les sessions touchées ?">
          <QuOntEnCommun
            occurrences={occurrences}
            plage={label}
            touchees={group.occurrences === 0 ? 0 : group.sessions_affected}
            hrefValeur={hrefValeur}
            portee={portee}
          />
        </SectionErreur>
      </div>

      <p className="text-xs text-ink-soft">
        Pile du dernier exemplaire, table des occurrences et triage sont sur la page du groupe.{" "}
        <Link href={pageHref} className={ERROR_LINK}>
          Ouvrir en page
        </Link>
      </p>
    </DetailPanel>
  );
}
