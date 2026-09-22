// Écran composé à vide : tous les blocs ont été décochés dans la fenêtre de
// composition. Sans ce mot, la page s'affiche entièrement blanche et se lit
// comme une panne — alors que c'est un choix de l'utilisateur, réversible en
// un clic sur la roue de la sidebar.
//
// État « composé à vide » du vocabulaire commun (§ 3.8) : même texte qu'avant F02,
// rendu dans le cadre des états (`CadreEtat`, teinte neutre, rôle `status`).
import { CadreEtat } from "@/components/states/EtatSurface";

export function TousEteints() {
  return (
    <CadreEtat ton="neutre" role="status" etat="compose_vide" className="text-center">
      <p className="text-sm font-semibold text-ink">Cet écran est vide parce que vous l&apos;avez composé ainsi.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Tous les blocs sont décochés. Rouvrez la roue de réglage, à droite de l&apos;entrée de menu, pour en
        réactiver.
      </p>
    </CadreEtat>
  );
}
