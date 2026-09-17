"use client";
// Barre de filtres globale (P6.2) — état porté par l'URL (partage de lien).
//
// Plage : presets 1 h / 24 h / 7 j, ou plage personnalisée saisie en heure locale
// de l'app (`datetime-local`), convertie en instants UTC [from,to) et validée par le
// contrat AVANT la navigation : heure inexistante au passage à l'heure d'été, fin
// dans le futur ou plage de plus de 30 jours sont refusées près du champ. Appareil
// (tablette comprise) en accès direct ; navigateur, système, env, service, release,
// route et pays dans un tiroir ; chips supprimables.
//
// Chaque contrôle suit les capacités de l'écran (lib/surfaces.ts) : un filtre que
// les mesures affichées ne savent pas appliquer est désactivé avec sa raison, et
// celui que l'URL porte déjà y est marqué « non appliqué ». Le projet (?app) se
// choisit en amont (/select) : il est seulement préservé.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import { INPUT_CLASS } from "@/components/forms/Field";
import {
  DEVICES,
  DIMENSION_LABELS,
  PARAM_DIMENSIONS,
  PRESET_LABELS,
  PRESET_MS,
  RANGE_PRESETS,
  VALUE_MAX,
  isSafeText,
  localInputToUtc,
  parseUtcInstant,
  rangeLabel,
  resolveRange,
  utcToLocalInput,
  type ContractError,
  type Device,
  type RangePreset,
} from "@/lib/query-contract";
import {
  conditionAvailability,
  dimensionAvailability,
  rangeAvailability,
  surfaceFor,
  type FilterAvailability,
} from "@/lib/surfaces";

const DEVICE_LABELS: Record<Device, string> = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablette" };

/** Paramètres d'une page de résultats : un changement de filtre les invalide. */
const PAGINATION_PARAMS = ["cursor", "offset"];

function rangeMessage(error: ContractError): string {
  if (error.code === "range_in_future") return "La fin ne peut pas dépasser l'heure actuelle.";
  if (error.code === "range_too_long") return "La plage ne peut pas dépasser 30 jours.";
  return "Le début doit précéder la fin.";
}

export function GlobalFilters({
  schema,
  timeZones,
  defaultTimeZone,
}: {
  /** Colonnes de dimensions présentes (`table.colonne`), sondées par le layout. */
  schema: string[];
  /** Fuseau d'affichage de chaque app autorisée. */
  timeZones: Record<string, string>;
  defaultTimeZone: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const columns = useMemo(() => new Set(schema), [schema]);
  // Valeurs initiales de l'éditeur, figées à l'ouverture : un rafraîchissement
  // (LIVE, 5 s) ne doit pas réinitialiser une saisie en cours.
  const [rangeDraft, setRangeDraft] = useState<{ from: string; to: string } | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const surface = surfaceFor(pathname);
  // Écrans sans filtres globaux (administration…) : rien à proposer.
  if (!surface) return null;

  const app = sp.get("app");
  const timeZone = (app && timeZones[app]) || defaultTimeZone;
  const from = sp.get("from");
  const to = sp.get("to");
  const custom = from !== null || to !== null;
  const rawPeriod = sp.get("period")?.trim().toLowerCase().replace("7j", "7d") ?? "24h";
  const preset: RangePreset | null = custom
    ? null
    : (RANGE_PRESETS as readonly string[]).includes(rawPeriod)
      ? (rawPeriod as RangePreset)
      : "24h";
  const rawDevice = sp.get("device")?.trim().toLowerCase() ?? "";
  const device = (DEVICES as readonly string[]).includes(rawDevice) ? (rawDevice as Device) : null;

  const presetAvailability = rangeAvailability(surface, false);
  const customAvailability = rangeAvailability(surface, true);
  const deviceAvailability = dimensionAvailability(surface, "device", columns);
  const activeDimensions = PARAM_DIMENSIONS.flatMap((dimension) => {
    const value = sp.get(dimension);
    return value ? [{ dimension, value, availability: dimensionAvailability(surface, dimension, columns) }] : [];
  });

  function navigate(mutate: (next: URLSearchParams) => void) {
    const next = new URLSearchParams(sp.toString());
    mutate(next);
    for (const name of PAGINATION_PARAMS) next.delete(name);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function choosePreset(key: RangePreset) {
    setRangeDraft(null);
    navigate((next) => {
      next.delete("from");
      next.delete("to");
      if (key === "24h") next.delete("period");
      else next.set("period", key);
    });
  }

  function chooseDevice(key: Device | null) {
    navigate((next) => (key ? next.set("device", key) : next.delete("device")));
  }

  // Plage personnalisée lue pour l'affichage seulement : le serveur la valide.
  const fromMs = from ? parseUtcInstant(from) : null;
  const toMs = to ? parseUtcInstant(to) : null;
  const customReadable = from !== null && to !== null && fromMs !== null && toMs !== null && fromMs < toMs;

  function toggleRangeEditor() {
    if (rangeDraft) {
      setRangeDraft(null);
      return;
    }
    const nowMs = Date.now();
    setRangeDraft(
      customReadable
        ? { from: utcToLocalInput(from, timeZone), to: utcToLocalInput(to, timeZone) }
        : {
            from: utcToLocalInput(new Date(nowMs - PRESET_MS[preset ?? "24h"]).toISOString(), timeZone),
            to: utcToLocalInput(new Date(nowMs).toISOString(), timeZone),
          },
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2" data-testid="global-filters">
      <Segmented
        label="Période"
        testid="filter-period"
        availability={presetAvailability}
        items={[
          ...RANGE_PRESETS.map((key) => ({ key, label: PRESET_LABELS[key] })),
          { key: "custom", label: "Personnalisée", availability: customAvailability },
        ]}
        value={custom ? "custom" : preset}
        onChange={(key) => (key === "custom" ? toggleRangeEditor() : choosePreset(key as RangePreset))}
      />
      <Segmented
        label="Appareil"
        testid="filter-device"
        availability={deviceAvailability}
        items={[
          { key: "all", label: "Tous" },
          ...DEVICES.map((key) => ({
            key,
            label: DEVICE_LABELS[key],
            availability: conditionAvailability(surface, { dimension: "device", operator: "eq", value: key }, columns),
          })),
        ]}
        value={device ?? "all"}
        onChange={(key) => chooseDevice(key === "all" ? null : (key as Device))}
      />
      <button
        type="button"
        onClick={() => setDrawerOpen((open) => !open)}
        aria-expanded={drawerOpen}
        aria-controls="filtres-dimensions"
        data-testid="filter-drawer-toggle"
        className="rounded-lg border border-line bg-panel2 px-2.5 py-1 text-xs font-medium text-ink-soft transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
      >
        Filtres{activeDimensions.length ? ` (${activeDimensions.length})` : ""}
      </button>

      {custom && (
        <Chip
          testid="filter-chip-range"
          label={
            customReadable
              ? `${rangeLabel({ from, to, preset: null, bucketSeconds: 0 }, timeZone)} (${timeZone})`
              : "Plage personnalisée illisible"
          }
          availability={customReadable ? customAvailability : { available: false, reason: "Plage illisible : retirez-la." }}
          removeLabel="Retirer la plage personnalisée"
          onRemove={() => {
            setRangeDraft(null);
            navigate((next) => {
              next.delete("from");
              next.delete("to");
            });
          }}
        />
      )}
      {activeDimensions.map(({ dimension, value, availability }) => (
        <Chip
          key={dimension}
          testid={`filter-chip-${dimension}`}
          label={`${DIMENSION_LABELS[dimension]} : ${value}`}
          availability={availability}
          removeLabel={`Retirer le filtre ${DIMENSION_LABELS[dimension]}`}
          onRemove={() => navigate((next) => next.delete(dimension))}
        />
      ))}

      {rangeDraft && customAvailability.available && (
        <RangeEditor
          initialFrom={rangeDraft.from}
          initialTo={rangeDraft.to}
          timeZone={timeZone}
          onCancel={() => setRangeDraft(null)}
          onApply={(fromIso, toIso) => {
            setRangeDraft(null);
            navigate((next) => {
              next.delete("period");
              next.set("from", fromIso);
              next.set("to", toIso);
            });
          }}
        />
      )}

      {drawerOpen && (
        <DimensionDrawer
          sp={sp}
          availability={(dimension) => dimensionAvailability(surface, dimension, columns)}
          onClose={() => setDrawerOpen(false)}
          onApply={(values) => {
            setDrawerOpen(false);
            navigate((next) => {
              for (const [dimension, value] of Object.entries(values)) {
                if (value) next.set(dimension, value);
                else next.delete(dimension);
              }
            });
          }}
        />
      )}
    </div>
  );
}

function RangeEditor({
  initialFrom,
  initialTo,
  timeZone,
  onApply,
  onCancel,
}: {
  initialFrom: string;
  initialTo: string;
  timeZone: string;
  onApply: (fromIso: string, toIso: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [fromValue, setFromValue] = useState(initialFrom);
  const [toValue, setToValue] = useState(initialTo);
  const [error, setError] = useState<{ field: "from" | "to"; message: string } | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fromIso = localInputToUtc(fromValue, timeZone);
    if (!fromIso) {
      setError({ field: "from", message: "Début invalide, ou heure inexistante (passage à l'heure d'été)." });
      return;
    }
    const toIso = localInputToUtc(toValue, timeZone);
    if (!toIso) {
      setError({ field: "to", message: "Fin invalide, ou heure inexistante (passage à l'heure d'été)." });
      return;
    }
    const range = resolveRange({ from: fromIso, to: toIso }, Date.now());
    if (!range.ok) {
      setError({ field: range.error.parameter === "to" ? "to" : "from", message: rangeMessage(range.error) });
      return;
    }
    onApply(range.value.from, range.value.to);
  }

  const field = (name: "from" | "to", label: string, value: string, set: (v: string) => void) => (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-soft">
      {label}
      <input
        type="datetime-local"
        name={name}
        value={value}
        onChange={(event) => {
          set(event.target.value);
          setError(null);
        }}
        aria-invalid={error?.field === name}
        aria-describedby={error?.field === name ? `${id}-erreur` : undefined}
        data-testid={`filter-range-${name}`}
        className={INPUT_CLASS}
        required
      />
      {error?.field === name && (
        <span id={`${id}-erreur`} role="alert" className="text-[11px] font-medium text-bad" data-testid="filter-range-error">
          {error.message}
        </span>
      )}
    </label>
  );

  return (
    <form
      onSubmit={submit}
      aria-label="Plage personnalisée"
      className="flex basis-full flex-wrap items-end gap-3 rounded-lg border border-line bg-panel2 p-3"
      data-testid="filter-range-editor"
    >
      {field("from", `Début (${timeZone})`, fromValue, setFromValue)}
      {field("to", `Fin, exclue (${timeZone})`, toValue, setToValue)}
      <p className="basis-full text-[11px] text-ink-faint sm:basis-auto">30 jours au plus, fin au plus tard maintenant.</p>
      <div className="flex gap-2">
        <button type="submit" className="btn-accent" data-testid="filter-range-apply">
          Appliquer
        </button>
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Annuler
        </button>
      </div>
    </form>
  );
}

function DimensionDrawer({
  sp,
  availability,
  onApply,
  onClose,
}: {
  sp: URLSearchParams;
  availability: (dimension: (typeof PARAM_DIMENSIONS)[number]) => FilterAvailability;
  onApply: (values: Record<string, string>) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [invalid, setInvalid] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const values: Record<string, string> = {};
    for (const dimension of PARAM_DIMENSIONS) {
      // Champ désactivé (dimension non applicable) : absent du formulaire, l'URL garde sa valeur.
      if (!data.has(dimension)) continue;
      const value = String(data.get(dimension)).trim();
      if (value && !isSafeText(value, VALUE_MAX)) {
        setInvalid(dimension);
        return;
      }
      values[dimension] = value;
    }
    onApply(values);
  }

  return (
    <form
      id="filtres-dimensions"
      onSubmit={submit}
      aria-label="Filtres par dimension"
      className="grid basis-full gap-3 rounded-lg border border-line bg-panel2 p-3 sm:grid-cols-2 lg:grid-cols-4"
      data-testid="filter-drawer"
    >
      {PARAM_DIMENSIONS.map((dimension) => {
        const state = availability(dimension);
        return (
          <label key={dimension} className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-soft">
            {DIMENSION_LABELS[dimension]}
            <input
              name={dimension}
              defaultValue={sp.get(dimension) ?? ""}
              maxLength={VALUE_MAX}
              disabled={!state.available}
              aria-invalid={invalid === dimension}
              aria-describedby={`${id}-${dimension}`}
              data-testid={`filter-input-${dimension}`}
              className={INPUT_CLASS}
            />
            <span id={`${id}-${dimension}`} className={`text-[11px] ${invalid === dimension ? "text-bad" : "text-ink-faint"}`}>
              {invalid === dimension
                ? `Valeur invalide (1 à ${VALUE_MAX} caractères, sans caractère de contrôle).`
                : state.available
                  ? "Valeur exacte ; vide = toutes."
                  : state.reason}
            </span>
          </label>
        );
      })}
      <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className="btn-accent" data-testid="filter-drawer-apply">
          Appliquer
        </button>
        <button type="button" className="btn-ghost" onClick={onClose}>
          Fermer
        </button>
      </div>
    </form>
  );
}

function Chip({
  label,
  availability,
  removeLabel,
  onRemove,
  testid,
}: {
  label: string;
  availability: FilterAvailability;
  removeLabel: string;
  onRemove: () => void;
  testid: string;
}) {
  const applied = availability.available;
  return (
    <span
      data-testid={testid}
      data-applied={applied}
      title={applied ? undefined : availability.reason}
      className={`flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
        applied ? "border-perf/30 bg-perf/10 text-perf" : "border-warn/40 bg-warn/10 text-ink-soft line-through decoration-warn/60"
      }`}
    >
      <span className="truncate">{label}</span>
      {!applied && <span className="sr-only">— non appliqué sur cet écran : {availability.reason}</span>}
      <button
        type="button"
        onClick={onRemove}
        aria-label={removeLabel}
        title="Retirer"
        className="ml-0.5 rounded opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf"
      >
        ×
      </button>
    </span>
  );
}

function Segmented({
  label,
  items,
  value,
  onChange,
  availability,
  testid,
}: {
  label: string;
  items: { key: string; label: string; availability?: FilterAvailability }[];
  value: string | null;
  onChange: (key: string) => void;
  /** Disponibilité du groupe entier (écran sans plage, dimension sans objet…). */
  availability: FilterAvailability;
  testid: string;
}) {
  const id = useId();
  const groupReason = availability.available ? null : availability.reason;
  return (
    <div
      role="group"
      aria-label={label}
      aria-describedby={groupReason ? id : undefined}
      title={groupReason ?? undefined}
      className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5"
      data-testid={testid}
    >
      {groupReason && (
        <span id={id} className="sr-only">
          {groupReason}
        </span>
      )}
      {items.map((item) => {
        const reason = groupReason ?? (item.availability && !item.availability.available ? item.availability.reason : null);
        const active = value === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            disabled={reason !== null}
            aria-pressed={active}
            title={reason ?? undefined}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-perf disabled:cursor-not-allowed disabled:opacity-50 ${
              active ? "bg-panel text-ink shadow-sm ring-1 ring-line" : "text-ink-faint hover:text-ink-soft"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
