// Bandeau d'échantillonnage d'un écran d'usage (F40, règle S7) — SSR.
//
// Placé au-dessus des figures qu'il qualifie : « Échantillonné : chaque session
// avait au moins p % de chances d'être retenue ; comptes observés, non
// extrapolés. » Rien n'est rendu quand rien n'est échantillonné ; une lecture en
// échec rend un `partiel` qui le dit (lib/echantillonnage.ts). Le texte lui-même
// est celui d'`EtatSurface` : un seul vocabulaire pour tous les écrans.
import type { EchantillonnageSessions } from "@/lib/echantillonnage";
import { etatLectureEchantillonnage } from "@/lib/echantillonnage";
import type { Lecture } from "@/lib/lecture";
import { EtatSurface } from "./EtatSurface";

export function BandeauEchantillonnage({ lecture }: { lecture: Lecture<EchantillonnageSessions> }) {
  const etat = etatLectureEchantillonnage(lecture);
  if (!etat) return null;
  return (
    <div className="mb-6" data-testid="bandeau-echantillonnage">
      <EtatSurface etat={etat} />
    </div>
  );
}
