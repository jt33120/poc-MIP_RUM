"use server";
// Server Actions /admin/privacy (Lot 5b, DSAR) — recherche d'une identité métier ou
// d'un visiteur, effacement des données d'une personne (droit à l'effacement RGPD).
// C10 — chaque demande est une COMMANDE (`lib/commandes/vie-privee.ts`) :
// l'administrateur de l'application (« toutes » : la plateforme), auditée — refus
// compris. Ici : le formulaire, et la redirection tirée de la décision.
//
// AUCUN IDENTIFIANT DE PERSONNE DANS UNE URL (audit du 07/10/2026). L'identité brute
// ne fait que traverser : lue du formulaire, passée dans le CORPS de la commande,
// qui la hache. Son HMAC, comme un identifiant de visiteur, est SCELLÉ dans le cookie
// de la demande en cours (`lib/demande-rgpd.ts`) ; les redirections ne portent que
// l'application, le type d'identité et l'issue. L'effacement est irréversible : on
// exige la ressaisie exacte de l'identifiant.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { executerCommande } from "@/lib/commande";
import { apresRefus } from "@/lib/commande-suite";
import { oublierDemande, poserDemande } from "./demande";

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "").trim();
const typeDe = (v: string) => (v === "user" || v === "account" ? v : null);
const ecran = (params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return q ? `/admin/privacy?${q}` : "/admin/privacy";
};

/** Hache l'identité saisie (dans la commande) ; son HMAC part dans le cookie de la demande, pas dans l'URL. */
export async function searchIdentityAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const kind = typeDe(champ(fd, "kind"));
  if (!app || app === "all") redirect(ecran({ error: "app" }));
  if (!kind) redirect(ecran({ error: "kind" }));
  const r = await executerCommande("rechercherIdentite", { app, corps: { kind: kind!, identity: String(fd.get("identity") ?? "") } });
  if (!r.ok) {
    apresRefus(r);
    redirect(ecran({ error: "app" }));
  }
  if (r.data.etat === "vide") redirect(ecran({ error: "empty" }));
  if (r.data.etat === "indisponible") redirect(ecran({ error: "secret" }));
  await poserDemande({ type: "identite", app, kind: kind!, hash: r.data.hash });
  redirect(ecran());
}

/** Recherche par identifiant de visiteur : en POST, scellée dans le cookie de la demande. */
export async function searchVisitorAction(fd: FormData): Promise<void> {
  const app = champ(fd, "visitor_app") || "all";
  const visitorId = champ(fd, "user");
  if (!visitorId) redirect(ecran({ error: "empty" }));
  if (visitorId.length > 200) redirect(ecran({ error: "empty" }));
  await poserDemande({ type: "visiteur", app, visitorId });
  redirect(ecran());
}

/** Effacement par HMAC ; l'identité ressaisie est hachée par la commande et comparée. */
export async function eraseIdentityAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app");
  const kind = typeDe(champ(fd, "kind"));
  const hash = champ(fd, "identity_hash");
  if (!app || app === "all") redirect(ecran({ error: "app" }));
  if (!kind) redirect(ecran({ error: "kind" }));
  // Un refus garde la demande (cookie) : l'écran la montre de nouveau, avec l'erreur.
  const r = await executerCommande("effacerIdentite", {
    app,
    corps: { kind: kind!, identity_hash: hash, confirm_identity: String(fd.get("confirm_identity") ?? "") },
  });
  if (!r.ok) {
    apresRefus(r);
    redirect(ecran({ error: "confirm" }));
  }
  if (r.data.etat === "confirmation") redirect(ecran({ error: "confirm" }));
  if (r.data.etat === "indisponible") redirect(ecran({ error: "secret" }));
  await oublierDemande();
  revalidatePath("/admin/privacy");
  redirect(ecran({ app, erased: String(r.data.lignes) }));
}

/** Effacement par identifiant de visiteur : toutes les données, en une transaction. */
export async function eraseUserAction(fd: FormData): Promise<void> {
  const app = champ(fd, "app") || "all";
  const visitorId = champ(fd, "user");
  if (!visitorId) redirect(ecran({ error: "empty" }));
  const r = await executerCommande("effacerVisiteur", { corps: { app, visitor_id: visitorId, confirm: String(fd.get("confirm") ?? "") } });
  if (!r.ok) {
    apresRefus(r);
    redirect(ecran({ error: "perimetre" }));
  }
  const d = r.data;
  if (d.etat === "vide") redirect(ecran({ error: "empty" }));
  if (d.etat === "confirmation") redirect(ecran({ error: "confirm" }));
  if (d.etat === "interdit" || d.etat === "invalide") redirect(ecran({ error: "perimetre" }));
  if (d.etat === "refus") redirect(ecran({ error: d.motif }));
  await oublierDemande();
  revalidatePath("/admin/privacy");
  redirect(ecran({ visitor_app: app, erased: String(d.lignes) }));
}
