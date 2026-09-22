// Trace introuvable (F02, § 3.8 règle 4 et § 5.9). Rendu par `notFound()` : aucun
// span lisible dans le périmètre. Choix de sécurité conservé : une trace dont il
// ne reste rien ici est introuvable, sans dire si elle existe ailleurs.
import { Introuvable } from "@/components/states/Introuvable";

export default function TraceIntrouvable() {
  return (
    <Introuvable
      titre="Trace introuvable"
      message="Trace introuvable ou hors périmètre : purgée par la rétention, ou rattachée à une autre application."
      retour={{ href: "/tracing", libelle: "← Toutes les traces" }}
    />
  );
}
