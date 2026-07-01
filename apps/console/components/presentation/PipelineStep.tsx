// Étape unique de la frise « Comment ça fonctionne » de la page Présentation :
// une carte (icône + titre + texte) avec un chevron de liaison sauf en fin de
// frise. Rendu 100 % serveur. Extrait de app/presentation/page.tsx.
import { ICON_PATHS, Icon } from "@/components/icons";
import type { PIPELINE } from "@/lib/presentation-content";

export function PipelineStep({ step, last }: { step: (typeof PIPELINE)[number]; last: boolean }) {
  return (
    <div className="relative flex-1">
      <div className="card h-full p-4">
        <span className="mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep text-white shadow-glow">
          <Icon paths={ICON_PATHS[step.icon]} className="h-5 w-5" strokeWidth={2.1} />
        </span>
        <div className="text-sm font-semibold text-ink">{step.title}</div>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{step.body}</p>
      </div>
      {!last && (
        <Icon
          paths={ICON_PATHS.chevronRight}
          className="absolute -right-3 top-1/2 hidden h-5 w-5 -translate-y-1/2 text-ink-faint xl:block"
        />
      )}
    </div>
  );
}
