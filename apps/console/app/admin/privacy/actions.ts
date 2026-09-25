"use server";
// Server Actions /admin/privacy (Lot 5b, DSAR) — recherche d'une identité métier,
// effacement des données d'une personne (droit à l'effacement RGPD). C10 — chaque
// demande est une COMMANDE (`lib/commandes/vie-privee.ts`) : l'administrateur de
// l'application (« toutes » : la plateforme), auditée — refus compris. Ici : le
// formulaire, et la redirection tirée de la décision.
//
// L'identité brute ne fait que traverser : lue du formulaire, passée dans le CORPS
// de la commande, qui la hache. Seul le HMAC revient, et seul lui entre dans une
// URL. L'effacement est irréversible : on exige la ressaisie exacte de l'identifiant.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();
const typeDe = (v: string) => (v === "user" || v === "account" ? v : null);

/** Hache l'identité saisie (dans la commande) ; l'URL ne reçoit que le HMAC. */
export async function searchIdentityAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const kind = typeDe(champ(fd, "kind"));
  if (!app || app === "all") redirect("/admin/privacy?error=app");
  if (!kind) redirect("/admin/privacy?error=kind");
  const r = await executerCommande("rechercherIdentite", { app, corps: { kind: kind!, identity: String(fd.get("identity") ?? "") } });
  if (!r.ok) {
    apresRefus(r);
    redirect("/admin/privacy?error=app");
  }
  if (r.data.etat === "vide") redirect("/admin/privacy?error=empty");
  if (r.data.etat === "indisponible") redirect("/admin/privacy?error=secret");
  redirect(`/admin/privacy?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${r.data.hash}`);
}

/** Effacement par HMAC ; l'identité ressaisie est hachée par la commande et comparée. */
export async function eraseIdentityAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const kind = typeDe(champ(fd, "kind"));
  const hash = champ(fd, "identity_hash");
  if (!app || app === "all") redirect("/admin/privacy?error=app");
  if (!kind) redirect("/admin/privacy?error=kind");
  const retour = `/admin/privacy?app=${encodeURIComponent(app)}&kind=${kind}&identity_hash=${encodeURIComponent(hash)}`;
  const r = await executerCommande("effacerIdentite", {
    app,
    corps: { kind: kind!, identity_hash: hash, confirm_identity: String(fd.get("confirm_identity") ?? "") },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect(`${retour}&error=confirm`);
  }
  if (r.data.etat === "confirmation") redirect(`${retour}&error=confirm`);
  if (r.data.etat === "indisponible") redirect(`${retour}&error=secret`);
  revalidatePath("/admin/privacy");
  redirect(`/admin/privacy?app=${encodeURIComponent(app)}&erased=${r.data.lignes}`);
}

/** Effacement par identifiant de visiteur : toutes les données, en une transaction. */
export async function eraseUserAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app") || "all";
  const visitorId = champ(fd, "user");
  const retour = `/admin/privacy?visitor_app=${encodeURIComponent(app)}&user=${encodeURIComponent(visitorId)}`;
  if (!visitorId) redirect("/admin/privacy?error=empty");
  const r = await executerCommande("effacerVisiteur", { corps: { app, visitor_id: visitorId, confirm: String(fd.get("confirm") ?? "") } });
  if (!r.ok) {
    apresRefus(r);
    redirect(`${retour}&error=perimetre`);
  }
  const d = r.data;
  if (d.etat === "vide") redirect("/admin/privacy?error=empty");
  if (d.etat === "confirmation") redirect(`${retour}&error=confirm`);
  if (d.etat === "interdit" || d.etat === "invalide") redirect(`${retour}&error=perimetre`);
  if (d.etat === "refus") redirect(`${retour}&error=${d.motif}`);
  revalidatePath("/admin/privacy");
  redirect(`/admin/privacy?visitor_app=${encodeURIComponent(app)}&erased=${d.lignes}`);
}
