// Un parcours d'installation, présenté (/presentation/installation/sdk-javascript |
// extension | serveur) : l'installation en une phrase, l'essentiel en quatre chiffres,
// puis un tutoriel animé de l'installation assistée par IA (lib/installation-faits.ts).
// La check-list détaillée, codes compris, reste dans la console (/installer) : elle a
// besoin des valeurs de l'application, qu'une page publique ne connaît pas.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OngletsInstallation } from "@/components/presentation/installation/OngletsInstallation";
import { TutorielInstallation } from "@/components/presentation/installation/TutorielInstallation";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { FICHES } from "@/lib/installation-faits";
import { LIBELLE_PARCOURS } from "@/lib/installer";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { parcoursDuSegment } from "@/lib/vitrine-navigation";

export const dynamic = "force-dynamic";

type Params = Promise<{ parcours: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const p = parcoursDuSegment((await params).parcours);
  return { title: p ? `MIP RUM — Installation : ${LIBELLE_PARCOURS[p]}` : "MIP RUM — Installation" };
}

export default async function ParcoursPublic({ params }: { params: Params }) {
  const parcours = parcoursDuSegment((await params).parcours);
  if (!parcours) notFound();
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  const fiche = FICHES[parcours];
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId={`page-parcours-${parcours}`}
      surtitre="Installation"
      titre={LIBELLE_PARCOURS[parcours]}
      chapeau={fiche.accroche}
    >
      <OngletsInstallation courant={parcours} />

      {/* L'essentiel, en quatre chiffres. */}
      <section aria-label="L'essentiel" className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
        <ul className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 lg:grid-cols-4" data-testid="faits-parcours">
          {fiche.faits.map((f) => (
            <li key={f.valeur} className="bg-[#050d24] p-6">
              <p className="text-3xl font-extrabold tracking-[-0.03em] text-white">{f.valeur}</p>
              <p className="mt-2 text-sm leading-relaxed text-white/60">{f.libelle}</p>
            </li>
          ))}
        </ul>
      </section>

      <TutorielInstallation parcours={parcours} etapes={fiche.etapes} />

      {/* La voie manuelle : la check-list de la console. */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-5">
          <p className="min-w-0 flex-1 text-sm leading-relaxed text-white/70">
            <strong className="font-semibold text-white">Plutôt à la main ?</strong> La page Installer de la console garde
            la check-list détaillée, étape par étape, codes à copier compris, et le même test en direct.
          </p>
          {/* <a> : la console a sa propre coquille, qu'une navigation client ne monterait pas. */}
          <a href="/installer" className="rounded-full border border-white/25 px-4 py-2 text-sm font-semibold text-white transition hover:border-[#f89101] hover:bg-[#f89101]/10">
            Ouvrir la console →
          </a>
        </div>
      </section>
    </PageVitrine>
  );
}
