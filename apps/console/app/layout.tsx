import type { Metadata } from "next";
import { AutoRefresh } from "@/components/AutoRefresh";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIP RUM Live",
  description: "Console RUM OpenTelemetry-native — POC MIP",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen bg-slate-100 text-slate-900 antialiased">
        <AutoRefresh />
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 bg-slate-900 p-4">
            <div className="mb-6 px-2">
              <div className="text-lg font-bold text-white">MIP RUM</div>
              <div className="text-xs text-slate-400">Live · OTel-native · POC</div>
            </div>
            <Nav />
          </aside>
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
