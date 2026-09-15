"use client";
// Le layout racine choisit la coquille (nue ou console) côté serveur, mais Next ne
// le re-rend JAMAIS lors d'une navigation client : un <Link> qui franchit la
// frontière (vitrine -> console, console -> /select, /select/new -> /admin…)
// garde l'ancienne coquille autour de la nouvelle page — une console sans sidebar,
// ou une page plein écran sous la sidebar, jusqu'au rechargement.
//
// Ce garde recalcule côté client la coquille attendue pour le chemin courant et,
// si elle diffère de celle rendue, redemande l'arbre complet (router.refresh()
// re-rend depuis la racine, layout compris). Côté client on ignore la session,
// mais on n'en a pas besoin : hors /login et des chemins nus, le middleware ne
// laisse arriver une page qu'avec une session, donc dans la coquille console.
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { estCoquilleNue } from "@/lib/chemins-publics";

// Une seule tentative par (coquille, chemin), hors du composant parce que la
// bascule de coquille le remonte : si le serveur rendait durablement une autre
// coquille que celle prévue ici, on n'entre pas dans une boucle de refresh.
let derniereTentative: string | null = null;

export function CoquilleGarde({ rendue }: { rendue: "nue" | "console" }) {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const attendue = pathname === "/login" || estCoquilleNue(pathname) ? "nue" : "console";
    if (attendue === rendue) {
      derniereTentative = null;
      return;
    }
    const cle = `${rendue}:${pathname}`;
    if (derniereTentative === cle) return;
    derniereTentative = cle;
    router.refresh();
  }, [pathname, rendue, router]);
  return null;
}
