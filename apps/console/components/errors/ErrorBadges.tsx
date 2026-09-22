// Badges des écrans Erreurs : type, statut de triage, source et caractère géré.
// Rendu serveur. Une valeur inconnue (NULL) n'est jamais habillée en valeur
// connue : pas de badge « gérée » deviné, pas de source supposée.
import { ERROR_SOURCE_LABELS, type ErrorSource } from "@/lib/queries-errors";
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

/** Régression d'abord : une erreur « résolue » qui revient n'est plus résolue. */
export function ErrorStatusBadges({ status, regressed }: { status: ErrorStatus; regressed: boolean }) {
  if (regressed) {
    return (
      <span className="mr-2 rounded-full border border-warn/50 bg-warn/10 px-1.5 py-0.5 text-[10px] font-bold text-warn-ink">
        ⚠ régression
      </span>
    );
  }
  if (status === "resolved") {
    return (
      <span className="mr-2 rounded-full border border-good/30 bg-good/10 px-1.5 py-0.5 text-[10px] font-semibold text-good-ink">
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
          : "border-bad/30 bg-bad/10 text-bad-ink"
      }`}
    >
      {handled ? "gérée" : "non gérée"}
    </span>
  );
}
