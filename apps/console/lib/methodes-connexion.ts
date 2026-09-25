// Les moyens de se connecter qu'offre la plateforme : mot de passe toujours, SSO
// et démo selon la configuration (C1c).
//
// Branchée sur console-api, la console ne détient plus la configuration
// d'identité : le service la dit (`GET /v1/auth/methods`, gardé une minute par
// le cache de Next), et `OIDC_*` comme `DEMO_USER_APPS` peuvent quitter Vercel.
// Non branchée — ou si le service ne répond pas —, les variables d'aujourd'hui.
import { METHODES } from "@mip/console-contract";
import { backend } from "./backend";
import { demoConfig } from "./demo";
import { isOidcEnabled } from "./oidc";

export interface Methodes {
  readonly sso: boolean;
  readonly demo: boolean;
}

export async function methodesConnexion(client: Pick<ReturnType<typeof backend>, "appeler" | "estBranche"> = backend()): Promise<Methodes> {
  const locales = { sso: isOidcEnabled(), demo: demoConfig() !== null };
  if (!client.estBranche()) return locales;
  const r = await client.appeler(METHODES, {}, { revalider: 60 });
  return r.ok ? { sso: r.data.sso, demo: r.data.demo } : locales;
}
