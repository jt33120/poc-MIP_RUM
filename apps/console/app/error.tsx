"use client";
// Échec de la Vue d'ensemble `/` (F02, § 3.8) — et filet commun des écrans qui
// n'ont pas leur propre `error.tsx` (administration, sélection de projet, pages
// publiques) : une frontière posée à la racine couvre toutes les routes filles.
// Sans elle, ces écrans tombaient sur le message anglais par défaut de Next
// (« Application error: a server-side exception has occurred »).
//
// Le titre suit donc le chemin : « Vue d'ensemble » à la racine, le nom de la
// console ailleurs — jamais le nom d'un écran qui n'est pas celui affiché.
import { usePathname } from "next/navigation";
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  const titre = usePathname() === "/" ? "Vue d'ensemble" : "Console MIP RUM";
  return <ErreurEcran titre={titre} {...props} />;
}
