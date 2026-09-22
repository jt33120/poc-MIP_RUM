// Chargement de l'écran « Carte » (F02, § 3.8) : corps commun dans `ChargementEcran`.
import { ChargementEcran } from "@/components/states/ChargementEcran";

export default function Chargement() {
  return <ChargementEcran titre="Carte" />;
}
