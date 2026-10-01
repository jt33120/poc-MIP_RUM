// Badges des issues (P5.5) : statut, réapparition, origine, base de regroupement
// et groupe historique. Rendu serveur. Chaque badge dit ce que la donnée établit,
// rien de plus : une réapparition est « à vérifier », jamais une régression.
import {
  GROUPING_BASIS_LABELS,
  ISSUE_STATUS_LABELS,
  type GroupingBasis,
  type IssueOrigin,
  type IssueStatus,
} from "@/lib/issues-libelles";

const PASTILLE = "mr-2 inline-block shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold";

// Couleurs de STATUT, distinctes du rouge de la GRAVITÉ (type, « non gérée »,
// « fatale ») : « Ouverte », « Error » et « fatale » étaient tous rouges, et le
// statut se lisait comme une gravité (recette du 26/09/2026).
const STATUT_CLASSES: Record<IssueStatus, string> = {
  open: "border-perf/40 bg-perf/10 text-ink",
  for_review: "border-warn/50 bg-warn/10 text-warn-ink",
  resolved: "border-good/30 bg-good/10 text-good-ink",
  ignored: "border-line bg-panel2 text-ink-soft",
};

export function IssueStatusBadge({ status, testid }: { status: IssueStatus; testid?: string }) {
  return (
    <span className={`${PASTILLE} ${STATUT_CLASSES[status]}`} data-testid={testid}>
      {ISSUE_STATUS_LABELS[status]}
    </span>
  );
}

export function ReappearedBadge({ reappeared }: { reappeared: boolean }) {
  if (!reappeared) return null;
  return (
    <span
      className={`${PASTILLE} border-warn/50 bg-warn/10 text-warn-ink`}
      title="Marqué résolu puis revu depuis : la release et le déploiement restent à vérifier avant de parler de régression."
    >
      ⚠ réapparition à vérifier
    </span>
  );
}

/** Seule l'origine `migration` se signale : elle explique un statut hérité et l'absence d'alerte « nouveau bug ». */
export function IssueOriginBadge({ origin, testid }: { origin: IssueOrigin; testid?: string }) {
  if (origin !== "migration") return null;
  return (
    <span
      className={`${PASTILLE} border-perf/30 bg-perf/10 text-ink`}
      data-testid={testid}
      title="Reprend une ou plusieurs anciennes signatures déjà vues : ce n'est pas un nouveau bug."
    >
      reprise de l&apos;historique
    </span>
  );
}

/**
 * Une base peu discriminante est dite ; les autres ne se montrent pas (recette du
 * 26/09/2026 : « Frame normalisée » était un badge technique sans usage pour le
 * lecteur).
 */
export function GroupingBasisBadge({ basis }: { basis: GroupingBasis }) {
  if (basis !== "low_confidence") return null;
  return (
    <span
      className={`${PASTILLE} border-warn/40 bg-warn/10 text-ink`}
      title="Aucune ligne de code de l'application dans la pile (« Script error. », pile tierce ou absente) : regroupement par type et message, peu discriminant."
    >
      {GROUPING_BASIS_LABELS[basis]}
    </span>
  );
}

export function LegacyEntryBadge() {
  return (
    <span
      className={`${PASTILLE} border-line bg-panel2 text-ink-soft`}
      title="Ancienne signature qu'aucun groupe ne reprend seul : occurrences antérieures au regroupement actuel, ou signature répartie sur plusieurs groupes."
    >
      ancienne signature
    </span>
  );
}
