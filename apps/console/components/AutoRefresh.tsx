"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

/**
 * Effet « live » : re-fetch des server components toutes les 5 s (PLAN §9.2).
 *
 * Onglet caché : aucune requête ; au retour, un rafraîchissement immédiat. Un
 * rafraîchissement encore en cours n'en empile jamais un second : sur un écran
 * lent, les requêtes se chevauchaient et retardaient d'autant la navigation.
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible" || pendingRef.current) return;
      startTransition(() => router.refresh());
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    const id = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router, intervalMs]);
  return null;
}
