"use client";
// Révocation d'un jeton de CI (P5.4) : confirmation, server action (la commande
// `revoquerJetonSourcemap`, C9), puis relecture serveur de la liste. La ligne reste
// visible, marquée révoquée.
//
// La confirmation est l'encadré de la page (`ConfirmationDanger`), plus la boîte
// `window.confirm()` du navigateur : même geste que les autres suppressions de la
// console, la cible nommée, et rien à « accepter » à l'aveugle dans les tests.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { revoquerJetonSourcemapAction } from "@/app/admin/sourcemaps/actions";
import { ConfirmationDanger } from "@/components/ConfirmationDanger";
import { entreGuillemets } from "@/lib/format";

export function TokenRevokeButton({ id, name, appId, scope }: { id: string; name: string; appId: string; scope?: string }) {
  const router = useRouter();
  const [echec, setEchec] = useState(false);

  async function revoquer() {
    setEchec(false);
    try {
      const res = await revoquerJetonSourcemapAction(appId, id);
      if (!res.ok) {
        setEchec(true);
        return;
      }
      router.refresh();
    } catch {
      setEchec(true);
    }
  }

  return (
    <span className="inline-flex items-start gap-2">
      <ConfirmationDanger
        libelle="Révoquer"
        libelleAccessible={`Révoquer le jeton ${name}`}
        question={`Révoquer le jeton ${entreGuillemets(name)}\u00a0?`}
        consequence={`La CI qui l’utilise ne pourra plus ${scope === "deploys:write" ? "déclarer de déploiement" : "envoyer de source maps"} ; un jeton révoqué ne se rétablit pas.`}
        confirmer="Révoquer le jeton"
        enCours="Révocation…"
        onConfirmer={revoquer}
        // Bouton de ligne compact (refonte du 01/10/2026) : la ligne du tableau reste à 32-34 px.
        classeDeclencheur="inline-flex items-center whitespace-nowrap rounded-md border border-bad/40 bg-panel px-2 py-0.5 text-[11px] font-medium leading-4 text-bad-ink transition hover:bg-bad/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bad/40"
      />
      {echec && (
        <span role="alert" className="text-xs text-bad-ink">
          Échec : réessayez.
        </span>
      )}
    </span>
  );
}
