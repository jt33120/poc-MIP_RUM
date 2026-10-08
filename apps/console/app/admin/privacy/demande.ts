// Le cookie de la demande RGPD en cours (`lib/demande-rgpd.ts`) : poser, lire, oublier.
// Serveur seulement (actions, page, export) ; le secret est celui des sessions de
// la console, dérivé pour cet usage.
import { cookies } from "next/headers";
import { resolveAuthSecret } from "@/lib/auth";
import {
  CHEMIN_DEMANDE_RGPD,
  COOKIE_DEMANDE_RGPD,
  DUREE_DEMANDE_RGPD_S,
  ouvrirDemande,
  scellerDemande,
  type DemandeRgpd,
} from "@/lib/demande-rgpd";

const OPTIONS = {
  httpOnly: true,
  sameSite: "strict",
  secure: process.env.NODE_ENV === "production",
  path: CHEMIN_DEMANDE_RGPD,
} as const;

export async function poserDemande(d: DemandeRgpd): Promise<void> {
  (await cookies()).set(COOKIE_DEMANDE_RGPD, await scellerDemande(d, resolveAuthSecret()), { ...OPTIONS, maxAge: DUREE_DEMANDE_RGPD_S });
}

export async function lireDemande(): Promise<DemandeRgpd | null> {
  return ouvrirDemande((await cookies()).get(COOKIE_DEMANDE_RGPD)?.value, resolveAuthSecret());
}

export async function oublierDemande(): Promise<void> {
  (await cookies()).set(COOKIE_DEMANDE_RGPD, "", { ...OPTIONS, maxAge: 0 });
}
