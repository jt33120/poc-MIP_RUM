"use server";
// Server Actions des tableaux de bord configurables (P1). Validation côté serveur
// puis CRUD via lib/queries-dashboards ; le layout est normalisé par updateLayout.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  defaultTitle,
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  type Widget,
  type WidgetType,
} from "@/lib/dashboards";
import {
  deleteDashboard,
  getDashboard,
  insertDashboard,
  updateDashboardMeta,
  updateLayout,
} from "@/lib/queries-dashboards";
import { getUser } from "@/lib/auth";

function appIdFromForm(fd: FormData): string | null {
  return String(fd.get("app_id") ?? "").trim() || null;
}

/**
 * Le tableau de bord `id`, SI l'utilisateur courant a le droit d'y toucher —
 * null sinon, et l'action s'arrête sans rien écrire.
 *
 * Ces actions ne recevaient que l'identifiant, un entier séquentiel donc
 * devinable, et agissaient sans vérifier à quelle application le tableau
 * appartient : un viewer scopé sur une app pouvait renommer, vider ou supprimer
 * le tableau de bord d'une autre. Un tableau sans app_id est transverse et reste
 * accessible à tout utilisateur connecté, comme avant.
 */
async function dashboardAutorise(id: number) {
  const dash = await getDashboard(id);
  if (!dash) return null;
  const user = await getUser();
  if (!user) return null;
  if (dash.app_id && user.apps && !user.apps.includes(dash.app_id)) return null;
  return dash;
}

/** Un viewer scopé ne crée pas de tableau sur une application qu'il ne voit pas. */
async function appAutorisee(appId: string | null): Promise<boolean> {
  if (!appId) return true; // tableau transverse
  const user = await getUser();
  if (!user) return false;
  return !user.apps || user.apps.includes(appId);
}

export async function createDashboardAction(fd: FormData): Promise<void> {
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const app_id = appIdFromForm(fd);
  if (!(await appAutorisee(app_id))) return;
  const created_by = (await getUser())?.email ?? null;
  const id = await insertDashboard({ name, app_id, created_by });
  redirect(`/dashboards/${id}`);
}

export async function renameDashboardAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  const cible = appIdFromForm(fd);
  if (!(await appAutorisee(cible))) return; // ni déplacer un tableau hors de son scope
  await updateDashboardMeta(id, name, cible);
  revalidatePath(`/dashboards/${id}`);
}

export async function deleteDashboardAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  await deleteDashboard(id);
  redirect("/dashboards");
}

export async function addWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const type = String(fd.get("type") ?? "");
  if (!(WIDGET_TYPES as readonly string[]).includes(type)) {
    throw new Error(`type de widget invalide : ${type}`);
  }
  const wtype = type as WidgetType;
  let metric: string | undefined;
  if (WIDGET_META[wtype].needsMetric) {
    const m = String(fd.get("metric") ?? "");
    if (!(WIDGET_VITALS as readonly string[]).includes(m)) {
      throw new Error(`métrique invalide : ${m}`);
    }
    metric = m;
  }
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  const widget: Widget = {
    type: wtype,
    title: defaultTitle(wtype, metric),
    ...(metric ? { metric } : {}),
  };
  await updateLayout(id, [...dash.layout, widget]);
  revalidatePath(`/dashboards/${id}`);
}

export async function removeWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const index = Number(fd.get("index"));
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  if (!Number.isInteger(index) || index < 0 || index >= dash.layout.length) return;
  const layout = dash.layout.filter((_, i) => i !== index);
  await updateLayout(id, layout);
  revalidatePath(`/dashboards/${id}`);
}

export async function moveWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const index = Number(fd.get("index"));
  const dir = String(fd.get("dir") ?? "");
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  if (!Number.isInteger(index) || index < 0 || index >= dash.layout.length) return;
  const target = dir === "up" ? index - 1 : dir === "down" ? index + 1 : index;
  if (target < 0 || target >= dash.layout.length) return;
  const layout = [...dash.layout];
  [layout[index], layout[target]] = [layout[target], layout[index]];
  await updateLayout(id, layout);
  revalidatePath(`/dashboards/${id}`);
}
