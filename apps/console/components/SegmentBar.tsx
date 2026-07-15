"use client";
// Barre de segments v1 — compose des conditions arbitraires (dim<op>val) portées
// dans l'URL (?seg=…) et appliquées RÉTROACTIVEMENT aux requêtes. Les segments
// peuvent être enregistrés (localStorage). N'apparaît que sur les pages dont les
// requêtes consomment le segment (home / pages lentes / sessions) — ailleurs, la
// couche data ne le lit pas encore (extension = suivi mécanique du Lot 1).
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  describeCond,
  parseSegment,
  SEG_DIMENSIONS,
  type SegCond,
  serializeSegment,
} from "@/lib/segments";

const DIMS = Object.entries(SEG_DIMENSIONS).map(([key, v]) => ({ key, label: v.label }));
const OPS: { key: "==" | "!="; label: string }[] = [
  { key: "==", label: "=" },
  { key: "!=", label: "≠" },
];
const SAVED_KEY = "mip-saved-segments";

/** Routes dont les requêtes appliquent réellement le segment (cf. lib/queries.ts). */
function segmentApplies(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname.startsWith("/pages") ||
    pathname.startsWith("/sessions") ||
    pathname.startsWith("/paths") ||
    pathname.startsWith("/forms") ||
    pathname.startsWith("/acquisition") ||
    pathname.startsWith("/goals") ||
    pathname.startsWith("/retention")
  );
}

interface Saved {
  name: string;
  seg: string;
}

function loadSaved(): Saved[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((s) => s?.name && s?.seg) : [];
  } catch {
    return [];
  }
}

export function SegmentBar() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const conds = parseSegment(sp.get("seg"));
  const includeBots = sp.get("bots") === "1";
  const includeInternal = sp.get("internal") === "1";
  // apps internes (dogfooding) : toggle pertinent seulement en vue « toutes apps »
  const appParam = sp.get("app");
  const isAllApps = !appParam || appParam === "all";

  const [adding, setAdding] = useState(false);
  const [dim, setDim] = useState(DIMS[0].key);
  const [op, setOp] = useState<"==" | "!=">("==");
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState<Saved[]>([]);

  // localStorage n'est lu qu'au montage client (évite le mismatch d'hydratation)
  useEffect(() => setSaved(loadSaved()), []);

  if (!segmentApplies(pathname)) return null;

  function apply(next: SegCond[]) {
    const params = new URLSearchParams(sp.toString());
    const s = serializeSegment(next);
    if (s) params.set("seg", s);
    else params.delete("seg");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function addCond() {
    const v = value.trim();
    if (!v) return;
    // dédup exact (dim+op+val identiques) ; conjonction (ET) sinon
    const exists = conds.some((c) => c.dim === dim && c.op === op && c.value === v);
    if (!exists) apply([...conds, { dim, op, value: v }]);
    setValue("");
    setAdding(false);
  }

  function persist(list: Saved[]) {
    setSaved(list);
    try {
      window.localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch {
      /* quota/privé : on garde l'état en mémoire */
    }
  }

  function toggleBots() {
    const params = new URLSearchParams(sp.toString());
    if (includeBots) params.delete("bots");
    else params.set("bots", "1");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function toggleInternal() {
    const params = new URLSearchParams(sp.toString());
    if (includeInternal) params.delete("internal");
    else params.set("internal", "1");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function saveCurrent() {
    const seg = serializeSegment(conds);
    if (!seg) return;
    const name = window.prompt("Nom du segment ?", conds.map(describeCond).join(", "));
    if (!name?.trim()) return;
    persist([...saved.filter((s) => s.name !== name.trim()), { name: name.trim(), seg }]);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel/60 px-6 py-2"
      data-testid="segment-bar"
    >
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-perf" />
        Segment
      </span>

      {conds.length === 0 && (
        <span className="text-xs text-ink-faint">tous les visiteurs</span>
      )}

      {conds.map((c, i) => (
        <span
          key={`${c.dim}${c.op}${c.value}`}
          className="flex items-center gap-1 rounded-full border border-perf/30 bg-perf/10 px-2 py-0.5 text-xs font-medium text-perf"
        >
          {describeCond(c)}
          <button
            onClick={() => apply(conds.filter((_, j) => j !== i))}
            className="ml-0.5 text-perf/70 hover:text-perf"
            aria-label={`Retirer ${describeCond(c)}`}
            title="Retirer"
          >
            ×
          </button>
        </span>
      ))}

      {adding ? (
        <span className="flex items-center gap-1 rounded-lg border border-line bg-panel2 px-1.5 py-1">
          <select
            value={dim}
            onChange={(e) => setDim(e.target.value)}
            className="rounded bg-transparent text-xs text-ink outline-none"
            aria-label="Dimension"
          >
            {DIMS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
          <select
            value={op}
            onChange={(e) => setOp(e.target.value as "==" | "!=")}
            className="rounded bg-transparent text-xs text-ink outline-none"
            aria-label="Opérateur"
          >
            {OPS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addCond();
              if (e.key === "Escape") setAdding(false);
            }}
            placeholder="valeur (ex. FR)"
            className="w-28 rounded bg-app px-1.5 py-0.5 text-xs text-ink outline-none ring-1 ring-line focus:ring-perf/40"
            aria-label="Valeur"
          />
          <button
            onClick={addCond}
            className="rounded bg-perf px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90"
          >
            Ajouter
          </button>
          <button
            onClick={() => setAdding(false)}
            className="px-1 text-xs text-ink-faint hover:text-ink"
            aria-label="Annuler"
          >
            ×
          </button>
        </span>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-line px-2 py-0.5 text-xs font-medium text-ink-soft transition hover:border-perf/40 hover:text-perf"
          data-testid="segment-add"
        >
          + Filtre
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {isAllApps && (
          <button
            onClick={toggleInternal}
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
              includeInternal
                ? "border-perf/40 bg-perf/10 text-perf"
                : "border-line text-ink-faint hover:text-ink-soft"
            }`}
            title={
              includeInternal
                ? "Les apps internes (dogfooding : la console qui se mesure elle-même) sont incluses dans « Tous »"
                : "Les apps internes (dogfooding) sont exclues de « Tous » — clients réels uniquement"
            }
            data-testid="segment-internal-toggle"
          >
            {includeInternal ? "🏠 Interne inclus" : "🏠 Interne exclu"}
          </button>
        )}
        <button
          onClick={toggleBots}
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
            includeBots
              ? "border-warn/40 bg-warn/10 text-warn"
              : "border-line text-ink-faint hover:text-ink-soft"
          }`}
          title={
            includeBots
              ? "Le trafic non humain (headless, moniteurs, crawlers) est inclus"
              : "Le trafic non humain est exclu des mesures (Real User)"
          }
          data-testid="segment-bots-toggle"
        >
          {includeBots ? "🤖 Bots inclus" : "🤖 Bots exclus"}
        </button>
        {conds.length > 0 && (
          <>
            <button
              onClick={saveCurrent}
              className="text-xs font-medium text-ink-faint hover:text-perf"
              title="Enregistrer ce segment"
            >
              ☆ Enregistrer
            </button>
            <button
              onClick={() => apply([])}
              className="text-xs font-medium text-ink-faint hover:text-bad"
              title="Réinitialiser le segment"
            >
              Réinitialiser
            </button>
          </>
        )}
        {saved.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              const s = saved.find((x) => x.name === e.target.value);
              if (s) apply(parseSegment(s.seg));
            }}
            className="rounded-lg border border-line bg-panel2 px-1.5 py-1 text-xs text-ink-soft outline-none"
            aria-label="Segments enregistrés"
          >
            <option value="">Segments enregistrés…</option>
            {saved.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
