"use server";
// Server action — triage d'un groupe d'erreurs (résolu / ignoré / rouvert).
// C7 : l'écriture est la COMMANDE `trierGroupe` (`lib/commandes/issues.ts`) —
// réservée à l'administrateur de l'application du groupe, hors démo, tracée dans
// audit_log dans la même transaction. Même prédicat que la page, qui ne rend ses
// boutons qu'à qui peut s'en servir (V9) : la commande le refait, parce qu'un
// formulaire se rejoue.
import { revalidatePath } from "@/lib/next-cache";
import { executerCommande } from "@/lib/commande-locale";

export async function setErrorStatusAction(fd: FormData): Promise<void> {
  const appId = String(fd.get("app_id") ?? "").trim();
  const fingerprint = String(fd.get("fingerprint") ?? "").trim();
  if (!appId || !fingerprint) return;
  const r = await executerCommande("trierGroupe", {
    app: appId,
    chemin: { fingerprint },
    corps: { status: String(fd.get("status") ?? "") },
  });
  if (!r.ok) return;
  revalidatePath(`/errors/${fingerprint}`);
  revalidatePath("/errors");
}
