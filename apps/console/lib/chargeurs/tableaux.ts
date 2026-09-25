// LE CHARGEUR DE L'ÉCRAN « Tableaux de bord » (C6) — `app/dashboards/page.tsx`.
//
// Les tableaux du périmètre et les modèles prêts à cloner. Ce que la table dit de
// chaque tableau — son app par son NOM, son propriétaire, le TYPE de ses cartes —
// est calculé ICI : la disposition entière d'un tableau (jusqu'à 24 configurations
// d'analyse) ne voyage pas pour en tirer trois puces. Les droits d'écriture
// (créer, cloner, dans quelles apps) sont décidés par le principal du chargeur,
// par la porte unique des tableaux (`lib/dashboard-access.ts`) : un bouton qui
// échouerait n'est pas proposé.
import { canCreateDashboard, dashboardApps, dashboardPrincipal, ownerLabel } from "../dashboard-access";
import { optionsDeClonage, pucesDuTableau } from "../dashboard-templates";
import { nombreDeCartes } from "../dashboards";
import { analyserFiltres } from "../filtres-ecran";
import { registeredApps } from "../queries";
import { listDashboards } from "../queries-dashboards";
import type { Chargeur } from "./commun";

export const chargerTableaux = (async (principal, sp) => {
  const user = await dashboardPrincipal(principal);
  // L'accès normal est garanti par le middleware ; sans session, aucune métadonnée ne sort.
  if (!user) return { etat: "sans_session" } as const;
  const ecran = await analyserFiltres(principal, sp, "/dashboards");
  if (!ecran.ok) return { etat: "refus", problem: ecran.problem } as const;
  const [dashboards, allApps] = await Promise.all([listDashboards(ecran.filters), registeredApps()]);
  const apps = dashboardApps(allApps, user);
  // Le nom d'une app, pas son identifiant (W-D2) ; une app retirée du registre garde son identifiant.
  const libelleApp = new Map(allApps.map((a) => [a.app_id, a.name || a.app_id]));
  return {
    etat: "ok",
    query: ecran.query,
    notApplied: ecran.notApplied,
    appFiltre: ecran.filters.app,
    demo: user.demo === true,
    canCreateGlobal: canCreateDashboard(user, null),
    appsCreables: apps.filter((a) => canCreateDashboard(user, a.app_id)),
    clonage: optionsDeClonage(user, apps),
    tableaux: dashboards.map((d) => ({
      id: d.id,
      name: d.name,
      app: d.app_id === null ? null : (libelleApp.get(d.app_id) ?? d.app_id),
      proprietaire: ownerLabel(d, user),
      // F37 : un titre de section n'est pas une carte — ni compté, ni en puce.
      cartes: nombreDeCartes(d.layout),
      puces: pucesDuTableau(d.layout),
      updated_at: d.updated_at,
    })),
  } as const;
}) satisfies Chargeur<unknown>;
