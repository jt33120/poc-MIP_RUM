// Groupe d'erreurs introuvable (F02, § 3.8 règle 4 et § 5.3.3). Rendu par
// `notFound()` : empreinte invalide, absente du périmètre, ou groupe disparu
// entre la résolution et la lecture du détail (rétention).
import { Introuvable } from "@/components/states/Introuvable";

export default function GroupeIntrouvable() {
  return (
    <Introuvable
      titre="Groupe introuvable"
      message="Groupe introuvable : purgé par la rétention, autre application, ou empreinte antérieure au regroupement."
      retour={{ href: "/errors", libelle: "← Tous les groupes" }}
    />
  );
}
