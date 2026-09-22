"use client";
// Échec du détail de session (F44, § 3.8 règle 3) : corps commun dans `ErreurEcran`.
// Plus proche que celui de `/sessions` : il nomme l'écran réellement en échec, et
// dit que la liste, elle, n'est pas touchée.
import Link from "next/link";
import { ErreurEcran } from "@/components/states/ErreurEcran";

export default function Erreur(props: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErreurEcran
      titre="Détail de session"
      detail={
        <>
          La liste des sessions reste lisible :{" "}
          <Link href="/sessions" className="text-brand hover:underline">
            ← Toutes les sessions
          </Link>
          .
        </>
      }
      {...props}
    />
  );
}
