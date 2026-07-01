// Carte de statistique de l'en-tête Tracing : libellé + valeur + sous-texte
// optionnel et glossaire. Rendu 100 % serveur. Extrait de app/tracing/page.tsx.
import { GlossaryTip } from "@/components/GlossaryTip";
import type { GlossaryId } from "@/lib/glossary";

/** Tuile de métrique (KPI) affichée dans la grille de synthèse. */
export function Stat({
  label,
  value,
  sub,
  help,
  testid,
}: {
  label: string;
  value: string;
  sub?: string;
  help?: GlossaryId;
  testid?: string;
}) {
  return (
    <div className="card p-4" data-testid={testid}>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        {label}
        {help && <GlossaryTip id={help} />}
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-xs tabular-nums text-ink-faint">{sub}</div>}
    </div>
  );
}
