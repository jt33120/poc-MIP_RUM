// Bulle d'aide au survol — primitive accessible, sans dépendance ni état JS.
//
// Pourquoi CSS pur (group-hover + focus-within) plutôt qu'une lib de tooltip :
// rendable côté serveur (RSC), zéro hydratation, ouvrable au clavier (le
// déclencheur est un <button> focusable), et role="tooltip" pour les lecteurs
// d'écran. Le POC reste léger tout en étant navigable et accessible.
//
// BORNÉE (F09). La bulle fermée était seulement TRANSPARENTE : une boîte absolue de
// 288 px centrée sur l'icône, qui comptait dans la largeur défilable. Posée après
// un titre long, elle portait la page à 471 px sur une fenêtre de 390 — sans que
// rien ne soit visible. Désormais :
//   · fermée, elle est `hidden` (display: none) et n'occupe aucune largeur ;
//   · ouverte, elle ne dépasse jamais `100vw - 2rem` ;
//   · sous 640 px, elle se pose au bord de la fenêtre (1 rem de chaque côté, en
//     bas), là où aucune position de l'icône ne peut la faire sortir de l'écran ;
//   · au-delà, `align` l'accroche au bord de l'icône (`start` : elle s'étend vers
//     la droite ; `end` : vers la gauche) plutôt qu'au centre.
//
// ÉCHAP LA FERME (F69, WCAG 1.4.13). Ouverte au focus, elle restait ouverte tant
// que le focus restait sur l'icône : rien ne la masquait sans quitter l'icône.
// L'îlot `InfoTipEchap` pose `data-ferme` sur le groupe à l'appui d'Échap
// (`group-data-[ferme]:!hidden`) et le retire quand le groupe n'est plus NI survolé
// NI focalisé (le pointeur qui sort ne rouvre pas une bulle dont l'icône garde le focus).
import { ICON_PATHS, Icon, type IconName } from "./icons";
import { InfoTipEchap } from "./InfoTipEchap";

const ALIGN = {
  center: "sm:left-1/2 sm:-translate-x-1/2",
  start: "sm:left-0",
  end: "sm:right-0",
} as const;

export function InfoTip({
  children,
  icon = "help",
  side = "bottom",
  align = "center",
  className = "",
  label = "Aide",
}: {
  children: React.ReactNode;
  icon?: IconName;
  side?: "top" | "bottom";
  /** Accroche horizontale à partir de 640 px ; en dessous, la bulle est posée au bord de la fenêtre. */
  align?: keyof typeof ALIGN;
  className?: string;
  label?: string;
}) {
  const pos = side === "top" ? "sm:bottom-full sm:mb-2" : "sm:bottom-auto sm:top-full sm:mt-2";
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-ink-faint transition hover:text-accent focus:text-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icon paths={ICON_PATHS[icon]} className="h-3.5 w-3.5" strokeWidth={2} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none fixed inset-x-4 bottom-4 z-50 hidden max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel p-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink-soft shadow-pop group-hover:block group-focus-within:block group-data-[ferme]:!hidden sm:absolute sm:inset-x-auto sm:w-72 ${pos} ${ALIGN[align]}`}
      >
        {children}
      </span>
      <InfoTipEchap />
    </span>
  );
}
