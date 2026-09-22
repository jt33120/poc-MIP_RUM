"use client";
// Échec de l'écran « Erreurs JS » (F02, § 3.8) : corps commun dans `ErreurEcran`.
// Couvre la liste ET le détail d'un groupe (et d'une issue) : aucune donnée partielle
// n'est montrée, un compteur à moitié calculé contredirait ceux de l'écran précédent.
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErreurEcran titre="Erreurs JS" {...props} />;
}
