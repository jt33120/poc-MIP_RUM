// Session introuvable (F02, § 3.8 règle 4). Rendu par `notFound()` : session
// absente (rétention), d'une application hors du périmètre, ou d'une autre
// application que celle annoncée par le lien. Les trois causes sont dites
// ensemble : les distinguer révélerait qu'un identifiant d'un autre tenant existe.
import { Introuvable } from "@/components/states/Introuvable";

export default function SessionIntrouvable() {
  return (
    <Introuvable
      titre="Session introuvable"
      message="Session introuvable ou hors périmètre : purgée par la rétention, ou rattachée à une autre application."
      retour={{ href: "/sessions", libelle: "← Toutes les sessions" }}
    />
  );
}
