// LE CHARGEUR DE L'ÉCRAN « Uptime » (C8) — `app/admin/uptime/page.tsx`.
//
// Écran d'ADMINISTRATION (`ECRANS_ADMIN`) : un administrateur, sans portée
// d'application. Il liste les sondes de son périmètre — toutes pour
// l'administrateur de la plateforme, celles de ses applications pour un
// administrateur d'une liste (C8 : il n'administre que celles-ci) — et les
// applications où il peut en créer. Hors administrateur, le chargeur le DIT
// (`interdit`) ; la page redirige.
import { cadenceTickPubliee } from "../queries-planifie";
import { listApps } from "../queries";
import { listUptimeStatus } from "../queries-uptime";
import type { Chargeur } from "./commun";

export const chargerSondes = (async (principal) => {
  if (!principal) return { etat: "sans_session" } as const;
  if (principal.role !== "admin" || principal.demo) return { etat: "interdit" } as const;
  const [apps, checks, cadence] = await Promise.all([listApps(), listUptimeStatus(), cadenceTickPubliee()]);
  const dans = (app: string) => principal.apps === null || principal.apps.includes(app);
  return {
    etat: "ok",
    apps: apps.filter((a) => dans(a.app_id)),
    checks: checks.filter((c) => dans(c.app_id)),
    cadence,
  } as const;
}) satisfies Chargeur<unknown>;
