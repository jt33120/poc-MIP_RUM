"use client";
// Échec de l'écran « Mobile » (F02, § 3.8) : corps commun dans `ErreurEcran`.
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErreurEcran titre="Mobile" detail="La lecture est restée bornée. Un taux calculé sur une lecture interrompue se lirait comme une mesure." {...props} />;
}
