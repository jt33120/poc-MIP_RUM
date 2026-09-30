// Un parcours d'installation, en documentation publique
// (/presentation/installation/sdk-javascript | extension | serveur) : les étapes de
// /installer, sur l'application d'exemple (DocInstallation.tsx).
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { CartesParcours, PanneauParcours } from "@/components/presentation/installation/DocInstallation";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { LIBELLE_PARCOURS } from "@/lib/installer";
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
  const [user, methodes, h] = await Promise.all([getUser(), methodesConnexion(), headers()]);
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId={`page-parcours-${parcours}`}
      surtitre="Installation"
      titre={LIBELLE_PARCOURS[parcours]}
      chapeau={
        <>
          Les étapes, sur une application d&apos;exemple : <code className="chip-mono">votre-application</code> et le
          repère de la clé sont à remplacer par les vôtres. Connecté, la page Installer de la console les remplit.
        </>
      }
    >
      <div className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <CartesParcours courant={parcours} />
        <section aria-label={`Parcours : ${LIBELLE_PARCOURS[parcours]}`} className="mt-10 rounded-3xl border border-white/10 bg-panel/70 p-5 sm:p-8">
          <PanneauParcours parcours={parcours} host={h.get("host") ?? "localhost:3000"} />
        </section>
      </div>
    </PageVitrine>
  );
}
