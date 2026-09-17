"use client";
// Barre de segments (P6.2) — conditions `dimension opérateur valeur` portées dans
// l'URL (`?seg=v2:…`) et appliquées RÉTROACTIVEMENT par les lectures du contrat.
//
// Les dimensions proposées suivent les capacités de l'écran (lib/surfaces.ts) :
// une dimension que ses mesures ne savent pas appliquer est désactivée avec sa
// raison. Un ancien segment d'URL (v1, `geo==FR;device!=mobile`) reste lu et passe
// au format v2 dès qu'on le modifie. Un segment illisible n'est jamais ignoré en
// silence : l'écran le refuse et la barre propose de le retirer.
//
// Segments enregistrés : magasin versionné du navigateur (v2), repris une fois de
// l'ancienne clé v1 laissée intacte ; les entrées illisibles sont écartées et
// annoncées.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  DIMENSIONS,
  DIMENSION_LABELS,
  MAX_CONDITIONS,
  SAVED_SEGMENTS_KEY,
  SAVED_SEGMENTS_KEY_V1,
  migrateSavedSegments,
  parseSegmentParam,
  serializeSegments,
  type Dimension,
  type FilterCondition,
  type FilterOperator,
  type SavedSegment,
} from "@/lib/query-contract";
import { conditionAvailability, dimensionAvailability, surfaceFor } from "@/lib/surfaces";

const OPERATORS: { key: FilterOperator; label: string }[] = [
  { key: "eq", label: "=" },
  { key: "neq", label: "≠" },
  { key: "is_null", label: "inconnu" },
];

/** Paramètres d'une page de résultats : un changement de segment les invalide. */
const PAGINATION_PARAMS = ["cursor", "offset"];

function describeCondition(condition: FilterCondition): string {
  const label = DIMENSION_LABELS[condition.dimension];
  if (condition.operator === "is_null") return `${label} inconnu`;
  return `${label} ${condition.operator === "eq" ? "=" : "≠"} ${condition.value}`;
}

function sameCondition(a: FilterCondition, b: FilterCondition): boolean {
  return a.dimension === b.dimension && a.operator === b.operator && a.value === b.value;
}

function loadSaved(): { items: SavedSegment[]; dropped: number } {
  try {
    const rawV2 = window.localStorage.getItem(SAVED_SEGMENTS_KEY);
    const { store, dropped } = migrateSavedSegments(rawV2, window.localStorage.getItem(SAVED_SEGMENTS_KEY_V1));
    // Première lecture après la migration : le magasin v2 est écrit, la clé v1 reste.
    if (rawV2 === null && store.items.length) window.localStorage.setItem(SAVED_SEGMENTS_KEY, JSON.stringify(store));
    return { items: store.items, dropped };
  } catch {
    return { items: [], dropped: 0 };
  }
}

export function SegmentBar({ schema }: { schema: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const columns = useMemo(() => new Set(schema), [schema]);
  const surface = surfaceFor(pathname);

  const [adding, setAdding] = useState(false);
  const [dimension, setDimension] = useState<Dimension | "">("");
  const [operator, setOperator] = useState<FilterOperator>("eq");
  const [value, setValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SavedSegment[]>([]);
  const [dropped, setDropped] = useState(0);

  // localStorage n'est lu qu'au montage client (évite le mismatch d'hydratation).
  useEffect(() => {
    const loaded = loadSaved();
    setSaved(loaded.items);
    setDropped(loaded.dropped);
  }, []);

  // Écran sans filtres globaux, ou sans aucune dimension applicable : pas de barre.
  if (!surface || DIMENSIONS.every((d) => !dimensionAvailability(surface, d, columns).available)) return null;

  const parsed = parseSegmentParam(sp.get("seg"));
  const conditions = parsed.ok ? parsed.value : [];
  const includeBots = sp.get("bots") === "1";
  const includeInternal = sp.get("internal") === "1";
  // apps internes (dogfooding) : toggle pertinent seulement en vue « toutes apps »
  const appParam = sp.get("app");
  const isAllApps = !appParam || appParam === "all";

  function navigate(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(sp.toString());
    mutate(next);
    for (const name of PAGINATION_PARAMS) next.delete(name);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function apply(list: FilterCondition[]) {
    const seg = serializeSegments(list);
    navigate((next) => (seg ? next.set("seg", seg) : next.delete("seg")));
  }

  function addCondition() {
    if (!surface || !dimension) {
      setAddError("Choisissez une dimension.");
      return;
    }
    const candidate = serializeSegments([
      { dimension, operator, value: operator === "is_null" ? null : value.trim() },
    ]);
    // Le contrat valide la condition comme le serveur la relira : valeur bornée, appareil connu…
    const checked = parseSegmentParam(candidate);
    if (!checked.ok) {
      setAddError(checked.error.message);
      return;
    }
    const condition = checked.value[0];
    const availability = conditionAvailability(surface, condition, columns);
    if (!availability.available) {
      setAddError(availability.reason);
      return;
    }
    if (conditions.length >= MAX_CONDITIONS) {
      setAddError(`Au plus ${MAX_CONDITIONS} conditions combinées.`);
      return;
    }
    // dédup exact ; conjonction (ET) sinon
    if (!conditions.some((c) => sameCondition(c, condition))) apply([...conditions, condition]);
    setValue("");
    setAddError(null);
    setAdding(false);
  }

  function persist(list: SavedSegment[]) {
    setSaved(list);
    try {
      window.localStorage.setItem(SAVED_SEGMENTS_KEY, JSON.stringify({ version: 2, items: list }));
    } catch {
      /* quota/privé : on garde l'état en mémoire */
    }
  }

  function saveCurrent() {
    const seg = serializeSegments(conditions);
    if (!seg) return;
    const name = window.prompt("Nom du segment ?", conditions.map(describeCondition).join(", "));
    if (!name?.trim()) return;
    persist([...saved.filter((s) => s.name !== name.trim()), { name: name.trim().slice(0, 100), seg }]);
  }

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 border-b border-line bg-panel/60 px-4 py-2 sm:px-6"
      data-testid="segment-bar"
    >
      <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
        <span className="h-1.5 w-1.5 rounded-full bg-perf" />
        Segment
      </span>

      {!parsed.ok && (
        <span
          role="alert"
          data-testid="segment-invalid"
          className="flex items-center gap-1.5 rounded-full border border-bad/40 bg-bad/10 px-2 py-0.5 text-xs font-medium text-bad"
        >
          Segment illisible : {parsed.error.message}
          <button
            type="button"
            onClick={() => navigate((next) => next.delete("seg"))}
            className="rounded underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
          >
            Retirer
          </button>
        </span>
      )}

      {parsed.ok && conditions.length === 0 && <span className="text-xs text-ink-faint">tous les visiteurs</span>}

      {conditions.map((condition, i) => {
        const availability = conditionAvailability(surface, condition, columns);
        return (
          <span
            key={`${condition.dimension}:${condition.operator}:${condition.value}`}
            data-testid="segment-chip"
            data-applied={availability.available}
            title={availability.available ? undefined : availability.reason}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
              availability.available
                ? "border-perf/30 bg-perf/10 text-perf"
                : "border-warn/40 bg-warn/10 text-ink-soft line-through decoration-warn/60"
            }`}
          >
            {describeCondition(condition)}
            {!availability.available && <span className="sr-only">— non appliqué sur cet écran : {availability.reason}</span>}
            <button
              type="button"
              onClick={() => apply(conditions.filter((_, j) => j !== i))}
              className="ml-0.5 rounded opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
              aria-label={`Retirer ${describeCondition(condition)}`}
              title="Retirer"
            >
              ×
            </button>
          </span>
        );
      })}

      {adding ? (
        <span className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-panel2 px-1.5 py-1">
          <select
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value as Dimension | "");
              setAddError(null);
            }}
            className="rounded bg-transparent text-xs text-ink outline-none"
            aria-label="Dimension"
            data-testid="segment-dimension"
          >
            <option value="">Dimension…</option>
            {DIMENSIONS.map((d) => {
              const availability = dimensionAvailability(surface, d, columns);
              return (
                <option
                  key={d}
                  value={d}
                  disabled={!availability.available}
                  title={availability.available ? undefined : availability.reason}
                >
                  {DIMENSION_LABELS[d]}
                  {availability.available ? "" : " — indisponible ici"}
                </option>
              );
            })}
          </select>
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as FilterOperator)}
            className="rounded bg-transparent text-xs text-ink outline-none"
            aria-label="Opérateur"
            data-testid="segment-operator"
          >
            {OPERATORS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          {operator !== "is_null" && (
            <input
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") addCondition();
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="valeur exacte"
              maxLength={500}
              className="w-28 rounded bg-app px-1.5 py-0.5 text-xs text-ink outline-none ring-1 ring-line focus:ring-perf/40"
              aria-label="Valeur"
              data-testid="segment-value"
            />
          )}
          <button
            type="button"
            onClick={addCondition}
            className="rounded bg-perf px-2 py-0.5 text-xs font-semibold text-white hover:opacity-90"
            data-testid="segment-confirm"
          >
            Ajouter
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setAddError(null);
            }}
            className="px-1 text-xs text-ink-faint hover:text-ink"
            aria-label="Annuler"
          >
            ×
          </button>
          {addError && (
            <span role="alert" className="basis-full text-[11px] font-medium text-bad" data-testid="segment-error">
              {addError}
            </span>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-lg border border-dashed border-line px-2 py-0.5 text-xs font-medium text-ink-soft transition hover:border-perf/40 hover:text-perf"
          data-testid="segment-add"
        >
          + Filtre
        </button>
      )}

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {dropped > 0 && (
          <span role="status" className="text-[11px] text-ink-faint" data-testid="segment-saved-dropped">
            {dropped} segment(s) enregistré(s) illisible(s) écarté(s)
          </span>
        )}
        {isAllApps && (
          <button
            type="button"
            onClick={() => navigate((next) => (includeInternal ? next.delete("internal") : next.set("internal", "1")))}
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
          type="button"
          onClick={() => navigate((next) => (includeBots ? next.delete("bots") : next.set("bots", "1")))}
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
        {conditions.length > 0 && (
          <>
            <button
              type="button"
              onClick={saveCurrent}
              className="text-xs font-medium text-ink-faint hover:text-perf"
              title="Enregistrer ce segment"
            >
              ☆ Enregistrer
            </button>
            <button
              type="button"
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
              const segment = saved.find((s) => s.name === e.target.value);
              const conditionsOfSaved = segment ? parseSegmentParam(segment.seg) : null;
              if (conditionsOfSaved?.ok) apply(conditionsOfSaved.value);
            }}
            className="rounded-lg border border-line bg-panel2 px-1.5 py-1 text-xs text-ink-soft outline-none"
            aria-label="Segments enregistrés"
            data-testid="segment-saved"
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
