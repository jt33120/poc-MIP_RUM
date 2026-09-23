"use server";
// Server Actions des tableaux de bord. Validation côté serveur puis CRUD via
// lib/queries-dashboards ; le layout est sérialisé par updateLayout.
//
// CHAQUE ÉCRITURE CITE SA RÉVISION (P6.5). Le formulaire porte la révision
// AFFICHÉE ; si la ligne a bougé entre-temps, l'écriture est refusée et l'écran
// revient avec `conflit=1` — la carte de l'autre onglet n'est pas écrasée. Le
// contexte de filtres (`ctx`) voyage avec le formulaire : une redirection ne doit
// pas ramener l'utilisateur sur une autre fenêtre que celle qu'il regardait.
import { redirect } from "next/navigation";
import { revalidatePath } from "@/lib/next-cache";
import {
  defaultTitle,
  layoutPlein,
  normalizeLayout,
  parseRangeOverride,
  sectionDuFormulaire,
  WIDGET_META,
  WIDGET_TYPES,
  WIDGET_VITALS,
  type AnalyticsWidget,
  type Widget,
  type WidgetType,
} from "@/lib/dashboards";
import {
  deleteDashboard,
  insertDashboard,
  updateDashboardMeta,
  updateLayout,
  type DashboardRow,
  type DashboardWrite,
} from "@/lib/queries-dashboards";
import { getUser } from "@/lib/auth";
import {
  canCreateDashboard,
  dashboardPrincipal,
  getWritableDashboard,
  type DashboardAction,
} from "@/lib/dashboard-access";
import { forgetWidgetCache } from "@/lib/widget-data";
import { cartesDuModele, modeleTableau } from "@/lib/dashboard-templates";
import { CONTRACT_PARAMS, parseSegmentParam } from "@/lib/query-contract";

function appIdFromForm(fd: FormData): string | null {
  return String(fd.get("app_id") ?? "").trim() || null;
}

/** Révision affichée par le formulaire. Absente, l'écriture partirait à l'aveugle. */
function revisionFromForm(fd: FormData): string {
  const brut = String(fd.get("revision") ?? "").trim();
  return /^[1-9][0-9]{0,18}$/.test(brut) ? brut : "0";
}

/**
 * Contexte de filtres à reporter dans la redirection. Seuls les paramètres du
 * contrat sont repris : un champ inventé par un formulaire n'entre pas dans l'URL.
 */
function contexteFromForm(fd: FormData): URLSearchParams {
  const entrant = new URLSearchParams(String(fd.get("ctx") ?? ""));
  const sortie = new URLSearchParams();
  for (const nom of CONTRACT_PARAMS) {
    const valeur = entrant.get(nom);
    if (valeur !== null) sortie.set(nom, valeur);
  }
  return sortie;
}

/**
 * États de retour vers le tableau, chacun écrit par la page (`role="alert"`) :
 * `conflit` (révision dépassée), `refus` (valeur de carte inapplicable), `plein`
 * (24 éléments, sections comprises), `section-refusee` (titre vide, position
 * disparue). Aucun ne s'écrit sans que rien n'ait été enregistré.
 */
function retour(
  id: number,
  ctx: URLSearchParams,
  etat?: "conflit" | "refus" | "plein" | "section-refusee",
): string {
  const p = new URLSearchParams(ctx);
  if (etat) p.set(etat, "1");
  const qs = p.toString();
  return qs ? `/dashboards/${id}?${qs}` : `/dashboards/${id}`;
}

/**
 * Le tableau de bord `id`, SI l'utilisateur courant a le droit d'y faire `action` —
 * null sinon, et l'action s'arrête sans rien écrire.
 *
 * Lecture et écriture ne sont pas équivalentes : un dashboard transverse peut
 * être lu avec un filtre tenant, mais seul son admin peut le modifier. Un viewer
 * ne touche qu'à ses propres dashboards liés à une app autorisée.
 */
async function dashboardAutorise(id: number, action: DashboardAction): Promise<DashboardRow | null> {
  const principal = await dashboardPrincipal(await getUser());
  return getWritableDashboard(id, principal, action);
}

/** Un viewer ne crée que dans une app de son scope — jamais en transverse. */
async function appAutorisee(appId: string | null): Promise<boolean> {
  return canCreateDashboard(await dashboardPrincipal(await getUser()), appId);
}

/** Suite d'une écriture : conflit → retour annoté, succès → revalidation. */
function apres(id: number, ctx: URLSearchParams, write: DashboardWrite): void {
  if (write.kind === "conflict") redirect(retour(id, ctx, "conflit"));
  if (write.kind === "not_found") redirect(retour(id, ctx, "refus"));
  // La donnée d'une carte vient d'un cache court : après une écriture, elle a changé.
  forgetWidgetCache();
  revalidatePath(`/dashboards/${id}`);
}

/**
 * Retour vers la liste avec la raison d'un refus de création (W-D3) : l'écran
 * l'écrit sous le champ fautif (`role="alert"`) au lieu de ne rien dire.
 */
function retourListe(ctx: URLSearchParams, creation: "nom-vide" | "refus" | "modele-inconnu"): string {
  const p = new URLSearchParams(ctx);
  p.set("creation", creation);
  return `/dashboards?${p.toString()}`;
}

export async function createDashboardAction(fd: FormData): Promise<void> {
  const name = String(fd.get("name") ?? "").trim();
  const ctx = contexteFromForm(fd);
  // Un nom fait d'espaces passe l'attribut `required` du navigateur : le refus est dit.
  if (!name) return redirect(retourListe(ctx, "nom-vide"));
  const app_id = appIdFromForm(fd);
  if (!(await appAutorisee(app_id))) return redirect(retourListe(ctx, "refus"));
  const principal = await dashboardPrincipal(await getUser());
  const id = await insertDashboard({
    name,
    app_id,
    created_by: principal?.email ?? null,
    owner_id: principal?.accountId ?? null,
  });
  redirect(`/dashboards/${id}`);
}

/**
 * Clone d'un MODÈLE fourni (F35, W-D1) : un nouveau tableau « <Modèle> — copie »,
 * dont le cloneur est propriétaire, dans une app NOMMÉE où il a le droit de créer
 * (`canCreateDashboard`) — jamais « toutes les apps ». Le layout vient du modèle
 * (`cartesDuModele`), jamais du formulaire : on ne peut pas faire passer une carte
 * arbitraire pour un modèle.
 */
export async function cloneTemplateAction(fd: FormData): Promise<void> {
  const ctx = contexteFromForm(fd);
  const modele = modeleTableau(String(fd.get("modele") ?? ""));
  if (!modele) return redirect(retourListe(ctx, "modele-inconnu"));
  const app_id = appIdFromForm(fd);
  if (app_id === null || !(await appAutorisee(app_id))) return redirect(retourListe(ctx, "refus"));
  const principal = await dashboardPrincipal(await getUser());
  const id = await insertDashboard({
    name: `${modele.titre} — copie`,
    app_id,
    created_by: principal?.email ?? null,
    owner_id: principal?.accountId ?? null,
    layout: cartesDuModele(modele),
  });
  // L'app du clone devient celle de l'écran d'arrivée : ses cartes s'y lisent.
  ctx.set("app", app_id);
  redirect(retour(id, ctx));
}

/**
 * Clone : un NOUVEL identifiant, le cloneur pour propriétaire, la MÊME app —
 * celle sur laquelle ses droits ont déjà été vérifiés. Cloner vers une autre app
 * contournerait le périmètre ; le layout, lui, est recopié tel quel.
 */
export async function cloneDashboardAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const dash = await dashboardAutorise(id, "clone");
  if (!dash) return;
  const principal = await dashboardPrincipal(await getUser());
  const clone = await insertDashboard({
    name: `${dash.name} (copie)`.slice(0, 120),
    app_id: dash.app_id,
    created_by: principal?.email ?? null,
    owner_id: principal?.accountId ?? null,
    layout: dash.layout,
  });
  redirect(`/dashboards/${clone}`);
}

export async function renameDashboardAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const ctx = contexteFromForm(fd);
  const dash = await dashboardAutorise(id, "rename");
  if (!dash) return;
  const cible = appIdFromForm(fd);
  // Déplacer un tableau vers une autre app est un geste distinct du renommage :
  // il exige le droit de CRÉER dans l'app visée, pas seulement d'écrire ici.
  if (cible !== dash.app_id && !(await appAutorisee(cible))) return;
  apres(id, ctx, await updateDashboardMeta(id, name, cible, revisionFromForm(fd)));
}

export async function deleteDashboardAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const dash = await dashboardAutorise(id, "delete");
  if (!dash) return;
  await deleteDashboard(id);
  forgetWidgetCache();
  redirect("/dashboards");
}

export async function addWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const ctx = contexteFromForm(fd);
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
    if (!name || name.length > 100 || /[ -]/.test(name)) {
      throw new Error("nom d’événement invalide");
    }
    eventName = name;
  }
  const dash = await dashboardAutorise(id, "add_widget");
  if (!dash) return;
  // F37 — 24 éléments, sections comprises : la 25e carte est refusée, et le refus est
  // dit. Sans cette garde, `serializeLayout` la coupait sans un mot.
  if (layoutPlein(dash.layout)) return redirect(retour(id, ctx, "plein"));
  const widget: Widget = {
    kind: "v1",
    type: wtype,
    title: defaultTitle(wtype, metric, eventName),
    ...(metric ? { metric } : {}),
    ...(eventName ? { eventName } : {}),
  };
  apres(id, ctx, await updateLayout(id, [...dash.layout, widget], revisionFromForm(fd)));
}

/**
 * Position d'insertion d'une section : un entier de 0 (avant le premier élément) à
 * `longueur` (en fin de tableau). Champ absent : en fin de tableau. Toute autre
 * valeur est refusée — on ne devine pas où l'utilisateur voulait la poser.
 */
function positionDuFormulaire(brut: FormDataEntryValue | null, longueur: number): number | null {
  if (brut === null || String(brut).trim() === "") return longueur;
  const texte = String(brut).trim();
  if (!/^[0-9]{1,3}$/.test(texte)) return null;
  const position = Number(texte);
  return position <= longueur ? position : null;
}

/**
 * Ajoute un titre de section (F37, W-B12). Une section est un ÉLÉMENT du layout :
 * même geste que l'ajout d'une carte (`add_widget`), donc même garde —
 * `canMutateDashboard` : jamais un viewer non propriétaire, jamais une session
 * démo (V9). La page ne rend le formulaire qu'à qui passe cette même garde ; l'action
 * la refait, parce qu'un formulaire se rejoue. Elle compte dans `MAX_WIDGETS` : un
 * tableau plein la refuse comme il refuse une 25e carte, et le dit.
 */
export async function addSectionAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const ctx = contexteFromForm(fd);
  const dash = await dashboardAutorise(id, "add_widget");
  if (!dash) return;
  const section = sectionDuFormulaire(fd.get("title"), fd.get("question"));
  const position = positionDuFormulaire(fd.get("position"), dash.layout.length);
  if (!section.ok || position === null) return redirect(retour(id, ctx, "section-refusee"));
  if (layoutPlein(dash.layout)) return redirect(retour(id, ctx, "plein"));
  const layout: Widget[] = [...dash.layout.slice(0, position), section.value, ...dash.layout.slice(position)];
  apres(id, ctx, await updateLayout(id, layout, revisionFromForm(fd)));
}

/**
 * Enregistre une analyse de l'Explorer comme carte. Le JSON reçu est la
 * configuration v2 complète ; il retraverse l'adaptateur de lecture, donc la même
 * validation que le jsonb stocké — une configuration illisible devient une carte
 * de diagnostic plutôt qu'une écriture refusée sans explication.
 */
export async function saveAnalysisAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const ctx = contexteFromForm(fd);
  let config: unknown;
  try {
    config = JSON.parse(String(fd.get("widget") ?? ""));
  } catch {
    return;
  }
  const [widget] = normalizeLayout([config]);
  if (!widget || widget.kind !== "v2") return;
  const dash = await dashboardAutorise(id, "add_widget");
  if (!dash) return;
  // F37 — même garde que `addWidgetAction` : sur un tableau de 24 éléments, la carte
  // venue de l'Explorer est refusée, et le tableau le DIT (`plein=1`, V10). Sans elle,
  // `serializeLayout` coupait la 25e en silence après une écriture « réussie ».
  if (layoutPlein(dash.layout)) return redirect(retour(id, ctx, "plein"));

  // « Figer » transforme la fenêtre COURANTE de l'écran en fenêtre propre de la
  // carte ; sans cela, la carte suit celle du tableau de bord. Une fenêtre figée
  // invalide est refusée, jamais rabattue sur une autre.
  let rangeOverride = widget.rangeOverride;
  if (String(fd.get("fenetre") ?? "") === "freeze") {
    let brut: unknown;
    try {
      brut = JSON.parse(String(fd.get("range_override") ?? ""));
    } catch {
      return;
    }
    const fenetre = parseRangeOverride(brut);
    if (!fenetre.ok) return;
    rangeOverride = fenetre.value;
  }
  const titre = String(fd.get("title") ?? "").trim();
  const carte: AnalyticsWidget = {
    ...widget,
    ...(titre ? { title: titre.slice(0, 60) } : {}),
    rangeOverride,
  };
  // La révision est portée par cible : l'Explorer propose plusieurs tableaux de
  // bord d'un coup, chacun avec la sienne.
  const revision = String(fd.get(`revision_${id}`) ?? fd.get("revision") ?? "");
  apres(id, ctx, await updateLayout(id, [...dash.layout, carte], /^[1-9][0-9]{0,18}$/.test(revision) ? revision : "0"));
}

/**
 * Filtres et fenêtre propres d'une carte analytique. Les filtres s'AJOUTENT à ceux
 * de l'écran ; une fenêtre propre est explicite et sera affichée sur la carte.
 */
export async function configureWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  const index = Number(fd.get("index"));
  if (!Number.isInteger(id) || !Number.isInteger(index)) return;
  const ctx = contexteFromForm(fd);
  const dash = await dashboardAutorise(id, "configure_widget");
  if (!dash) return;
  const cible = dash.layout[index];
  if (!cible || cible.kind !== "v2") return;

  // Même syntaxe que le paramètre `seg` des URL : une seule écriture de segment
  // dans le produit, donc un seul refus quand elle est illisible.
  const segments = parseSegmentParam(String(fd.get("filters") ?? "").trim() || null);
  if (!segments.ok) redirect(retour(id, ctx, "refus"));

  // « keep » garde la fenêtre FIGÉE déjà enregistrée : une liste de presets ne
  // sait pas la représenter, et la retaper à chaque édition la ferait dériver.
  const preset = String(fd.get("range_preset") ?? "").trim();
  const fenetre =
    preset === "keep" ? { ok: true as const, value: cible.rangeOverride } : parseRangeOverride(preset ? { preset } : null);
  if (!fenetre.ok) redirect(retour(id, ctx, "refus"));

  const layout = [...dash.layout];
  layout[index] = { ...cible, filters: segments.value, rangeOverride: fenetre.value };
  apres(id, ctx, await updateLayout(id, layout, revisionFromForm(fd)));
}

export async function removeWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const index = Number(fd.get("index"));
  const ctx = contexteFromForm(fd);
  const dash = await dashboardAutorise(id, "remove_widget");
  if (!dash) return;
  if (!Number.isInteger(index) || index < 0 || index >= dash.layout.length) return;
  const layout = dash.layout.filter((_, i) => i !== index);
  apres(id, ctx, await updateLayout(id, layout, revisionFromForm(fd)));
}

export async function moveWidgetAction(fd: FormData): Promise<void> {
  const id = Number(fd.get("id"));
  if (!Number.isInteger(id)) return;
  const index = Number(fd.get("index"));
  const dir = String(fd.get("dir") ?? "");
  const ctx = contexteFromForm(fd);
  const dash = await dashboardAutorise(id, "reorder_widget");
  if (!dash) return;
  if (!Number.isInteger(index) || index < 0 || index >= dash.layout.length) return;
  const target = dir === "up" ? index - 1 : dir === "down" ? index + 1 : index;
  if (target < 0 || target >= dash.layout.length) return;
  const layout = [...dash.layout];
  [layout[index], layout[target]] = [layout[target], layout[index]];
  apres(id, ctx, await updateLayout(id, layout, revisionFromForm(fd)));
}
