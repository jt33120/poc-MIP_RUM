// La vitrine d'avant la refonte « démo » du 30/09/2026, gardée lisible le temps que
// son texte trouve sa nouvelle place. Publique comme elle l'était, mais hors des
// moteurs de recherche : ce n'est plus la page d'accueil.
import type { Metadata } from "next";
import { LandingArchive } from "@/components/presentation/archive/LandingArchive";
import { getUser } from "@/lib/auth";
import { methodesConnexion } from "@/lib/methodes-connexion";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function PresentationArchive() {
  const [user, methodes] = await Promise.all([getUser(), methodesConnexion()]);
  return <LandingArchive user={user} demoOuverte={methodes.demo} />;
}
