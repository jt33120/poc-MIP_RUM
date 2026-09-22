// Badges des issues (P5.5) : statut, réapparition, origine, base de regroupement
// et groupe historique. Rendu serveur. Chaque badge dit ce que la donnée établit,
// rien de plus : une réapparition est « à vérifier », jamais une régression.
import {
  GROUPING_BASIS_LABELS,
  ISSUE_STATUS_LABELS,
  type GroupingBasis,
  type IssueOrigin,
  type IssueStatus,
} from "@/lib/error-issues";

const PASTILLE = "mr-2 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-semibold";

const STATUT_CLASSES: Record<IssueStatus, string> = {
  open: "border-bad/30 bg-bad/10 text-bad-ink",
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
      title="Marquée résolue puis revue depuis : la release et le déploiement restent à vérifier avant de parler de régression."
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
      title="Reprend un ou plusieurs groupes historiques déjà vus : ce n'est pas un nouveau bug."
    >
      reprise de l&apos;historique
    </span>
  );
}

/** Une base peu discriminante est dite ; les autres restent discrètes. */
export function GroupingBasisBadge({ basis }: { basis: GroupingBasis }) {
  const faible = basis === "low_confidence";
  return (
    <span
      className={`${PASTILLE} ${faible ? "border-warn/40 bg-warn/10 text-ink" : "border-line bg-panel2 text-ink-soft"}`}
      title={
        faible
          ? "Aucune frame applicative (« Script error. », pile tierce ou absente) : regroupement par type et message, peu discriminant."
          : "Base de la clé de regroupement de cette issue."
      }
    >
      {GROUPING_BASIS_LABELS[basis]}
    </span>
  );
}

export function LegacyEntryBadge() {
  return (
    <span
      className={`${PASTILLE} border-line bg-panel2 text-ink-soft`}
      title="Groupe historique qu'aucune issue ne reprend seule : occurrences antérieures au regroupement v2, ou empreinte répartie sur plusieurs issues."
    >
      groupe historique
    </span>
  );
}
