// Frontière unique d'accès aux tableaux de bord. Les identifiants sont
// séquentiels : un contrôle uniquement dans les actions ne protège ni le rendu
// de page ni l'export CSV. Toutes les surfaces passent donc ici et échouent sans
// révéler le tableau hors périmètre.
//
// LES ACTIONS SONT ÉNUMÉRÉES, PAS DEVINÉES (P6.5). « Modifier » recouvrait quatre
// gestes différents — renommer, déplacer vers une autre app, éditer les widgets,
// supprimer —, chacun avec son propre risque. Chaque geste a désormais son nom
// dans `DASHBOARD_ACTIONS`, une ligne dans la matrice ci-dessous, et un test.
//
// CE QUE LA PROPRIÉTÉ N'EST PAS. Être propriétaire n'ouvre AUCUN droit nouveau :
// le propriétaire d'un tableau lié à une app qu'il n'est plus autorisé à lire ne
// peut plus rien en faire. La propriété restreint, elle n'accorde pas.
//
// MATRICE (lignes : qui ; colonnes : ce qu'il peut) —
//
//   | acteur                               | read/export | écriture |
//   |--------------------------------------|-------------|----------|
//   | anonyme                              | non         | non      |
//   | session démo                         | oui (scope) | NON      |
//   | viewer, app hors périmètre           | non         | non      |
//   | viewer autorisé, non propriétaire    | oui         | non      |
//   | viewer autorisé, propriétaire        | oui         | oui      |
//   | admin, app dans son périmètre        | oui         | oui      |
//   | admin, tableau transverse (app null) | oui         | oui      |
//
// Un tableau transverse (`app_id` null) reste LISIBLE par un viewer — ses widgets
// sont alors forcés sur ses seules apps autorisées — mais n'est jamais ÉCRIT par
// lui : il n'appartient à aucune app dont il puisse être propriétaire.
import type { SessionUser } from "./auth";
import { filtersOfQuery, type Filters } from "./filters";
import type { AppItem } from "./queries";
import { getDashboard, type DashboardRow } from "./queries-dashboards";
import { accountIdOf } from "./queries-accounts";
import { intersectApp, type AnalyticsQuery } from "./query-contract";

/** Les gestes possibles sur un tableau de bord EXISTANT. La création a sa propre porte. */
export const DASHBOARD_ACTIONS = [
  "read",
  "export",
  "rename",
  "move_app",
  "delete",
  "add_widget",
  "remove_widget",
  "reorder_widget",
  "configure_widget",
  "clone",
] as const;
export type DashboardAction = (typeof DASHBOARD_ACTIONS)[number];

/** Gestes de LECTURE : ils ne changent rien et suivent le périmètre signé. */
export const DASHBOARD_READ_ACTIONS: readonly DashboardAction[] = ["read", "export", "clone"];

/**
 * Le principal d'un tableau de bord : la session, plus son compte interne résolu
 * (`accountId`). Avant migration-v79, ou pour une session sans compte actif, il
 * vaut null : la propriété retombe alors sur l'email `created_by`, seul lien dont
 * disposait le modèle v18.
 */
export interface DashboardPrincipal {
  email: string;
  role: "admin" | "viewer";
  apps: string[] | null;
  demo?: boolean;
  accountId?: string | null;
}

/** Résout le compte interne d'une session pour les gardes de propriété. */
export async function dashboardPrincipal(user: SessionUser | null): Promise<DashboardPrincipal | null> {
  if (!user) return null;
  return { ...user, accountId: await accountIdOf(user.email) };
}

/**
 * Périmètre TRANSVERSE : une liste d'apps absente, et elle seule. Le rôle ne
 * suffit pas — un admin à qui on a confié `apps: ['app-a']` est un administrateur
 * DE app-a. Lui ouvrir app-b au motif qu'il est admin viderait de son sens la
 * liste qu'on lui a signée.
 */
function isUnrestricted(user: DashboardPrincipal): boolean {
  return user.apps === null;
}

/** L'app d'un tableau est-elle dans le périmètre signé ? `[]` ne vaut jamais « toutes ». */
function scopeAllows(user: DashboardPrincipal, appId: string): boolean {
  return user.apps === null || user.apps.includes(appId);
}

/**
 * Propriété d'un tableau. La clé fait foi dès qu'elle existe ; l'email ne sert
 * que tant qu'aucun compte n'a été résolu (tableau v18, ou compte supprimé).
 * Sans cette priorité, un compte recréé avec la même adresse hériterait des
 * tableaux de son homonyme.
 */
export function ownsDashboard(user: DashboardPrincipal, dashboard: DashboardRow): boolean {
  if (dashboard.owner_id !== null && dashboard.owner_id !== undefined) {
    return user.accountId != null && dashboard.owner_id === user.accountId;
  }
  return dashboard.created_by !== null && dashboard.created_by === user.email;
}

/** Un dashboard lié à une app est accessible seulement dans le scope signé. */
export function canAccessDashboard(user: DashboardPrincipal | null, dashboard: DashboardRow): boolean {
  if (!user) return false;
  if (isUnrestricted(user)) return true;
  // Un dashboard transverse ne transporte aucune app par lui-même. Ses widgets
  // seront ensuite forcés sur une app autorisée par `dashboardFilters`.
  return dashboard.app_id === null || scopeAllows(user, dashboard.app_id);
}

/**
 * L'écriture est volontairement plus stricte que la lecture transverse : un
 * viewer peut LIRE une vue globale filtrée à ses apps, mais ne peut jamais en
 * créer une ni l'altérer. Seul l'admin a une écriture transverse.
 */
export function canCreateDashboard(user: DashboardPrincipal | null, appId: string | null): boolean {
  if (!user || user.demo) return false;
  // Créer un tableau TRANSVERSE demande un périmètre transverse : un admin scopé
  // ne peut pas fabriquer une vue qui déborde la liste d'apps qu'on lui a signée.
  if (appId === null) return user.role === "admin" && user.apps === null;
  return scopeAllows(user, appId);
}

/** Un viewer ne modifie que son propre dashboard, lié à une app dans son scope. */
export function canMutateDashboard(user: DashboardPrincipal | null, dashboard: DashboardRow): boolean {
  if (!user || user.demo) return false;
  if (user.role === "admin") {
    // Un admin scopé gère DANS son périmètre ; un tableau transverse reste réservé
    // à un admin transverse, faute d'app à laquelle rattacher la décision.
    return dashboard.app_id === null ? user.apps === null : scopeAllows(user, dashboard.app_id);
  }
  if (dashboard.app_id === null || !scopeAllows(user, dashboard.app_id)) return false;
  return ownsDashboard(user, dashboard);
}

/**
 * Le geste `action` est-il permis à `user` sur `dashboard` ? Une seule porte pour
 * les pages, les server actions et l'API : un nouveau geste s'ajoute à la liste,
 * il ne se glisse pas dans un `canMutate` générique.
 */
export function canDashboardAction(
  user: DashboardPrincipal | null,
  dashboard: DashboardRow,
  action: DashboardAction,
): boolean {
  if (!user || !canAccessDashboard(user, dashboard)) return false;
  if (DASHBOARD_READ_ACTIONS.includes(action)) {
    // Cloner, c'est CRÉER ailleurs : lire la source ne suffit pas, il faut aussi
    // le droit d'écrire dans l'app visée — celle du tableau cloné.
    return action !== "clone" || canCreateDashboard(user, dashboard.app_id);
  }
  return canMutateDashboard(user, dashboard);
}

/**
 * Propriétaire affiché. L'adresse d'un AUTRE compte ne sort que vers une session
 * admin — même règle que le workflow d'issue (P5.6) : un viewer n'a pas à
 * apprendre qui travaille sur quoi pour lire un tableau.
 */
export function ownerLabel(dashboard: DashboardRow, user: DashboardPrincipal | null): string {
  if (user && ownsDashboard(user, dashboard)) return "vous";
  if (dashboard.owner_id === null && !dashboard.created_by) return "propriétaire hérité";
  if (user?.role === "admin") return dashboard.owner_email ?? dashboard.created_by ?? "propriétaire hérité";
  return "un autre compte";
}

/** Alias de compatibilité : les nouveaux appels expliciteront create/mutate. */
export function canUseDashboardApp(user: DashboardPrincipal | null, appId: string | null): boolean {
  return canCreateDashboard(user, appId);
}

/** Résolution centrale : null couvre à la fois un id absent et un id hors scope. */
export async function getAccessibleDashboard(
  id: number,
  user: DashboardPrincipal | null,
): Promise<DashboardRow | null> {
  const dashboard = await getDashboard(id);
  return dashboard && canAccessDashboard(user, dashboard) ? dashboard : null;
}

/** Résolution centrale d'écriture : jamais une lecture transverse ne vaut droit de mutation. */
export async function getWritableDashboard(
  id: number,
  user: DashboardPrincipal | null,
  action: DashboardAction = "rename",
): Promise<DashboardRow | null> {
  const dashboard = await getDashboard(id);
  return dashboard && canDashboardAction(user, dashboard, action) ? dashboard : null;
}

/** Le sélecteur ne contient jamais une app hors du scope du viewer. */
export function dashboardApps(apps: AppItem[], user: DashboardPrincipal | null): AppItem[] {
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
  user: DashboardPrincipal | null,
): Filters | null {
  if (!user || !canAccessDashboard(user, dashboard)) return null;
  return filtersOfQuery(dashboard.app_id ? intersectApp(query, dashboard.app_id) : query);
}
