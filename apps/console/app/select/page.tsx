// Étape préliminaire : choix du projet à superviser. Rendue AVANT les menus —
// RUM et analyse IA sont propres à un projet, il n'existe pas de vue « toutes
// les apps ». Plein écran, sans sidebar (le layout masque sa coquille sur /select).
//
// L'écran porte le même fond « papier millimétré » que la vitrine publique
// (.mip-sci, globals.css) et sa bascule jour/nuit : c'est le premier écran après
// la connexion, il doit prolonger l'accueil plutôt que ressembler à un menu nu.
//
// Chaque carte dit ce que le projet EST : par où il est mesuré (Snippet posé
// dans le site, ou Extension navigateur), quels domaines sont surveillés, et si
// une anomalie court en ce moment. Les trois signaux viennent de
// lib/queries-projects.ts — trois requêtes pour toute la liste, pas trois par
// carte.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getUser } from "@/lib/auth";
import { describeProject, projectsForUser } from "@/lib/project";
import { signauxProjets, type ModeCollecte } from "@/lib/queries-projects";
import { selectProjectAction } from "./actions";

export const dynamic = "force-dynamic";

/** Habillage d'un mode de collecte : intitulé, icône, ton. */
const MODE: Record<ModeCollecte, { label: string; icon: IconName; ton: string }> = {
  sdk: {
    label: "Snippet",
    icon: "logs",
    ton: "border-accent/40 bg-accent/10 text-accent-ink",
  },
  extension: {
    label: "Extension",
    icon: "grid",
    ton: "border-perf/40 bg-perf/10 text-perf",
  },
  mixte: {
    label: "Snippet + Extension",
    icon: "compare",
    ton: "border-ai/40 bg-ai/10 text-ai",
  },
  aucun: {
    label: "Aucune donnée",
    icon: "info",
    ton: "border-line bg-panel2 text-ink-faint",
  },
};

export default async function SelectProject({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await getUser();
  if (!user) redirect("/login");
  const projects = await projectsForUser(user!);
  const signaux = await signauxProjets(projects.map((p) => p.app_id));
  // Posé par le middleware quand l'URL nommait une app hors périmètre (P6.2) : le
  // refus est dit, au lieu d'ouvrir silencieusement un autre projet.
  const refus = (await searchParams).hors_perimetre;
  const horsPerimetre = typeof refus === "string" && refus.trim() ? refus.trim().slice(0, 200) : null;

  return (
    <main className="mip-sci min-h-screen px-6 py-14">
      <div className="mx-auto w-full max-w-4xl">
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
          <div className="ml-auto flex items-center gap-2.5">
            <ThemeToggle />
            <form action="/logout" method="post">
              <button className="btn-ghost" type="submit">
                {user!.email} · quitter
              </button>
            </form>
          </div>
        </header>

        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Choisissez un projet
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-ink-soft">
          Deux façons de mesurer, un seul catalogue : un{" "}
          <strong className="font-semibold text-ink">Snippet</strong> posé dans le site, ou l&apos;
          <strong className="font-semibold text-ink">Extension</strong> navigateur qui observe sans
          rien y toucher. Chaque carte indique le mode réellement observé et les domaines
          surveillés.
        </p>
        {horsPerimetre && (
          <p
            role="alert"
            data-testid="select-hors-perimetre"
            className="mt-4 max-w-2xl rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-ink-soft"
          >
            Le projet <span className="font-mono text-ink">{horsPerimetre}</span> ne fait pas partie de votre
            périmètre : choisissez un projet autorisé.
          </p>
        )}

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {projects.length === 0 && (
            <div className="card p-6 text-sm text-ink-soft sm:col-span-2">
              Aucun projet accessible. Enregistrez une application ou contactez un administrateur.
            </div>
          )}

          {projects.map((p) => {
            const d = describeProject(p.app_id);
            const s = signaux[p.app_id];
            const m = MODE[s?.mode ?? "aucun"];
            const alerte = (s?.anomalies ?? 0) > 0;

            return (
              <form key={p.app_id} action={selectProjectAction}>
                <input type="hidden" name="app" value={p.app_id} />
                <button
                  type="submit"
                  data-testid="project-card"
                  className="group flex h-full w-full flex-col rounded-xl border border-line bg-panel/85 p-5 text-left shadow-card backdrop-blur-sm transition hover:-translate-y-0.5 hover:border-perf/40 hover:shadow-pop"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-ink">{p.name}</span>
                    <span className="rounded-full bg-perf-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-perf-ink dark:bg-perf/15">
                      {d.tag}
                    </span>
                  </div>

                  {/* Par où ce projet est mesuré — le fait, pas la déclaration */}
                  <span
                    className={`mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold ${m.ton}`}
                  >
                    <Icon paths={ICON_PATHS[m.icon]} className="h-3.5 w-3.5" strokeWidth={2.2} />
                    {m.label}
                  </span>

                  {/* Un périmètre extension déclaré qui ne produit rien mérite
                      d'être dit : c'est le symptôme d'une intégration à finir. */}
                  {s?.extensionDeclaree && s.mode !== "extension" && s.mode !== "mixte" && (
                    <span className="mt-1.5 text-[11px] text-ink-faint">
                      Extension déclarée, aucune session encore remontée
                    </span>
                  )}

                  {/* Ce qui est réellement surveillé */}
                  {s?.domaines.length ? (
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {s.domaines.map((h) => (
                        <li
                          key={h}
                          className="rounded-md bg-panel2 px-2 py-0.5 font-mono text-[11px] text-ink-soft ring-1 ring-line"
                        >
                          {h}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="mt-3 text-[11px] text-ink-faint">
                      Aucun domaine déclaré pour ce projet
                    </span>
                  )}

                  {/* Alerte : anomalie de LCP en cours, calculée à la volée */}
                  {alerte && (
                    <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-bad/40 bg-bad/10 px-2 py-1 text-[11px] font-semibold text-bad-ink">
                      <Icon paths={ICON_PATHS.alert} className="h-3.5 w-3.5" strokeWidth={2.4} />
                      {s.anomalies} anomalie{s.anomalies > 1 ? "s" : ""} de LCP sur 24 h
                    </span>
                  )}

                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">{d.hint}</p>

                  <span className="mt-auto inline-flex items-center gap-1 pt-4 text-sm font-medium text-perf transition group-hover:gap-2">
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
              className="group flex min-h-[9.5rem] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel/40 p-5 text-center backdrop-blur-sm transition hover:border-accent/50 hover:bg-panel/70"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-2xl font-light text-accent-ink transition group-hover:bg-accent/20">
                +
              </span>
              <span className="mt-2 text-sm font-semibold text-ink">Ajouter un site</span>
              <span className="mt-0.5 text-xs text-ink-faint">
                Snippet, bookmarklet ou extension — en 1 minute
              </span>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
