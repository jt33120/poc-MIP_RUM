// « Installation » (/presentation/installation) : les trois façons de poser MIP RUM,
// lisibles sans compte ; chacune a sa page (components/presentation/installation/).
import type { Metadata } from "next";
import { CartesParcours } from "@/components/presentation/installation/DocInstallation";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MIP RUM — Installation" };

export default async function Installation() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId="page-installation"
      surtitre="Installation"
      titre={
        <>
          Trois façons de mesurer,
          <br />
          <span className="text-[#f89101]">une seule console.</span>
        </>
      }
      chapeau={
        <>
          Le code de suivi mesure tous les visiteurs ; l&apos;extension, les postes où elle est installée ; l&apos;agent
          serveur relie chaque appel du navigateur à sa part côté serveur. Les trois se cumulent.
        </>
      }
    >
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <CartesParcours />
        <p className="mt-8 text-sm text-white/60">
          Connecté, la page <strong className="font-semibold text-white/85">Installer</strong> de la console reprend ces
          parcours avec les valeurs de votre application, et un test en direct qui passe au vert quand les données
          arrivent.
        </p>
      </section>
    </PageVitrine>
  );
}
