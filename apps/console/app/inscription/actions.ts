"use server";
// L'inscription en libre-service (30/09/2026) : le compte et son premier site, en une
// fois, par console-api (`POST /v1/auth/accounts`) — seul le service l'écrit, sous
// ses plafonds (par IP, par jour, débit du site). La console applique d'abord les
// mêmes règles de saisie (`verifierInscription` du contrat), pour dire tout de suite
// quel champ ne va pas ; non branchée, elle dit l'inscription fermée.
//
// Réussie : la session est posée comme à la connexion, et la clé d'ingestion,
// rendue une fois, part au formulaire (`FormulaireSecret`), qui la remet à la page
// d'intégration du site — le snippet y est prêt, clé comprise.
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { INSCRIPTION, verifierInscription } from "@mip/console-contract";
import { SESSION_COOKIE } from "@/lib/auth";
import { backend } from "@/lib/backend";
import { ipVisiteur } from "@/lib/ip-visiteur";
import { cleDe, type SecretRemis } from "@/lib/secret-remis";

/** Le code d'un refus du service → l'erreur que la page sait dire. */
const ERREUR_DU_SERVICE: Record<string, string> = {
  conflit: "existe",
  debit_depasse: "plafond",
  route_inconnue: "fermee",
};

const champ = (fd: FormData, nom: string) => String(fd.get(nom) ?? "");

export async function inscrireAction(_precedent: SecretRemis, fd: FormData): Promise<SecretRemis> {
  const corps = {
    email: champ(fd, "email").trim(),
    mot_de_passe: champ(fd, "mot_de_passe"),
    nom_site: champ(fd, "nom_site").trim(),
    url_site: champ(fd, "url_site").trim(),
  };
  if (fd.get("conditions") !== "on") redirect("/inscription?erreur=conditions");
  const saisie = verifierInscription(corps);
  if (!saisie.ok) redirect(`/inscription?erreur=${saisie.champ}`);
  if (!backend().estBranche()) redirect("/inscription?erreur=fermee");

  const h = await headers();
  const r = await backend().appeler(INSCRIPTION, { corps }, { ipVisiteur: ipVisiteur(h), requestId: h.get("x-request-id") ?? undefined });
  if (!r.ok) {
    const refuse = r.code === "entree_invalide" ? (r.details as { champ?: string } | undefined)?.champ : undefined;
    redirect(`/inscription?erreur=${refuse ?? ERREUR_DU_SERVICE[r.code] ?? "indisponible"}`);
  }
  const { session, app, cle } = r.data;
  (await cookies()).set(SESSION_COOKIE, session.jeton, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expire_le),
  });
  return { nom: cleDe(app), valeur: cle, pour: app, aller: `/select/new?app=${encodeURIComponent(app)}&mode=sdk&cree=1` };
}
