// Issue introuvable (F02, § 3.8 règle 4 et § 5.3.3) : même texte que le groupe
// d'erreurs — une issue regroupe des empreintes, et ses causes de disparition
// sont les mêmes. Rendu par `notFound()` : identifiant invalide ou hors périmètre.
import { Introuvable } from "@/components/states/Introuvable";

export default function IssueIntrouvable() {
  return (
    <Introuvable
      titre="Groupe introuvable"
      message="Groupe introuvable : purgé par la rétention, autre application, ou empreinte antérieure au regroupement."
      retour={{ href: "/errors", libelle: "← Tous les groupes" }}
    />
  );
}
