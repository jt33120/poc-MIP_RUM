"use client";
// Rafraîchit la checklist d'onboarding (server component) tant que les données
// ne sont pas « live ». Corrige la promesse « rafraîchissement automatique » qui
// était affichée SANS aucun polling : le nouveau client colle son snippet et voit
// désormais la checklist passer au vert toute seule. S'arrête une fois live (pas
// de rafraîchissement inutile).
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function OnboardingPoll({ live, intervalMs = 5000 }: { live: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (live) return; // objectif atteint : on cesse de poller
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [live, intervalMs, router]);
  return null;
}
