import type { Metadata } from "next";
import { Suspense } from "react";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GlobalFilters } from "@/components/GlobalFilters";
import { Nav } from "@/components/Nav";
import { listApps } from "@/lib/queries";
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
  const apps = await listApps();
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
            <footer className="mt-auto px-2 pt-6 text-[11px] text-slate-500">
              POC v0.2 — OTel-native
            </footer>
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
