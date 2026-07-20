import { setErrorStatusAction } from "@/app/errors/[fingerprint]/actions";
import type { ErrorStatus } from "@/lib/queries-v2";

const STATUS_META: Record<ErrorStatus, { label: string; cls: string }> = {
  open: {
    label: "Ouverte",
    cls: "border-red-300 bg-red-100 text-red-800 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-300",
  },
  resolved: {
    label: "Résolue",
    cls: "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-300",
  },
  ignored: {
    label: "Ignorée",
    cls: "border-line bg-panel2 text-ink-soft",
  },
};

function StatusButton({
  appId,
  fingerprint,
  status,
  label,
  accent = false,
}: {
  appId: string;
  fingerprint: string;
  status: ErrorStatus;
  label: string;
  accent?: boolean;
}) {
  return (
    <form action={setErrorStatusAction}>
      <input type="hidden" name="app_id" value={appId} />
      <input type="hidden" name="fingerprint" value={fingerprint} />
      <input type="hidden" name="status" value={status} />
      <button
        type="submit"
        className={
          accent
            ? "btn-accent px-3 py-1.5 text-xs"
            : "btn-ghost border border-line px-3 py-1.5 text-xs"
        }
      >
        {label}
      </button>
    </form>
  );
}

/** Barre de triage d'un groupe d'erreurs : statut courant, alerte de régression,
 *  et boutons de transition (résolu / ignoré / rouvrir). */
export function ErrorTriage({
  appId,
  fingerprint,
  status,
  regressed,
}: {
  appId: string;
  fingerprint: string;
  status: ErrorStatus;
  regressed: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <div className="card mb-6 flex flex-wrap items-center gap-3 p-4" data-testid="error-triage">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Statut</span>
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`} data-testid="error-status">
        {meta.label}
      </span>
      {regressed && (
        <span className="rounded-full border border-amber-400/50 bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          ⚠ Régression — réapparue après résolution
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        {(status !== "resolved" || regressed) && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="resolved" label="Marquer résolu" accent />
        )}
        {status !== "ignored" && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="ignored" label="Ignorer" />
        )}
        {status !== "open" && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="open" label="Rouvrir" />
        )}
      </div>
    </div>
  );
}
