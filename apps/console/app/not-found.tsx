// 404 de la console (toute URL inconnue, et tout `notFound()` sans `not-found.tsx`
// plus proche) : en français, dans la coquille, avec un lien de retour.
//
// Sans ce fichier, Next rendait son 404 anglais par défaut (« This page could not
// be found ») — relevé par la recette du 26/09/2026. Rendu dans le layout racine :
// la sidebar reste là pour repartir ailleurs. Le texte ne distingue pas « n'existe
// pas » de « hors de votre périmètre » (voir `Introuvable`).
import { Introuvable } from "@/components/states/Introuvable";

export default function PageIntrouvable() {
  return (
    <Introuvable
      titre="Page introuvable"
      message="Cette adresse ne correspond à aucun écran de la console : le lien est peut-être incomplet, ou l'élément demandé n'existe plus ou n'est pas dans votre périmètre."
      retour={{ href: "/", libelle: "← Revenir à la vue d'ensemble" }}
    />
  );
}
