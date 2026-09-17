// Frontière unique d'accès aux tableaux de bord. Les identifiants sont
// séquentiels : un contrôle uniquement dans les actions ne protège ni le rendu
// de page ni l'export CSV. Toutes les surfaces passent donc ici et échouent sans
// révéler le tableau hors périmètre.
import type { SessionUser } from "./auth";
import { filtersOfQuery, type Filters } from "./filters";
import type { AppItem } from "./queries";
import { getDashboard, type DashboardRow } from "./queries-dashboards";
import { intersectApp, type AnalyticsQuery } from "./query-contract";

function isUnrestricted(user: SessionUser): boolean {
  return user.role === "admin" || user.apps === null;
}

/** Un dashboard lié à une app est accessible seulement dans le scope signé. */
export function canAccessDashboard(user: SessionUser | null, dashboard: DashboardRow): boolean {
  if (!user) return false;
  if (isUnrestricted(user)) return true;
  // Un dashboard transverse ne transporte aucune app par lui-même. Ses widgets
  // seront ensuite forcés sur une app autorisée par `dashboardFilters`.
  return dashboard.app_id === null || (user.apps?.includes(dashboard.app_id) ?? false);
}

/**
 * L'écriture est volontairement plus stricte que la lecture transverse : un
 * viewer peut LIRE une vue globale filtrée à ses apps, mais ne peut jamais en
 * créer une ni l'altérer. Seul l'admin a une écriture transverse.
 */
export function canCreateDashboard(user: SessionUser | null, appId: string | null): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (appId === null) return false;
  return user.apps === null || user.apps.includes(appId);
}

/** Un viewer ne modifie que son propre dashboard, lié à une app dans son scope. */
export function canMutateDashboard(user: SessionUser | null, dashboard: DashboardRow): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (dashboard.app_id === null || dashboard.created_by !== user.email) return false;
  return user.apps === null || user.apps.includes(dashboard.app_id);
}

/** Alias de compatibilité : les nouveaux appels expliciteront create/mutate. */
export function canUseDashboardApp(user: SessionUser | null, appId: string | null): boolean {
  return canCreateDashboard(user, appId);
}

/** Résolution centrale : null couvre à la fois un id absent et un id hors scope. */
export async function getAccessibleDashboard(
  id: number,
  user: SessionUser | null,
): Promise<DashboardRow | null> {
  const dashboard = await getDashboard(id);
  return dashboard && canAccessDashboard(user, dashboard) ? dashboard : null;
}

/** Résolution centrale d'écriture : jamais une lecture transverse ne vaut droit de mutation. */
export async function getWritableDashboard(
  id: number,
  user: SessionUser | null,
): Promise<DashboardRow | null> {
  const dashboard = await getDashboard(id);
  return dashboard && canMutateDashboard(user, dashboard) ? dashboard : null;
}

/** Le sélecteur ne contient jamais une app hors du scope du viewer. */
export function dashboardApps(apps: AppItem[], user: SessionUser | null): AppItem[] {
  if (!user || !isUnrestricted(user)) {
    const allowed = user?.apps ?? [];
    return apps.filter((app) => allowed.includes(app.app_id));
  }
  return apps;
}

/**
 * Les filtres des widgets : la requête de l'écran — déjà résolue contre le principal
 * signé (périmètre vide ou app hors périmètre refusés en amont) — INTERSECTÉE avec
 * l'app du tableau de bord. Un tableau de bord lié à B lu avec `app=A` ne remplace
 * pas A par B : l'intersection est vide et chaque widget rend zéro. Un tableau de
 * bord transverse suit l'app de l'écran.
 */
export function dashboardFilters(
  dashboard: DashboardRow,
  query: AnalyticsQuery,
  user: SessionUser | null,
): Filters | null {
  if (!user || !canAccessDashboard(user, dashboard)) return null;
  return filtersOfQuery(dashboard.app_id ? intersectApp(query, dashboard.app_id) : query);
}
