// LE CHARGEUR D'UN TABLEAU DE BORD (C6) — `app/dashboards/[id]/page.tsx`.
//
// Le tableau, résolu par la porte unique (`getAccessibleDashboard`) : absent ou
// hors périmètre, c'est le même `introuvable`. Puis la donnée de ses cartes, par
// le résolveur partagé avec l'export CSV (`resolveWidgets`) : même contrat de
// filtres, même intersection avec l'app du tableau, mêmes refus. Une carte qui
// échoue le dit sur elle-même (`kind: "error"`), sans emporter le tableau.
//
// Les droits d'édition (renommer, cloner, ajouter une section) sont décidés par le
// principal du chargeur : un formulaire qui échouerait n'est pas rendu.
import {
  canCreateDashboard,
  canDashboardAction,
  dashboardApps,
  dashboardFilters,
  dashboardPrincipal,
  getAccessibleDashboard,
  ownerLabel,
} from "../dashboard-access";
import { queryOf } from "../filters";
import { analyserFiltres } from "../filtres-ecran";
import { fuseauDe } from "../fuseau";
import { registeredApps } from "../queries";
import { paramReader } from "../query-contract";
import { lireComparaison } from "../view-state";
import { resolveWidgets } from "../widget-data";
import type { Chargeur } from "./commun";

export const chargerTableau = (async (principal, sp, chemin) => {
  const id = Number(chemin.id);
  const user = await dashboardPrincipal(principal);
  const dash = Number.isInteger(id) ? await getAccessibleDashboard(id, user) : null;
  if (!dash) return { etat: "introuvable" } as const;
  const ecran = await analyserFiltres(principal, sp, `/dashboards/${dash.id}`);
  if (!ecran.ok) return { etat: "refus", titre: dash.name, problem: ecran.problem } as const;
  const f = dashboardFilters(dash, ecran.query, user);
  if (!f) return { etat: "introuvable" } as const;

  const timeZone = await fuseauDe(ecran.query.scope.requestedApp);
  // `cmp` de l'écran (§ 3.1) : défaut « aucune » sur ce domaine. En `prev`, seules
  // les cartes « Valeur » relisent la période précédente (W-B2) ; les autres le disent.
  const reglages = lireComparaison(`/dashboards/${dash.id}`, paramReader(sp));
  // Quatre lectures à la fois, dans l'ordre de la grille. Vingt-quatre cartes
  // lancées ensemble épuiseraient le pool de connexions.
  const [data, apps] = await Promise.all([
    resolveWidgets(dash.layout, { filters: f, timeZone, nowMs: Date.now(), comparaison: reglages.valeur.mode }),
    registeredApps(),
  ]);
  return {
    etat: "ok",
    tableau: { id: dash.id, name: dash.name, app_id: dash.app_id, layout: dash.layout, revision: dash.revision },
    proprietaire: ownerLabel(dash, user),
    query: ecran.query,
    label: ecran.label,
    // La requête des CARTES (celle de l'écran intersectée avec l'app du tableau) : la population affichée.
    population: queryOf(f),
    timeZone,
    data,
    // Le sélecteur de « Renommer » : jamais une app hors du périmètre.
    apps: dashboardApps(apps, user).map((a) => a.app_id),
    droits: {
      editable: canDashboardAction(user, dash, "rename"),
      clonable: canDashboardAction(user, dash, "clone"),
      global: canCreateDashboard(user, null),
      // F37 — même garde que l'action (`add_widget`) : jamais un viewer non propriétaire ni une démo (V9).
      sections: canDashboardAction(user, dash, "add_widget"),
    },
  } as const;
}) satisfies Chargeur<unknown>;
