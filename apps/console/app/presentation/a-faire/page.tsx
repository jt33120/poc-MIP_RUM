// Page « À faire » (/presentation/a-faire) : les hypothèses réductrices du POC, puis
// ce qui reste à faire (components/presentation/AFaire.tsx). Chemin PUBLIC
// (lib/vitrine-navigation.ts).
import type { Metadata } from "next";
import { AFaire } from "@/components/presentation/AFaire";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MIP RUM — À faire" };

export default async function PageAFaire() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId="page-a-faire"
      surtitre="À faire"
      titre={
        <>
          Ce que le POC simplifie,
          <br />
          <span className="text-[#f89101]">et ce qui reste à construire.</span>
        </>
      }
      chapeau={
        <>
          Un POC va vite en choisissant petit : une base provisoire, des travaux au quart d&apos;heure, une seule région.
          Voici ces choix, dits franchement, puis les chantiers qui séparent le POC d&apos;un outil en service.
        </>
      }
    >
      <AFaire />
    </PageVitrine>
  );
}
