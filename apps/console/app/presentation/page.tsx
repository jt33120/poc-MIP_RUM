// Page d'accueil « Présentation » — explique ce qu'est l'outil (RUM), sa stack
// en quelques mots, son fonctionnement, comment brancher un nouveau client
// (carrousel pas-à-pas), et les statistiques restituées. Sert de porte d'entrée
// pour un visiteur (commercial, prospect, nouvel utilisateur) avant le poste de
// pilotage (Overview). Rendu serveur ; seul `isAdmin` conditionne le CTA admin.
import Link from "next/link";
import { AddClientCarousel } from "@/components/AddClientCarousel";
import { GlossaryTip } from "@/components/GlossaryTip";
import { ICON_PATHS, Icon } from "@/components/icons";
import { PageHeader } from "@/components/PageHeader";
import { PipelineStep } from "@/components/presentation/PipelineStep";
import { getUser } from "@/lib/auth";
import { PIPELINE, STATS } from "@/lib/presentation-content";

export const dynamic = "force-dynamic";

export default async function Presentation() {
  const user = await getUser();
  const isAdmin = user?.role === "admin";

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="MIP RUM — Real User Monitoring"
        help="rum"
        sub={
          <>
            Monitoring de l'expérience réelle, OpenTelemetry-natif et souverain UE. Cette page présente
            l'outil ; le poste de pilotage est sur <Link href="/" className="font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">la Vue d'ensemble</Link>.
          </>
        }
      />

      {/* Qu'est-ce que le RUM ------------------------------------------------ */}
      <section className="card mb-6 p-5">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          Qu'est-ce que le RUM ?
          <GlossaryTip id="rum" />
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink-soft">
          Le <strong>Real User Monitoring</strong> mesure la performance et les erreurs <strong>réellement
          vécues par vos utilisateurs</strong> en production — pas une sonde de laboratoire. On capte ce que
          vivent les vrais visiteurs (vitesse d'affichage, réactivité, bugs JavaScript, parcours), parce que
          c'est cette expérience-là qui pèse sur la conversion et la satisfaction. Un site rapide convertit
          mieux : le RUM le prouve avec des chiffres terrain.
        </p>
      </section>

      {/* Stack technique ---------------------------------------------------- */}
      <section className="card mb-6 p-5">
        <h2 className="text-sm font-semibold text-ink">La stack technique en quelques mots</h2>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {[
            "SDK navigateur (Web Vitals API, rrweb)",
            "OpenTelemetry · OTLP/HTTP",
            "Ingestion Deno / Node",
            "PostgreSQL → ClickHouse",
            "Console Next.js 15 / React 19",
            "Souverain UE",
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
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-accent-deep dark:text-accent">
                  <Icon paths={ICON_PATHS[s.icon]} className="h-4 w-4" />
                </span>
                <span className="flex items-center gap-1 text-sm font-semibold text-ink">
                  {s.label}
                  <GlossaryTip id={s.id} />
                </span>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-ink-soft">{s.desc}</p>
              <span className="mt-auto pt-2 text-[11px] font-semibold text-accent-deep opacity-0 transition group-hover:opacity-100 dark:text-accent">
                Ouvrir →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
