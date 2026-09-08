import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";
import { AskAssistant } from "@/components/AskAssistant";
import { AutoRefresh } from "@/components/AutoRefresh";
import { GlobalFilters } from "@/components/GlobalFilters";
import { ICON_PATHS, Icon } from "@/components/icons";
import { Nav } from "@/components/Nav";
import { SegmentBar } from "@/components/SegmentBar";
import { SubNav } from "@/components/SubNav";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TourGuide } from "@/components/TourGuide";
import { getUser } from "@/lib/auth";
import { dogfoodingEndpoint } from "@/lib/ingest-endpoint";
import { DashboardSettings } from "@/components/DashboardSettings";
import { CATALOGUES, lireChoix } from "@/lib/dashboard-blocs";
import { reglerBlocsAction } from "./actions-dashboard";
import { listApps } from "@/lib/queries";
import { describeProject, selectedProjectId } from "@/lib/project";
import { logoutAction } from "./logout/actions";
import "./globals.css";

export const metadata: Metadata = {
  title: "MIP RUM",
  description: "Console RUM OpenTelemetry-native — MIP",
};

// Anti-FOUC : applique le thème (localStorage > préférence système) avant le
// premier paint. Inline dans <head>, donc exécuté avant l'hydratation.
const THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("mip-theme");var d=t?t==="dark":matchMedia("(prefers-color-scheme: dark)").matches;var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";}catch(_){}})();`;

// dogfooding : session replay activé sur la console elle-même. RGPD : saisies
// masquées à l'enregistrement (maskAllInputs), blocs `mip-rum-block` exclus,
// capture coupée si DNT/GPC signalé, TTL 30 j. Taux configurable via
// NEXT_PUBLIC_RUM_REPLAY (défaut 1 = toutes les sessions internes, pour que le
// rejeu soit toujours peuplé en démo).
const RUM_REPLAY = Number(process.env.NEXT_PUBLIC_RUM_REPLAY ?? "1");
const RUM_REPLAY_RATE = Number.isFinite(RUM_REPLAY) ? RUM_REPLAY : 0;

// dogfooding : la console s'auto-instrumente avec son propre SDK (limite n°25).
// L'endpoint est résolu PAR REQUÊTE, et non figé au chargement du module : c'est ce
// qui fait suivre naturellement les previews et le self-host, et ce qui évite qu'un
// hôte codé en dur survive à une migration d'infrastructure — le dogfooding a émis
// vers un projet Supabase décommissionné pendant douze jours (invariant AD-4).
function rumInitScript(host: string | null): string {
  // dogfoodingEndpoint, PAS ingestEndpoint : la console poste chez elle, et
  // NEXT_PUBLIC_RUM_ENDPOINT ne doit jamais pouvoir l'envoyer ailleurs.
  const endpoint = dogfoodingEndpoint(host);
  // Version de l'app : le SHA du commit déployé, fourni par Vercel. Sans elle, une
  // régression de performance ne peut pas être rattachée à une mise en production —
  // et les traces d'erreur restent minifiées faute de savoir quelle source map lire.
  const release = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "dev";
  return `window.MIPRum && MIPRum.init({endpoint:${JSON.stringify(endpoint)},appId:"mip-rum-console",clientId:"mip",env:"prod",release:${JSON.stringify(release)},replay:${JSON.stringify(RUM_REPLAY_RATE)}});`;
}

/** Marque produit : pictogramme pouls sur carré orange MIP + wordmark. */
function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
        <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
      </span>
      <span className="leading-tight">
        <span className="block text-base font-bold tracking-tight text-ink">
          MIP <span className="text-accent">RUM</span>
        </span>
        <span className="block text-[10px] uppercase tracking-[0.18em] text-ink-faint">
          Real User Monitoring
        </span>
      </span>
    </div>
  );
}

/** Carte « projet courant » : rappelle le scope actif et permet d'en changer. */
function ProjectSwitcher({ name, appId }: { name: string; appId: string }) {
  const d = describeProject(appId);
  return (
    <Link
      href="/select"
      className="group mb-6 block rounded-xl border border-line bg-panel2 p-3 transition hover:border-perf/40"
      title="Changer de projet"
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-perf" />
        Projet · {d.tag}
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink" title={name}>
          {name}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-perf opacity-0 transition group-hover:opacity-100">
          changer
        </span>
      </div>
    </Link>
  );
}

/** Le capteur, identique sur les trois coquilles. Extrait pour qu'aucune branche
 *  ne puisse l'oublier : c'est précisément ce qui laissait la vitrine, le login et
 *  le choix de projet — tout le premier contact d'un visiteur — hors mesure, sur un
 *  produit dont l'argument est justement de mesurer le premier contact. */
function Capteur({ init }: { init: string }) {
  return (
    <>
      <script src="/mip-rum.js" />
      <script dangerouslySetInnerHTML={{ __html: init }} />
      {/* dogfooding : la console collecte son propre ressenti (widget feedback
          -> track 'feedback' -> rum_event, app mip-rum-console) pour peupler
          sa page Expérience. Chargé après l'init RUM. */}
      <script src="/mip-rum-feedback.js" defer />
    </>
  );
}

/** Une roue par catalogue, indexée par href de catégorie. Les cookies sont lus
 *  ICI parce que c'est le layout qui rend la sidebar ; chaque page relit le sien
 *  de son côté pour décider quelles requêtes lancer. */
async function rouesDeReglage(): Promise<Record<string, React.ReactNode>> {
  const jar = await cookies();
  return Object.fromEntries(
    CATALOGUES.map((cat) => [
      cat.href,
      <DashboardSettings
        key={cat.href}
        catalogue={cat}
        choix={lireChoix(cat, jar.get(cat.cookie)?.value)}
        action={reglerBlocsAction}
      />,
    ]),
  );
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const RUM_INIT = rumInitScript((await headers()).get("host"));

  // non connecté : seule /login passe le middleware -> coquille nue, sans sidebar
  if (!user) {
    return (
      <html lang="fr" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body className="min-h-screen">
          {children}
          <Capteur init={RUM_INIT} />
        </body>
      </html>
    );
  }

  // /select : étape de choix du projet -> rendu plein écran, sans la coquille
  // (sidebar/header) qui suppose un projet déjà sélectionné.
  const pathname = (await headers()).get("x-pathname") ?? "";
  if (pathname === "/select" || pathname.startsWith("/select/")) {
    return (
      <html lang="fr" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        </head>
        <body className="min-h-screen">
          {children}
          <Capteur init={RUM_INIT} />
        </body>
      </html>
    );
  }

  // RBAC : on ne considère que les apps autorisées (viewer scopé)
  const allApps = await listApps();
  const apps =
    user.role === "admin" || !user.apps?.length
      ? allApps
      : allApps.filter((a) => user.apps!.includes(a.app_id));

  // Projet courant (cookie posé par /select ou le middleware). Absent -> le
  // middleware a déjà renvoyé vers /select ; on garde un repli défensif.
  const projectId = await selectedProjectId();
  const currentProject = apps.find((a) => a.app_id === projectId) ?? null;

  const initials = user.email.slice(0, 2).toUpperCase();

  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-screen">
        <AutoRefresh />
        <div className="flex min-h-screen">
          {/* Sidebar claire : neutre, épurée — n'entre plus en concurrence avec le contenu */}
          <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel p-4">
            <div className="mb-6 px-1 pt-1">
              <BrandMark />
            </div>
            {currentProject && (
              <ProjectSwitcher name={currentProject.name} appId={currentProject.app_id} />
            )}
            <Suspense>
              {/* La roue vit dans la sidebar, contre « Performance » : c'est ce
                  menu qu'elle compose. Le choix est lu ici parce que le layout
                  la rend — la Vue d'ensemble le relit de son côté pour décider
                  quelles requêtes lancer. */}
              <Nav reglages={await rouesDeReglage()} />
            </Suspense>
            {user.role === "admin" && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-faint">
                  Administration
                </div>
                <nav className="flex flex-col gap-0.5">
                  {[
                    { href: "/admin/customers", label: "Clients", icon: "users" as const },
                    { href: "/admin/users", label: "Utilisateurs", icon: "user" as const },
                    { href: "/admin/privacy", label: "Vie privée · DSAR", icon: "shield" as const },
                    { href: "/admin/read-tokens", label: "Tokens de lecture", icon: "trace" as const },
                    { href: "/admin/extension-scope", label: "Extension navigateur", icon: "compass" as const },
                    { href: "/admin/extension-installs", label: "Postes équipés", icon: "grid" as const },
                    { href: "/admin/uptime", label: "Uptime", icon: "target" as const },
                    { href: "/admin/audit", label: "Audit", icon: "list" as const },
                    { href: "/admin/usage", label: "Consommation", icon: "gauge" as const },
                    { href: "/admin/health", label: "Santé interne", icon: "activity" as const },
                  ].map((it) => (
                    <Link
                      key={it.href}
                      href={it.href}
                      className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft transition hover:bg-panel2 hover:text-ink"
                    >
                      <Icon paths={ICON_PATHS[it.icon]} className="h-4 w-4 text-ink-faint" />
                      {it.label}
                    </Link>
                  ))}
                </nav>
              </div>
            )}
            <div className="mt-auto pt-6">
              <div className="flex items-center gap-2.5 rounded-xl border border-line bg-panel2 p-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent/90 to-accent-deep text-xs font-bold text-navy-950">
                  {initials}
                </span>
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-xs font-medium text-ink" title={user.email}>
                    {user.email}
                  </span>
                  <span className="block text-[10px] uppercase tracking-wider text-ink-faint">{user.role}</span>
                </span>
                <form action={logoutAction} className="ml-auto shrink-0">
                  <button
                    type="submit"
                    data-testid="logout"
                    title="Se déconnecter"
                    aria-label="Se déconnecter"
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-app hover:text-accent"
                  >
                    <Icon paths={ICON_PATHS.logout} className="h-3.5 w-3.5" />
                  </button>
                </form>
              </div>
              <Link
                href="/help/architecture"
                className="mt-3 flex items-center gap-2 rounded-lg px-3 py-1.5 text-[11px] font-medium text-ink-faint transition hover:bg-panel2 hover:text-ink"
              >
                <Icon paths={ICON_PATHS.compass} className="h-3.5 w-3.5" />
                Architecture &amp; fonctionnement
              </Link>
              <footer className="px-1 pt-3 text-[10px] tracking-wide text-ink-faint">
                v0.3 — OTel-native · souverain UE
              </footer>
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-panel/80 px-6 py-2.5 backdrop-blur-md">
              <Suspense>
                <GlobalFilters />
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
            <Suspense>
              <SubNav />
            </Suspense>
            <Suspense>
              <SegmentBar />
            </Suspense>
            <main className="flex-1 p-6 lg:p-8">{children}</main>
          </div>
        </div>
        <Capteur init={RUM_INIT} />
        {/* Assistant IA (données + architecture, avec citations vérifiables) */}
        <AskAssistant appId={currentProject?.app_id ?? ""} />
      </body>
    </html>
  );
}
