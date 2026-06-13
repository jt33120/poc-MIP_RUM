import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GlobalFilters } from "@/components/GlobalFilters";
import { ICON_PATHS, Icon } from "@/components/icons";
import { Nav } from "@/components/Nav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TourGuide } from "@/components/TourGuide";
import { getUser } from "@/lib/auth";
import { listApps } from "@/lib/queries";
import { logoutAction } from "./logout/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIP RUM",
  description: "Console RUM OpenTelemetry-native — MIP",
};

// Anti-FOUC : applique le thème (localStorage > préférence système) avant le
// premier paint. Inline dans <head>, donc exécuté avant l'hydratation.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("mip-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

// dogfooding : la console s'auto-instrumente avec son propre SDK (limite n°25)
const RUM_ENDPOINT = process.env.NEXT_PUBLIC_RUM_ENDPOINT;
const RUM_INIT = RUM_ENDPOINT
  ? `window.MIPRum && MIPRum.init({endpoint:${JSON.stringify(RUM_ENDPOINT)},appId:"mip-rum-console",clientId:"mip",env:"prod"});`
  : null;

/** Marque produit : pictogramme pouls sur carré orange MIP + wordmark. */
function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
        <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-tight text-white">
          MIP <span className="text-accent">RUM</span>
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-slate-400">
          Real User Monitoring
        </span>
      </span>
    </div>
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  // non connecté : seule /login passe le middleware -> coquille nue, sans sidebar
  if (!user) {
    return (
      <html lang="fr" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body className="min-h-screen">{children}</body>
      </html>
    );
  }

  // RBAC : le sélecteur d'app ne propose que les apps autorisées (viewer scopé)
  const allApps = await listApps();
  const apps =
    user.role === "admin" || !user.apps?.length
      ? allApps
      : allApps.filter((a) => user.apps!.includes(a.app_id));

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <AutoRefresh />
        <div className="flex min-h-screen">
          {/* Sidebar : navy MIP permanent (ancre de marque), identique clair/sombre */}
          <aside className="grid-texture flex w-60 shrink-0 flex-col bg-gradient-to-b from-navy-900 to-navy-950 p-4">
            <div className="mb-7 px-1 pt-1">
              <BrandMark />
            </div>
            <Suspense>
              <Nav />
            </Suspense>
            {user.role === "admin" && (
              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Administration
                </div>
                <nav className="flex flex-col gap-0.5">
                  <Link
                    href="/admin/customers"
                    className="rounded px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Clients
                  </Link>
                  <Link
                    href="/admin/users"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300/90 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    <Icon paths={ICON_PATHS.user} className="h-4 w-4 text-slate-400" />
                    Utilisateurs
                  </Link>
                  <Link
                    href="/admin/audit"
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-300/90 transition hover:bg-white/[0.05] hover:text-white"
                  >
                    <Icon paths={ICON_PATHS.list} className="h-4 w-4 text-slate-400" />
                    Audit
                  </Link>
                </nav>
              </div>
            )}
            <div className="mt-auto pt-6">
              <div className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/90 to-accent-deep text-xs font-bold text-navy-950">
                  {initials}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-xs font-medium text-slate-200" title={user.email}>
                    {user.email}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wider text-slate-500">{user.role}</span>
                </span>
                <form action={logoutAction} className="ml-auto shrink-0">
                  <button
                    type="submit"
                    data-testid="logout"
                    title="Se déconnecter"
                    aria-label="Se déconnecter"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-accent"
                  >
                    <Icon paths={ICON_PATHS.logout} className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
              <footer className="px-1 pt-3 text-[10px] tracking-wide text-slate-600">
                POC v0.2 — OTel-native · souverain UE
              </footer>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel/80 px-6 py-2.5 backdrop-blur-md">
              <Suspense>
                <GlobalFilters apps={apps} />
              </Suspense>
              <div className="ml-auto flex items-center gap-3">
                {/* AutoRefresh re-fetch les server components toutes les 5 s */}
                <span
                  className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
                  title="Données rafraîchies automatiquement toutes les 5 secondes"
                >
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-emerald-500" />
                  LIVE · 5 s
                </span>
                <TourGuide />
                <ThemeToggle />
              </div>
            </header>
            <main className="flex-1 p-6 lg:p-8">{children}</main>
          </div>
        </div>
        {RUM_INIT && (
          <>
            <script src="/mip-rum.js" />
            <script dangerouslySetInnerHTML={{ __html: RUM_INIT }} />
          </>
        )}
      </body>
    </html>
  );
}
