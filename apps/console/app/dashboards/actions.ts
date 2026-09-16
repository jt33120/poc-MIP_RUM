"use server";
// Server Actions des tableaux de bord configurables (P1). Validation côté serveur
// puis CRUD via lib/queries-dashboards ; le layout est normalisé par updateLayout.
import { redirect } from "next/navigation";
import { revalidatePath } from "@/lib/next-cache";
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
  insertDashboard,
  updateDashboardMeta,
  updateLayout,
} from "@/lib/queries-dashboards";
import { getUser } from "@/lib/auth";
import { canCreateDashboard, getWritableDashboard } from "@/lib/dashboard-access";

function appIdFromForm(fd: FormData): string | null {
  return String(fd.get("app_id") ?? "").trim() || null;
}

/**
 * Le tableau de bord `id`, SI l'utilisateur courant a le droit d'y toucher —
 * null sinon, et l'action s'arrête sans rien écrire.
 *
 * Lecture et écriture ne sont pas équivalentes : un dashboard transverse peut
 * être lu avec un filtre tenant, mais seul son admin peut le modifier. Un viewer
 * ne touche qu'à ses propres dashboards liés à une app autorisée.
 */
async function dashboardAutorise(id: number) {
  const user = await getUser();
  return getWritableDashboard(id, user);
}

/** Un viewer ne crée que dans une app de son scope — jamais en transverse. */
async function appAutorisee(appId: string | null): Promise<boolean> {
  return canCreateDashboard(await getUser(), appId);
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
  let eventName: string | undefined;
  if (WIDGET_META[wtype].needsEventName) {
    const name = String(fd.get("event_name") ?? "").trim();
    if (!name || name.length > 100 || /[\u0000-\u001F\u007F]/.test(name)) {
      throw new Error("nom d’événement invalide");
    }
    eventName = name;
  }
  const dash = await dashboardAutorise(id);
  if (!dash) return;
  const widget: Widget = {
    type: wtype,
    title: defaultTitle(wtype, metric, eventName),
    ...(metric ? { metric } : {}),
    ...(eventName ? { eventName } : {}),
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
