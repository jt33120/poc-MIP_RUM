// Carte KPI simple pour la rangée d'indicateurs de la page Performance IA.
// Rendu 100 % serveur, calquée sur le style de VitalCard (card + libellé
// majuscules + grande valeur tabulaire).

export function AiKpi({
  label,
  value,
  hint,
  testId,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  testId?: string;
  /** Coloration de la valeur : neutre par défaut, rouge pour un taux d'erreur. */
  tone?: "ink" | "danger";
}) {
  return (
    <div className="card p-4 transition hover:shadow-pop">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div
        data-testid={testId}
        className={`mt-2 text-3xl font-bold tabular-nums tracking-tight ${
          tone === "danger" ? "text-red-600 dark:text-red-400" : "text-ink"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
