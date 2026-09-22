// Page « Présentation ». Deux visages selon l'authentification :
//   - visiteur NON connecté  -> site de présentation public (composant Landing),
//     une vraie page d'accueil produit qui scrolle, avec connexion en haut à droite.
//   - utilisateur connecté    -> rappel de l'outil DANS la coquille console
//     (sidebar + main déjà rembourré), porte d'entrée avant le poste de pilotage.
import Link from "next/link";
import { AddClientCarousel } from "@/components/AddClientCarousel";
import { GlossaryTip } from "@/components/GlossaryTip";
import { ICON_PATHS, Icon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { PipelineStep } from "@/components/presentation/PipelineStep";
import { Landing } from "@/components/presentation/Landing";
import { getUser } from "@/lib/auth";
import { PIPELINE, STATS } from "@/lib/presentation-content";

export const dynamic = "force-dynamic";

export default async function Presentation() {
  const user = await getUser();

  // Vitrine PUBLIQUE : le layout rend le visiteur non connecté dans une coquille
  // nue — on habille donc nous-mêmes la page d'accueil.
  if (!user) return <Landing />;

  const isAdmin = user.role === "admin";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="MIP RUM — Real User Monitoring"
        help="rum"
        sub={
          <>
            Monitoring de l'expérience réelle, OpenTelemetry-natif, données en UE. Cette page présente
            l'outil ; le poste de pilotage est sur{" "}
            <Link href="/" className="font-medium text-accent-ink underline-offset-2 hover:underline">
              la Vue d'ensemble
            </Link>
            .
          </>
        }
      >
        <Link href="/" className="btn-accent px-4 py-2">
          Ouvrir la console →
        </Link>
      </PageHeader>

      {/* Qu'est-ce que le RUM ------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Qu'est-ce que le RUM ?
          <GlossaryTip id="rum" />
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
          Le <strong>Real User Monitoring</strong> mesure la performance et les erreurs <strong>réellement
          vécues par vos utilisateurs</strong> en production — pas une sonde de laboratoire. On capte ce que
          vivent les vrais visiteurs (vitesse d'affichage, réactivité, bugs JavaScript, parcours) : c'est
          cette expérience-là, et non celle d'un robot, que la console restitue.
        </p>
      </section>

      {/* Stack technique ---------------------------------------------------- */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">La stack technique en quelques mots</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {[
            "SDK navigateur (Web Vitals API, rrweb)",
            "OpenTelemetry · OTLP/HTTP",
            "Collecte : route de la console, Vercel (Francfort)",
            "Travaux planifiés et MCP : Railway (Amsterdam)",
            "PostgreSQL",
            "Console Next.js 15 / React 19",
            // Ce qui est vrai : la donnée est en UE (Neon, Francfort). Ce qui ne
            // l'est pas : la souveraineté — Neon, Vercel et Railway sont de droit
            // américain, même si les fonctions serveur tournent en fra1 (vercel.json).
            "Base de données en UE — Francfort",
          ].map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-line bg-panel2 px-3 py-1 font-medium text-ink-soft"
            >
              {chip}
            </span>
          ))}
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-ink-faint">
          Tout repose sur des standards ouverts (OpenTelemetry) : pas de format propriétaire, pas
          d'enfermement fournisseur, et une compatibilité immédiate avec l'écosystème observabilité existant.
        </p>
      </section>

      {/* Comment ça fonctionne --------------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Comment ça fonctionne — du navigateur à la décision
        </h2>
        <div className="flex flex-col gap-3 xl:flex-row xl:gap-6">
          {PIPELINE.map((step, i) => (
            <PipelineStep key={step.title} step={step} last={i === PIPELINE.length - 1} />
          ))}
        </div>
      </section>

      {/* Ajouter un client — tutoriel pas-à-pas (carrousel) ----------------- */}
      <section className="mb-6">
        <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Ajouter un client en 6 étapes
        </h2>
        <p className="mb-3 max-w-3xl text-sm text-ink-soft">
          De la création de l'app au premier graphe : ce qu'il faut faire, concrètement, pour brancher
          un nouveau site et le rendre monitorable.
        </p>
        <AddClientCarousel isAdmin={isAdmin} />
      </section>

      {/* Les statistiques montrées ----------------------------------------- */}
      <section className="mb-6">
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Les statistiques montrées
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="card group flex flex-col p-4 transition hover:shadow-pop"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent-ink">
                  <Icon paths={ICON_PATHS[s.icon]} className="h-4 w-4" />
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-ink">
                  {s.label}
                  <GlossaryTip id={s.id} />
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
              <span className="mt-auto pt-2 text-[11px] font-semibold text-accent-ink opacity-0 transition group-hover:opacity-100">
                Ouvrir →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
