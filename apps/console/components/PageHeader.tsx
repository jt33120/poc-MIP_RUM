// En-tête de page standard : titre + sous-titre descriptif + zone d'actions à droite.
import { GlossaryTip } from "./GlossaryTip";
import type { GlossaryId } from "@/lib/glossary";

export function PageHeader({
  title,
  sub,
  help,
  children,
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  /** Clé de glossaire : ajoute une bulle d'aide « ? » à côté du titre. */
  help?: GlossaryId;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start gap-3">
      <div className="min-w-0">
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
