// « Installation » (/presentation/installation) : les trois façons de poser MIP RUM,
// lisibles sans compte ; chacune a sa page (components/presentation/installation/).
import type { Metadata } from "next";
import { CartesParcours } from "@/components/presentation/installation/DocInstallation";
import { SchemaInstallation } from "@/components/presentation/installation/SchemaInstallation";
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
          Comment installer le RUM
          <br />
          <span className="text-[#f89101]">sur votre application.</span>
        </>
      }
      chapeau={
        <>
          Côté navigateur, le SDK mesure ce que vivent vos visiteurs ; côté serveur, l&apos;agent OpenTelemetry relie
          chaque appel à sa part serveur. Survolez chaque côté pour voir les options.
        </>
      }
    >
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <SchemaInstallation />
        <h2 className="mb-5 mt-16 text-xl font-bold text-white">Les trois parcours, pas à pas</h2>
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
