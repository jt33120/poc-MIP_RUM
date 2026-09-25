"use client";
// Révocation d'un jeton de CI (P5.4) : confirmation, server action (la commande
// `revoquerJetonSourcemap`, C9), puis relecture serveur de la liste. La ligne reste
// visible, marquée révoquée.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { revoquerJetonSourcemapAction } from "@/app/admin/sourcemaps/actions";

export function TokenRevokeButton({ id, name, appId }: { id: string; name: string; appId: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<"repos" | "envoi" | "echec">("repos");

  async function revoquer() {
    if (!window.confirm(`Révoquer le jeton « ${name} » ? La CI qui l'utilise ne pourra plus envoyer de source maps.`)) {
      return;
    }
    setEtat("envoi");
    try {
      const res = await revoquerJetonSourcemapAction(appId, id);
      if (!res.ok) {
        setEtat("echec");
        return;
      }
      setEtat("repos");
      router.refresh();
    } catch {
      setEtat("echec");
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={revoquer}
        disabled={etat === "envoi"}
        className="btn-ghost px-2 py-1 text-bad-ink"
        aria-label={`Révoquer le jeton ${name}`}
      >
        {etat === "envoi" ? "Révocation…" : "Révoquer"}
      </button>
      {etat === "echec" && (
        <span role="alert" className="text-xs text-bad-ink">
          Échec : réessayer
        </span>
      )}
    </span>
  );
}
