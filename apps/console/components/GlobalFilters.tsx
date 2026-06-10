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

/** Filtres globaux app/période/device — état porté par les searchParams (partage d'URL). */
export function GlobalFilters({ apps }: { apps: { app_id: string; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const current = {
    app: sp.get("app") ?? "all",
    period: sp.get("period") ?? "24h",
    device: sp.get("device") ?? "all",
  };

  function set(key: string, value: string) {
    const next = new URLSearchParams(sp.toString());
    // défauts non sérialisés -> URLs propres
    if (value === "all" || (key === "period" && value === "24h")) next.delete(key);
    else next.set(key, value);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={current.app}
        onChange={(e) => set("app", e.target.value)}
        data-testid="filter-app"
        className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 shadow-sm focus:border-blue-500 focus:outline-none"
      >
        <option value="all">Toutes les apps</option>
        {apps.map((a) => (
          <option key={a.app_id} value={a.app_id}>
            {a.name}
          </option>
        ))}
      </select>
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
    <div className="flex overflow-hidden rounded-md border border-slate-300 shadow-sm" data-testid={testid}>
      {items.map((it, i) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`px-3 py-1.5 text-sm font-medium ${i > 0 ? "border-l border-slate-300" : ""} ${
            value === it.key ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
