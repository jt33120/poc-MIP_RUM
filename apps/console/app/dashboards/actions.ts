"use server";
// Server Actions des tableaux de bord. C6 — chaque écriture est une COMMANDE
// (`lib/commandes/tableaux.ts`), appelée par sa clé : les droits (la porte unique
// `lib/dashboard-access.ts`), la validation, la révision et l'audit sont les
// siens, les mêmes que console-api servira. Ici : la lecture du formulaire, et la
// suite de la DÉCISION rendue — revalidation, ou retour annoté.
//
// CHAQUE ÉCRITURE CITE SA RÉVISION (P6.5). Le formulaire porte la révision
// AFFICHÉE ; si la ligne a bougé entre-temps, l'écriture est refusée et l'écran
// revient avec `conflit=1` — la carte de l'autre onglet n'est pas écrasée. Le
// contexte de filtres (`ctx`) voyage avec le formulaire : une redirection ne doit
// pas ramener l'utilisateur sur une autre fenêtre que celle qu'il regardait.
import { redirect } from "next/navigation";
import { revalidatePath } from "@/lib/next-cache";
import { executerCommande, type SortieDe } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";
import { modeleTableau } from "@/lib/dashboard-templates";
import { CONTRACT_PARAMS } from "@/lib/query-contract";

function appIdFromForm(fd: FormData): string | null {
  return String(fd.get("app_id") ?? "").trim() || null;
}

/** Révision affichée par le formulaire. Absente ou illisible : « 0 », qu'aucune ligne ne porte — un conflit, jamais une écriture à l'aveugle. */
function revisionFromForm(fd: FormData, nom = "revision"): string {
  const brut = String(fd.get(nom) ?? "").trim();
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
  id: string,
  ctx: URLSearchParams,
  etat?: "conflit" | "refus" | "plein" | "section-refusee",
): string {
  const p = new URLSearchParams(ctx);
  if (etat) p.set(etat, "1");
  const qs = p.toString();
  return qs ? `/dashboards/${id}?${qs}` : `/dashboards/${id}`;
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

/** L'identifiant du tableau que porte le formulaire, s'il est entier. */
function idFromForm(fd: FormData): string | null {
  const brut = String(fd.get("id") ?? "").trim();
  return /^[1-9][0-9]{0,17}$/.test(brut) ? brut : null;
}

type Edition = SortieDe<"ajouterCarte">;

/**
 * Suite d'une écriture sur un tableau existant : conflit, refus, tableau plein →
 * retour annoté ; succès → revalidation. `interdit` (pas le droit, ou tableau
 * absent : indiscernables) et `invalide` (formulaire rejoué sur une carte qui a
 * disparu) n'écrivent rien et ne disent rien — comme avant C6.
 */
function apres(id: string, ctx: URLSearchParams, r: Awaited<ReturnType<typeof executerCommande>>): void {
  if (!r.ok) {
    apresRefus(r);
    return;
  }
  const decision = r.data as Edition;
  switch (decision.etat) {
    case "ok":
      revalidatePath(`/dashboards/${id}`);
      return;
    case "conflit":
      redirect(retour(id, ctx, "conflit"));
    case "introuvable":
    case "refus":
      redirect(retour(id, ctx, "refus"));
    case "plein":
      redirect(retour(id, ctx, "plein"));
    case "section_refusee":
      redirect(retour(id, ctx, "section-refusee"));
    default:
      return;
  }
}

export async function createDashboardAction(fd: FormData): Promise<void> {
  const name = String(fd.get("name") ?? "").trim();
  const ctx = contexteFromForm(fd);
  // Un nom fait d'espaces passe l'attribut `required` du navigateur : le refus est dit.
  if (!name) return redirect(retourListe(ctx, "nom-vide"));
  const r = await executerCommande("creerTableau", { corps: { name, app_id: appIdFromForm(fd) } });
  if (!r.ok) apresRefus(r);
  if (!r.ok || r.data.etat !== "cree") return redirect(retourListe(ctx, "refus"));
  redirect(`/dashboards/${r.data.id}`);
}

/**
 * Clone d'un MODÈLE fourni (F35, W-D1) : un nouveau tableau « <Modèle> — copie »,
 * dans une app NOMMÉE où la session peut créer — jamais « toutes les apps ».
 */
export async function cloneTemplateAction(fd: FormData): Promise<void> {
  const ctx = contexteFromForm(fd);
  const cle = String(fd.get("modele") ?? "");
  // Un modèle inconnu se dit avant toute autre chose : le formulaire ne vaut rien.
  if (!modeleTableau(cle)) return redirect(retourListe(ctx, "modele-inconnu"));
  const app_id = appIdFromForm(fd);
  if (app_id === null) return redirect(retourListe(ctx, "refus"));
  const r = await executerCommande("clonerModele", { chemin: { modele: cle }, corps: { app_id } });
  if (!r.ok) apresRefus(r);
  if (!r.ok) return redirect(retourListe(ctx, "refus"));
  if (r.data.etat === "modele_inconnu") return redirect(retourListe(ctx, "modele-inconnu"));
  if (r.data.etat !== "cree") return redirect(retourListe(ctx, "refus"));
  // L'app du clone devient celle de l'écran d'arrivée : ses cartes s'y lisent.
  ctx.set("app", r.data.app);
  redirect(retour(String(r.data.id), ctx));
}

/**
 * Clone : un NOUVEL identifiant, le cloneur pour propriétaire, la MÊME app —
 * celle sur laquelle ses droits ont déjà été vérifiés.
 */
export async function cloneDashboardAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  const r = await executerCommande("clonerTableau", { chemin: { id } });
  if (!r.ok) return apresRefus(r);
  if (r.data.etat === "cree") redirect(`/dashboards/${r.data.id}`);
}

export async function renameDashboardAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return;
  const r = await executerCommande("modifierTableau", {
    chemin: { id },
    corps: { name, app_id: appIdFromForm(fd), revision: revisionFromForm(fd) },
  });
  apres(id, contexteFromForm(fd), r);
}

export async function deleteDashboardAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  const r = await executerCommande("supprimerTableau", { chemin: { id } });
  if (!r.ok) return apresRefus(r);
  if (r.data.etat === "ok") redirect("/dashboards");
}

export async function addWidgetAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  const metric = String(fd.get("metric") ?? "");
  const eventName = String(fd.get("event_name") ?? "");
  const r = await executerCommande("ajouterCarte", {
    chemin: { id },
    corps: {
      type: String(fd.get("type") ?? ""),
      ...(metric ? { metric } : {}),
      ...(eventName ? { event_name: eventName } : {}),
      revision: revisionFromForm(fd),
    },
  });
  // Un type de carte inconnu est un formulaire forgé : rien n'est écrit, et le refus est dit.
  if (!r.ok && r.code === "entree_invalide") return redirect(retour(id, contexteFromForm(fd), "refus"));
  apres(id, contexteFromForm(fd), r);
}

/**
 * Ajoute un titre de section (F37, W-B12). Une section est un ÉLÉMENT du layout :
 * même geste que l'ajout d'une carte, donc même garde — jamais un viewer non
 * propriétaire, jamais une session démo (V9). Elle compte dans `MAX_WIDGETS`.
 */
export async function addSectionAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  const question = String(fd.get("question") ?? "");
  const position = String(fd.get("position") ?? "");
  const r = await executerCommande("ajouterSection", {
    chemin: { id },
    corps: {
      title: String(fd.get("title") ?? ""),
      ...(question ? { question } : {}),
      ...(position ? { position } : {}),
      revision: revisionFromForm(fd),
    },
  });
  if (!r.ok && r.code === "entree_invalide") return redirect(retour(id, contexteFromForm(fd), "section-refusee"));
  apres(id, contexteFromForm(fd), r);
}

/**
 * Enregistre une analyse de l'Explorer comme carte. Le JSON reçu est la
 * configuration v2 complète ; la commande la fait retraverser l'adaptateur de
 * lecture, donc la même validation que le jsonb stocké.
 */
export async function saveAnalysisAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  if (!id) return;
  let widget: unknown;
  let rangeOverride: unknown;
  try {
    widget = JSON.parse(String(fd.get("widget") ?? ""));
    // « Figer » : la fenêtre COURANTE de l'écran devient celle de la carte.
    if (String(fd.get("fenetre") ?? "") === "freeze") rangeOverride = JSON.parse(String(fd.get("range_override") ?? ""));
  } catch {
    return;
  }
  const titre = String(fd.get("title") ?? "").trim();
  const figer = String(fd.get("fenetre") ?? "") === "freeze";
  const r = await executerCommande("enregistrerAnalyse", {
    chemin: { id },
    corps: {
      widget,
      ...(titre ? { title: titre } : {}),
      ...(figer ? { fenetre: "freeze", range_override: rangeOverride } : {}),
      // La révision est portée par cible : l'Explorer propose plusieurs tableaux de
      // bord d'un coup, chacun avec la sienne.
      revision: fd.get(`revision_${id}`) !== null ? revisionFromForm(fd, `revision_${id}`) : revisionFromForm(fd),
    },
  });
  if (!r.ok && r.code === "entree_invalide") return;
  apres(id, contexteFromForm(fd), r);
}

/**
 * Filtres et fenêtre propres d'une carte analytique. Les filtres s'AJOUTENT à ceux
 * de l'écran ; une fenêtre propre est explicite et sera affichée sur la carte.
 */
export async function configureWidgetAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  const index = String(fd.get("index") ?? "").trim();
  if (!id || !/^(0|[1-9][0-9]{0,2})$/.test(index)) return;
  const r = await executerCommande("configurerCarte", {
    chemin: { id, index },
    corps: {
      filters: String(fd.get("filters") ?? ""),
      range_preset: String(fd.get("range_preset") ?? ""),
      revision: revisionFromForm(fd),
    },
  });
  if (!r.ok && r.code === "entree_invalide") return redirect(retour(id, contexteFromForm(fd), "refus"));
  apres(id, contexteFromForm(fd), r);
}

export async function removeWidgetAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  const index = String(fd.get("index") ?? "").trim();
  if (!id || !/^(0|[1-9][0-9]{0,2})$/.test(index)) return;
  const r = await executerCommande("retirerCarte", { chemin: { id, index }, corps: { revision: revisionFromForm(fd) } });
  apres(id, contexteFromForm(fd), r);
}

export async function moveWidgetAction(fd: FormData): Promise<void> {
  const id = idFromForm(fd);
  const index = String(fd.get("index") ?? "").trim();
  const dir = String(fd.get("dir") ?? "");
  if (!id || !/^(0|[1-9][0-9]{0,2})$/.test(index) || (dir !== "up" && dir !== "down")) return;
  const r = await executerCommande("deplacerCarte", { chemin: { id, index }, corps: { dir, revision: revisionFromForm(fd) } });
  apres(id, contexteFromForm(fd), r);
}
