// LE CHARGEUR DE L'ÉCRAN « Uptime » (C8) — `app/admin/uptime/page.tsx`.
//
// Écran d'ADMINISTRATION (`ECRANS_ADMIN`) : un administrateur, sans portée
// d'application. Il liste les sondes de son périmètre — toutes pour
// l'administrateur de la plateforme, celles de ses applications pour un
// administrateur d'une liste (C8 : il n'administre que celles-ci) — et les
// applications où il peut en créer. Hors administrateur, le chargeur le DIT
// (`interdit`) ; la page redirige.
//
// DISPONIBILITÉ INCONNUE PENDANT UNE PANNE DE COLLECTE (29/09/2026). La vue
// `v_uptime_status` rapporte les vérifications RÉUSSIES aux vérifications
// PRÉSENTES : sans passage (scheduler ou base coupés), pas de résultat, et la
// disponibilité restait à 100 %. Tant que la vue ne compte pas les passages
// attendus (une migration, hors de ce lot), l'affichage se corrige ici : une
// fenêtre `interrompue` du registre (`collecte_fenetre`) qui recoupe les 24 h de
// la sonde rend sa disponibilité INCONNUE, avec la fenêtre pour raison.
import { cadenceTickPubliee } from "../queries-planifie";
import { listApps } from "../queries";
import { lireFenetresCollecte } from "../queries-collecte";
import { listUptimeStatus, type UptimeStatusRow } from "../queries-uptime";
import type { FenetreCollecte } from "../series";
import type { Chargeur } from "./commun";

const JOUR_MS = 86_400_000;

/** Une ligne de sonde, avec la raison d'une disponibilité inconnue (`uptime_pct_24h` est alors `null`). */
export type SondeAffichee = UptimeStatusRow & { uptime_inconnu: string | null };

/**
 * La disponibilité 24 h d'une sonde, corrigée des fenêtres interrompues de sa
 * plateforme (`portee = '*'`) ou de son application. PURE.
 */
export function uptimeSelonCollecte(
  check: UptimeStatusRow,
  fenetres: readonly FenetreCollecte[],
  maintenant: number,
): SondeAffichee {
  const depuis = maintenant - JOUR_MS;
  const panne = fenetres.find((f) => {
    if (f.etat !== "interrompue") return false;
    if (f.portee !== undefined && f.portee !== "*" && f.portee !== check.app_id) return false;
    const fin = f.fin === null ? Number.POSITIVE_INFINITY : Date.parse(f.fin);
    return Date.parse(f.debut) < maintenant && fin > depuis;
  });
  if (!panne) return { ...check, uptime_inconnu: null };
  return {
    ...check,
    uptime_pct_24h: null,
    uptime_inconnu: "collecte interrompue sur les dernières 24 h : les vérifications manquées ne sont pas comptées",
  };
}

export const chargerSondes = (async (principal) => {
  if (!principal) return { etat: "sans_session" } as const;
  if (principal.role !== "admin" || principal.demo) return { etat: "interdit" } as const;
  const maintenant = Date.now();
  const [apps, checks, cadence, fenetres] = await Promise.all([
    listApps(),
    listUptimeStatus(),
    cadenceTickPubliee(),
    // Un registre illisible ne met pas l'écran en échec : la disponibilité reste celle de la vue.
    lireFenetresCollecte(
      { from: new Date(maintenant - JOUR_MS).toISOString(), to: new Date(maintenant).toISOString() },
      principal.apps,
    ).catch(() => [] as FenetreCollecte[]),
  ]);
  const dans = (app: string) => principal.apps === null || principal.apps.includes(app);
  return {
    etat: "ok",
    apps: apps.filter((a) => dans(a.app_id)),
    checks: checks.filter((c) => dans(c.app_id)).map((c) => uptimeSelonCollecte(c, fenetres, maintenant)),
    cadence,
  } as const;
}) satisfies Chargeur<unknown>;
