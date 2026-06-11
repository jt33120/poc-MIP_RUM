"use client";
import { ICON_PATHS, Icon } from "./icons";

// Bascule clair/sombre : classe `dark` sur <html> + persistance localStorage.
// Les icônes commutent en pur CSS (dark:) — aucun état React, donc aucun
// risque de mismatch d'hydratation avec le script anti-FOUC du layout.
export function ThemeToggle() {
  function toggle() {
    const el = document.documentElement;
    const dark = el.classList.toggle("dark");
    el.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("mip-theme", dark ? "dark" : "light");
    } catch {
      /* navigation privée : le choix ne survit pas, tant pis */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      data-testid="theme-toggle"
      aria-label="Basculer entre mode clair et mode sombre"
      title="Mode clair / sombre"
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-ink-soft transition hover:border-accent/50 hover:text-accent"
    >
      <span className="hidden dark:block">
        <Icon paths={ICON_PATHS.sun} className="h-4 w-4" />
      </span>
      <span className="dark:hidden">
        <Icon paths={ICON_PATHS.moon} className="h-4 w-4" />
      </span>
    </button>
  );
}
