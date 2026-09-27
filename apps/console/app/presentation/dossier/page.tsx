// Page « Dossier technique » (/presentation/dossier) : le détail que la présentation
// résume (components/presentation/Dossier.tsx). Chemin PUBLIC, comme la présentation
// (lib/chemins-publics.ts) : lisible sans compte, jamais dans la coquille de la console.
//
// `force-dynamic` : la session se lit à chaque requête (l'action proposée en dépend),
// la ligne de relevé calcule l'âge du relevé au jour de la visite, et les
// spécifications lisent l'état du planificateur.
import type { Metadata } from "next";
import { Dossier } from "@/components/presentation/Dossier";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "MIP RUM — Dossier technique" };

export default async function DossierTechnique() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return <Dossier user={user} demoOuverte={methodes.demo} />;
}
