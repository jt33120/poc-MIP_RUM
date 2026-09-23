// Partie 3 de la vitrine — « Ce qui reste pour un vrai outil de RUM » (plan § 8.2, PS10).
//
// OSSATURE (P**.2) : le titre et le chapeau, textes exacts du plan. Le contenu
// arrive avec P**.5, dans ce fichier : une carte par point de
// lib/presentation-reste.ts (R1 à R9), avec « Ce qui manque », « Ce qui le
// débloque » et « Qui décide ». Les capacités déployées mais inertes (D12, D14)
// y figurent, et nulle part dans la partie 2.
import { Partie } from "@/components/presentation/Partie";

export function Reste() {
  return (
    <Partie
      id="reste"
      chapeau={
        <>
          Ce qui sépare ce POC d&apos;un outil qu&apos;on met en service chez un client. Pour chaque
          point : ce qui manque, ce qui le débloquerait, et qui décide.
        </>
      }
    />
  );
}
