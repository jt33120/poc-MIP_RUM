// Dernière section de la vitrine — « Le détail, ligne par ligne » (plan § 8.2, PS11).
//
// OSSATURE (P**.2) : le titre et le chapeau. Le contenu arrive avec P**.6, dans ce
// fichier : toutes les capacités du document de couverture, une famille par
// `<details>` (depuis lib/couverture.ts), puis Specs.tsx sous une frontière
// <Suspense> — c'est la seule partie de la page qui lit la base.
//
// La date du chapeau est CELLE DU RELEVÉ (lib/couverture.ts), jamais tapée ici :
// un nouveau relevé la change au build suivant.
import { Partie } from "@/components/presentation/Partie";
import { RELEVE } from "@/lib/couverture";

export function Annexe() {
  return (
    <Partie
      id="detail"
      chapeau={
        <>
          Le document de couverture du {RELEVE}, tel quel : une ligne par capacité, son verdict et
          sa limite.
        </>
      }
    />
  );
}
