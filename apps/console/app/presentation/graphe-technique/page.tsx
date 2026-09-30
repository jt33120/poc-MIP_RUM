// Page « Graphe technique » (/presentation/graphe-technique) : le texte d'explication
// des anciennes pages publiques, rassemblé (components/presentation/GrapheTechnique.tsx).
// Chemin PUBLIC (lib/vitrine-navigation.ts) ; /presentation/dossier et
// /presentation/archive y sont redirigés (next.config.mjs).
//
// `force-dynamic` : la session se lit à chaque requête (l'action proposée en dépend),
// le relevé calcule son âge au jour de la visite, et les spécifications lisent l'état
// du planificateur.
import type { Metadata } from "next";
import { GrapheTechnique } from "@/components/presentation/GrapheTechnique";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MIP RUM — Graphe technique" };

export default async function PageGrapheTechnique() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return (
    <PageVitrine
      connecte={user !== null}
      demoOuverte={methodes.demo}
      testId="page-graphe"
      surtitre="Graphe technique"
      titre={
        <>
          Comment c&apos;est construit,
          <br />
          <span className="text-[#f89101]">ligne par ligne.</span>
        </>
      }
      chapeau={
        <>
          Ce que fait l&apos;outil, où sont les données, ce qu&apos;il contient et ce qu&apos;il sait faire, puis le
          registre des capacités et les spécifications. Ce qui reste à faire a sa propre page.
        </>
      }
    >
      <GrapheTechnique user={user} demoOuverte={methodes.demo} />
    </PageVitrine>
  );
}
