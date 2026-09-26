// Page « Présentation » : la vitrine publique, UNE page pour tous (plan § 8.2, P**.2),
// réduite à deux ou trois écrans par la recette du 26/09/2026 ; le détail est dans le
// dossier technique (/presentation/dossier).
//
// Visiteur ou connecté, c'est le même composant : seule l'action proposée change
// (« Ouvrir la console » au lieu de la démo et de la connexion). /presentation est un
// chemin public (lib/chemins-publics.ts), que le layout ne met jamais dans la coquille
// de la console.
//
// `force-dynamic` : la session se lit à chaque requête, et le statut du POC calcule
// l'âge du relevé au jour de la visite.
import { Landing } from "@/components/presentation/Landing";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export default async function Presentation() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return <Landing user={user} demoOuverte={methodes.demo} />;
}
