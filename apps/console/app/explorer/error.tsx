"use client";
// Échec de l'écran « Explorer » (F02, § 3.8) : corps commun dans `ErreurEcran`.
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErreurEcran titre="Explorer" detail="La requête n'a pas pu être exécutée jusqu'au bout." {...props} />;
}
