"use client";
// Briefing d'accueil (auto au login) — appelle /api/briefing au montage et affiche
// l'état de l'app depuis la dernière connexion : statut + tuiles chiffrées +
// points clés + checklist cliquable « à regarder en priorité ». Non bloquant (la
// Vue d'ensemble se rend sans l'attendre) ; se masque en silence si l'API
// échoue. Dismiss par onglet (sessionStorage) pour ne pas être répétitif.
import { useEffect, useState } from "react";
import Link from "next/link";
import { ICON_PATHS, Icon, type IconName } from "./icons";

type ChecklistKind = "alert" | "slo" | "error" | "perf";
interface ChecklistItem {
  label: string;
  href: string;
  kind: ChecklistKind;
}
interface Stats {
  sessions: number;
  errors: number;
  healthScore: number | null;
  worstVital: { name: string; p75: number } | null;
}
interface Result {
  status: "ok" | "watch" | "critical";
  headline: string;
  bullets: string[];
  focus: string | null;
  checklist: ChecklistItem[];
  stats: Stats;
  source: "ai" | "deterministic";
}

const TONE: Record<Result["status"], { wrap: string; dot: string; label: string; badge: string }> = {
  ok: { wrap: "border-good/30 bg-good/[0.04]", dot: "bg-good", label: "text-good", badge: "border-good/30 bg-good/10 text-good" },
  watch: { wrap: "border-warn/30 bg-warn/[0.04]", dot: "bg-warn", label: "text-warn", badge: "border-warn/30 bg-warn/10 text-warn" },
  critical: { wrap: "border-bad/30 bg-bad/[0.04]", dot: "bg-bad", label: "text-bad", badge: "border-bad/30 bg-bad/10 text-bad" },
};

const STATUS_LABEL: Record<Result["status"], string> = {
  ok: "Au vert",
  watch: "À surveiller",
  critical: "Critique",
};

const CHECKLIST_ICON: Record<ChecklistKind, IconName> = {
  alert: "bell",
  slo: "target",
  error: "alert",
  perf: "timer",
};

/** Couleur d'un chiffre selon son sens — mêmes seuils que deriveStatus
 *  (santé < 50 = critique, < 80 = à surveiller) pour rester cohérent avec le
 *  statut affiché juste au-dessus. */
function statTone(kind: "sessions" | "errors" | "health", value: number | null): string {
  if (value == null) return "text-ink-faint";
  if (kind === "sessions") return "text-ink";
  if (kind === "errors") return value > 0 ? "text-bad" : "text-good";
  return value < 50 ? "text-bad" : value < 80 ? "text-warn" : "text-good";
}

/** Tuile chiffre-icône compacte de la bande KPI (sessions/erreurs/santé). */
function StatChip({ icon, label, value, tone }: { icon: IconName; label: string; value: string; tone: string }) {
  return (
    <div className="flex items-center gap-1.5" title={label}>
      <Icon paths={ICON_PATHS[icon]} className="h-3.5 w-3.5 text-ink-faint" strokeWidth={2} />
      <span className={`text-sm font-bold tabular-nums tracking-tight ${tone}`}>{value}</span>
      <span className="text-[11px] font-medium text-ink-faint">{label}</span>
    </div>
  );
}

// app absente => briefing PORTAIL (vue « Tous », toutes les apps).
export function BriefingCard({ app }: { app?: string }) {
  const [state, setState] = useState<"loading" | "done" | "hidden">("loading");
  const [r, setR] = useState<Result | null>(null);
  const dismissKey = `mip-briefing-dismissed:${app ?? "__portal__"}`;

  useEffect(() => {
    if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(dismissKey)) {
      setState("hidden");
      return;
    }
    let alive = true;
    fetch("/api/briefing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(app ? { app } : {}),
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
  const stats = r.stats;
  const health = stats?.healthScore ?? null;

  return (
    <section
      className={`mb-6 overflow-hidden rounded-2xl border shadow-card ${tone.wrap}`}
      aria-label="Briefing d'accueil"
    >
      {/* En-tête : pastille de statut + titre + badge d'état + provenance + fermer */}
      <div className="flex items-center gap-3 border-b border-line/60 px-5 py-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot} animate-pulse-dot`} />
        <h2 className={`text-sm font-semibold ${tone.label}`}>{r.headline}</h2>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${tone.badge}`}>
          {STATUS_LABEL[r.status]}
        </span>
        <span className="ml-auto hidden items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-ink-faint sm:flex">
          <Icon paths={ICON_PATHS.ai} className="h-3.5 w-3.5 text-accent" strokeWidth={2} />
          {r.source === "ai" ? "Synthèse IA" : "Synthèse"} · {app ? "cette app" : "portail"}
        </span>
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
          className="-mr-1 ml-1 shrink-0 rounded-lg p-1 text-ink-faint transition hover:bg-panel2 hover:text-ink"
          aria-label="Masquer le briefing"
          title="Masquer"
        >
          <Icon paths={ICON_PATHS.close} className="h-4 w-4" />
        </button>
      </div>

      {/* Bande de tuiles chiffrées (KPI scannables d'un coup d'œil) */}
      {stats && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line/60 bg-panel/40 px-5 py-2.5">
          <StatChip
            icon="users"
            label="sessions"
            value={stats.sessions.toLocaleString("fr-FR")}
            tone={statTone("sessions", stats.sessions)}
          />
          <StatChip
            icon="alert"
            label="erreurs"
            value={stats.errors.toLocaleString("fr-FR")}
            tone={statTone("errors", stats.errors)}
          />
          {health != null && (
            <StatChip icon="gauge" label="santé /100" value={String(health)} tone={statTone("health", health)} />
          )}
          {stats.worstVital && (
            <StatChip
              icon="timer"
              label={`${stats.worstVital.name} p75`}
              value={`${Math.round(stats.worstVital.p75).toLocaleString("fr-FR")} ms`}
              tone="text-warn"
            />
          )}
          <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-ink-faint">
            depuis votre dernière connexion
          </span>
        </div>
      )}

      {/* Corps : points clés + checklist cliquable */}
      <div className="px-5 py-3.5">
        <ul className="space-y-1.5 text-sm text-ink-soft">
          {r.bullets.map((b, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={`mt-1.5 h-1 w-1 shrink-0 rounded-full ${tone.dot}`} />
              <span>{b}</span>
            </li>
          ))}
        </ul>

        {(r.checklist ?? []).length > 0 && (
          <div className="mt-3.5 border-t border-line/60 pt-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              <Icon paths={ICON_PATHS.compass} className="h-3.5 w-3.5" strokeWidth={2} />
              À regarder en priorité
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {r.checklist.map((c, i) => (
                <li key={i}>
                  <Link
                    href={c.href}
                    className="group inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-[12px] font-medium text-ink-soft shadow-sm transition hover:border-accent/50 hover:bg-accent/5 hover:text-ink"
                  >
                    <Icon
                      paths={ICON_PATHS[CHECKLIST_ICON[c.kind]]}
                      className="h-3.5 w-3.5 text-ink-faint transition group-hover:text-accent"
                      strokeWidth={2}
                    />
                    {c.label}
                    <span className="text-ink-faint transition group-hover:translate-x-0.5 group-hover:text-accent">
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
