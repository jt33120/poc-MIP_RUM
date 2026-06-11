import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GlobalFilters } from "@/components/GlobalFilters";
import { Nav } from "@/components/Nav";
import { getUser } from "@/lib/auth";
import { listApps } from "@/lib/queries";
import { logoutAction } from "./logout/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIP RUM",
  description: "Console RUM OpenTelemetry-native — MIP",
};

// dogfooding : la console s'auto-instrumente avec son propre SDK (limite n°25)
const RUM_ENDPOINT = process.env.NEXT_PUBLIC_RUM_ENDPOINT;
const RUM_INIT = RUM_ENDPOINT
  ? `window.MIPRum && MIPRum.init({endpoint:${JSON.stringify(RUM_ENDPOINT)},appId:"mip-rum-console",clientId:"mip",env:"prod"});`
  : null;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();

  // non connecté : seule /login passe le middleware -> coquille nue, sans sidebar
  if (!user) {
    return (
      <html lang="fr">
        <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">{children}</body>
      </html>
    );
  }

  // RBAC : le sélecteur d'app ne propose que les apps autorisées (viewer scopé)
  const allApps = await listApps();
  const apps =
    user.role === "admin" || !user.apps?.length
      ? allApps
      : allApps.filter((a) => user.apps!.includes(a.app_id));

  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <AutoRefresh />
        <div className="flex min-h-screen">
          <aside className="flex w-56 shrink-0 flex-col bg-slate-900 p-4">
            <div className="mb-6 px-2">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500" />
                <span className="text-lg font-bold tracking-tight text-white">MIP RUM</span>
              </div>
              <div className="mt-0.5 text-xs text-slate-400">Real User Monitoring</div>
            </div>
            <Suspense>
              <Nav />
            </Suspense>
            {user.role === "admin" && (
              <div className="mt-4 border-t border-slate-800 pt-3">
                <div className="px-3 pb-1 text-[11px] uppercase tracking-wide text-slate-500">
                  Administration
                </div>
                <nav className="flex flex-col gap-1">
                  <Link
                    href="/admin/customers"
                    className="rounded px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Clients
                  </Link>
                  <Link
                    href="/admin/users"
                    className="rounded px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Utilisateurs
                  </Link>
                  <Link
                    href="/admin/audit"
                    className="rounded px-3 py-2 text-sm font-medium text-slate-300 hover:bg-slate-800"
                  >
                    Audit
                  </Link>
                </nav>
              </div>
            )}
            <div className="mt-auto px-2 pt-6">
              <div className="mb-2 truncate text-[11px] text-slate-400" title={user.email}>
                {user.email} · {user.role}
              </div>
              <form action={logoutAction}>
                <button
                  type="submit"
                  data-testid="logout"
                  className="w-full rounded bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
                >
                  Se déconnecter
                </button>
              </form>
              <footer className="pt-3 text-[11px] text-slate-500">POC v0.2 — OTel-native</footer>
            </div>
          </aside>
          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-8 py-3 backdrop-blur">
              <Suspense>
                <GlobalFilters apps={apps} />
              </Suspense>
            </header>
            <main className="flex-1 p-8">{children}</main>
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
