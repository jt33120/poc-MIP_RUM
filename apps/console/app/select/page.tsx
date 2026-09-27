// Étape préliminaire : choix du projet à superviser. Rendue AVANT les menus —
// RUM et analyse IA sont propres à un projet, il n'existe pas de vue « toutes
// les apps ». Plein écran, sans sidebar (le layout masque sa coquille sur /select).
//
// L'écran porte le même fond « papier millimétré » que la vitrine publique
// (.mip-sci, globals.css) et sa bascule jour/nuit : c'est le premier écran après
// la connexion, il doit prolonger l'accueil plutôt que ressembler à un menu nu.
//
// Chaque carte dit ce que le projet EST : par où il est mesuré (SDK embarqué dans
// ses pages, ou extension navigateur), quels domaines sont déclarés, et si une
// anomalie court en ce moment. Les trois signaux viennent de lib/queries-projects.ts
// — trois requêtes pour toute la liste, pas trois par carte.
//
// RECETTE DU 26/09/2026. Un seul mot, « projet » (l'écran disait aussi « application »
// et « site ») ; les libellés de lib/project.ts ne sont plus affichés : ils répétaient
// le nom (« dogfooding »), nommaient un client, ou promettaient un suivi « temps réel »
// générique. « Snippet » était faux pour une application React Native : le SDK
// embarqué couvre le web et le mobile. Un projet sans aucune donnée propose d'abord
// d'installer le capteur, au lieu d'ouvrir une console vide.
import Link from "next/link";
import { redirect } from "next/navigation";
import { ECRANS_SESSION } from "@mip/console-contract";
import { ICON_PATHS, Icon, type IconName } from "@/components/icons";
import { ThemeToggle } from "@/components/ThemeToggle";
import { chargerProjets } from "@/lib/chargeurs/projets";
import { chargerEcran } from "@/lib/ecran";
import { pluriel } from "@/lib/format";
import type { ModeCollecte } from "@/lib/queries-projects";
import { selectProjectAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Habillage d'un mode de collecte : intitulé et icône. Ton NEUTRE pour tous : un
 * mode de collecte est un fait, pas un état — ni bon, ni à surveiller.
 */
const MODE: Record<ModeCollecte, { label: string; icon: IconName }> = {
  sdk: { label: "SDK embarqué", icon: "logs" },
  extension: { label: "Extension navigateur", icon: "grid" },
  mixte: { label: "SDK embarqué et extension", icon: "compare" },
  aucun: { label: "Aucune donnée reçue", icon: "info" },
};

export default async function SelectProject({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Le chargeur (`lib/chargeurs/projets.ts`) : les projets du périmètre et leurs signaux (C9).
  const ecran = await chargerEcran(ECRANS_SESSION.projets, chargerProjets, {});
  if (ecran.etat === "sans_session") redirect("/login");
  const { email, projets: projects, signaux, creation } = ecran;
  // Posé par le middleware quand l'URL nommait une app hors périmètre (P6.2) : le
  // refus est dit, au lieu d'ouvrir silencieusement un autre projet.
  const refus = (await searchParams).hors_perimetre;
  const horsPerimetre = typeof refus === "string" && refus.trim() ? refus.trim().slice(0, 200) : null;

  return (
    <main className="mip-sci min-h-screen px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-4xl">
        <header className="mb-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep shadow-glow">
            <Icon paths={ICON_PATHS.activity} className="h-5 w-5 text-white" strokeWidth={2.4} />
          </span>
          <div className="leading-tight">
            <div className="text-base font-bold tracking-tight text-ink">
              MIP <span className="text-accent">RUM</span>
            </div>
            <div className="text-[11px] uppercase tracking-[0.18em] text-ink-soft">
              Real User Monitoring
            </div>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2.5">
            <span className="hidden max-w-[16rem] truncate text-sm text-ink-soft sm:inline" title={email}>
              {email}
            </span>
            <ThemeToggle />
            <form action="/logout" method="post">
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                type="submit"
                title="Se déconnecter"
                aria-label="Se déconnecter"
              >
                <Icon paths={ICON_PATHS.logout} className="h-4 w-4" />
              </button>
            </form>
          </div>
        </header>

        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
          Choisissez un projet
        </h1>
        <p className="mt-2 max-w-2xl leading-relaxed text-ink-soft">
          Un projet est mesuré par le <strong className="font-semibold text-ink">SDK embarqué</strong>{" "}
          dans ses pages, ou par l&apos;<strong className="font-semibold text-ink">extension navigateur</strong>{" "}
          installée sur les postes, sans toucher au site. Chaque carte dit ce qui est réellement reçu
          et les domaines déclarés.
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
              Aucun projet accessible : demandez à un administrateur de vous en ouvrir un.
            </div>
          )}

          {projects.map((p) => {
            const s = signaux[p.app_id];
            const mode = s?.mode ?? "aucun";
            const m = MODE[mode];
            const alerte = (s?.anomalies ?? 0) > 0;
            // Sans aucune donnée, ouvrir la console montrerait des écrans vides : la
            // première action est d'installer le capteur (réservée à qui peut le faire).
            const aInstaller = mode === "aucun" && creation;

            return (
              <div
                key={p.app_id}
                data-testid="project-card"
                className="flex h-full flex-col rounded-xl border border-line bg-panel/85 p-5 shadow-card backdrop-blur-sm"
              >
                <span className="text-base font-semibold text-ink">{p.name}</span>

                {/* Par où ce projet est mesuré — le fait, pas la déclaration */}
                <span className="mt-2.5 inline-flex w-fit items-center gap-1.5 rounded-lg border border-line bg-panel2 px-2 py-1 text-[11px] font-semibold text-ink-soft">
                  <Icon paths={ICON_PATHS[m.icon]} className="h-3.5 w-3.5" strokeWidth={2.2} />
                  {m.label}
                </span>

                {/* Un périmètre extension déclaré qui ne produit rien mérite
                    d'être dit : c'est le symptôme d'une intégration à finir. */}
                {s?.extensionDeclaree && s.mode !== "extension" && s.mode !== "mixte" && (
                  <span className="mt-1.5 text-[11px] text-ink-soft">
                    Extension déclarée, aucune session encore reçue par elle
                  </span>
                )}

                {/* Ce qui est déclaré comme surveillé */}
                {s?.domaines.length ? (
                  <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Domaines déclarés">
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
                  <span className="mt-3 text-[11px] text-ink-soft">Aucun domaine déclaré</span>
                )}

                {/* Alerte : anomalie de LCP en cours, calculée à la volée */}
                {alerte && (
                  <span className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-lg border border-bad/40 bg-bad/10 px-2 py-1 text-[11px] font-semibold text-bad-ink">
                    <Icon paths={ICON_PATHS.alert} className="h-3.5 w-3.5" strokeWidth={2.4} />
                    {pluriel(s.anomalies, "anomalie")} de LCP sur 24 h
                  </span>
                )}

                {mode === "aucun" && !creation && (
                  <p className="mt-3 text-[12px] leading-relaxed text-ink-soft">
                    Aucune donnée reçue : l&apos;installation du capteur se fait par un administrateur.
                  </p>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-4">
                  {aInstaller && (
                    <Link
                      href={`/select/new?app=${encodeURIComponent(p.app_id)}`}
                      data-testid="project-installer"
                      className="btn-accent inline-flex items-center gap-1 px-3 py-1.5 text-sm"
                    >
                      Installer le capteur
                      <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
                    </Link>
                  )}
                  <form action={selectProjectAction}>
                    <input type="hidden" name="app" value={p.app_id} />
                    <button
                      type="submit"
                      data-testid="project-open"
                      className="inline-flex items-center gap-1 rounded-lg text-sm font-medium text-perf transition hover:gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      Ouvrir la console
                      <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </div>
            );
          })}

          {creation && (
            <Link
              href="/select/new"
              data-testid="add-site"
              className="group flex min-h-[9.5rem] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-panel/40 p-5 text-center backdrop-blur-sm transition hover:border-accent/50 hover:bg-panel/70"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-2xl font-light text-accent-ink transition group-hover:bg-accent/20">
                +
              </span>
              <span className="mt-2 text-sm font-semibold text-ink">Ajouter un projet</span>
              <span className="mt-0.5 text-xs text-ink-soft">SDK embarqué ou extension navigateur</span>
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
