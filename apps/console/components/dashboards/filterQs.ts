// Sérialisation des filtres globaux en querystring (préservation des liens
// internes + export CSV). Extrait de app/dashboards/[id]/page.tsx.
import type { Filters } from "@/lib/filters";

/** Querystring des filtres globaux (préservation des liens internes + export). */
export function filterQs(f: Filters): string {
  const p = new URLSearchParams();
  if (f.app) p.set("app", f.app);
  if (f.period !== "24h") p.set("period", f.period);
  if (f.device) p.set("device", f.device);
  return p.toString();
}
