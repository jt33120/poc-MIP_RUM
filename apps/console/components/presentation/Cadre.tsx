// Le cadre commun de la présentation (/presentation), du dossier technique
// (/presentation/dossier) et des composants open source (/presentation/open-source) :
// la marque, l'en-tête, le pied de page.
//
// Plusieurs pages, un seul cadre : un visiteur qui passe de la vitrine au dossier doit
// sentir qu'il est resté au même endroit, et l'attribution de la base GeoIP (CC BY
// 4.0) ne doit pas exister sur une page et manquer sur l'autre.
//
// Le fond texturé vit dans globals.css (.mip-sci), pas ici : /select et /select/new
// le réutilisent, et importer ce module pour une chaîne CSS y tirerait la vitrine.
import type { ReactNode } from "react";
import Link from "next/link";
import { ICON_PATHS, Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DATA_SOURCES } from "@/lib/legal";

/** Marque MIP RUM — pouls sur carré orange + wordmark. */
export function BrandMark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
        <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-tight text-ink">
          MIP <span className="text-accent">RUM</span>
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-soft">Real User Monitoring</span>
      </span>
    </span>
  );
}

/**
 * Étiquette « POC en recette » : apposée sur le produit, pas un badge de marque —
 * légèrement de travers, bord pointillé, comme collée là en attendant. Une seule par
 * page (la recette du 26/09/2026 en comptait deux dans le premier écran).
 */
export function PocLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex -rotate-[4deg] items-center rounded-md border border-dashed border-accent/70 bg-accent/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-accent-ink shadow-sm dark:bg-accent/15 ${className}`}
    >
      POC en recette
    </span>
  );
}

/**
 * En-tête : la marque (lien vers la présentation), la bascule de thème, puis ce que
 * la page y met (`children`). Sous `sm`, ce contenu est masqué : le premier écran
 * d'un téléphone répétait sinon les boutons du titre (recette du 26/09/2026).
 */
export function EnTete({ children }: { children?: ReactNode }) {
  return (
    <header className="border-b border-line bg-panel/60 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/presentation" aria-label="MIP RUM — présentation">
          <BrandMark />
        </Link>
        <div className="ml-auto flex items-center gap-2.5">
          <ThemeToggle />
          {children && <div className="hidden items-center gap-2.5 sm:flex">{children}</div>}
        </div>
      </div>
    </header>
  );
}

/**
 * Pied de page. Il ne redit pas l'hébergement (le tableau de la présentation en est la
 * seule source) ; il garde l'attribution de la base GeoIP, que sa licence veut visible.
 * Pas de lien vers des conditions de vente : ce POC ne se vend pas.
 */
export function Pied() {
  return (
    <footer className="border-t border-line bg-panel/60 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-6 py-5 text-xs text-ink-soft">
        <span>MIP RUM — preuve de concept</span>
        <Link href="/presentation/dossier" className="hover:text-ink">
          Dossier technique
        </Link>
        {/* L'inventaire des composants tiers, pour qui veut les vérifier (29/09/2026). */}
        <Link href="/presentation/open-source" className="hover:text-ink">
          Composants open source
        </Link>
        <Link href="/legal/cgu" className="hover:text-ink">
          Conditions d&apos;utilisation
        </Link>
        <Link href="/legal/confidentialite" className="hover:text-ink">
          Confidentialité
        </Link>
        {/* CC BY 4.0 : l'attribution de la base GeoIP doit être visible (lib/legal.ts). */}
        {DATA_SOURCES.map((s) => (
          <a key={s.name} href={s.url} className="hover:text-ink" rel="noopener noreferrer">
            {s.attribution}
          </a>
        ))}
      </div>
    </footer>
  );
}
