// Partie 2 de la vitrine — « Ce qu'il sait faire » (plan § 8.2, PS7 à PS9).
//
// OSSATURE (P**.2) : le titre et le chapeau, textes exacts du plan. Le contenu
// arrive avec P**.4, dans ce fichier : la barre de couverture (CouvertureBarre.tsx),
// les cartes de capacité tirées de lib/presentation-sait-faire.ts (PS7), le bloc
// « Méthode » (PS8) et le positionnement (Positionnement.tsx, PS9).
//
// RÈGLE DE LA PARTIE (§ 8.0) : n'y figurent que des lignes du document de
// couverture au verdict « déployé, non éprouvé », chacune avec sa limite ; les
// lignes déployées mais inertes vont dans « Ce qui reste ». Le chapeau le dit au
// lecteur, et tests/unit/couverture-site.test.ts le vérifie sur les cartes.
import { Partie } from "@/components/presentation/Partie";

export function SaitFaire() {
  return (
    <Partie
      id="sait-faire"
      chapeau={
        <>
          Ne figurent ici que les capacités que le document de couverture classe « déployé, non
          éprouvé » : le code est en service et ses tests passent, mais il n&apos;a jamais rencontré de
          données réellement ingérées. Aucune capacité n&apos;a encore de meilleur verdict. Chacune est
          donnée avec sa limite.
        </>
      }
    />
  );
}
