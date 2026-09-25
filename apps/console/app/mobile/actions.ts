"use server";
// Server Action /mobile (R5, C9) — poser la RECETTE d'une capacité mobile
// déclarée : un signal réellement reçu, lu et affiché sur un appareil. La commande
// `validerCapaciteMobile` (`lib/commandes/raccordements.ts`) : l'administrateur de
// la plateforme seul, auditée. Avant C9, `verified_at` se posait par un `update`
// direct, documenté, sans contrôle de droits.
import { revalidatePath } from "next/cache";
import { executerCommande } from "@/lib/commande-locale";
import { apresRefus } from "@/lib/commande-suite";
import { SANS_RELEASE } from "@/lib/mobile-capabilities";
import { MOBILE_RUNTIME } from "@/lib/queries-mobile";

export async function validerCapaciteAction(fd: FormData): Promise<void> {
  const release = String(fd.get("release") ?? "");
  const r = await executerCommande("validerCapaciteMobile", {
    corps: {
      app_id: String(fd.get("app") ?? ""),
      runtime: MOBILE_RUNTIME,
      release: release === SANS_RELEASE ? null : release,
      capability: String(fd.get("capability") ?? ""),
      note: String(fd.get("note") ?? ""),
    },
  });
  if (!r.ok) apresRefus(r);
  revalidatePath("/mobile");
}
