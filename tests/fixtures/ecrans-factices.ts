// Des chargeurs d'écrans FACTICES pour `creerTable` : la coquille vide, et un
// chargeur par écran du contrat (`ECRANS`) qui rend ce qu'il a reçu — pour les
// tests du pipeline, de l'identité et de la doc, qui n'ont pas de base d'écrans.
// Les vrais chargeurs, sur une vraie base, sont dans la matrice d'autorisations
// (`tests/contract/console-api-authz.test.ts`) et les tests des écrans.
import { ECRANS, type CleEcran } from "@mip/console-contract";
import type { ChargeurEcran, ChargeursEcrans } from "@mip/console-api";

const recu: ChargeurEcran = async (principal, parametres, chemin) => ({ principal, parametres, chemin });

export const ECRANS_FACTICES: ChargeursEcrans = {
  coquille: async () => ({ projets: { ok: true as const, data: [] }, schema: { ok: true as const, data: [] }, fuseaux: {}, tickets: null }),
  pages: Object.fromEntries((Object.keys(ECRANS) as CleEcran[]).map((cle) => [cle, recu])) as ChargeursEcrans["pages"],
  refusDeFiltre: () => null,
};
