// Badges des écrans Erreurs : type, statut de triage, source et caractère géré.
// Rendu serveur. Une valeur inconnue (NULL) n'est jamais habillée en valeur
// connue : pas de badge « gérée » deviné, pas de source supposée.
import { ERROR_SOURCE_LABELS, type ErrorSource } from "@/lib/queries-errors";
import type { ErrorStatus } from "@/lib/queries-v2";

export function ErrorTypeBadge({ type, large = false }: { type: string | null; large?: boolean }) {
  return (
    <span
      className={`rounded border border-red-300 bg-red-100 font-mono text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300 ${
        large ? "px-2 py-0.5 text-base" : "mr-2 px-1.5 py-0.5 text-xs"
      }`}
    >
      {type ?? "Error"}
    </span>
  );
}

/** Régression d'abord : une erreur « résolue » qui revient n'est plus résolue. */
export function ErrorStatusBadges({ status, regressed }: { status: ErrorStatus; regressed: boolean }) {
  if (regressed) {
    return (
      <span className="mr-2 rounded-full border border-amber-400/50 bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
        ⚠ régression
      </span>
    );
  }
  if (status === "resolved") {
    return (
      <span className="mr-2 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300">
        résolue
      </span>
    );
  }
  if (status === "ignored") {
    return (
      <span className="mr-2 rounded-full border border-line bg-panel2 px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
        ignorée
      </span>
    );
  }
  return null;
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
          : "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300"
      }`}
    >
      {handled ? "gérée" : "non gérée"}
    </span>
  );
}
