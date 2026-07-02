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
        <div className="py-2" data-testid="replay-coming-soon">
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-bold text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300">
              À venir
            </span>
            <h3 className="text-sm font-bold tracking-tight">Session Replay</h3>
          </div>
          <p className="mt-2 max-w-2xl text-sm text-ink-soft">
            Le rejeu visuel des sessions n&apos;est pas activé sur ce déploiement : la collecte RUM
            reste <strong>anonyme et sans consentement</strong> (mesure d&apos;audience exemptée, pas
            d&apos;IP ni de cookie de traçage). Le replay, plus intrusif, sera activé{" "}
            <strong>derrière un consentement explicite</strong>.
          </p>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
            Approche technique prévue
          </p>
          <ul className="mt-1 max-w-2xl list-disc space-y-1 pl-5 text-sm text-ink-soft">
            <li>
              Capture DOM via <strong>rrweb</strong> (bundle chargé à la demande),{" "}
              <code className="rounded bg-panel2 px-1">maskAllInputs</code> + blocs{" "}
              <code className="rounded bg-panel2 px-1">mip-rum-block</code> exclus.
            </li>
            <li>
              Gate <strong>consentement</strong> (SDK <code className="rounded bg-panel2 px-1">requireConsent</code>) :
              rien n&apos;est enregistré avant accord de l&apos;utilisateur.
            </li>
            <li>
              Chunks <strong>gzip</strong> envoyés à l&apos;edge function{" "}
              <code className="rounded bg-panel2 px-1">/v1/replay</code> (déjà déployée).
            </li>
            <li>
              Stockage <code className="rounded bg-panel2 px-1">bytea</code> (POC) →{" "}
              <strong>object storage</strong> (S3/R2) en cible, TTL 30 j (RGPD).
            </li>
            <li>
              Reconstruction par <code className="rounded bg-panel2 px-1">/api/replay/[sessionId]</code>{" "}
              (gunzip + concat) puis rejeu ici (rrweb-player). Détails :{" "}
              <code className="rounded bg-panel2 px-1">docs/ROADMAP_REPLAY.md</code>.
            </li>
          </ul>
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
      <div ref={host} className={state === "ready" ? "flex justify-center" : "hidden"} />
    </div>
  );
}
