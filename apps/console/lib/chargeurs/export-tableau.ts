// L'EXPORT CSV D'UN TABLEAU DE BORD (C6) — `app/api/dashboards/[id]/export/route.ts`.
//
// La même donnée que l'écran, projetée en lignes : même porte (un tableau absent ou
// hors périmètre est `introuvable`, sans un mot de son contenu), même contrat de
// filtres (P6.2), même AST de carte (P6.5), même intersection avec l'app du
// tableau, mêmes refus — `resolveWidgets` puis `layoutToCsv`.
//
// PLAFOND ET TRONCATURE. 10 000 lignes au total, annoncées dans le fichier quand
// elles sont atteintes. Les cellules qui commencent par `=`, `+`, `-` ou `@` sont
// préfixées : un export ne doit pas devenir une formule exécutée par un tableur.
//
// ANNULATION. La route passe le signal de la requête : un export abandonné par le
// navigateur n'ouvre pas les lectures restantes. (Servi par console-api, c'est
// l'échéance de l'appel qui borne l'export.)
import { canDashboardAction, dashboardFilters, dashboardPrincipal, getAccessibleDashboard } from "../dashboard-access";
import { fuseauDe } from "../fuseau";
import { contractErrorStatus, parseAnalyticsQuery } from "../query-contract";
import { dimensionSchema } from "../query-schema";
import { checkSurface, surfaceFor } from "../surfaces";
import { layoutToCsv, resolveWidgets } from "../widget-data";
import { urlDeLaPage, type CheminEcran, type ParametresEcran, type PrincipalEcran } from "./commun";

export async function chargerExportTableau(principal: PrincipalEcran | null, sp: ParametresEcran, chemin: CheminEcran, signal?: AbortSignal) {
  const user = await dashboardPrincipal(principal);
  if (!user) return { etat: "sans_session" } as const;
  const id = Number(chemin.id);
  const dash = Number.isInteger(id) ? await getAccessibleDashboard(id, user) : null;
  if (!dash || !canDashboardAction(user, dash, "export")) return { etat: "introuvable" } as const;

  const parsed = parseAnalyticsQuery(urlDeLaPage(sp), { principal: user, nowMs: Date.now() });
  if (!parsed.ok) return { etat: "refus", statut: contractErrorStatus(parsed.error), message: parsed.error.message } as const;
  const surface = surfaceFor(`/dashboards/${dash.id}`);
  const check = surface ? checkSurface(parsed.value, surface, await dimensionSchema()) : null;
  if (check && !check.ok) return { etat: "refus", statut: 400, message: check.error.message } as const;
  const eff = dashboardFilters(dash, parsed.value, user);
  if (!eff) return { etat: "introuvable" } as const;

  const timeZone = await fuseauDe(parsed.value.scope.requestedApp);
  const data = await resolveWidgets(dash.layout, { filters: eff, timeZone, nowMs: Date.now(), ...(signal ? { signal } : {}) });
  return { etat: "ok", fichier: `dashboard-${dash.id}.csv`, csv: layoutToCsv(dash.name, dash.layout, data, new Date()) } as const;
}
