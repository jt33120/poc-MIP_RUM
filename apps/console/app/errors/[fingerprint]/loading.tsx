// Chargement de l'écran « Groupe d'erreurs » (F02, § 3.8) : corps commun dans `ChargementEcran`.
// Sans lui, le squelette de l'écran parent — et son titre — s'afficherait ici.
import { ChargementEcran } from "@/components/states/ChargementEcran";

export default function Chargement() {
  return <ChargementEcran titre="Groupe d'erreurs" />;
}
