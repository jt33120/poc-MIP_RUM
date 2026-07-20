"use client";
// Player rrweb (composant Svelte compilé, manipule window/document) : import
// dynamique côté client uniquement (no SSR), monté sur les events reconstruits
// par /api/replay/[sessionId] (gunzip + concat côté serveur).
import { useEffect, useRef, useState } from "react";
import "rrweb-player/dist/style.css";

type PlayerCtor = new (opts: {
  target: HTMLElement;
  props: Record<string, unknown>;
}) => { $destroy?: () => void };

type State = "loading" | "empty" | "error" | "ready";

export default function ReplayPlayer({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<State>("loading");
  const [eventCount, setEventCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let player: { $destroy?: () => void } | null = null;

    (async () => {
      try {
        const res = await fetch(`/api/replay/${encodeURIComponent(sessionId)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events?: unknown[] };
        const events = data.events ?? [];
        if (cancelled) return;
        if (events.length < 2) {
          // rrweb exige ≥ 2 events (meta + full snapshot) pour rejouer
          setState("empty");
          return;
        }
        const mod = (await import("rrweb-player")) as unknown as { default: PlayerCtor };
        if (cancelled || !host.current) return;
        host.current.innerHTML = "";
        player = new mod.default({
          target: host.current,
          props: { events, autoPlay: false, width: 920, height: 520, showController: true },
        });
        setEventCount(events.length);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      player?.$destroy?.();
    };
  }, [sessionId]);

  return (
    <div
      className="card p-6"
      data-testid="replay-player"
      data-state={state}
      data-events={eventCount}
    >
      {state === "loading" && (
        <p className="py-8 text-center text-sm text-ink-faint">Chargement du replay…</p>
      )}
      {state === "empty" && (
        <div className="py-2" data-testid="replay-empty">
          <h3 className="text-sm font-bold tracking-tight">Aucun rejeu pour cette session</h3>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Le session replay est <strong>activé</strong>, mais aucun enregistrement n&apos;a été
            capturé pour cette session — le plus souvent une session trop courte, un signal{" "}
            <strong>DNT/GPC</strong> ou un consentement refusé, ou un navigateur sans{" "}
            <code className="rounded bg-panel2 px-1">CompressionStream</code>.
          </p>
          <p className="mt-3 max-w-2xl text-sm text-ink-soft">
            Quand un rejeu existe, les saisies sont <strong>masquées à l&apos;enregistrement</strong>{" "}
            (<code className="rounded bg-panel2 px-1">maskAllInputs</code>) et les blocs{" "}
            <code className="rounded bg-panel2 px-1">mip-rum-block</code> exclus ; chunks gzip stockés
            avec TTL 30 j (RGPD).
          </p>
        </div>
      )}
      {state === "error" && (
        <p className="py-8 text-center text-sm text-red-500 dark:text-red-400">
          Replay indisponible (erreur de chargement des chunks).
        </p>
      )}
      {state === "ready" && (
        <p className="mb-3 text-xs text-ink-soft">
          {eventCount} événements rrweb — saisies masquées à l&apos;enregistrement
          (maskAllInputs), blocs <code className="rounded bg-panel2 px-1">mip-rum-block</code>{" "}
          exclus.
        </p>
      )}
      {/* Le conteneur doit rester VISIBLE en permanence : rrweb-player mesure ses
          dimensions (iframe) au montage, or le player est instancié dans l'effet
          pendant que state vaut encore "loading". Le masquer via `hidden`
          (display:none) le montait en 0×0 → lecteur vide, contrôleur écrasé.
          Vide tant que le player n'est pas monté (hauteur nulle, invisible). */}
      <div ref={host} className="flex justify-center" />
    </div>
  );
}
