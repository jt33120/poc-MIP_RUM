"use client";
// Briefing d'accueil (auto au login) — appelle /api/briefing au montage et affiche
// l'état de l'app depuis la dernière connexion : statut + points clés + où regarder.
// Non bloquant (la Vue d'ensemble se rend sans l'attendre) ; se masque en silence
// si l'API échoue. Dismiss par onglet (sessionStorage) pour ne pas être répétitif.
import { useEffect, useState } from "react";
import Link from "next/link";

interface Result {
  status: "ok" | "watch" | "critical";
  headline: string;
  bullets: string[];
  focus: string | null;
  source: "ai" | "deterministic";
}

const TONE: Record<Result["status"], { wrap: string; dot: string; label: string }> = {
  ok: { wrap: "border-good/30 bg-good/5", dot: "bg-good", label: "text-good" },
  watch: { wrap: "border-warn/30 bg-warn/5", dot: "bg-warn", label: "text-warn" },
  critical: { wrap: "border-bad/30 bg-bad/5", dot: "bg-bad", label: "text-bad" },
};

const FOCUS_HREF: Record<string, string> = {
  Alertes: "/alerts",
  "Erreurs JS": "/errors",
  SLO: "/slo",
  "Vue d'ensemble": "/",
};

export function BriefingCard({ app }: { app: string }) {
  const [state, setState] = useState<"loading" | "done" | "hidden">("loading");
  const [r, setR] = useState<Result | null>(null);
  const dismissKey = `mip-briefing-dismissed:${app}`;

  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(dismissKey)) {
      setState("hidden");
      return;
    }
    let alive = true;
    fetch("/api/briefing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ app }),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((d) => {
        if (alive) {
          setR(d.briefing as Result);
          setState("done");
        }
      })
      .catch(() => alive && setState("hidden"));
    return () => {
      alive = false;
    };
  }, [app, dismissKey]);

  if (state === "hidden") return null;

  if (state === "loading") {
    return (
      <div className="mb-6 animate-pulse rounded-xl border border-line bg-panel p-4">
        <div className="h-3 w-40 rounded bg-panel2" />
        <div className="mt-3 h-2.5 w-2/3 rounded bg-panel2" />
        <div className="mt-2 h-2.5 w-1/2 rounded bg-panel2" />
      </div>
    );
  }

  if (!r) return null;
  const tone = TONE[r.status];
  const focusHref = r.focus ? FOCUS_HREF[r.focus] : null;

  return (
    <section className={`mb-6 rounded-xl border p-4 ${tone.wrap}`} aria-label="Briefing d'accueil">
      <div className="flex items-start gap-3">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 className={`text-sm font-semibold ${tone.label}`}>{r.headline}</h2>
            <span className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] font-medium text-ink-faint">
              {r.source === "ai" ? "résumé IA · depuis votre dernière connexion" : "résumé · depuis votre dernière connexion"}
            </span>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-ink-soft">
            {r.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-ink-faint">•</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
          {r.focus && (
            <div className="mt-2.5 text-xs">
              <span className="text-ink-faint">À regarder en priorité : </span>
              {focusHref ? (
                <Link href={`${focusHref}?app=${encodeURIComponent(app)}`} className="font-medium text-accent-deep underline-offset-2 hover:underline dark:text-accent">
                  {r.focus} →
                </Link>
              ) : (
                <span className="font-medium text-ink">{r.focus}</span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              sessionStorage.setItem(dismissKey, "1");
            } catch {
              /* sessionStorage indispo : on masque quand même pour la vue courante */
            }
            setState("hidden");
          }}
          className="shrink-0 rounded p-1 text-ink-faint transition hover:bg-panel2 hover:text-ink"
          aria-label="Masquer le briefing"
          title="Masquer"
        >
          ✕
        </button>
      </div>
    </section>
  );
}
