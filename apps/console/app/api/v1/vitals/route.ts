// GET /api/v1/vitals — p75 par vital + séries temporelles. `?series=LCP,INP` choisit
// les vitals à détailler (défaut : aucune série, juste les p75 ; `?series=all` = les 5).
import { handle } from "@/lib/api/handle";
import { preflight } from "@/lib/api/respond";
import { type SeriesRow, vitalSeries, vitalsP75 } from "@/lib/queries";

export const dynamic = "force-dynamic";

const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

export const OPTIONS = preflight;

export const GET = handle(async ({ filters, searchParams }) => {
  const f = filters.legacy;
  const p75 = await vitalsP75(f);

  const raw = (searchParams.get("series") ?? "").trim();
  const wanted =
    raw === "all"
      ? [...VITALS]
      : raw
        ? raw.split(",").map((s) => s.trim().toUpperCase()).filter((s) => (VITALS as readonly string[]).includes(s))
        : [];

  const series: Record<string, SeriesRow[]> = {};
  await Promise.all(wanted.map(async (name) => { series[name] = await vitalSeries(f, name); }));

  return { p75, series };
});
