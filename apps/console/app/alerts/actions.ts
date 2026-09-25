"use server";
// Server Actions des pages /alerts et /slo. C8 — chaque écriture est une COMMANDE
// (`lib/commandes/alertes.ts`), appelée par sa clé : la règle (administrateur de
// l'application ; de la plateforme pour « Évaluer maintenant » et un canal global),
// la lecture du formulaire, le jugement des URL sortantes et l'audit sont les
// siens, les mêmes que console-api servira. Ici : les champs du formulaire, et la
// suite de la décision.
//
// Ce fichier n'a longtemps porté AUCUNE garde : n'importe quel utilisateur
// connecté pouvait créer une règle ou un canal portant une URL de webhook
// arbitraire, sur n'importe quel app_id — une élévation de privilège et une
// écriture inter-tenant, adossées à une primitive de requête sortante. Depuis C8,
// chaque écriture filtre de plus sa ligne par son application (`where id = $1 and
// app_id = $2`) : basculer, acquitter ou supprimer ne vise plus un identifiant seul.
//
// CE QUE L'ÉCRAN VOIT D'UN REFUS. Sans session : /login ; un viewer : / (comme
// `requireAdmin`). Une URL sortante refusée revient sur la page avec le CODE du
// motif, que la page traduit — pas une exception, que Next remplacerait en
// production par l'écran d'erreur générique. Les autres refus (démonstration,
// application hors périmètre, champ invalide) lèvent leur message, comme avant C8.
import { redirect } from "next/navigation";
import type { ResultatCommande } from "@mip/console-contract";
import { revalidatePath } from "@/lib/next-cache";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";

/** Les champs d'un formulaire, en chaînes : ce que la commande lit (sans l'identifiant, qui est dans le chemin). */
function champs(fd: FormData): Record<string, string> {
  const sortie: Record<string, string> = {};
  for (const [nom, valeur] of fd.entries()) {
    if (typeof valeur === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(nom) && nom !== "id" && nom !== "app") sortie[nom] = valeur;
  }
  return sortie;
}

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();

/** La suite d'une écriture de /alerts ou /slo : `true` si elle a écrit (ou trouvé la ligne absente). */
function suite(r: ResultatCommande<unknown>, page: "/alerts" | "/slo"): void {
  if (!r.ok) {
    apresRefus(r);
    if (r.code === "demo_refusee") throw new Error("session de démonstration : lecture seule");
    throw new Error(r.message);
  }
  const d = r.data as { etat: string; message?: string; code?: string };
  if (d.etat === "url_refusee") redirect(`${page}?url_refusee=${d.code}`);
  if (d.etat === "invalide") throw new Error(d.message);
  if (d.etat === "hors_perimetre") throw new Error("app hors périmètre");
  revalidatePath(page);
}

export async function createRuleAction(fd: FormData): Promise<void> {
  suite(await executerCommande("creerRegle", { app: champ(fd, "app_id"), corps: champs(fd) }), "/alerts");
}

/**
 * La règle existante est cherchée dans SON application (`app`, champ caché de la
 * ligne) ; `app_id` peut l'envoyer dans une autre — du périmètre seulement. Sans
 * champ `app` (formulaire d'avant C8), la règle reste dans `app_id`.
 */
export async function updateRuleAction(fd: FormData): Promise<void> {
  const id = champ(fd, "id");
  if (!/^[1-9][0-9]{0,17}$/.test(id)) return;
  const app = champ(fd, "app") || champ(fd, "app_id");
  suite(await executerCommande("modifierRegle", { app, chemin: { id }, corps: champs(fd) }), "/alerts");
}

/** Le formulaire porte l'état VOULU (`active`, champ caché de la ligne), pas un « inverser ». */
export async function toggleRuleAction(fd: FormData): Promise<void> {
  const id = champ(fd, "id");
  const app = champ(fd, "app") || champ(fd, "app_id") || null;
  suite(await executerCommande("activerRegle", { app, chemin: { id }, corps: { active: champ(fd, "active") === "true" } }), "/alerts");
}

export async function ackEventAction(fd: FormData): Promise<void> {
  suite(await executerCommande("acquitterEvenement", { app: champ(fd, "app") || null, chemin: { id: champ(fd, "id") } }), "/alerts");
}

/**
 * « Évaluer maintenant » : check_alerts() + check_slo_burn(), total affiché via
 * ?fired=N — réservé à l'administrateur de la plateforme (toutes les applications).
 */
export async function evaluateNowAction(fd: FormData): Promise<void> {
  const r = await executerCommande("evaluerAlertes");
  suite(r, "/alerts");
  const fired = r.ok ? (r.data as { declenchees: number }).declenchees : 0;
  // qs = filtres globaux à préserver (app/period/device), fourni par la page
  const qs = String(fd.get("qs") ?? "");
  redirect(`/alerts${qs ? `${qs}&` : "?"}fired=${fired}`);
}

// ---------------------------------------------------------------------------
// SLO (page /slo)
// ---------------------------------------------------------------------------

export async function createSloAction(fd: FormData): Promise<void> {
  suite(await executerCommande("creerSlo", { app: champ(fd, "app_id"), corps: champs(fd) }), "/slo");
}

export async function toggleSloAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerSlo", {
    app: champ(fd, "app") || null,
    chemin: { id: champ(fd, "id") },
    corps: { active: champ(fd, "active") === "true" },
  });
  suite(r, "/slo");
}

export async function deleteSloAction(fd: FormData): Promise<void> {
  suite(await executerCommande("supprimerSlo", { app: champ(fd, "app") || null, chemin: { id: champ(fd, "id") } }), "/slo");
}

// ---------------------------------------------------------------------------
// Canaux de notification (section de la page /alerts)
// ---------------------------------------------------------------------------

export async function createChannelAction(fd: FormData): Promise<void> {
  suite(await executerCommande("creerCanal", { corps: champs(fd) }), "/alerts");
}

export async function toggleChannelAction(fd: FormData): Promise<void> {
  const r = await executerCommande("activerCanal", { chemin: { id: champ(fd, "id") }, corps: { active: champ(fd, "active") === "true" } });
  suite(r, "/alerts");
}

export async function deleteChannelAction(fd: FormData): Promise<void> {
  suite(await executerCommande("supprimerCanal", { chemin: { id: champ(fd, "id") } }), "/alerts");
}
