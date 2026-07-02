// Étape préliminaire : choix du projet à superviser. Rendue AVANT les menus —
// RUM et analyse IA sont propres à un projet, il n'existe pas de vue « toutes
// les apps ». Plein écran, sans sidebar (le layout masque sa coquille sur /select).
import Link from "next/link";
import { redirect } from "next/navigation";
import { ICON_PATHS, Icon } from "@/components/icons";
import { getUser } from "@/lib/auth";
import { describeProject, projectsForUser } from "@/lib/project";
import { logoutAction } from "../logout/actions";
import { selectProjectAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function SelectProject() {
  const user = await getUser();
  if (!user) redirect("/login");
  const projects = await projectsForUser(user!);

  return (
    <main className="min-h-screen bg-app px-6 py-14">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
            <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-ink">
              MIP <span className="text-accent">RUM</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              Real User Monitoring
            </div>
          </div>
          <form action={logoutAction} className="ml-auto">
            <button className="btn-ghost" type="submit">
              {user!.email} · quitter
            </button>
          </form>
        </header>

        <h1 className="text-2xl font-bold tracking-tight text-ink">Choisissez un projet</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Chaque projet a ses propres mesures de performance et d'usage IA. Sélectionnez celui à superviser —
          vous pourrez en changer à tout moment depuis le bandeau latéral.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {projects.length === 0 && (
            <div className="card p-6 text-sm text-ink-soft sm:col-span-2">
              Aucun projet accessible. Enregistrez une application ou contactez un administrateur.
            </div>
          )}
          {projects.map((p) => {
            const d = describeProject(p.app_id);
            return (
              <form key={p.app_id} action={selectProjectAction}>
                <input type="hidden" name="app" value={p.app_id} />
                <button
                  type="submit"
                  data-testid="project-card"
                  className="group flex w-full flex-col rounded-xl border border-line bg-panel p-5 text-left shadow-card transition hover:-translate-y-0.5 hover:border-perf/40 hover:shadow-pop"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base font-semibold text-ink">{p.name}</span>
                    <span className="rounded-full bg-perf-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-perf-ink dark:bg-perf/15">
                      {d.tag}
                    </span>
                  </div>
                  <code className="mt-1 font-mono text-xs text-ink-faint">{p.app_id}</code>
                  <p className="mt-3 text-sm text-ink-soft">{d.hint}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-perf transition group-hover:gap-2">
                    Ouvrir la console
                    <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
                  </span>
                </button>
              </form>
            );
          })}

          {user!.role === "admin" && (
            <Link
              href="/select/new"
              data-testid="add-site"
              className="group flex min-h-[9.5rem] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel/40 p-5 text-center transition hover:border-accent/50 hover:bg-panel"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-2xl font-light text-accent-deep transition group-hover:bg-accent/20 dark:text-accent">
                +
              </span>
              <span className="mt-2 text-sm font-semibold text-ink">Ajouter un site</span>
              <span className="mt-0.5 text-xs text-ink-faint">Injection JS ou bookmarklet — en 1 minute</span>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
