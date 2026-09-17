"use client";
// Lecteur de session replay : le Replayer de @rrweb/replay, monté sur les events
// reconstruits par /api/replay/[sessionId] (gunzip + concat côté serveur). Import
// dynamique côté client uniquement : le Replayer manipule window/document dès sa
// construction.
//
// POURQUOI PAS rrweb-player. Le build installé de rrweb-player@2.0.1 n'instancie
// jamais de Replayer (aucun `new Replayer` dans son dist ; `getMetaData` et `goto`
// indéfinis à l'exécution) : l'onglet affichait un contrôleur qui ne rejouait rien.
// On pilote donc le Replayer directement — lecture, pause, positionnement sur
// l'instant d'une erreur (P5.1) et mise à l'échelle.
import type { Replayer } from "@rrweb/replay";
import { useEffect, useRef, useState } from "react";
import "@rrweb/replay/dist/style.css";

type State = "loading" | "empty" | "error" | "ready";
/** none : aucun instant demandé ; positioned : calé dessus ; unavailable : hors enregistrement. */
type OffsetState = "none" | "positioned" | "unavailable";
interface Viewport {
  width: number;
  height: number;
}

const OFFSET_MESSAGE: Record<OffsetState, string> = {
  none: "",
  positioned: "Replay positionné à l'instant de l'erreur",
  unavailable: "Replay indisponible à cet instant",
};

export default function ReplayPlayer({ sessionId, atMs = null }: { sessionId: string; atMs?: number | null }) {
  const frame = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const replayer = useRef<Replayer | null>(null);
  const [state, setState] = useState<State>("loading");
  const [eventCount, setEventCount] = useState(0);
  const [offset, setOffset] = useState<OffsetState>("none");
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [available, setAvailable] = useState(0);

  useEffect(() => {
    let cancelled = false;

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
        const rrweb = await import("@rrweb/replay");
        if (cancelled || !host.current) return;
        const r = new rrweb.Replayer(events as ConstructorParameters<typeof rrweb.Replayer>[0], {
          root: host.current,
        });
        replayer.current = r;
        // Dimensions de la page enregistrée (event Meta, puis chaque redimensionnement) :
        // la base de la mise à l'échelle.
        r.on("resize", (dimension) => setViewport(dimension as Viewport));
        if (atMs !== null) {
          // Borné au contenu : un instant hors de l'enregistrement n'est pas « à peu
          // près » rejouable. On l'annonce et on reste au début.
          const { startTime, endTime } = r.getMetaData();
          const inside = atMs >= startTime && atMs <= endTime;
          r.pause(inside ? atMs - startTime : 0);
          setOffset(inside ? "positioned" : "unavailable");
        }
        setEventCount(events.length);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
      replayer.current?.destroy();
      replayer.current = null;
    };
  }, [sessionId, atMs]);

  // Largeur réellement disponible, suivie : elle change avec la fenêtre et le menu.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setAvailable(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function play() {
    const r = replayer.current;
    if (!r) return;
    // Reprend là où le lecteur s'est arrêté ; au bout de l'enregistrement, repart du début.
    const current = r.getCurrentTime();
    r.play(current >= r.getMetaData().totalTime ? 0 : current);
  }

  // Jamais agrandie au-delà de sa taille enregistrée, réduite pour tenir dans la carte.
  const scale = viewport && available > 0 ? Math.min(1, available / viewport.width) : 1;

  return (
    <div
      className="card p-4 sm:p-6"
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
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-accent" onClick={play}>
            Lecture
          </button>
          <button type="button" className="btn-ghost" onClick={() => replayer.current?.pause()}>
            Pause
          </button>
          <p className="text-xs text-ink-soft">
            {eventCount} événements rrweb — saisies masquées à l&apos;enregistrement
            (maskAllInputs), blocs <code className="rounded bg-panel2 px-1">mip-rum-block</code>{" "}
            exclus.
          </p>
        </div>
      )}
      {/* Région live présente dès le montage : une annonce n'est lue que si la
          région existait avant que son texte change. */}
      <p
        role="status"
        data-testid="replay-offset"
        data-offset-state={offset}
        className="mb-3 text-sm font-medium text-ink empty:mb-0"
      >
        {OFFSET_MESSAGE[offset]}
      </p>
      {/* Le conteneur du Replayer reste monté en permanence : son iframe exige une
          racine attachée au document dès la construction, pendant que state vaut
          encore "loading". Vide et sans hauteur tant que la page enregistrée n'a pas
          annoncé ses dimensions ; ensuite réduit à la largeur de la carte (la page
          enregistrée garde sa mise en page, seule l'image est mise à l'échelle). */}
      <div ref={frame} className="overflow-x-auto">
        <div
          className="mx-auto overflow-hidden"
          style={viewport ? { width: viewport.width * scale, height: viewport.height * scale } : undefined}
        >
          <div
            ref={host}
            style={
              viewport
                ? { width: viewport.width, height: viewport.height, transform: `scale(${scale})`, transformOrigin: "0 0" }
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
}
