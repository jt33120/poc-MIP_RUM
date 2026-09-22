// Indicateur « capacité inactive » — principe produit : on ne fait JAMAIS croire
// qu'une fonctionnalité marche si elle n'est pas réellement branchée. Un cadenas
// + un libellé clair signalent qu'une configuration externe est requise (provider
// email, clés Stripe, etc.). Utilisé partout où une capacité est prête mais non active.
import { ICON_PATHS, Icon } from "./icons";

export function LockedBadge({
  label = "Inactif",
  title,
  className = "",
}: {
  label?: string;
  /** Infobulle expliquant ce qu'il faut configurer pour l'activer. */
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border border-warn/60 bg-warn/10 px-2 py-0.5 text-[11px] font-semibold text-warn-ink ${className}`}
    >
      <Icon paths={ICON_PATHS.lock} className="h-3 w-3" strokeWidth={2.2} />
      {label}
    </span>
  );
}
