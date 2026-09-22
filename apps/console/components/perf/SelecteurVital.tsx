"use client";
// Sélecteur « Vital » de `/pages` (F14, plan § 5.2.1) — le vital qui pilote les
// tuiles, le classement des routes et (F15) la distribution.
//
// Un réglage d'AFFICHAGE (`vital=`, lib/view-state.ts) : il ne change aucune
// population, ne suit pas la navigation, et son défaut (LCP) ne s'écrit pas dans
// l'URL. Tous les autres paramètres restent — plage, filtres, comparaison, tri : on
// change la question posée aux mêmes données, pas les données.
//
// Le groupe est le `Segmented` de la barre de filtres (un seul contrôle exclusif dans
// toute la console) ; à 390 px il défile dans son conteneur plutôt que d'élargir la page.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Segmented } from "@/components/GlobalFilters";
import { VITAUX, type VitalName } from "@/lib/fmt-ids";
import { ecrireEtatDeVue } from "@/lib/view-state";

export function SelecteurVital({ vital }: { vital: VitalName }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function choisir(cle: string) {
    const next = new URLSearchParams(sp.toString());
    const { vital: valeur } = ecrireEtatDeVue(pathname, { vital: cle });
    if (valeur === null || valeur === undefined) next.delete("vital");
    else next.set("vital", valeur);
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <span className="shrink-0 text-xs font-medium text-ink-soft">Vital</span>
      <div className="min-w-0 overflow-x-auto">
        <Segmented
          label="Vital qui pilote les tuiles et le classement"
          items={VITAUX.map((v) => ({ key: v, label: v }))}
          value={vital}
          onChange={choisir}
          availability={{ available: true }}
          testid="selecteur-vital"
        />
      </div>
    </div>
  );
}
