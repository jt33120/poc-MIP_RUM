"use client";
// LA RELECTURE EN DIRECT DE LA CONSOLE : `router.refresh()` à intervalle fixe (les
// server components sont relus, la page garde son état client), jamais onglet
// masqué — au retour, une relecture immédiate —, et jamais deux à la fois : sur un
// écran lent, les relectures se chevauchaient et retardaient d'autant la navigation.
//
// Extrait d'`AutoRefresh` (la pastille « LIVE · 5 s » de toutes les pages) pour que
// `/installer` réutilise le même mécanisme en le BORNANT : `autoriser` est consulté
// à chaque tic, et la page y compte ses relectures pour s'arrêter au vert ou au bout
// de 10 minutes (la base est payée à l'usage).
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useTransition } from "react";

export function useRelecturePeriodique({
  actif,
  intervalMs = 5000,
  autoriser,
}: {
  actif: boolean;
  intervalMs?: number;
  /** Consulté à chaque tic, onglet visible et aucune relecture en cours : `false` la saute. */
  autoriser?: () => boolean;
}): { pending: boolean; relire: () => void } {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Lu au tic, pas figé à la pose de l'intervalle : la page peut changer de règle
  // (un autre parcours affiché) sans que l'intervalle soit refait.
  const autoriserRef = useRef(autoriser);
  autoriserRef.current = autoriser;
  const relire = useCallback(() => startTransition(() => router.refresh()), [router]);

  useEffect(() => {
    if (!actif) return;
    const tick = () => {
      if (document.visibilityState !== "visible" || pendingRef.current) return;
      if (autoriserRef.current && !autoriserRef.current()) return;
      relire();
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
  }, [actif, intervalMs, relire]);

  return { pending, relire };
}
