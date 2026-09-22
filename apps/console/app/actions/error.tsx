"use client";
// Échec de l'écran « Actions » (F02, § 3.8) : corps commun dans `ErreurEcran`.
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErreurEcran titre="Actions" detail="Les agrégats causaux n'ont pas pu être chargés. Les données collectées ne sont pas modifiées." {...props} />;
}
