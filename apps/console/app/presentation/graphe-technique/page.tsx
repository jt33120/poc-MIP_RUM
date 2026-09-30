// Page « Graphe technique » (/presentation/graphe-technique) : la cartographie
// interactive de tout MIP RUM (components/presentation/cartographie, 30/09/2026),
// sa version texte, puis le texte d'explication des anciennes pages publiques,
// rassemblé (components/presentation/GrapheTechnique.tsx).
// Chemin PUBLIC (lib/vitrine-navigation.ts) ; /presentation/dossier et
// /presentation/archive y sont redirigés (next.config.mjs).
//
// `force-dynamic` : la session se lit à chaque requête (l'action proposée en dépend),
// le relevé calcule son âge au jour de la visite, et les spécifications lisent l'état
// du planificateur.
import type { Metadata } from "next";
import { CartographieChargee } from "@/components/presentation/cartographie/CartographieChargee";
import { InventaireCarte } from "@/components/presentation/cartographie/InventaireCarte";
import { GrapheTechnique } from "@/components/presentation/GrapheTechnique";
import { PageVitrine } from "@/components/presentation/vitrine/PageVitrine";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";
import { DEPOT_GITHUB } from "@/lib/vitrine-navigation";

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
          Tout MIP RUM,
          <br />
          <span className="text-[#f89101]">sur une seule carte.</span>
        </>
      }
      chapeau={
        <>
          Des capteurs chez le client jusqu&apos;à la console : chaque service, chaque table, chaque protection et
          chaque test, reliés. Cliquez un élément pour ses faits et leurs sources dans le dépôt ; suivez un parcours
          pour voir une mesure, une alerte ou un déploiement traverser le système.
        </>
      }
    >
      <section className="mx-auto max-w-[96rem] px-4 pb-16 sm:px-6" aria-label="Cartographie de MIP RUM">
        <CartographieChargee depot={DEPOT_GITHUB} />
        <InventaireCarte depot={DEPOT_GITHUB} />
      </section>
      <div className="mx-auto max-w-6xl px-4 pb-8 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#fbbc64]">Le détail, en texte</p>
        <h2 className="mt-3 max-w-3xl text-2xl font-bold text-white sm:text-3xl">
          Ce que fait l&apos;outil, où sont les données, ce qu&apos;il contient et ce qu&apos;il sait faire.
        </h2>
      </div>
      <GrapheTechnique user={user} demoOuverte={methodes.demo} />
    </PageVitrine>
  );
}
