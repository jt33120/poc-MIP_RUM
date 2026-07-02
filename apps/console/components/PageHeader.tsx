// En-tête de page standard : titre + sous-titre descriptif + zone d'actions à droite.
import { GlossaryTip } from "./GlossaryTip";
import type { GlossaryId } from "@/lib/glossary";

// Domaine de la page — code couleur constant : bleu = performance utilisateur
// (RUM), violet = intelligence artificielle. Détermine l'étiquette au-dessus du
// titre. Défaut : perf (la majorité des pages).
const DOMAIN = {
  perf: { label: "Performance utilisateur", dot: "bg-perf", text: "text-perf" },
  ai: { label: "Intelligence artificielle", dot: "bg-ai", text: "text-ai" },
} as const;

export function PageHeader({
  title,
  sub,
  help,
  domain = "perf",
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Clé de glossaire : ajoute une bulle d'aide « ? » à côté du titre. */
  help?: GlossaryId;
  /** Domaine (code couleur). Défaut « perf ». */
  domain?: keyof typeof DOMAIN;
  children?: React.ReactNode;
}) {
  const d = DOMAIN[domain];
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3">
      <div className="min-w-0">
        <div className={`mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${d.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${d.dot}`} />
          {d.label}
        </div>
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-ink">
          {title}
          {help && <GlossaryTip id={help} />}
        </h1>
        {sub && <p className="mt-1 text-sm text-ink-soft">{sub}</p>}
      </div>
      {children && <div className="ml-auto flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}
