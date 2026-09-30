// Étape préliminaire : choix du projet à superviser. Rendue AVANT les menus —
// RUM et analyse IA sont propres à un projet, il n'existe pas de vue « toutes
// les apps ». Plein écran, sans sidebar (le layout masque sa coquille sur /select).
//
// Fond uni (recette du 30/09/2026) : le quadrillage de la vitrine n'apportait
// rien ici et brouillait la lecture des cartes. « Ajouter un projet » est à côté
// du titre, pas au bout de la grille : avec une longue liste, il fallait défiler.
//
// Chaque carte dit ce que le projet EST : par où il est mesuré (SDK embarqué dans
// ses pages, ou extension navigateur), quels domaines sont déclarés, et son état
// en un coup d'œil — un voyant, les sessions des dernières 24 h et leurs sept
// derniers jours. Les trois signaux viennent de lib/queries-projects.ts
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
import { depuis } from "@/lib/chaine-mesure";
import { fmtNombre, pluriel } from "@/lib/format";
import type { ModeCollecte, SignauxProjet } from "@/lib/queries-projects";
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

type Ton = "good" | "warn" | "bad" | "neutre";

/**
 * Couleur du voyant, par ton. Les barres restent neutres : elles disent un volume,
 * pas un état — les teindre en rouge pour une anomalie de LCP ferait lire une
 * chute de trafic qui n'existe pas.
 */
const TON: Record<Ton, { point: string; texte: string }> = {
  good: { point: "bg-good", texte: "text-good-ink" },
  warn: { point: "bg-warn", texte: "text-warn-ink" },
  bad: { point: "bg-bad", texte: "text-bad-ink" },
  neutre: { point: "bg-ink-faint", texte: "text-ink-soft" },
};

/**
 * L'état d'un projet en une ligne. Une anomalie passe avant le silence : c'est
 * elle qu'on vient voir. « Silencieux » = rien depuis 24 h alors que le projet a
 * déjà reçu des données — la collecte s'est peut-être arrêtée.
 */
function etat(s: SignauxProjet | undefined, maintenant: number): { ton: Ton; label: string } {
  if (!s || s.mode === "aucun") return { ton: "neutre", label: "En attente de données" };
  const derniere = s.derniereDonnee ? ` · ${depuis(s.derniereDonnee, maintenant)}` : "";
  if (s.anomalies > 0) return { ton: "bad", label: `${pluriel(s.anomalies, "anomalie")} de LCP sur 24 h` };
  if ((s.sessionsParJour.at(-1) ?? 0) === 0) return { ton: "warn", label: `Silencieux${derniere}` };
  return { ton: "good", label: `Actif${derniere}` };
}

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

  const maintenant = Date.now();

  return (
    <main className="min-h-screen bg-panel px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-10 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-accent-deep">
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Mes projets</h1>
          {creation && (
            <Link
              href="/select/new"
              data-testid="add-site"
              className="btn-accent inline-flex items-center gap-1.5 px-3.5 py-2 text-sm"
            >
              <span aria-hidden className="text-lg leading-none">+</span>
              Ajouter un projet
            </Link>
          )}
        </div>
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

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.length === 0 && (
            <div className="rounded-xl border border-line p-6 text-sm text-ink-soft sm:col-span-2 lg:col-span-3">
              Aucun projet accessible : demandez à un administrateur de vous en ouvrir un.
            </div>
          )}

          {projects.map((p) => {
            const s = signaux[p.app_id];
            const mode = s?.mode ?? "aucun";
            const m = MODE[mode];
            const e = etat(s, maintenant);
            const ton = TON[e.ton];
            const jours = s?.sessionsParJour ?? [];
            const sommet = Math.max(1, ...jours);
            const sessions24h = jours.at(-1) ?? 0;
            // Sans aucune donnée, ouvrir la console montrerait des écrans vides : la
            // première action est d'installer le capteur (réservée à qui peut le faire).
            const aInstaller = mode === "aucun" && creation;

            return (
              <div
                key={p.app_id}
                data-testid="project-card"
                className="flex h-full flex-col rounded-xl border border-line bg-panel p-5 transition hover:border-ink-faint/60 hover:shadow-card"
              >
                <span className="text-base font-semibold leading-snug text-ink">{p.name}</span>

                {/* Par où il est mesuré (ce qui est reçu, pas déclaré), et ce qui est déclaré comme surveillé */}
                <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-soft">
                  <Icon paths={ICON_PATHS[m.icon]} className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
                  <span className="shrink-0">{mode === "aucun" ? "Aucun capteur" : m.label}</span>
                  <span aria-hidden>·</span>
                  <span
                    className="min-w-0 truncate font-mono"
                    aria-label="Domaines déclarés"
                    title={s?.domaines.join(", ")}
                  >
                    {s?.domaines.length ? s.domaines.join(", ") : "aucun domaine déclaré"}
                  </span>
                </p>

                {/* L'aperçu de santé : le volume des dernières 24 h et sa tendance sur 7 jours */}
                <div className="mt-5 flex items-end justify-between gap-4">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
                      {mode === "aucun" ? "—" : fmtNombre(sessions24h, 0)}
                    </div>
                    <div className="text-[11px] text-ink-soft">sessions sur 24 h</div>
                  </div>
                  <div
                    className="flex h-10 items-end gap-1"
                    role="img"
                    aria-label={`Sessions des 7 derniers jours : ${jours.join(", ")}`}
                  >
                    {jours.map((n, i) => (
                      <span
                        key={i}
                        className={`w-2.5 rounded-sm ${n > 0 ? (i === jours.length - 1 ? "bg-perf" : "bg-perf/35") : "bg-line"}`}
                        style={{ height: `${Math.max(6, (n / sommet) * 100)}%` }}
                      />
                    ))}
                  </div>
                </div>

                <div className={`mt-4 flex items-center gap-2 text-xs font-medium ${ton.texte}`}>
                  <span className={`h-2 w-2 shrink-0 rounded-full ${ton.point}`} aria-hidden />
                  <span className="truncate">{e.label}</span>
                </div>

                {/* Un périmètre extension déclaré qui ne produit rien mérite
                    d'être dit : c'est le symptôme d'une intégration à finir. */}
                {s?.extensionDeclaree && s.mode !== "extension" && s.mode !== "mixte" && (
                  <p className="mt-1.5 text-[11px] text-ink-soft">
                    Extension déclarée, aucune session encore reçue par elle
                  </p>
                )}

                {mode === "aucun" && !creation && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-soft">
                    L&apos;installation du capteur se fait par un administrateur.
                  </p>
                )}

                <div className="min-h-4 flex-1" aria-hidden />
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3.5">
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
                  <form action={selectProjectAction} className="ml-auto">
                    <input type="hidden" name="app" value={p.app_id} />
                    <button
                      type="submit"
                      data-testid="project-open"
                      className="inline-flex items-center gap-1 rounded-lg text-sm font-medium text-perf transition hover:gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
                    >
                      Ouvrir
                      <Icon paths={ICON_PATHS.chevronRight} className="h-4 w-4" />
                    </button>
                  </form>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
