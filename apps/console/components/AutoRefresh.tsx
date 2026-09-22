"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { sansRafraichissement } from "@/lib/surfaces";

/** « 14:03:27 » en UTC : l'heure de lecture se dit dans le fuseau des fenêtres (V6). */
function heureUtc(d: Date): string {
  return d.toISOString().slice(11, 19);
}

/**
 * Effet « live » : re-fetch des server components toutes les 5 s (PLAN §9.2), et
 * la pastille qui le dit.
 *
 * Onglet caché : aucune requête ; au retour, un rafraîchissement immédiat. Un
 * rafraîchissement encore en cours n'en empile jamais un second : sur un écran
 * lent, les requêtes se chevauchaient et retardaient d'autant la navigation.
 *
 * Routes à lecture explicite (`SANS_RAFRAICHISSEMENT`, § 3.11) : aucun
 * rafraîchissement automatique — un Explorer exécuté ou un tableau de bord ne
 * change pas sous le curseur. La pastille devient « Lecture à la demande », avec
 * l'heure de la dernière lecture et un bouton « Relire ».
 */
export function AutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const aLaDemande = sansRafraichissement(pathname);
  const [pending, startTransition] = useTransition();
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Heure de la dernière lecture, posée côté client seulement : rendue au serveur,
  // elle différerait de celle du navigateur et casserait l'hydratation.
  const [lu, setLu] = useState<Date | null>(null);
  const requete = sp.toString();

  useEffect(() => {
    if (!pending) setLu(new Date());
  }, [pending, pathname, requete]);

  useEffect(() => {
    if (aLaDemande) return;
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
  }, [router, intervalMs, aLaDemande]);

  if (!aLaDemande) {
    return (
      <span
        className="flex items-center gap-2 rounded-full border border-good/30 bg-good/10 px-2.5 py-1 text-[11px] font-semibold text-good-ink"
        title="Données rafraîchies automatiquement toutes les 5 secondes"
        data-testid="rafraichissement"
        data-mode="live"
      >
        <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-good" />
        LIVE · 5 s
      </span>
    );
  }

  return (
    <span
      className="flex min-w-0 items-center gap-2 rounded-full border border-line bg-panel2 py-0.5 pl-2.5 pr-0.5 text-[11px] font-semibold text-ink-soft"
      data-testid="rafraichissement"
      data-mode="demande"
    >
      <span className="min-w-0 truncate" title="Cet écran n'est relu que sur demande : le résultat ne change pas sous le curseur.">
        Lecture à la demande{lu && <span className="hidden sm:inline"> · Lu à {heureUtc(lu)} UTC</span>}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={pending}
        className="shrink-0 rounded-full border border-line bg-panel px-2 py-0.5 text-[11px] font-semibold text-ink transition hover:border-perf/40 disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
      >
        {pending ? "Lecture…" : "Relire"}
      </button>
    </span>
  );
}
