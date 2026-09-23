// Page « Présentation » : la vitrine publique, UNE page pour tous (plan § 8.2, P**.2).
//
// Visiteur ou connecté, c'est le même composant et les mêmes parties : seule
// l'action proposée change (« Ouvrir la console » au lieu de la démo et de la
// connexion), et, dans la partie 1, les écrans deviennent des liens. La seconde
// rédaction qu'avait le connecté disparaît : /presentation est un chemin public
// (lib/chemins-publics.ts), que le layout ne met jamais dans la coquille de la
// console, et elle disait autre chose que la vitrine.
//
// `force-dynamic` : la session se lit à chaque requête, et la ligne de relevé
// (Releve.tsx) calcule l'âge du document de couverture au jour de la visite.
import { Landing } from "@/components/presentation/Landing";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Presentation() {
  const user = await getUser();
  return <Landing user={user} />;
}
