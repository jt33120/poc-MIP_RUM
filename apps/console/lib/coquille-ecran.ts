// LA COQUILLE DU LAYOUT (projets, schéma des dimensions, fuseaux), servie par console-api (`console.shell`) ou par son chargeur local —
// l'aiguillage est celui des écrans (`lib/ecran.ts`). Module à part : seul le
// layout l'importe, et les pages ne tirent pas les lectures de la coquille.
import type { PrincipalEcran } from "./chargeurs/commun";
import { chargerCoquille } from "./chargeurs/coquille";
import { lireCoquille, type CoquilleEcran } from "./ecran";
import { lectureSeuleSiDemo } from "./lecture-seule";

export function chargerCoquilleEcran(user: PrincipalEcran): Promise<CoquilleEcran> {
  // Le repli local d'une session de démo lit en transaction READ ONLY, comme console-api.
  return lireCoquille(() => lectureSeuleSiDemo(user?.demo, () => chargerCoquille(user)));
}
