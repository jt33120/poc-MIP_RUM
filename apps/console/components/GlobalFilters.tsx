"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

const PERIOD_ITEMS = [
  { key: "1h", label: "1 h" },
  { key: "24h", label: "24 h" },
  { key: "7d", label: "7 j" },
];

const DEVICE_ITEMS = [
  { key: "all", label: "Tous" },
  { key: "desktop", label: "Desktop" },
  { key: "mobile", label: "Mobile" },
];

/** Filtres globaux période/appareil — état porté par les searchParams (partage
 * d'URL). Le projet (?app) n'est plus un filtre : il se choisit en amont (/select)
 * et se change via le bandeau latéral ; on se contente de le préserver dans l'URL. */
export function GlobalFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = {
    period: sp.get("period") ?? "24h",
    device: sp.get("device") ?? "all",
  };

  function set(key: string, value: string) {
    const next = new URLSearchParams(sp.toString()); // conserve ?app
    // défauts non sérialisés -> URLs propres
    if (value === "all" || (key === "period" && value === "24h")) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        items={PERIOD_ITEMS}
        value={current.period}
        onChange={(v) => set("period", v)}
        testid="filter-period"
      />
      <Segmented
        items={DEVICE_ITEMS}
        value={current.device}
        onChange={(v) => set("device", v)}
        testid="filter-device"
      />
    </div>
  );
}

function Segmented({
  items,
  value,
  onChange,
  testid,
}: {
  items: { key: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  testid: string;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-line bg-panel2 p-0.5" data-testid={testid}>
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === it.key
              ? "bg-panel text-ink shadow-sm ring-1 ring-line"
              : "text-ink-faint hover:text-ink-soft"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
