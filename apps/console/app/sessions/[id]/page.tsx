import Link from "next/link";
import { notFound } from "next/navigation";
import ReplayPlayer from "@/components/replay/ReplayPlayer";
import { TabLink } from "@/components/sessions/TabLink";
import { TimelineRow } from "@/components/sessions/Timeline";
import { browserFromUA, fmtDate } from "@/lib/format";
import { geoSourceLabel } from "@/lib/geo";
import { sessionMeta, sessionTimeline, type TimelineKind } from "@/lib/queries";
import { authorizedAppsOf } from "@/lib/query-contract";
import { KIND_STYLE } from "@/lib/timeline-constants";

export const dynamic = "force-dynamic";

function fmtDuration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export default async function SessionDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const [meta, timeline] = await Promise.all([sessionMeta(id), sessionTimeline(id)]);
  if (!meta) notFound();

  // scoping viewer : une session d'une app hors périmètre est invisible (404) ;
  // une liste d'apps vide n'ouvre aucune session.
  const { getUser } = await import("@/lib/auth");
  const authorized = authorizedAppsOf(await getUser());
  if (authorized !== null && !authorized.includes(meta.app_id)) notFound();
  // Un lien qui annonce son app (erreur, trace — P5.1) ne doit jamais ouvrir la
  // session d'une autre : l'identifiant de session est émis par le client, et une
  // erreur forgée peut citer celui d'un autre tenant. Paramètre répété : la
  // première valeur, comme la porte projet du middleware.
  const app = Array.isArray(sp.app) ? sp.app[0] : sp.app;
  if (app && app !== "all" && app !== meta.app_id) notFound();

  // Instant de l'erreur (epoch ms) vers lequel positionner le replay. Une valeur
  // non entière est ignorée : le lecteur ne devine pas un instant.
  const at = typeof sp.at === "string" && /^\d{1,15}$/.test(sp.at) ? Number(sp.at) : null;

  // filtres globaux conservés dans les liens ; onglet et instant exclus (propres au détail)
  const qs = new URLSearchParams(
    Object.entries(sp).flatMap(([k, v]) =>
      typeof v === "string" && k !== "tab" && k !== "at" ? [[k, v] as [string, string]] : [],
    ),
  ).toString();
  const tab: "timeline" | "replay" = sp.tab === "replay" ? "replay" : "timeline";
  const tabHref = (t: "timeline" | "replay") => {
    const p = new URLSearchParams(qs);
    if (t === "replay") {
      p.set("tab", "replay");
      if (at !== null) p.set("at", String(at));
    }
    const s = p.toString();
    return `/sessions/${meta.session_id}${s ? `?${s}` : ""}`;
  };
  const t0 = new Date(meta.started_at).getTime();
  const durationMs = new Date(meta.last_seen_at).getTime() - t0;
  const counts = timeline.reduce<Partial<Record<TimelineKind, number>>>((acc, it) => {
    acc[it.kind] = (acc[it.kind] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-up">
      <Link href={`/sessions${qs ? `?${qs}` : ""}`} className="text-sm text-brand hover:underline">
        ← Sessions
      </Link>
      <h1 className="mb-1 mt-2 text-xl font-bold tracking-tight">
        Session <span className="font-mono text-lg text-ink-soft">{meta.session_id.slice(0, 8)}…</span>
      </h1>
      <p className="mb-6 text-sm text-ink-soft">
        Timeline fusionnée : actions causales, pages vues, vitals, erreurs, ressources, appels API et événements métier
      </p>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-8">
        <Meta label="App" value={meta.app_id} />
        <Meta label="Device" value={meta.device_type ?? "—"} />
        <Meta label="Navigateur" value={browserFromUA(meta.user_agent)} />
        {/* P8.7 : le pays ne s'affiche jamais seul. Sa provenance le suit, parce
            qu'une adresse résolue et un fuseau déclaré ne valent pas la même
            chose, et que « Inconnue » est la vérité de l'historique. */}
        <Meta
          label="Pays estimé"
          value={meta.geo_country ?? "—"}
          hint={meta.geo_country ? `${geoSourceLabel(meta.geo_source)}${meta.geo_db_version ? ` · ${meta.geo_db_version}` : ""}` : null}
        />
        <Meta
          label="Source"
          value={meta.collection_source === "extension" ? "Extension" : "SDK"}
          tone={meta.collection_source === "extension" ? "extension" : undefined}
        />
        <Meta
          label={meta.visitor_id ? "Visiteur (aléatoire)" : "Classe d'appareil (héritée)"}
          value={
            meta.visitor_id
              ? `${meta.visitor_id.slice(0, 10)}…`
              : meta.user_hash
                ? `${meta.user_hash.slice(0, 10)}… — n'identifie pas une personne`
                : "—"
          }
          mono
        />
        <Meta label="Durée" value={fmtDuration(durationMs)} />
        <Meta label="Pages" value={String(meta.page_count)} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span className="tabular-nums">
          {fmtDate(meta.started_at)} → {fmtDate(meta.last_seen_at)}
        </span>
        <span className="text-ink-faint/50">·</span>
        {(Object.keys(KIND_STYLE) as TimelineKind[])
          .filter((k) => counts[k])
          .map((k) => (
            <span key={k} className={`rounded-full border px-2 py-0.5 font-medium ${KIND_STYLE[k].badge}`}>
              {counts[k]} {KIND_STYLE[k].label.toLowerCase()}
            </span>
          ))}
      </div>

      {/* v0.3 — onglets Timeline | Replay (B2) */}
      <div className="mb-4 flex gap-1 border-b border-line" data-testid="session-tabs">
        <TabLink href={tabHref("timeline")} active={tab === "timeline"}>
          Timeline
        </TabLink>
        <TabLink href={tabHref("replay")} active={tab === "replay"}>
          Replay
        </TabLink>
      </div>

      {tab === "replay" ? (
        <ReplayPlayer sessionId={meta.session_id} atMs={at} />
      ) : (
        <div className="card p-6">
          {timeline.length ? (
            <ol className="relative ml-2 border-l-2 border-line" data-testid="timeline">
              {timeline.map((it, i) => (
                <TimelineRow key={i} item={it} t0={t0} />
              ))}
            </ol>
          ) : (
            <p className="py-8 text-center text-sm text-ink-faint">
              Aucun événement enregistré pour cette session
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Meta({
  label,
  value,
  mono = false,
  tone,
  hint,
}: {
  label: string;
  value: string;
  mono?: boolean;
  /** met la valeur en avant — 'extension' colore en accent (capteur navigateur). */
  tone?: "extension";
  /** Seconde ligne : d'où vient la valeur. Écrite, pas seulement en infobulle. */
  hint?: string | null;
}) {
  const toneCls = tone === "extension" ? "text-accent" : "";
  return (
    <div className="card p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-faint">{label}</div>
      <div className={`mt-0.5 truncate text-sm font-semibold ${mono ? "font-mono" : ""} ${toneCls}`} title={value}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-ink-soft" title={hint}>{hint}</div>}
    </div>
  );
}
