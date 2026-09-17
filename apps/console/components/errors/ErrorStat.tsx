// Tuile de mesure des détails d'erreur (groupe historique et issue) : libellé,
// valeur déjà formatée, précision optionnelle. Rendu serveur.
export function ErrorStat({ label, value, testid, hint }: { label: string; value: string; testid?: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className="mt-1.5 text-xl font-bold tabular-nums" data-testid={testid}>
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-ink-faint">{hint}</div>}
    </div>
  );
}
