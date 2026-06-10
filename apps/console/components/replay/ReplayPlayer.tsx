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
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      data-testid="replay-player"
      data-state={state}
      data-events={eventCount}
    >
      {state === "loading" && (
        <p className="py-8 text-center text-sm text-slate-400">Chargement du replay…</p>
      )}
      {state === "empty" && (
        <p className="py-8 text-center text-sm text-slate-400">
          Pas de replay pour cette session — enregistrement non activé (option{" "}
          <code className="rounded bg-slate-100 px-1">replay</code> du SDK) ou session
          non échantillonnée.
        </p>
      )}
      {state === "error" && (
        <p className="py-8 text-center text-sm text-red-500">
          Replay indisponible (erreur de chargement des chunks).
        </p>
      )}
      {state === "ready" && (
        <p className="mb-3 text-xs text-slate-500">
          {eventCount} événements rrweb — saisies masquées à l&apos;enregistrement
          (maskAllInputs), blocs <code className="rounded bg-slate-100 px-1">mip-rum-block</code>{" "}
          exclus.
        </p>
      )}
      <div ref={host} className={state === "ready" ? "flex justify-center" : "hidden"} />
    </div>
  );
}
