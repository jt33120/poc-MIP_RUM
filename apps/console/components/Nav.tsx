"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { contextHref } from "@/lib/view-state";
import { CATEGORIES, activeCategory, type NavCategory } from "./nav-items";
import { ICON_PATHS, Icon } from "./icons";

const DOMAIN_DOT = { perf: "text-perf", neutral: "text-ink-faint" } as const;

const BASE =
  "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition";

/** Icône de la catégorie, coiffée d'un cadenas quand la capacité est fermée. */
function Pastille({ c, isActive }: { c: NavCategory; isActive: boolean }) {
  return (
    <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
      <Icon
        paths={ICON_PATHS[c.icon]}
        className={`h-4 w-4 ${
          c.verrouille
            ? "text-ink-faint opacity-50"
            : isActive
              ? DOMAIN_DOT[c.domain]
              : "text-ink-faint group-hover:text-ink-soft"
        }`}
      />
      {/* Cadenas apposé sur l'icône, posé sur une pastille opaque. Un simple
          liseré via paint-order ne fonctionnerait pas : ces icônes n'ont pas de
          remplissage, donc le contour de propreté serait la SEULE chose peinte
          et le cadenas disparaîtrait, blanc sur blanc. */}
      {c.verrouille && (
        <span className="absolute -bottom-1 -right-1.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-panel ring-1 ring-line">
          <Icon paths={ICON_PATHS.lock} className="h-2.5 w-2.5 text-ink-soft" strokeWidth={2.6} />
        </span>
      )}
    </span>
  );
}

/**
 * Sidebar : une entrée par catégorie (les pages sœurs s'ouvrent en sous-onglets).
 *
 * `reglages` est monté À CÔTÉ du lien de la catégorie « Performance », jamais
 * dedans : un bouton imbriqué dans une ancre est invalide en HTML, et le clic
 * remonterait au lien — on ouvrirait la fenêtre ET on naviguerait. D'où la
 * rangée en flex, avec le lien qui prend la place et le réglage à sa droite.
 */
export function Nav({ reglages }: { reglages?: Record<string, React.ReactNode> }) {
  const pathname = usePathname();
  // Contexte persisté (app, plage, filtres, comparaison) ; les réglages propres à l'écran quitté restent derrière.
  const sp = useSearchParams();
  const active = activeCategory(pathname);

  return (
    <nav className="flex flex-col gap-0.5">
      {CATEGORIES.map((c) => {
        const isActive = c === active;

        // Une catégorie verrouillée n'est PAS un lien désactivé mais un <span> :
        // un <a> qu'on se contente de griser reste atteignable au clavier et par
        // « ouvrir dans un nouvel onglet ».
        if (c.verrouille) {
          return (
            <span
              key={c.href}
              aria-disabled
              title="Bientôt disponible — accès fermé"
              className={`${BASE} cursor-not-allowed text-ink-faint`}
            >
              <Pastille c={c} isActive={false} />
              {c.label}
            </span>
          );
        }

        const lien = (
          <Link
            href={contextHref(c.href, sp)}
            className={`${BASE} min-w-0 flex-1 ${
              isActive ? "bg-perf/10 text-ink" : "text-ink-soft hover:bg-panel2 hover:text-ink"
            }`}
          >
            <span
              className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent transition-opacity ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
            <Pastille c={c} isActive={isActive} />
            <span className="truncate">{c.label}</span>
          </Link>
        );

        // Le réglage n'est proposé que sur les catégories qui en ont un — pas
        // sur celles qui n'ont rien à composer, ni sur les catégories fermées.
        const reglage = c.verrouille ? undefined : reglages?.[c.href];

        return (
          <div key={c.href} className={reglage ? "flex items-center gap-0.5" : undefined}>
            {lien}
            {reglage}
          </div>
        );
      })}
    </nav>
  );
}
