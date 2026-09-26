// Badges des écrans Erreurs : type, statut de triage, source et caractère géré.
// Rendu serveur. Une valeur inconnue (NULL) n'est jamais habillée en valeur
// connue : pas de badge « gérée » deviné, pas de source supposée.
import { ERROR_SOURCE_LABELS, type ErrorSource } from "@/lib/erreurs-sources";
import type { ErrorStatus } from "@/lib/queries-v2";

export function ErrorTypeBadge({ type, large = false }: { type: string | null; large?: boolean }) {
  return (
    <span
      className={`rounded border border-bad/30 bg-bad/10 font-mono text-bad-ink ${
        large ? "px-2 py-0.5 text-base" : "mr-2 px-1.5 py-0.5 text-xs"
      }`}
    >
      {type ?? "Error"}
    </span>
  );
}

/**
 * Statut de triage d'un groupe, TOUJOURS dit — « ouvert » compris (recette du
 * 26/09/2026 : on pouvait trier et filtrer par triage sans voir le statut d'aucune
 * ligne). Couleurs de STATUT, jamais celle de la GRAVITÉ : le rouge reste au type
 * d'erreur, à « non gérée » et à « fatale » ; ouvert est bleu, régressé orange,
 * résolu vert, ignoré neutre.
 *
 * Régression d'abord : une erreur « résolue » qui revient n'est plus résolue.
 */
export const STATUT_GROUPE: Record<"open" | "regressed" | "resolved" | "ignored", { libelle: string; classes: string }> = {
  open: { libelle: "Ouvert", classes: "border-perf/40 bg-perf/10 text-ink" },
  regressed: { libelle: "⚠ Régressé", classes: "border-warn/50 bg-warn/10 text-warn-ink" },
  resolved: { libelle: "Résolu", classes: "border-good/30 bg-good/10 text-good-ink" },
  ignored: { libelle: "Ignoré", classes: "border-line bg-panel2 text-ink-soft" },
};

/** L'état affiché d'un groupe : `regressed` prime sur le statut enregistré. */
export function statutAffiche(status: ErrorStatus, regressed: boolean): keyof typeof STATUT_GROUPE {
  return regressed ? "regressed" : status;
}

export function ErrorStatusBadges({ status, regressed }: { status: ErrorStatus; regressed: boolean }) {
  const etat = statutAffiche(status, regressed);
  const { libelle, classes } = STATUT_GROUPE[etat];
  return (
    <span
      className={`mr-2 inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${classes}`}
      data-testid="statut-groupe"
      data-statut={etat}
    >
      {libelle}
    </span>
  );
}

/** Source déclarée de l'occurrence ; NULL = émetteur inconnu ou ligne antérieure à v69. */
export function ErrorSourceBadge({ source }: { source: ErrorSource | null }) {
  return (
    <span className="rounded-full border border-line bg-panel2 px-2 py-0.5 text-[11px] font-medium text-ink-soft">
      {source ? ERROR_SOURCE_LABELS[source] : "Source inconnue"}
    </span>
  );
}

/** Rien quand l'émetteur ne l'a pas dit : « gérée » ne se déduit pas. */
export function HandledBadge({ handled }: { handled: boolean | null }) {
  if (handled === null) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        handled
          ? "border-line bg-panel2 text-ink-soft"
          : "border-bad/30 bg-bad/10 text-bad-ink"
      }`}
    >
      {handled ? "gérée" : "non gérée"}
    </span>
  );
}
