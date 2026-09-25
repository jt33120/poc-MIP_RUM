import { setErrorStatusAction } from "@/app/errors/[fingerprint]/actions";
import { fmtDate } from "@/lib/format";
import type { ErrorStatus } from "@/lib/queries-v2";

const STATUS_META: Record<ErrorStatus, { label: string; cls: string }> = {
  open: {
    label: "Ouverte",
    cls: "border-bad/30 bg-bad/10 text-bad-ink",
  },
  resolved: {
    label: "Résolue",
    cls: "border-good/30 bg-good/10 text-good-ink",
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
 *  date de résolution, et boutons de transition (résolu / ignoré / rouvrir).
 *
 *  V9 (F20) : pour un viewer, un compte de démonstration ou un jeton API, les
 *  boutons ne sont pas RENDUS — plutôt que rendus puis refusés par l'action. */
export function ErrorTriage({
  appId,
  fingerprint,
  status,
  regressed,
  resolvedAt,
  lectureSeule = false,
}: {
  appId: string;
  fingerprint: string;
  status: ErrorStatus;
  regressed: boolean;
  /** Date de passage en « résolue » (`error_status.resolved_at`) ; `null` : jamais résolue. */
  resolvedAt?: Date | string | null;
  lectureSeule?: boolean;
}) {
  const meta = STATUS_META[status];
  return (
    <div className="card mb-6 flex flex-wrap items-center gap-3 p-4" data-testid="error-triage">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">Statut</span>
      <span className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${meta.cls}`} data-testid="error-status">
        {meta.label}
      </span>
      {regressed && (
        <span className="rounded-full border border-warn/50 bg-warn/10 px-2.5 py-0.5 text-xs font-bold text-warn-ink">
          ⚠ Régression — réapparue après résolution
        </span>
      )}
      {resolvedAt && (
        <span className="text-xs text-ink-soft" data-testid="error-resolue-le">
          Résolue le {fmtDate(resolvedAt)}
        </span>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        {lectureSeule && (
          <span className="text-xs text-ink-soft" data-testid="triage-lecture-seule">
            Lecture seule : le triage demande un compte administrateur.
          </span>
        )}
        {!lectureSeule && (status !== "resolved" || regressed) && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="resolved" label="Marquer résolu" accent />
        )}
        {!lectureSeule && status !== "ignored" && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="ignored" label="Ignorer" />
        )}
        {!lectureSeule && status !== "open" && (
          <StatusButton appId={appId} fingerprint={fingerprint} status="open" label="Rouvrir" />
        )}
      </div>
    </div>
  );
}
